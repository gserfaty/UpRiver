import codecs
import hashlib
import hmac
import json
import lzma
import os
import re
import sqlite3
import stat
import tempfile
import zipfile
import zlib
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator, model_validator
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from . import db, runner

NAME_RE = r"^[A-Za-z0-9_.-]{1,64}$"
MAX_ZIP_MEMBERS = 10_000
LOG_CHUNK = 64 * 1024


@asynccontextmanager
async def lifespan(app):
    # Read env here (not at import) so tests can monkeypatch it.
    team, admin = os.environ.get("UPRIVER_TOKEN"), os.environ.get("UPRIVER_ADMIN_TOKEN")
    if not team or not admin:
        raise RuntimeError("UPRIVER_TOKEN and UPRIVER_ADMIN_TOKEN must be set")
    data = Path(os.environ.get("UPRIVER_DATA", "data")).resolve()
    (data / "tmp").mkdir(parents=True, exist_ok=True)
    app.state.team, app.state.admin, app.state.data = team, admin, data
    app.state.executors = int(os.environ.get("UPRIVER_EXECUTORS", "2"))
    app.state.max_upload = int(os.environ.get("UPRIVER_MAX_UPLOAD_MB", "200")) * 1024 * 1024
    app.state.db = str(data / "upriver.db")
    db.init(app.state.db)
    runner.start(app.state.db, data, app.state.executors)
    try:
        yield
    finally:
        runner.shutdown()


app = FastAPI(lifespan=lifespan)


# ---- auth ----
def _token(request: Request, authorization: str | None):
    scheme, _, tok = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not tok:  # RFC 7235: scheme is case-insensitive
        raise HTTPException(401, "missing bearer token")
    s = request.app.state
    # evaluate both so timing doesn't reveal which matched
    is_admin = hmac.compare_digest(tok.encode(), s.admin.encode())
    is_team = hmac.compare_digest(tok.encode(), s.team.encode())
    if not (is_admin or is_team):
        raise HTTPException(401, "bad token")
    return is_admin


def team_auth(request: Request, authorization: str | None = Header(None)):
    _token(request, authorization)


def admin_auth(request: Request, authorization: str | None = Header(None)):
    if not _token(request, authorization):
        raise HTTPException(403, "admin token required")


def user(x_upriver_user: str | None = Header(None)):
    if not x_upriver_user or not x_upriver_user.strip() or len(x_upriver_user) > 64:
        raise HTTPException(400, "X-UpRiver-User header required (1-64 chars)")
    return x_upriver_user.strip()


def conn(request: Request):
    return db.connect(request.app.state.db)


# ---- models ----
class Param(BaseModel):
    name: str = Field(pattern=r"^[A-Z_][A-Z0-9_]{0,63}$")
    default: str = Field(max_length=1024)
    choices: list[str] | None = None

    @model_validator(mode="after")
    def _default_in_choices(self):
        if self.choices is not None and self.default not in self.choices:
            raise ValueError("default must be in choices")
        return self


class Stage(BaseModel):
    name: str = Field(pattern=NAME_RE)
    kind: Literal["bvt", "fvt", "smoke", "regression", "custom"]
    command: str = Field(min_length=1)
    timeout_s: int = Field(120, ge=1, le=86400)
    on_fail: Literal["stop", "continue"] = "stop"


class PipelineConfig(BaseModel):
    auto_build: bool = False
    params: list[Param] = []
    stages: list[Stage] = Field(min_length=1)

    @field_validator("params")
    @classmethod
    def _uniq_params(cls, v):
        if len({p.name for p in v}) != len(v):
            raise ValueError("duplicate param name")
        return v

    @field_validator("stages")
    @classmethod
    def _uniq_stages(cls, v):
        if len({s.name for s in v}) != len(v):
            raise ValueError("duplicate stage name")
        return v


class PipelineIn(BaseModel):
    name: str = Field(pattern=NAME_RE)
    description: str = ""
    config: PipelineConfig


class PipelineUpdate(BaseModel):
    description: str = ""
    config: PipelineConfig


class BuildIn(BaseModel):
    config_id: int | None = None
    params: dict[str, str] = {}
    stages: list[str] | None = None
    upload_ids: list[int] = []


