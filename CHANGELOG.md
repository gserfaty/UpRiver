# Changelog

## Phase 2: uploads and file sets
- Routes: list current files, per-path version history, multipart upload (`files`, `extract`), remove (marker version), download (attachment + nosniff).
- `safe_path`; uploads stream to `data/tmp` while hashing into content-addressed `blobs/`; identical content creates no new version.
- Zip extraction validates everything (symlinks, zip-slip, 10,000 members, uncompressed bytes vs `UPRIVER_MAX_UPLOAD_MB`) before storing; any rejection leaves no blobs or rows.
- `tests/test_uploads.py`.

## Phase 1 review fixes
- Accept the `Bearer` auth scheme case-insensitively (RFC 7235); clients sending `bearer` were getting 401.

## Phase 1: skeleton, auth, pipelines, run configs
- FastAPI app with lifespan-read env config, SQLite schema (all tables), bearer-token auth (team/admin), `X-UpRiver-User` on writes.
- Pipeline CRUD (admin write) with pydantic config validation; run configs (upsert by name, validated against the pipeline).
- Demo pipeline seeded from `samples/demo.json`; `samples/bvt.sh`, `samples/fvt.sh`.
- Placeholder `static/index.html`; pytest suite and reusable `conftest.py` (client, headers, `wait_build`).
