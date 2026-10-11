import io
import os
import zipfile

import pytest

PID = 1  # seeded demo pipeline


def up(client, team, files, extract=False):
    return client.post(f"/api/pipelines/{PID}/uploads", headers=team,
                       files=[("files", (n, d)) for n, d in files],
                       data={"extract": "true" if extract else "false"})


def mkzip(members):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in members:
            if isinstance(data, zipfile.ZipInfo):
                z.writestr(data, "target")
            else:
                z.writestr(name, data)
    return buf.getvalue()


def nothing_stored(client, tmp_path):
    assert client.get(f"/api/pipelines/{PID}/files", headers={"Authorization": "Bearer t"}).json() == []
    blobs, tmp = tmp_path / "blobs", tmp_path / "tmp"
    assert not blobs.exists() or not list(blobs.iterdir())
    assert not list(tmp.iterdir())
    import sqlite3
    assert sqlite3.connect(tmp_path / "upriver.db").execute("SELECT COUNT(*) FROM upload").fetchone()[0] == 0


def test_versions_and_dedupe(client, team):
    r = up(client, team, [("a.txt", b"one")])
    assert r.status_code == 200 and r.json()[0]["version"] == 1
    r = up(client, team, [("a.txt", b"one")])
    assert r.json()[0]["unchanged"] is True and r.json()[0]["version"] == 1
    r = up(client, team, [("a.txt", b"two"), ("d/b.txt", b"one")])
    assert [(o["path"], o["version"]) for o in r.json()] == [("a.txt", 2), ("d/b.txt", 1)]
    hist = client.get(f"/api/pipelines/{PID}/uploads", params={"path": "a.txt"}, headers=team).json()
    assert [h["version"] for h in hist] == [2, 1] and hist[0]["uploader"] == "alice"
    files = client.get(f"/api/pipelines/{PID}/files", headers=team).json()
    assert [(f["path"], f["version"]) for f in files] == [("a.txt", 2), ("d/b.txt", 1)]


def test_zip_extract(client, team):
    z = mkzip([("x/one.txt", b"1"), ("two.txt", b"2"), ("emptydir/", b"")])
    r = up(client, team, [("pack.zip", z)], extract=True)
    assert sorted(o["path"] for o in r.json()) == ["two.txt", "x/one.txt"]
    r = up(client, team, [("pack.zip", z)], extract=False)  # stored as-is
    assert [o["path"] for o in r.json()] == ["pack.zip"]
    paths = [f["path"] for f in client.get(f"/api/pipelines/{PID}/files", headers=team).json()]
    assert paths == ["pack.zip", "two.txt", "x/one.txt"]


def symlink_member():
    zi = zipfile.ZipInfo("link")
    zi.external_attr = (0o120777) << 16
    return ("link", zi)


@pytest.mark.parametrize("name", ["../x", "/abs", "a//b", "a/../b", "a\\b", "C:/x", "a/./b", "", "x" * 256,
                                  "a/", ".", "..", "\u00e9" * 128])
def test_bad_paths_rejected(client, team, tmp_path, name):
    # a valid file first: the whole request must be rejected, not just the bad part
    assert up(client, team, [("ok.txt", b"1"), (name, b"x")]).status_code == 400
    nothing_stored(client, tmp_path)


def test_bad_zips_rejected(client, team, tmp_path):
    for z in (mkzip([("ok.txt", b"1"), ("../evil", b"2")]),
              mkzip([("ok.txt", b"1"), symlink_member()]),
              mkzip([("ok.txt", b"1"), ("a\nb", b"2")]),  # control chars (multipart clients escape them)
              mkzip([("d/", b"")]),  # nothing to store
              corrupt_deflate(),
              b"not a zip"):
        assert up(client, team, [("p.zip", z)], extract=True).status_code == 400
    nothing_stored(client, tmp_path)
    assert client.get(f"/api/pipelines/{PID}/uploads", params={"path": "../x"}, headers=team).status_code == 400
    assert client.delete(f"/api/pipelines/{PID}/files", params={"path": "../x"}, headers=team).status_code == 400
    assert client.get(f"/api/pipelines/{PID}/uploads", params={"path": "a\x7fb"}, headers=team).status_code == 400


