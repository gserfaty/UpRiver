# UpRiver implementation plan

Scope: single machine, small trusted team. Built on docs/research.md. Anything not listed here is out of scope until someone needs it.

## Stack
Python 3.13, FastAPI, uvicorn, python-multipart, stdlib sqlite3 (no ORM), subprocess + ThreadPoolExecutor.
Frontend: static vanilla HTML/JS served by FastAPI, no build step, no npm.

Setup / run:

    python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    UPRIVER_TOKEN=team-secret UPRIVER_ADMIN_TOKEN=admin-secret \
      .venv/bin/uvicorn upriver.app:app --host 127.0.0.1 --port 8080
    .venv/bin/python -m pytest          # run from repo root

Environment variables (read in the FastAPI lifespan so tests can monkeypatch them):

| var | default | meaning |
|---|---|---|
| UPRIVER_TOKEN | required (startup fails if unset) | shared team token |
| UPRIVER_ADMIN_TOKEN | required | admin token (also accepted wherever the team token is) |
| UPRIVER_DATA | ./data | DB, blobs, builds |
| UPRIVER_EXECUTORS | 2 | concurrent builds |
| UPRIVER_MAX_UPLOAD_MB | 200 | per-file and per-zip-uncompressed cap |

Security note for README: uploaded files can be executed by stage commands, so uploaders effectively have shell access as the server user. Run UpRiver as a dedicated unprivileged user and bind it to localhost/LAN/VPN only.

## File layout

    requirements.txt          fastapi, uvicorn, python-multipart, pytest, httpx
    upriver/
      app.py                  FastAPI app: auth deps, pydantic models, all /api routes, upload/zip handling, static mount
      db.py                   SCHEMA string, connect(), init(), seed demo pipeline if DB empty
      runner.py               executor pool, run_build(), abort(), startup recovery
      static/index.html       layout + <style>
      static/app.js           hash router, fetch helpers, screens
    samples/
      demo.json               demo pipeline definition + run configs (seeded on first start)
      bvt.sh                  trivial BVT: list workspace, fail if empty, write artifacts/manifest.txt
      fvt.sh                  trivial FVT: echo params, sleep 2, exit 1 if UPRIVER_PARAM_FORCE_FAIL=yes
    tests/
      conftest.py             env (tmp UPRIVER_DATA, tokens), client fixture, auth headers, wait_build()
      test_pipelines.py       phase 1
      test_uploads.py         phase 2
      test_builds.py          phase 3 (+ phase 4 smoke)

Disk layout under UPRIVER_DATA:

    upriver.db
    blobs/<sha256>                          content-addressed upload storage, immutable
    tmp/                                    streaming upload temp files (same FS, so os.replace is atomic)
    builds/<build_id>/workspace/            snapshot of the file set; cwd for every stage
    builds/<build_id>/artifacts/            $ARTIFACTS_DIR
    builds/<build_id>/logs/<seq>.log        one log per stage (stdout+stderr)

