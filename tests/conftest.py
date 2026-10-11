import time

import pytest
from fastapi.testclient import TestClient

from upriver.app import app

TEAM = {"Authorization": "Bearer t", "X-UpRiver-User": "alice"}
ADMIN = {"Authorization": "Bearer a", "X-UpRiver-User": "root"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("UPRIVER_DATA", str(tmp_path))
    monkeypatch.setenv("UPRIVER_TOKEN", "t")
    monkeypatch.setenv("UPRIVER_ADMIN_TOKEN", "a")
    with TestClient(app) as c:
        yield c


@pytest.fixture
def team():
    return dict(TEAM)


@pytest.fixture
def admin():
    return dict(ADMIN)


@pytest.fixture
def wait_build(client, team):
    """Poll GET /api/builds/{id} until finished (used from phase 3)."""
    def wait(bid, timeout=30):
        end = time.time() + timeout
        while time.time() < end:
            b = client.get(f"/api/builds/{bid}", headers=team).json()
            if b["status"] in ("passed", "failed", "aborted"):
                return b
            time.sleep(0.1)
        raise TimeoutError(f"build {bid} still {b['status']}")
    return wait
