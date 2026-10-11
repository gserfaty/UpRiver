import hmac
import json
import os
import re
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator, model_validator

from . import db

NAME_RE = r"^[A-Za-z0-9_.-]{1,64}$"


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
    yield


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


def rc_out(r):
    return {**dict(r), "params": json.loads(r["params"]), "stages": json.loads(r["stages"])}


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
        decl = {p.name: p for p in cfg.params}
        for k, v in body.params.items():
            if k not in decl:
                raise HTTPException(400, f"unknown param {k}")
            if len(v) > 1024 or (decl[k].choices is not None and v not in decl[k].choices):
                raise HTTPException(400, f"invalid value for param {k}")
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


# Static UI, no auth. Mounted last so /api wins.
app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True))