class RunConfigIn(BaseModel):
    name: str = Field(pattern=NAME_RE)
    params: dict[str, str] = {}
    stages: list[str] = []


# ---- helpers ----
def pipeline_out(r):
    return {**dict(r), "config": json.loads(r["config"])}


def get_pipeline(c, pid):
    r = c.execute("SELECT * FROM pipeline WHERE id=?", (pid,)).fetchone()
    if r is None:
        raise HTTPException(404, "pipeline not found")
    return r


def check_params(cfg, params):
    decl = {p.name: p for p in cfg.params}
    for k, v in params.items():
        if k not in decl:
            raise HTTPException(400, f"unknown param {k}")
        if len(v) > 1024 or "\0" in v or (decl[k].choices is not None and v not in decl[k].choices):
            raise HTTPException(400, f"invalid value for param {k}")


def rc_out(r):
    return {**dict(r), "params": json.loads(r["params"]), "stages": json.loads(r["stages"])}


# ---- uploads ----
def safe_path(name):
    """Validate an untrusted relative POSIX path; returns it unchanged or raises 400."""
    segs = name.split("/")
    # bytes, not chars: Linux NAME_MAX is 255 bytes. Control chars (incl. NUL, newline) would forge log/manifest lines.
    if (not name or len(name.encode(errors="replace")) > 255 or any(ch < " " or ch == "\x7f" for ch in name)
            or "\\" in name or name.startswith("/") or any(s in ("", ".", "..") for s in segs) or ":" in segs[0]):
        raise HTTPException(400, f"invalid path {name[:80]!r}")
    return name


def spool(read, tmpdir, limit):
    """Stream `read` into a new tmp file while hashing; 413 past `limit` bytes. Returns (tmp, sha256, size)."""
    fd, tmp = tempfile.mkstemp(dir=tmpdir)
    h, n = hashlib.sha256(), 0
    try:
        with os.fdopen(fd, "wb") as f:
            while chunk := read(1 << 20):
                n += len(chunk)
                if n > limit:
                    raise HTTPException(413, "upload too large")
                h.update(chunk)
                f.write(chunk)
    except BaseException:
        os.unlink(tmp)
        raise
    return tmp, h.hexdigest(), n


def current_files(c, pid):
    return c.execute(
        "SELECT id, path, version, sha256, size, uploader, created_at FROM upload u "
        "WHERE pipeline_id=? AND sha256 IS NOT NULL "
        "AND version=(SELECT MAX(version) FROM upload WHERE pipeline_id=u.pipeline_id AND path=u.path) "
        "ORDER BY path", (pid,)).fetchall()


def check_clash(paths):
    """A file and a directory can't share a name in the build workspace ("a" vs "a/b")."""
    dirs = {p.rsplit("/", k)[0] for p in paths for k in range(1, p.count("/") + 1)}
    if clash := paths & dirs:
        raise HTTPException(400, f"file and directory share a path: {min(clash)[:80]!r}")


# ---- routes ----
@app.get("/api/pipelines", dependencies=[Depends(team_auth)])
def list_pipelines(request: Request):
    with conn(request) as c:
        rows = c.execute(
            "SELECT p.id, p.name, p.description, p.created_at, "
            "(SELECT status FROM build b WHERE b.pipeline_id=p.id ORDER BY number DESC LIMIT 1) AS last_build_status "
            "FROM pipeline p ORDER BY p.name").fetchall()
    return [dict(r) for r in rows]


@app.post("/api/pipelines", status_code=201, dependencies=[Depends(admin_auth), Depends(user)])
def create_pipeline(body: PipelineIn, request: Request):
    try:
        with conn(request) as c:
            pid = c.execute("INSERT INTO pipeline (name, description, config) VALUES (?,?,?)",
                            (body.name, body.description, body.config.model_dump_json())).lastrowid
            return pipeline_out(get_pipeline(c, pid))
    except sqlite3.IntegrityError:
        raise HTTPException(409, "pipeline name already exists")


@app.get("/api/pipelines/{pid}", dependencies=[Depends(team_auth)])
def read_pipeline(pid: int, request: Request):
    with conn(request) as c:
        return pipeline_out(get_pipeline(c, pid))


