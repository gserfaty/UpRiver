import copy

import pytest

CFG = {"stages": [{"name": "s1", "kind": "custom", "command": "true"}]}


def pipe(name="p1", cfg=CFG):
    return {"name": name, "description": "d", "config": cfg}


def test_auth_required(client, team, admin):
    assert client.get("/api/pipelines").status_code == 401
    assert client.get("/api/pipelines", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert client.get("/api/pipelines", headers=team).status_code == 200
    assert client.get("/api/pipelines", headers=admin).status_code == 200
    assert client.post("/api/pipelines", json=pipe()).status_code == 401
    assert client.post("/api/pipelines", json=pipe(), headers=team).status_code == 403
    assert client.put("/api/pipelines/1", json=pipe(), headers=team).status_code == 403
    assert client.post("/api/pipelines", json=pipe(), headers=admin).status_code == 201
    assert client.get("/").status_code == 200  # static needs no auth


def test_demo_seeded(client, team):
    ps = client.get("/api/pipelines", headers=team).json()
    assert [p["name"] for p in ps] == ["demo"]
    p = client.get(f"/api/pipelines/{ps[0]['id']}", headers=team).json()
    st = {s["name"]: s for s in p["config"]["stages"]}
    assert st["bvt"]["on_fail"] == "stop" and st["fvt"]["on_fail"] == "continue"
    assert {x["name"] for x in p["config"]["params"]} == {"TARGET", "FORCE_FAIL"}
    cs = client.get(f"/api/pipelines/{p['id']}/configs", headers=team).json()
    assert {c["name"]: c["stages"] for c in cs} == {"quick": ["bvt"], "full": ["bvt", "fvt"]}


def bad(**over):
    c = copy.deepcopy(CFG)
    c.update(over)
    return c


S = CFG["stages"][0]


@pytest.mark.parametrize("cfg", [
    {"stages": []},
    bad(stages=[S, S]),
    bad(stages=[{**S, "name": "a b"}]),
    bad(stages=[{**S, "kind": "nope"}]),
    bad(stages=[{**S, "command": ""}]),
    bad(stages=[{**S, "timeout_s": 0}]),
    bad(stages=[{**S, "timeout_s": 86401}]),
    bad(stages=[{**S, "on_fail": "x"}]),
    bad(params=[{"name": "lower", "default": "x"}]),
    bad(params=[{"name": "A", "default": "x"}, {"name": "A", "default": "y"}]),
    bad(params=[{"name": "A", "default": "z", "choices": ["x", "y"]}]),
])
def test_pipeline_validation(client, admin, cfg):
    assert client.post("/api/pipelines", json=pipe(cfg=cfg), headers=admin).status_code == 422


def test_pipeline_name_and_update(client, admin, team):
    assert client.post("/api/pipelines", json=pipe(name="bad name"), headers=admin).status_code == 422
    pid = client.post("/api/pipelines", json=pipe(), headers=admin).json()["id"]
    assert client.post("/api/pipelines", json=pipe(), headers=admin).status_code == 409
    r = client.put(f"/api/pipelines/{pid}", json={"description": "new", "config": bad(auto_build=True)}, headers=admin)
    assert r.status_code == 200 and r.json()["config"]["auto_build"] is True
    assert client.get("/api/pipelines/999", headers=team).status_code == 404


def test_run_config_validation_and_upsert(client, team):
    pid = client.get("/api/pipelines", headers=team).json()[0]["id"]
    url = f"/api/pipelines/{pid}/configs"
    for body in [{"name": "x", "params": {"NOPE": "1"}},
                 {"name": "x", "params": {"TARGET": "prod"}},
                 {"name": "x", "stages": ["nope"]}]:
        assert client.post(url, json=body, headers=team).status_code == 400
    assert client.post(url, json={"name": "bad name"}, headers=team).status_code == 422
    r1 = client.post(url, json={"name": "mine", "params": {"TARGET": "dev"}, "stages": ["fvt", "bvt"]}, headers=team).json()
    assert r1["stages"] == ["bvt", "fvt"]  # pipeline order
    r2 = client.post(url, json={"name": "mine", "params": {"TARGET": "staging"}, "stages": ["bvt"]}, headers=team).json()
    assert r2["id"] == r1["id"] and r2["params"] == {"TARGET": "staging"} and r2["stages"] == ["bvt"]
    assert len([c for c in client.get(url, headers=team).json() if c["name"] == "mine"]) == 1
    assert client.delete(f"/api/configs/{r1['id']}", headers=team).status_code == 204
    assert client.delete(f"/api/configs/{r1['id']}", headers=team).status_code == 404


def test_missing_user_header_400(client):
    h = {"Authorization": "Bearer t"}
    assert client.post("/api/pipelines/1/configs", json={"name": "x"}, headers=h).status_code == 400
    assert client.post("/api/pipelines/1/configs", json={"name": "x"}, headers={**h, "X-UpRiver-User": " "}).status_code == 400
    assert client.post("/api/pipelines/1/configs", json={"name": "x"}, headers={**h, "X-UpRiver-User": "u" * 65}).status_code == 400
    assert client.post("/api/pipelines", json=pipe(), headers={"Authorization": "Bearer a"}).status_code == 400
