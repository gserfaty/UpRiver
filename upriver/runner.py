import json
import logging
import os
import shutil
import signal
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import db

log = logging.getLogger("upriver")

# Module state, (re)set by start(). One app per process; tests start/stop it per TestClient.
_pool = None
_db = _data = None
_procs = {}  # build_id -> live Popen of the running stage
_lock = threading.Lock()  # guards _procs and the "check abort flag, then Popen" step
_stopping = False


def start(db_path, data, workers):
    global _pool, _db, _data, _stopping
    _db, _data, _stopping = db_path, Path(data), False
    _pool = ThreadPoolExecutor(workers, thread_name_prefix="build")
    with db.connect(_db) as c:
        ids = [r[0] for r in c.execute("SELECT id FROM build WHERE status='running'")]
        for bid in ids:  # the previous process died mid-build
            c.execute("UPDATE stage_run SET status='aborted', finished_at=CURRENT_TIMESTAMP WHERE build_id=? AND status='running'", (bid,))
            c.execute("UPDATE stage_run SET status='skipped' WHERE build_id=? AND status='pending'", (bid,))
            c.execute("UPDATE build SET status='aborted', finished_at=CURRENT_TIMESTAMP WHERE id=?", (bid,))
        queued = [r[0] for r in c.execute("SELECT id FROM build WHERE status='queued' ORDER BY id")]
    for bid in queued:
        submit(bid)


def shutdown():
    global _stopping
    with _lock:
        _stopping = True  # run_stage checks this under the lock, so no new process starts after this
        for p in _procs.values():
            _killpg(p, signal.SIGKILL)
    # unfinished builds stay running/queued in the DB; start() sorts them out next time
    _pool.shutdown(wait=True, cancel_futures=True)


def submit(bid):
    _pool.submit(run_build, bid)


def abort(bid):
    """Kill the live stage process of a running build, if any. The caller has already set abort_requested."""
    with _lock:
        p = _procs.get(bid)
    if p:  # not in the lock: may take 5 s
        threading.Thread(target=_term_then_kill, args=(p,), daemon=True).start()


def _killpg(p, sig):
    try:
        os.killpg(p.pid, sig)  # start_new_session makes pgid == pid
    except ProcessLookupError:
        pass


def _term_then_kill(p):
    _killpg(p, signal.SIGTERM)
    try:
        p.wait(5)
    except subprocess.TimeoutExpired:
        _killpg(p, signal.SIGKILL)


def run_build(bid):
    try:
        _run(bid)
    except Exception:
        # ponytail: the traceback goes to the server log only; the build just shows "failed". Surface it in the UI if it happens a lot.
        log.exception("build %s crashed", bid)
        if not _stopping:
            with db.connect(_db) as c:
                c.execute("UPDATE stage_run SET status='failed', finished_at=CURRENT_TIMESTAMP WHERE build_id=? AND status='running'", (bid,))
                c.execute("UPDATE stage_run SET status='skipped' WHERE build_id=? AND status='pending'", (bid,))
                c.execute("UPDATE build SET status='failed', finished_at=CURRENT_TIMESTAMP WHERE id=? AND status='running'", (bid,))


def _abort_requested(bid):
    with db.connect(_db) as c:
        return bool(c.execute("SELECT abort_requested FROM build WHERE id=?", (bid,)).fetchone()[0])