@app.put("/api/pipelines/{pid}", dependencies=[Depends(admin_auth), Depends(user)])
def update_pipeline(pid: int, body: PipelineUpdate, request: Request):
    with conn(request) as c:
        get_pipeline(c, pid)
        c.execute("UPDATE pipeline SET description=?, config=? WHERE id=?",
                  (body.description, body.config.model_dump_json(), pid))
        return pipeline_out(get_pipeline(c, pid))


@app.get("/api/pipelines/{pid}/configs", dependencies=[Depends(team_auth)])
def list_configs(pid: int, request: Request):
    with conn(request) as c:
        get_pipeline(c, pid)
        return [rc_out(r) for r in c.execute(
            "SELECT * FROM run_config WHERE pipeline_id=? ORDER BY name", (pid,))]


@app.post("/api/pipelines/{pid}/configs", dependencies=[Depends(team_auth)])
def upsert_config(pid: int, body: RunConfigIn, request: Request, who: str = Depends(user)):
    with conn(request) as c:
        cfg = PipelineConfig(**json.loads(get_pipeline(c, pid)["config"]))
        check_params(cfg, body.params)
        names = [s.name for s in cfg.stages]
        for s in body.stages:
            if s not in names:
                raise HTTPException(400, f"unknown stage {s}")
        stages = [n for n in names if n in body.stages] or names  # pipeline order; empty = all
        c.execute(
            "INSERT INTO run_config (pipeline_id, name, params, stages, created_by) VALUES (?,?,?,?,?) "
            "ON CONFLICT(pipeline_id, name) DO UPDATE SET params=excluded.params, "
            "stages=excluded.stages, created_by=excluded.created_by",
            (pid, body.name, json.dumps(body.params), json.dumps(stages), who))
        return rc_out(c.execute("SELECT * FROM run_config WHERE pipeline_id=? AND name=?",
                                (pid, body.name)).fetchone())


@app.delete("/api/configs/{cid}", status_code=204, dependencies=[Depends(team_auth), Depends(user)])
def delete_config(cid: int, request: Request):
    with conn(request) as c:
        if c.execute("DELETE FROM run_config WHERE id=?", (cid,)).rowcount == 0:
            raise HTTPException(404, "config not found")


@app.get("/api/pipelines/{pid}/files", dependencies=[Depends(team_auth)])
def list_files(pid: int, request: Request):
    with conn(request) as c:
        get_pipeline(c, pid)
        return [dict(r) for r in current_files(c, pid)]


@app.get("/api/pipelines/{pid}/uploads", dependencies=[Depends(team_auth)])
def list_uploads(pid: int, path: str, request: Request):
    safe_path(path)
    with conn(request) as c:
        get_pipeline(c, pid)
        return [dict(r) for r in c.execute(
            "SELECT id, path, version, sha256, size, uploader, created_at FROM upload "
            "WHERE pipeline_id=? AND path=? ORDER BY version DESC LIMIT 200", (pid, path))]


# async only to reject on Content-Length before the body is parsed; the blocking file work runs in a thread.
@app.post("/api/pipelines/{pid}/uploads", dependencies=[Depends(team_auth)])
async def upload(pid: int, request: Request, who: str = Depends(user)):
    s = request.app.state
    # ponytail: whole-request cap (cap + 1 MB overhead), not per file; raise the env var for bigger batches.
    # Required, so chunked bodies can't skip it (the server enforces the declared length).
    length = request.headers.get("content-length")
    if length is None:
        raise HTTPException(411, "Content-Length required")
    if int(length) > s.max_upload + (1 << 20):
        raise HTTPException(413, "upload too large")
    with conn(request) as c:
        get_pipeline(c, pid)
    form = await request.form()
    try:
        files = form.getlist("files")
        extract = str(form.get("extract", "")).lower() in ("1", "true", "yes", "on")
        if not files or not all(isinstance(f, UploadFile) for f in files):
            raise HTTPException(400, "multipart field 'files' required")
        out = await run_in_threadpool(store_uploads, request, pid, who, files, extract)
    finally:
        await form.close()
    # One build per request, and only if something actually changed (re-uploading identical files does not rebuild).
    with conn(request) as c:
        auto = PipelineConfig(**json.loads(get_pipeline(c, pid)["config"])).auto_build
    if auto and any(not o["unchanged"] for o in out):
        await run_in_threadpool(create_build, request, pid, BuildIn(), f"auto:{who}")
    return out


