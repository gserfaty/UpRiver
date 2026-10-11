# Changelog

## Phase 2 review fixes
- Uploads require `Content-Length` (411 otherwise): chunked bodies skipped the early size check and could store unlimited data.
- The size cap is one budget per request, extracted zip bytes included; several zips could each extract up to the cap.
- Reject a path that would be both a file and a directory in the build workspace (`a` and `a/b`), which Phase 3 could not materialize.
- `safe_path` limits 255 UTF-8 bytes (Linux NAME_MAX), not characters, and rejects control characters (newline in a zip member name could forge log/manifest lines).
- A corrupt deflate stream in a zip member returned 500; now 400.
- Blocking file work in the upload handler moves to a threadpool so large uploads don't stall the event loop; zip handles are closed; blobs are moved inside the DB transaction.
- Tests: rejection tests send a valid file alongside the bad one and assert nothing stored; new cases for duplicates/conflicts, chunked, multi-zip budget, corrupt member.

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