## DB schema (db.py)
WAL mode, foreign_keys=ON, a new short-lived connection per request/thread, parameterized SQL only.

    CREATE TABLE pipeline (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      config TEXT NOT NULL,                 -- JSON, see "Pipeline config"
      next_build_no INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE run_config (
      id INTEGER PRIMARY KEY,
      pipeline_id INTEGER NOT NULL REFERENCES pipeline(id),
      name TEXT NOT NULL,
      params TEXT NOT NULL,                 -- JSON {NAME: value}
      stages TEXT NOT NULL,                 -- JSON [stage names], pipeline order
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (pipeline_id, name)
    );
    CREATE TABLE upload (                   -- one row = one version of one path in a pipeline's file set
      id INTEGER PRIMARY KEY,
      pipeline_id INTEGER NOT NULL REFERENCES pipeline(id),
      path TEXT NOT NULL,                   -- validated relative POSIX path
      version INTEGER NOT NULL,             -- max(version for path)+1
      sha256 TEXT,                          -- NULL = removal marker
      size INTEGER NOT NULL DEFAULT 0,
      uploader TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (pipeline_id, path, version)
    );
    CREATE TABLE build (
      id INTEGER PRIMARY KEY,
      pipeline_id INTEGER NOT NULL REFERENCES pipeline(id),
      number INTEGER NOT NULL,
      status TEXT NOT NULL,                 -- queued|running|passed|failed|aborted
      config_name TEXT,
      params TEXT NOT NULL,                 -- JSON, resolved values
      stages TEXT NOT NULL,                 -- JSON, frozen stage definitions to run
      files TEXT NOT NULL,                  -- JSON [{path, upload_id, version, sha256}], frozen at trigger
      triggered_by TEXT NOT NULL,           -- user name, or "auto:<uploader>"
      abort_requested INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT, finished_at TEXT,
      UNIQUE (pipeline_id, number)
    );
    CREATE TABLE stage_run (
      id INTEGER PRIMARY KEY,
      build_id INTEGER NOT NULL REFERENCES build(id),
      seq INTEGER NOT NULL,                 -- 0..n-1; also the log filename
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,                 -- pending|running|passed|failed|skipped|aborted
      exit_code INTEGER,                    -- NULL on timeout/abort/skip
      started_at TEXT, finished_at TEXT,
      UNIQUE (build_id, seq)
    );

The current file set is the latest version per path where sha256 IS NOT NULL (one query).
Build number is allocated in the same transaction as the build insert:
`UPDATE pipeline SET next_build_no = next_build_no + 1 WHERE id=? RETURNING next_build_no - 1`.
No artifact table (list the directory). No migrations: `CREATE TABLE IF NOT EXISTS`.

## Pipeline config (pipeline.config JSON, pydantic-validated)

    {
      "auto_build": false,
      "params": [ {"name": "TARGET", "default": "dev", "choices": ["dev", "staging"]} ],
      "stages": [ {"name": "bvt", "kind": "bvt", "command": "sh \"$UPRIVER_ROOT/samples/bvt.sh\"",
                   "timeout_s": 120, "on_fail": "stop"} ]
    }

Validation: param name `^[A-Z_][A-Z0-9_]{0,63}$`, unique, default in choices if choices set; stage name `^[A-Za-z0-9_.-]{1,64}$`, unique; kind in bvt|fvt|smoke|regression|custom; timeout_s 1..86400; on_fail stop|continue; command non-empty; at least one stage.

## Build semantics (runner.py)
- **Resolve trigger:** params = pipeline defaults ← run config values (if `config_id`) ← body `params`. Stages = all, or config's list, or body `stages`. Pinned `upload_ids` replace the latest version for their path.
- **Validate:** unknown param/stage → 400; values must be in choices if set; strings ≤1024 chars. Pinned uploads must belong to the pipeline and not be removal markers.
- **Snapshot at trigger:** resolved params, frozen stage definitions and file list stored on the build row.
- **Run:** status=running; copy each blob to `workspace/<path>`; create `artifacts/`, `logs/`; insert pending stage_run rows for the selected stages.
- **Each stage:** `Popen(["/bin/sh","-c",command], cwd=workspace, env=ENV, stdout=log, stderr=STDOUT, start_new_session=True)`, `wait(timeout_s)`.
  - ENV scrubbed: PATH, HOME, LANG plus UPRIVER_ROOT, UPRIVER_PIPELINE, UPRIVER_BUILD_NUMBER, UPRIVER_BUILD_ID, UPRIVER_STAGE, UPRIVER_WORKSPACE, ARTIFACTS_DIR, UPRIVER_PARAM_<NAME>. Params never interpolated.
  - Exit 0 = passed, else failed. Timeout: killpg SIGTERM, 5 s, SIGKILL; log "[upriver] timed out after Ns"; failed.
  - Failure with on_fail=stop: remaining stages skipped.
- **Result:** passed if all executed stages passed, else failed; aborted overrides.
- **Abort:** set abort_requested=1. Queued → aborted immediately, runner skips it. Running → killpg the live process (module-level `{build_id: Popen}` + lock); current stage aborted, rest skipped, build aborted. Runner checks abort_requested before each stage.
- **Startup recovery:** running builds/stages → aborted; queued builds resubmitted.
- **Auto-build:** after a successful upload request to an auto_build pipeline, one build with defaults, `triggered_by="auto:<uploader>"`.

## Auth
- All /api routes: `Authorization: Bearer <token>`, team or admin, `hmac.compare_digest`; else 401.
- Admin-only: create/update pipeline → 403 for team token.
- Writes require `X-UpRiver-User` (non-empty, ≤64 chars, else 400), recorded as uploader/created_by/triggered_by.
- Static files need no auth.

## REST API
| method | path | auth | notes |
|---|---|---|---|
| GET | /api/pipelines | team | list + last build status |
| POST | /api/pipelines | admin | {name, description, config} |
| GET | /api/pipelines/{pid} | team | includes config |
| PUT | /api/pipelines/{pid} | admin | replace description/config |
| GET | /api/pipelines/{pid}/configs | team | run configs |
| POST | /api/pipelines/{pid}/configs | team | {name, params, stages}; upsert by name |
| DELETE | /api/configs/{cid} | team | |
| GET | /api/pipelines/{pid}/files | team | current set |
| GET | /api/pipelines/{pid}/uploads?path= | team | version history, newest first, limit 200 |
| POST | /api/pipelines/{pid}/uploads | team | multipart `files` (1..n), `extract` (bool). Identical content → no new version. May auto-build. |
| DELETE | /api/pipelines/{pid}/files?path= | team | removal marker |
| GET | /api/uploads/{uid}/download | team | attachment |
| POST | /api/pipelines/{pid}/builds | team | {config_id?, params?, stages?, upload_ids?} → 201 |
| GET | /api/pipelines/{pid}/builds?limit=50 | team | newest first |
| GET | /api/builds/{bid} | team | build + stage_runs |
| GET | /api/builds/{bid}/stages/{seq}/log?offset=N | team | {data, next_offset, complete}; ≤64 KB per read |
| POST | /api/builds/{bid}/abort | team | idempotent; 409 if finished |
| GET | /api/builds/{bid}/artifacts | team | [{path, size}] |
| GET | /api/builds/{bid}/artifacts/{path:path} | team | must resolve inside artifacts/, else 404 |

File responses: `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`. No CORS.

Upload handling (trust boundary):
- `safe_path(name)`: reject empty, NUL, backslash, absolute, `..` or empty segments, `:` in first segment, >255 chars.
- Size cap: early reject on Content-Length; stream 1 MB chunks to data/tmp while hashing, abort past cap (413), `os.replace` to blobs/<sha>.
- Zip (`extract=true`): skip dirs, reject symlinks, safe_path every member, reject if summed file_size > cap or >10,000 members. Validate all before storing anything (atomic 400).

## UI (static/index.html + app.js, hash-routed, untrusted text via textContent)
1. **Sign-in bar:** name, team token, optional admin token in localStorage; forced on first visit. Downloads via fetch → blob URL.
2. **#/ pipelines:** name, description, last build badge, live name filter, trend strip (last 20 builds, lazy per-row fetch). "New pipeline" (admin) JSON textarea.
3. **#/p/{id}:** Files (current set, dropzone upload with progress and result list, with "extract zips", per-path history with pin checkbox, remove); Run (config dropdown, params, stage checkboxes, Build now, Save as config); Builds history (status filter, text search, Load more to 500); Settings (admin JSON editor).
4. **#/b/{id}:** header, abort button, stages with status/duration, live log `<pre>` via offset polling 1.5 s, build polled 2 s, artifacts downloads.

## Phases

conftest.py: monkeypatch UPRIVER_DATA=tmp_path, tokens t/a; `with TestClient(app)`; header dicts; `wait_build()`. Tests use inline commands.

### Phase 1: skeleton, DB, auth, pipelines, run configs, demo seed
Acceptance: fresh start creates DB + "demo" pipeline (bvt[stop], fvt[continue], params TARGET, FORCE_FAIL, configs "quick"/"full"); 401/403 matrix; invalid configs 422/400; bad run config 400; same name upserts.
Tests: test_auth_required, test_demo_seeded, test_pipeline_validation (parametrized), test_run_config_validation_and_upsert, test_missing_user_header_400.

### Phase 2: uploads and file sets
Acceptance: versioning, dedupe, zip extract vs stored, traversal/zip-slip/symlink → 400 with nothing stored, cap → 413, remove keeps history, download exact bytes.
Tests: test_versions_and_dedupe, test_zip_extract, test_bad_paths_rejected, test_size_cap, test_remove_path, test_download.

### Phase 3: builds and runner
Acceptance: demo passes / FORCE_FAIL fails; per-pipeline numbering; stop vs continue; timeout; no param injection; snapshot and pin; log offset; abort running (<5 s) and queued; artifacts + traversal 404; auto-build exactly once; startup recovery.
Tests: test_demo_build_passes_and_fails, test_build_numbers, test_on_fail_stop_vs_continue, test_timeout, test_params_as_env_no_injection, test_snapshot_and_pin, test_log_offset, test_abort_running, test_abort_queued, test_artifacts_and_traversal, test_auto_build_on_upload, test_startup_recovery.

### Phase 4: UI
Manual checklist: sign-in persists; dashboard filter narrows rows and Clear filter restores; upload files + zip; run "quick" with live log; Rebuild on a history row starts an identical build; FORCE_FAIL fails; abort; download manifest.txt; save config; team-token Settings save shows 403; `<img onerror>` in a log renders as text.
Test: test_index_served.

## Deliberately skipped (add when needed)
- JUnit XML parsing — when a test team ships XML.
- Log size cap, build/blob retention — when disk use matters.
- Pipeline delete, per-user accounts/roles, webhooks/cron, notifications, remote agents, executable-bit preservation (use `sh script.sh`).
- Large downloads buffered in browser memory — signed URLs if artifacts get huge.