def store_uploads(request, pid, who, files, extract):
    s = request.app.state
    tmpdir = s.data / "tmp"
    left = s.max_upload  # one budget for everything stored by this request, extracted bytes included
    staged = []  # (path, tmp, sha, size); every tmp is removed in `finally` unless moved into blobs/
    try:
        for f in files:
            name = safe_path(f.filename or "")
            if extract and name.lower().endswith(".zip"):
                ztmp, _, _ = spool(f.file.read, tmpdir, s.max_upload)
                staged.append((None, ztmp, None, 0))
                try:
                    z = zipfile.ZipFile(ztmp)
                except zipfile.BadZipFile:
                    raise HTTPException(400, "bad zip file")
                with z:
                    infos = z.infolist()
                    if len(infos) > MAX_ZIP_MEMBERS:
                        raise HTTPException(400, "too many zip members")
                    members = [i for i in infos if not i.is_dir()]
                    for i in members:
                        if stat.S_ISLNK(i.external_attr >> 16):
                            raise HTTPException(400, f"symlink in zip: {i.filename[:80]!r}")
                        safe_path(i.filename)
                    if sum(i.file_size for i in members) > left:
                        raise HTTPException(413, "zip too large when extracted")
                    for i in members:  # declared sizes can lie, so spool() also enforces on bytes actually read
                        try:
                            with z.open(i) as src:
                                tmp, sha, n = spool(src.read, tmpdir, left)
                        except (zipfile.BadZipFile, RuntimeError, NotImplementedError, EOFError,
                                zlib.error, lzma.LZMAError, OSError):  # bz2 raises OSError on bad data
                            raise HTTPException(400, f"unreadable zip member {i.filename[:80]!r}")
                        left -= n
                        staged.append((i.filename, tmp, sha, n))
            else:
                tmp, sha, n = spool(f.file.read, tmpdir, left)
                left -= n
                staged.append((name, tmp, sha, n))
        items = [x for x in staged if x[0] is not None]
        if not items:
            raise HTTPException(400, "nothing to store")
        if len({x[0] for x in items}) != len(items):
            raise HTTPException(400, "duplicate path in request")
        out = []
        with conn(request) as c:
            check_clash({r["path"] for r in current_files(c, pid)} | {x[0] for x in items})
            for path, _, sha, n in items:
                last = c.execute("SELECT id, version, sha256 FROM upload WHERE pipeline_id=? AND path=? "
                                 "ORDER BY version DESC LIMIT 1", (pid, path)).fetchone()
                if last and last["sha256"] == sha:
                    out.append({"id": last["id"], "path": path, "version": last["version"], "sha256": sha,
                                "size": n, "unchanged": True})
                    continue
                ver = last["version"] + 1 if last else 1
                uid = c.execute("INSERT INTO upload (pipeline_id, path, version, sha256, size, uploader) "
                                "VALUES (?,?,?,?,?,?)", (pid, path, ver, sha, n, who)).lastrowid
                out.append({"id": uid, "path": path, "version": ver, "sha256": sha, "size": n,
                            "unchanged": False})
            # blobs land before commit, so a committed row never points at a missing blob
            (s.data / "blobs").mkdir(exist_ok=True)
            for _, tmp, sha, _ in items:
                os.replace(tmp, s.data / "blobs" / sha)  # identical content just rewrites the same blob
    except sqlite3.IntegrityError:
        raise HTTPException(409, "concurrent upload of the same path, retry")
    finally:
        for _, tmp, _, _ in staged:
            if os.path.exists(tmp):
                os.unlink(tmp)
    return out


@app.delete("/api/pipelines/{pid}/files", status_code=204, dependencies=[Depends(team_auth)])
def remove_file(pid: int, path: str, request: Request, who: str = Depends(user)):
    safe_path(path)
    with conn(request) as c:
        get_pipeline(c, pid)
        last = c.execute("SELECT version, sha256 FROM upload WHERE pipeline_id=? AND path=? "
                         "ORDER BY version DESC LIMIT 1", (pid, path)).fetchone()
        if last is None or last["sha256"] is None:
            raise HTTPException(404, "file not found")
        c.execute("INSERT INTO upload (pipeline_id, path, version, sha256, size, uploader) "
                  "VALUES (?,?,?,NULL,0,?)", (pid, path, last["version"] + 1, who))


