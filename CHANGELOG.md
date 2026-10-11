# Changelog

## Phase 4: web UI
- `static/index.html` + `static/app.js`: vanilla JS, no build step, hash routed (`#/` pipelines, `#/p/{id}` pipeline, `#/b/{id}` build). Sign-in bar (name, team token, optional admin token) kept in localStorage; every request sends the bearer token and `X-UpRiver-User`; API errors (401/403/413/...) show inline.
- Files (upload with "extract zips", version history with pin checkbox, remove), Run (config, params, stages, Build now with pinned versions, Save as config), Builds history, admin Settings JSON editor; build page with abort, stage statuses, live log (1.5 s offset polling), build polled every 2 s while active, artifact downloads.
- All server text is rendered with `textContent`/`createElement`; downloads use fetch -> blob -> object URL so no token is ever in a URL; pollers stop on navigation.
- Admin token is sent only for creating/updating pipelines; everything else uses the team token.
- `test_index_served`.

## Phase 3 review fixes
- An internal runner error (e.g. a missing blob during the workspace copy) now writes `[upriver] internal error: ...` to the log of the stage it hit and marks that stage failed; before, the build just showed "failed" with no stages. Stage rows are created before the copy so there is a stage to report in. A process started before the crash is killed and reaped.
- Param values containing NUL are rejected (400); they crashed `Popen`.
- Log reads: a trailing partial UTF-8 character is held back with an incremental decoder; an invalid byte earlier in the chunk used to defeat the check and split the character into two replacement chars.
- Artifacts: a stage that replaced `artifacts/` itself with a symlink could expose files outside it; the base dir is no longer resolved.
- Timed-out/aborted processes are reaped after SIGKILL (no transient zombie).
- Tests: split char after invalid byte, symlinked artifacts dir, internal error in stage log + NUL param.

## Phase 3: builds and runner
- `upriver/runner.py`: thread pool (`UPRIVER_EXECUTORS`), workspace snapshot copied from blobs, one `/bin/sh -c` process group per stage with a scrubbed env and a log file, timeout (SIGTERM, SIGKILL after 5 s), `on_fail` stop/continue, abort of queued and running builds, startup recovery (running -> aborted, queued resubmitted), pool shutdown (kills live stages) on app exit.
- Routes: trigger/list builds, build detail with stage runs, log reads by offset (64 KB, utf-8 replace, `complete` flag), abort, artifact list and download (must resolve inside `artifacts/`).
- Auto-build: one build per upload request, only when at least one file actually changed.
- Aborting an already aborted build returns 200 (idempotent); 409 only for passed/failed builds.
- `tests/test_builds.py`.

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
