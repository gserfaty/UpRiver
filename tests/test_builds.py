import json
import os
import sqlite3
import time

from fastapi.testclient import TestClient

from upriver.app import app

DEMO = 1
FILES = "/api/pipelines/{}/uploads"


def stage(name, command, on_fail="stop", timeout_s=30):
    return {"name": name, "kind": "custom", "command": command, "timeout_s": timeout_s, "on_fail": on_fail}


def mkpipe(client, admin, stages, name="p", params=(), auto=False):
    cfg = {"auto_build": auto, "params": list(params), "stages": stages}
    r = client.post("/api/pipelines", json={"name": name, "config": cfg}, headers=admin)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def build(client, team, pid, **body):
    r = client.post(f"/api/pipelines/{pid}/builds", json=body, headers=team)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def put(client, team, pid, name, data):
    r = client.post(FILES.format(pid), headers=team, files=[("files", (name, data))])
    assert r.status_code == 200, r.text
    return r.json()[0]


def artifact(client, team, bid, path):
    r = client.get(f"/api/builds/{bid}/artifacts/{path}", headers=team)
    assert r.status_code == 200
    return r.content


def statuses(b):
    return [s["status"] for s in b["stage_runs"]]


def wait_until(fn, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        if v := fn():
            return v
        time.sleep(0.05)
    raise TimeoutError


def test_demo_build_passes_and_fails(client, team, wait_build):
    put(client, team, DEMO, "a.txt", b"hello")
    ok = build(client, team, DEMO)
    bad = build(client, team, DEMO, params={"FORCE_FAIL": "yes"})  # runs concurrently (2 executors)
    b = wait_build(ok)
    assert b["status"] == "passed" and statuses(b) == ["passed", "passed"]
    assert b["params"] == {"TARGET": "dev", "FORCE_FAIL": "no"} and b["triggered_by"] == "alice"
    assert "a.txt" in artifact(client, team, ok, "manifest.txt").decode()
    b = wait_build(bad)
    assert b["status"] == "failed" and statuses(b) == ["passed", "failed"] and b["stage_runs"][1]["exit_code"] == 1
    log = client.get(f"/api/builds/{bad}/stages/1/log", headers=team).json()
    assert "UPRIVER_PARAM_FORCE_FAIL=yes" in log["data"] and "FVT failed" in log["data"] and log["complete"]
    # empty workspace: the demo BVT fails and on_fail=stop skips the FVT
    client.delete(f"/api/pipelines/{DEMO}/files", params={"path": "a.txt"}, headers=team)
    b = wait_build(build(client, team, DEMO))
    assert b["status"] == "failed" and statuses(b) == ["failed", "skipped"]


def test_build_numbers(client, team, admin, wait_build):
    p1 = mkpipe(client, admin, [stage("s", "true")], name="one")
    p2 = mkpipe(client, admin, [stage("s", "true")], name="two")
    ids = [build(client, team, p) for p in (p1, p1, p2)]
    assert [wait_build(i)["number"] for i in ids] == [1, 2, 1]
    nums = [b["number"] for b in client.get(f"/api/pipelines/{p1}/builds", headers=team).json()]
    assert nums == [2, 1]
    assert client.get(f"/api/pipelines/{p1}/builds?limit=1", headers=team).json()[0]["number"] == 2
    assert client.get("/api/builds/9999", headers=team).status_code == 404
    assert client.post("/api/pipelines/9999/builds", headers=team).status_code == 404


def test_on_fail_stop_vs_continue(client, team, admin, wait_build):
    stop = mkpipe(client, admin, [stage("f", "exit 3"), stage("g", "true")], name="stop")
    cont = mkpipe(client, admin, [stage("f", "exit 3", "continue"), stage("g", "true")], name="cont")
    b = wait_build(build(client, team, stop))
    assert b["status"] == "failed" and statuses(b) == ["failed", "skipped"]
    assert [s["exit_code"] for s in b["stage_runs"]] == [3, None]
    b = wait_build(build(client, team, cont))
    assert b["status"] == "failed" and statuses(b) == ["failed", "passed"]
    # a body stage list picks a subset, in pipeline order
    b = wait_build(build(client, team, cont, stages=["g"]))
    assert b["status"] == "passed" and [s["name"] for s in b["stage_runs"]] == ["g"]


def test_timeout(client, team, admin, wait_build):
    pid = mkpipe(client, admin, [stage("slow", "echo start; sleep 30", timeout_s=1)])
    t = time.time()
    b = wait_build(build(client, team, pid))
    assert time.time() - t < 8
    assert b["status"] == "failed" and b["stage_runs"][0]["status"] == "failed" and b["stage_runs"][0]["exit_code"] is None
    log = client.get(f"/api/builds/{b['id']}/stages/0/log", headers=team).json()["data"]
    assert "start" in log and "[upriver] timed out after 1s" in log


def test_params_as_env_no_injection(client, team, admin, wait_build):
    evil = "$(touch pwned) `touch pwned2`; touch pwned3 #\"'"
    pid = mkpipe(client, admin, [stage("s", 'printf %s "$UPRIVER_PARAM_VAL" > "$ARTIFACTS_DIR/val"; env > "$ARTIFACTS_DIR/env"')],
                 params=[{"name": "VAL", "default": "x"}, {"name": "MODE", "default": "a", "choices": ["a", "b"]}])
    b = wait_build(build(client, team, pid, params={"VAL": evil}))
    assert b["status"] == "passed"
    assert artifact(client, team, b["id"], "val").decode() == evil
    assert not [a for a in client.get(f"/api/builds/{b['id']}/artifacts", headers=team).json() if a["path"].startswith("pwned")]
    env = dict(l.split("=", 1) for l in artifact(client, team, b["id"], "env").decode().splitlines() if "=" in l)
    assert "UPRIVER_TOKEN" not in env and "UPRIVER_ADMIN_TOKEN" not in env
    assert env["UPRIVER_PARAM_MODE"] == "a" and env["UPRIVER_BUILD_NUMBER"] == "1" and env["UPRIVER_STAGE"] == "s"
    assert env["UPRIVER_PIPELINE"] == "p" and env["UPRIVER_BUILD_ID"] == str(b["id"])
    assert os.path.isdir(env["UPRIVER_WORKSPACE"]) and os.path.isdir(env["ARTIFACTS_DIR"]) and "UPRIVER_ROOT" in env
    for body in [{"params": {"NOPE": "1"}}, {"params": {"MODE": "c"}}, {"params": {"VAL": "x" * 1025}},
                 {"stages": ["nope"]}, {"config_id": 999}, {"upload_ids": [999]}]:
        assert client.post(f"/api/pipelines/{pid}/builds", json=body, headers=team).status_code == 400, body
    assert client.post(f"/api/pipelines/{pid}/builds", json={"params": {"MODE": "b"}}, headers={"Authorization": "Bearer t"}).status_code == 400


def test_snapshot_and_pin(client, team, admin, wait_build):
    pid = mkpipe(client, admin, [stage("s", 'cat a.txt > "$ARTIFACTS_DIR/a" 2>&1; ls > "$ARTIFACTS_DIR/ls"; true')])
    other = mkpipe(client, admin, [stage("s", "true")], name="other")
    v1 = put(client, team, pid, "a.txt", b"one")
    v2 = put(client, team, pid, "a.txt", b"two")
    put(client, team, pid, "d/b.txt", b"b")
    pinned = wait_build(build(client, team, pid, upload_ids=[v1["id"]]))
    latest = wait_build(build(client, team, pid))
    assert artifact(client, team, pinned["id"], "a") == b"one" and artifact(client, team, latest["id"], "a") == b"two"
    assert [(f["path"], f["version"]) for f in pinned["files"]] == [("a.txt", 1), ("d/b.txt", 1)]
    put(client, team, pid, "a.txt", b"three")  # later uploads don't touch the recorded build
    assert client.get(f"/api/builds/{pinned['id']}", headers=team).json()["files"] == pinned["files"]
    assert latest["files"][0]["upload_id"] == v2["id"]
    # removed files vanish from new snapshots; markers can't be pinned
    client.delete(f"/api/pipelines/{pid}/files", params={"path": "a.txt"}, headers=team)
    hist = client.get(FILES.format(pid), params={"path": "a.txt"}, headers=team).json()
    gone = wait_build(build(client, team, pid))
    assert [f["path"] for f in gone["files"]] == ["d/b.txt"] and b"a.txt" not in artifact(client, team, gone["id"], "ls")
    for ids in ([hist[0]["id"]], [v1["id"], v1["id"]]):
        assert client.post(f"/api/pipelines/{pid}/builds", json={"upload_ids": ids}, headers=team).status_code == 400
    foreign = put(client, team, other, "x", b"x")  # belongs to another pipeline
    assert client.post(f"/api/pipelines/{pid}/builds", json={"upload_ids": [foreign["id"]]}, headers=team).status_code == 400
    # run config: params + stage list come from the config, body overrides params
    rc = client.post(f"/api/pipelines/{DEMO}/configs", json={"name": "q", "params": {"TARGET": "staging"}, "stages": ["bvt"]}, headers=team).json()
    b = wait_build(build(client, team, DEMO, config_id=rc["id"], params={"FORCE_FAIL": "yes"}))
    assert b["config_name"] == "q" and b["params"] == {"TARGET": "staging", "FORCE_FAIL": "yes"} and len(b["stage_runs"]) == 1
    assert client.post(f"/api/pipelines/{pid}/builds", json={"config_id": rc["id"]}, headers=team).status_code == 400


def test_log_offset(client, team, admin, wait_build):
    cmd = "head -c 70000 /dev/zero | tr '\\000' x; printf '\\n\\377\\n'; echo done"
    b = wait_build(build(client, team, mkpipe(client, admin, [stage("s", cmd)])))
    url = f"/api/builds/{b['id']}/stages/0/log"
    first = client.get(url, headers=team).json()
    assert len(first["data"]) == 65536 and first["next_offset"] == 65536 and first["complete"] is False
    second = client.get(url, params={"offset": first["next_offset"]}, headers=team).json()
    assert second["complete"] is True and second["data"].endswith("\n�\ndone\n")
    assert len(first["data"]) + len(second["data"].encode("utf-8", "replace").decode()) > 70000
    end = client.get(url, params={"offset": 10**6}, headers=team).json()
    assert end == {"data": "", "next_offset": 10**6, "complete": True}
    assert client.get(url, params={"offset": -1}, headers=team).status_code == 422
    assert client.get(f"/api/builds/{b['id']}/stages/5/log", headers=team).status_code == 404


def test_abort_running(client, team, admin, wait_build):
    pid = mkpipe(client, admin, [stage("s1", 'echo $$ > "$ARTIFACTS_DIR/pid"; sleep 30', timeout_s=60), stage("s2", "true")])
    bid = build(client, team, pid)
    pid_file = lambda: client.get(f"/api/builds/{bid}/artifacts", headers=team).json()
    wait_until(lambda: pid_file() and client.get(f"/api/builds/{bid}", headers=team).json()["stage_runs"][0]["status"] == "running")
    t = time.time()
    r = client.post(f"/api/builds/{bid}/abort", headers=team)
    assert r.status_code == 200
    b = wait_build(bid)
    assert time.time() - t < 5
    assert b["status"] == "aborted" and statuses(b) == ["aborted", "skipped"] and b["abort_requested"]
    pid = int(artifact(client, team, bid, "pid"))

    def dead():
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
    wait_until(dead, 5)
    assert client.post(f"/api/builds/{bid}/abort", headers=team).status_code == 200  # idempotent
    done = wait_build(build(client, team, mkpipe(client, admin, [stage("s", "true")], name="q")))
    assert client.post(f"/api/builds/{done['id']}/abort", headers=team).status_code == 409


def test_abort_queued(client, team, admin, wait_build):
    pid = mkpipe(client, admin, [stage("s", "sleep 30", timeout_s=60)])
    ids = [build(client, team, pid) for _ in range(3)]  # 2 executors: the third stays queued
    get = lambda i: client.get(f"/api/builds/{i}", headers=team).json()
    wait_until(lambda: get(ids[0])["status"] == get(ids[1])["status"] == "running")
    assert get(ids[2])["status"] == "queued"
    assert client.post(f"/api/builds/{ids[2]}/abort", headers=team).json()["status"] == "aborted"
    for i in ids[:2]:  # free the executors; the aborted build must not start
        client.post(f"/api/builds/{i}/abort", headers=team)
        wait_build(i)
    time.sleep(0.5)
    b = get(ids[2])
    assert b["status"] == "aborted" and b["stage_runs"] == [] and b["started_at"] is None


def test_artifacts_and_traversal(client, team, admin, wait_build, tmp_path):
    (tmp_path / "secret.txt").write_text("secret")
    cmd = f'mkdir "$ARTIFACTS_DIR/sub"; echo hi > "$ARTIFACTS_DIR/sub/x.txt"; ln -s {tmp_path}/secret.txt "$ARTIFACTS_DIR/link"; ln -s {tmp_path} "$ARTIFACTS_DIR/dirlink"'
    pid = mkpipe(client, admin, [stage("s", cmd)])
    put(client, team, pid, "w.txt", b"workspace")
    bid = wait_build(build(client, team, pid))["id"]
    assert client.get(f"/api/builds/{bid}/artifacts", headers=team).json() == [{"path": "sub/x.txt", "size": 3}]
    r = client.get(f"/api/builds/{bid}/artifacts/sub/x.txt", headers=team)
    assert r.content == b"hi\n" and r.headers["content-disposition"].startswith("attachment")
    assert r.headers["x-content-type-options"] == "nosniff"
    for bad in ["link", "dirlink/secret.txt", "..%2Fworkspace%2Fw.txt", "%2e%2e/logs/0.log", "sub", "nope", "sub/%00"]:
        assert client.get(f"/api/builds/{bid}/artifacts/{bad}", headers=team).status_code == 404, bad
    assert client.get(f"/api/builds/{bid}/artifacts/sub/x.txt").status_code == 401


def test_auto_build_on_upload(client, team, admin, wait_build):
    auto = mkpipe(client, admin, [stage("s", "ls > $ARTIFACTS_DIR/ls")], name="auto", auto=True)
    manual = mkpipe(client, admin, [stage("s", "true")], name="manual")
    r = client.post(FILES.format(auto), headers=team, files=[("files", ("a", b"1")), ("files", ("b", b"2"))])
    assert r.status_code == 200
    builds = client.get(f"/api/pipelines/{auto}/builds", headers=team).json()
    assert len(builds) == 1 and builds[0]["triggered_by"] == "auto:alice"
    assert wait_build(builds[0]["id"])["status"] == "passed"
    assert artifact(client, team, builds[0]["id"], "ls") == b"a\nb\n"
    put(client, team, auto, "a", b"1")  # identical content: nothing changed, no build
    assert len(client.get(f"/api/pipelines/{auto}/builds", headers=team).json()) == 1
    put(client, team, auto, "a", b"11")
    assert len(client.get(f"/api/pipelines/{auto}/builds", headers=team).json()) == 2
    put(client, team, manual, "a", b"1")
    assert client.get(f"/api/pipelines/{manual}/builds", headers=team).json() == []


def test_startup_recovery(tmp_path, monkeypatch, team):
    monkeypatch.setenv("UPRIVER_DATA", str(tmp_path))
    monkeypatch.setenv("UPRIVER_TOKEN", "t")
    monkeypatch.setenv("UPRIVER_ADMIN_TOKEN", "a")
    with TestClient(app):  # creates the DB
        pass
    stages = json.dumps([{"name": "s", "kind": "custom", "command": "echo recovered", "timeout_s": 10, "on_fail": "stop"}])
    db = sqlite3.connect(tmp_path / "upriver.db")
    for n, status in ((1, "running"), (2, "queued")):
        db.execute("INSERT INTO build (pipeline_id, number, status, params, stages, files, triggered_by) VALUES (1,?,?,'{}',?,'[]','bob')",
                   (n, status, stages))
    db.execute("INSERT INTO stage_run (build_id, seq, name, kind, status) VALUES (1,0,'s','custom','running'), (1,1,'t','custom','pending')")
    db.commit()
    db.close()
    with TestClient(app) as c:
        get = lambda i: c.get(f"/api/builds/{i}", headers=team).json()
        dead = get(1)
        assert dead["status"] == "aborted" and dead["finished_at"] and statuses(dead) == ["aborted", "skipped"]
        wait_until(lambda: get(2)["status"] == "passed")
        assert "recovered" in c.get("/api/builds/2/stages/0/log", headers=team).json()["data"]


def test_log_offset_split_char_after_invalid_byte(client, team, admin, wait_build):
    # an invalid byte early in the chunk must not stop the trailing "é" from being held back whole
    cmd = "printf '\\377'; head -c 65534 /dev/zero | tr '\\000' x; printf '\\303\\251end'"
    b = wait_build(build(client, team, mkpipe(client, admin, [stage("s", cmd)])))
    url = f"/api/builds/{b['id']}/stages/0/log"
    first = client.get(url, headers=team).json()
    assert first["next_offset"] == 65535 and first["data"].endswith("x") and not first["complete"]
    assert client.get(url, params={"offset": 65535}, headers=team).json() == {"data": "éend", "next_offset": 65540, "complete": True}


def test_artifacts_dir_replaced_by_symlink(client, team, admin, wait_build, tmp_path):
    (tmp_path / "secret.txt").write_text("secret")
    pid = mkpipe(client, admin, [stage("s", f'rm -rf "$ARTIFACTS_DIR"; ln -s {tmp_path} "$ARTIFACTS_DIR"')])
    bid = wait_build(build(client, team, pid))["id"]
    assert client.get(f"/api/builds/{bid}/artifacts", headers=team).json() == []
    assert client.get(f"/api/builds/{bid}/artifacts/secret.txt", headers=team).status_code == 404


def test_internal_error_shown_in_stage_log(client, team, admin, wait_build, tmp_path):
    pid = mkpipe(client, admin, [stage("s", "true"), stage("t", "true")], params=[{"name": "P", "default": ""}])
    assert client.post(f"/api/pipelines/{pid}/builds", json={"params": {"P": "a\0b"}}, headers=team).status_code == 400
    up = put(client, team, pid, "a.txt", b"x")
    (tmp_path / "blobs" / up["sha256"]).unlink()  # the workspace copy will fail
    b = wait_build(build(client, team, pid))
    assert b["status"] == "failed" and statuses(b) == ["failed", "skipped"]
    assert "[upriver] internal error: FileNotFoundError" in client.get(f"/api/builds/{b['id']}/stages/0/log", headers=team).json()["data"]