@app.get("/api/uploads/{uid}/download", dependencies=[Depends(team_auth)])
def download(uid: int, request: Request):
    with conn(request) as c:
        r = c.execute("SELECT path, sha256 FROM upload WHERE id=?", (uid,)).fetchone()
    if r is None or r["sha256"] is None:
        raise HTTPException(404, "upload not found")
    return FileResponse(request.app.state.data / "blobs" / r["sha256"], filename=r["path"].rsplit("/", 1)[-1],
                        media_type="application/octet-stream", content_disposition_type="attachment",
                        headers={"X-Content-Type-Options": "nosniff"})


# ---- builds ----
def create_build(request, pid, body, who):
    """Resolve params/stages/files, snapshot them on a new queued build row and hand it to the runner."""
    with conn(request) as c:
        c.execute("BEGIN IMMEDIATE")  # validation and number allocation see one consistent state
        cfg = PipelineConfig(**json.loads(get_pipeline(c, pid)["config"]))
        params = {p.name: p.default for p in cfg.params}
        names = [s.name for s in cfg.stages]
        config_name, wanted = None, None
        if body.config_id is not None:
            rc = c.execute("SELECT * FROM run_config WHERE id=? AND pipeline_id=?", (body.config_id, pid)).fetchone()
            if rc is None:
                raise HTTPException(400, "unknown config_id")
            config_name, wanted = rc["name"], json.loads(rc["stages"])
            check_params(cfg, json.loads(rc["params"]))  # the pipeline may have changed since it was saved
            params.update(json.loads(rc["params"]))
        check_params(cfg, body.params)
        params.update(body.params)
        if body.stages:
            wanted = body.stages
        for s in wanted or []:
            if s not in names:
                raise HTTPException(400, f"unknown stage {s}")
        stages = [s.model_dump() for s in cfg.stages if wanted is None or s.name in wanted]
        if not stages:
            raise HTTPException(400, "no stages selected")

        files = {r["path"]: r for r in current_files(c, pid)}
        pinned = set()
        for uid in body.upload_ids:
            u = c.execute("SELECT id, path, version, sha256 FROM upload WHERE id=? AND pipeline_id=?", (uid, pid)).fetchone()
            if u is None or u["sha256"] is None:
                raise HTTPException(400, f"upload {uid} not found in this pipeline or is a removal marker")
            if u["path"] in pinned:
                raise HTTPException(400, f"two pinned versions of {u['path'][:80]!r}")
            pinned.add(u["path"])
            files[u["path"]] = u
        check_clash(set(files))
        frozen = [{"path": p, "upload_id": r["id"], "version": r["version"], "sha256": r["sha256"]}
                  for p, r in sorted(files.items())]

        number = c.execute("UPDATE pipeline SET next_build_no = next_build_no + 1 WHERE id=? "
                           "RETURNING next_build_no - 1", (pid,)).fetchone()[0]
        bid = c.execute("INSERT INTO build (pipeline_id, number, status, config_name, params, stages, files, triggered_by) "
                        "VALUES (?,?,'queued',?,?,?,?,?)",
                        (pid, number, config_name, json.dumps(params), json.dumps(stages), json.dumps(frozen), who)).lastrowid
    runner.submit(bid)  # after commit, so the runner thread can see the row
    with conn(request) as c:
        return build_out(c, bid)


def build_out(c, bid, detail=True):
    r = c.execute("SELECT * FROM build WHERE id=?", (bid,)).fetchone()
    if r is None:
        raise HTTPException(404, "build not found")
    out = {**dict(r), "params": json.loads(r["params"]), "stages": json.loads(r["stages"]),
           "files": json.loads(r["files"]), "abort_requested": bool(r["abort_requested"])}
    if detail:
        out["stage_runs"] = [dict(s) for s in c.execute("SELECT * FROM stage_run WHERE build_id=? ORDER BY seq", (bid,))]
    return out


@app.post("/api/pipelines/{pid}/builds", status_code=201, dependencies=[Depends(team_auth)])
def trigger_build(pid: int, request: Request, body: BuildIn | None = None, who: str = Depends(user)):
    return create_build(request, pid, body or BuildIn(), who)