def _run(bid):
    with db.connect(_db) as c:
        # atomic with the abort route's queued->aborted update: whoever wins decides
        if c.execute("UPDATE build SET status='running', started_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'", (bid,)).rowcount == 0:
            return
        b = c.execute("SELECT b.*, p.name AS pipeline FROM build b JOIN pipeline p ON p.id=b.pipeline_id WHERE b.id=?", (bid,)).fetchone()
    params, stages, files = json.loads(b["params"]), json.loads(b["stages"]), json.loads(b["files"])

    root = _data / "builds" / str(bid)
    ws, arts, logs = root / "workspace", root / "artifacts", root / "logs"
    shutil.rmtree(root, ignore_errors=True)  # leftovers of a crashed earlier attempt
    for d in (ws, arts, logs):
        d.mkdir(parents=True)
    for f in files:  # copies, not links: a stage must not be able to modify a blob
        dest = ws / f["path"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(_data / "blobs" / f["sha256"], dest)

    with db.connect(_db) as c:
        for seq, st in enumerate(stages):
            c.execute("INSERT INTO stage_run (build_id, seq, name, kind, status) VALUES (?,?,?,?,'pending')",
                      (bid, seq, st["name"], st["kind"]))

    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": os.environ.get("HOME", "/"),
           "LANG": os.environ.get("LANG", "C.UTF-8"),
           "UPRIVER_ROOT": str(db.ROOT), "UPRIVER_PIPELINE": b["pipeline"], "UPRIVER_BUILD_NUMBER": str(b["number"]),
           "UPRIVER_BUILD_ID": str(bid), "UPRIVER_WORKSPACE": str(ws), "ARTIFACTS_DIR": str(arts)}
    env.update({f"UPRIVER_PARAM_{k}": v for k, v in params.items()})

    skip = aborted = failed = False
    for seq, st in enumerate(stages):
        if not skip and _abort_requested(bid):
            skip = aborted = True
        status = None if skip else _run_stage(bid, seq, st, ws, logs, {**env, "UPRIVER_STAGE": st["name"]})
        if _stopping:
            return
        if status is None:  # skipped, or an abort won the race against starting the process
            skip = True
            aborted = aborted or _abort_requested(bid)
            with db.connect(_db) as c:
                c.execute("UPDATE stage_run SET status='skipped' WHERE build_id=? AND seq=?", (bid, seq))
        elif status == "aborted":
            skip = aborted = True
        elif status == "failed":
            failed = True
            skip = skip or st["on_fail"] == "stop"
    final = "aborted" if aborted or _abort_requested(bid) else "failed" if failed else "passed"
    with db.connect(_db) as c:
        c.execute("UPDATE build SET status=?, finished_at=CURRENT_TIMESTAMP WHERE id=?", (final, bid))


def _run_stage(bid, seq, st, ws, logs, env):
    """Returns passed|failed|aborted, or None if the process was never started because of an abort."""
    with open(logs / f"{seq}.log", "wb", buffering=0) as out:
        with _lock:
            if _stopping or _abort_requested(bid):  # abort_requested is committed before abort() takes the lock
                return None
            p = subprocess.Popen(["/bin/sh", "-c", st["command"]], cwd=ws, env=env, stdout=out,
                                 stderr=subprocess.STDOUT, start_new_session=True)
            _procs[bid] = p
            with db.connect(_db) as c:
                c.execute("UPDATE stage_run SET status='running', started_at=CURRENT_TIMESTAMP WHERE build_id=? AND seq=?", (bid, seq))
        timed_out = False
        try:
            rc = p.wait(st["timeout_s"])
        except subprocess.TimeoutExpired:
            timed_out = True
            _term_then_kill(p)
            rc = None
            out.write(f"\n[upriver] timed out after {st['timeout_s']}s\n".encode())
        finally:
            with _lock:
                _procs.pop(bid, None)
        if _stopping:
            return "failed"  # result ignored by the caller
        _killpg(p, signal.SIGKILL)  # sweep children the shell left behind
        status = "passed" if rc == 0 else "failed"
        if not timed_out and rc != 0 and _abort_requested(bid):
            status = "aborted"
    with db.connect(_db) as c:
        c.execute("UPDATE stage_run SET status=?, exit_code=?, finished_at=CURRENT_TIMESTAMP WHERE build_id=? AND seq=?",
                  (status, None if timed_out or status == "aborted" else rc, bid, seq))
    return status