def corrupt_deflate():
    z = bytearray(mkzip([("ok.txt", b"1"), ("a", b"hello world " * 100)]))
    i = z.find(b"a", z.find(b"ok.txt") + 7) + 1  # start of a's compressed data
    z[i:i + 20] = bytes(b ^ 0xFF for b in z[i:i + 20])
    return bytes(z)


def test_duplicate_and_conflicting_paths(client, team, tmp_path):
    assert up(client, team, [("ok.txt", b"1"), ("p.zip", mkzip([("ok.txt", b"2")]))], extract=True).status_code == 400
    assert up(client, team, [("a", b"1"), ("a/b", b"2")]).status_code == 400
    nothing_stored(client, tmp_path)
    up(client, team, [("a", b"1"), ("d/e", b"2")])
    for name in ("a/b", "d"):  # file vs directory of the same name can't both be in the workspace
        assert up(client, team, [(name, b"x")]).status_code == 400
    assert [f["path"] for f in client.get(f"/api/pipelines/{PID}/files", headers=team).json()] == ["a", "d/e"]
    client.delete(f"/api/pipelines/{PID}/files", params={"path": "a"}, headers=team)
    assert up(client, team, [("a/b", b"x")]).status_code == 200  # fine once "a" is removed


def test_zip_member_count(client, team, tmp_path, monkeypatch):
    monkeypatch.setattr("upriver.app.MAX_ZIP_MEMBERS", 2)
    z = mkzip([("a", b"1"), ("b", b"2"), ("c", b"3")])
    assert up(client, team, [("p.zip", z)], extract=True).status_code == 400
    nothing_stored(client, tmp_path)


@pytest.fixture
def small_cap(monkeypatch):
    monkeypatch.setenv("UPRIVER_MAX_UPLOAD_MB", "1")


def test_size_cap(small_cap, client, team, tmp_path):
    mb = 1024 * 1024
    assert up(client, team, [("ok", b"1"), ("big", b"0" * (mb + 1))]).status_code == 413
    nothing_stored(client, tmp_path)
    # the cap covers the whole request: two zips can't each extract up to the cap
    z1, z2 = mkzip([("a", b"0" * (mb // 2 + 1))]), mkzip([("b", b"0" * (mb // 2 + 1))])
    assert up(client, team, [("1.zip", z1), ("2.zip", z2)], extract=True).status_code == 413
    nothing_stored(client, tmp_path)
    # chunked bodies carry no Content-Length, so they'd skip the early check
    r = client.post(f"/api/pipelines/{PID}/uploads", headers={**team, "Content-Type": "multipart/form-data; boundary=x"},
                    content=iter([b"--x--\r\n"]))
    assert r.status_code == 411
    nothing_stored(client, tmp_path)
    # compresses to a few KB, 2 MB uncompressed across members: cap applies to the uncompressed total
    z = mkzip([("a", b"0" * mb), ("b", b"0" * mb)])
    assert len(z) < mb
    assert up(client, team, [("p.zip", z)], extract=True).status_code == 413
    nothing_stored(client, tmp_path)
    assert up(client, team, [("ok", b"0" * mb)]).status_code == 200


def test_remove_path(client, team):
    up(client, team, [("a.txt", b"one")])
    assert client.delete(f"/api/pipelines/{PID}/files", params={"path": "a.txt"}, headers=team).status_code == 204
    assert client.get(f"/api/pipelines/{PID}/files", headers=team).json() == []
    hist = client.get(f"/api/pipelines/{PID}/uploads", params={"path": "a.txt"}, headers=team).json()
    assert [(h["version"], h["sha256"] is None) for h in hist] == [(2, True), (1, False)]
    assert client.delete(f"/api/pipelines/{PID}/files", params={"path": "a.txt"}, headers=team).status_code == 404
    up(client, team, [("a.txt", b"one")])  # re-adding after removal is a new version, not dedupe
    assert client.get(f"/api/pipelines/{PID}/files", headers=team).json()[0]["version"] == 3


def test_download(client, team):
    data = bytes(range(256)) * 10
    uid = up(client, team, [("d/blob.bin", data)]).json()[0]["id"]
    r = client.get(f"/api/uploads/{uid}/download", headers=team)
    assert r.status_code == 200 and r.content == data
    assert r.headers["content-disposition"].startswith("attachment")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert client.get("/api/uploads/999/download", headers=team).status_code == 404
    assert client.get(f"/api/uploads/{uid}/download").status_code == 401