@app.get("/api/pipelines/{pid}/builds", dependencies=[Depends(team_auth)])
def list_builds(pid: int, request: Request, limit: int = Query(50, ge=1, le=500)):
    with conn(request) as c:
        get_pipeline(c, pid)
        return [{k: r[k] for k in ("id", "pipeline_id", "number", "status", "config_name", "triggered_by",
                                   "created_at", "started_at", "finished_at")}
                for r in c.execute("SELECT * FROM build WHERE pipeline_id=? ORDER BY number DESC LIMIT ?", (pid, limit))]


@app.get("/api/builds/{bid}", dependencies=[Depends(team_auth)])
def read_build(bid: int, request: Request):
    with conn(request) as c:
        return build_out(c, bid)


@app.get("/api/builds/{bid}/stages/{seq}/log", dependencies=[Depends(team_auth)])
def stage_log(bid: int, seq: int, request: Request, offset: int = Query(0, ge=0)):
    with conn(request) as c:
        st = c.execute("SELECT status FROM stage_run WHERE build_id=? AND seq=?", (bid, seq)).fetchone()
    if st is None:
        raise HTTPException(404, "stage not found")
    finished = st["status"] not in ("pending", "running")  # read before the file: a finished stage's log is final
    try:
        with open(request.app.state.data / "builds" / str(bid) / "logs" / f"{seq}.log", "rb") as f:
            size = os.fstat(f.fileno()).st_size
            f.seek(offset)
            chunk = f.read(LOG_CHUNK)
    except FileNotFoundError:
        size, chunk = 0, b""
    # hold back a trailing partial UTF-8 character unless this is the final read; it comes whole next time
    final = finished and len(chunk) < LOG_CHUNK
    dec = codecs.getincrementaldecoder("utf-8")("replace")
    data = dec.decode(chunk, final)
    nxt = offset + len(chunk) - len(dec.getstate()[0])
    return {"data": data, "next_offset": nxt, "complete": finished and nxt >= size}


@app.post("/api/builds/{bid}/abort", dependencies=[Depends(team_auth), Depends(user)])
def abort_build(bid: int, request: Request):
    with conn(request) as c:
        b = build_out(c, bid, detail=False)
        if b["status"] in ("passed", "failed"):
            raise HTTPException(409, "build already finished")
        # one transaction each, so the runner's queued->running update and this one can't both win
        c.execute("UPDATE build SET abort_requested=1 WHERE id=? AND status IN ('queued','running')", (bid,))
        c.execute("UPDATE build SET status='aborted', finished_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'", (bid,))
    runner.abort(bid)  # after commit: the runner re-reads the flag under the same lock
    with conn(request) as c:
        return build_out(c, bid)


def artifact_file(request, bid, path):
    """Resolve an artifact path; None unless it is an existing regular file inside the build's artifacts/ dir."""
    # data is already resolved; resolving artifacts/ too would follow a stage that replaced it with a symlink
    base = request.app.state.data / "builds" / str(bid) / "artifacts"
    try:
        f = (base / path).resolve()  # follows symlinks, so a link pointing outside fails the check below
        f.relative_to(base)
    except (ValueError, OSError):
        return None
    return f if f.is_file() else None


@app.get("/api/builds/{bid}/artifacts", dependencies=[Depends(team_auth)])
def list_artifacts(bid: int, request: Request):
    with conn(request) as c:
        build_out(c, bid, detail=False)
    base = request.app.state.data / "builds" / str(bid) / "artifacts"
    out = []
    for dirpath, _, names in os.walk(base):  # os.walk doesn't follow directory symlinks
        for n in names:
            rel = (Path(dirpath) / n).relative_to(base).as_posix()
            if f := artifact_file(request, bid, rel):
                out.append({"path": rel, "size": f.stat().st_size})
    return sorted(out, key=lambda a: a["path"])


@app.get("/api/builds/{bid}/artifacts/{path:path}", dependencies=[Depends(team_auth)])
def download_artifact(bid: int, path: str, request: Request):
    f = artifact_file(request, bid, path)
    if f is None:
        raise HTTPException(404, "artifact not found")
    return FileResponse(f, filename=f.name, media_type="application/octet-stream",
                        content_disposition_type="attachment", headers={"X-Content-Type-Options": "nosniff"})


# Static UI, no auth. Mounted last so /api wins.
app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True))
