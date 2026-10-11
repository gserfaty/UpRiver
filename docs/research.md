# UpRiver research notes

Goal: a small, Jenkins-inspired CI/CD framework. Team uploads files -> files form a build -> build runs
configurable test stages (BVT, FVT, ...) -> results/logs visible in a UI. Tests are plugged in later.
Environment: macOS, Python 3.13 (no FastAPI installed), Node 23, Java, no Docker.

## 1. Jenkins concepts: borrow vs skip

| Concept | MVP? | Notes |
|---|---|---|
| Job / pipeline | Borrow | A named, saved config: ordered stages + defaults. Stored as data (JSON in DB), not Groovy. |
| Stages | Borrow | Ordered list; each stage has a name, a command, and a gating policy. |
| Steps | Simplify | One shell command (or script path) per stage. No step DSL. |
| Build + build number | Borrow | Per-pipeline incrementing integer (`#1, #2...`), immutable record of inputs + config + results. |
| Workspace | Borrow | One fresh directory per build (`data/builds/<pipeline>/<n>/workspace`); uploaded files are copied in. Commands run with it as cwd. |
| Artifacts | Borrow (light) | Files a stage leaves in `$ARTIFACTS_DIR`; listed and downloadable. Just a directory, no registry. |
| Parameters | Borrow | Pipeline declares params (name, default, choices); the build gets the chosen values as env vars (`UPRIVER_PARAM_<NAME>`) plus the user-chosen env vars. |
| Console log streaming | Borrow | Each stage appends to a log file; UI polls with a byte offset (`?offset=N`). Polling beats SSE/WebSocket for simplicity. |
| Executors / queue | Simplify | A fixed-size `ThreadPoolExecutor` (default 2) is the queue + executors. Queued builds are DB rows with status `queued`. |
| Triggers | Partial | Manual trigger ("Upload and build" / "Build now") only. Webhook/cron/SCM polling skipped. |
| Agents/nodes, plugins, Groovy, Blue Ocean, credentials store, folders, matrix builds, shared libs | Skip | Single machine. Extensibility comes from "register a command per stage". |

## 2. BVT / FVT and friends as stages

Typical order, cheapest and most critical first (fail fast):

1. **BVT** (build verification, a.k.a. sanity): minutes, tiny. "Is the build even usable?" (starts, installs, key paths work). **Gate:** failure stops the pipeline; downstream stages are marked `skipped`.
2. **Smoke**: sometimes the same as BVT; treat as an alias, just a differently named stage.
3. **FVT** (functional verification): feature-level, longer. Gate: failure marks the build failed, but running remaining independent stages is usually still useful.
4. **Regression / system / perf**: slowest, often nightly or opt-in via parameters. Usually non-gating or run only when selected.

Model: each stage has `on_fail`: `stop` (default; skip the rest, build = FAILED) or `continue` (run on, build = FAILED/UNSTABLE at the end). Plus `enabled` toggle per build so users pick which stages/suites to run. Exit code 0 = pass, non-zero = fail, timeout = fail. A build is SUCCESS only if all executed gating stages pass. Suite results beyond pass/fail (JUnit XML parsing) are a later add-on.

Plug-in point for tests (decided now, filled in later): a stage is `{name, command, timeout_s, on_fail, env}`. The test team supplies a script (e.g. `tests/bvt.sh`) either inside the uploaded files or in a registered, server-side `suites/` directory. No code changes needed to add a suite.

## 3. Stack options and recommendation

| Option | Backend deps | Frontend | Pros | Cons |
|---|---|---|---|---|
| A. stdlib `http.server` (ThreadingHTTPServer) + sqlite3 + vanilla JS static page | 0 | One `index.html` + JS, no build | Zero install, one `python3 server.py` | Hand-rolled routing, multipart upload parsing is painful (`cgi` removed in 3.13), no auth helpers |
| B. FastAPI + uvicorn + SQLite + one static HTML/JS page | ~5 transitive (fastapi, uvicorn, python-multipart, pydantic...) | Same static page | Routing, validation, multipart, OpenAPI for free; nice for future API users | Needs a venv and pip, not installed here |
| C. Flask + Jinja server-rendered | 1-2 | Server-rendered HTML + forms | Plain forms work without JS, tiny | Live log needs a little JS anyway |
| D. Node/Express + React/Vite | many | SPA with build step | Rich UI | Two languages/toolchains, build step, most deps; against the team's values |

**Recommendation: B, minimally.** Python + FastAPI + `sqlite3` (stdlib, no ORM) + `subprocess`/`ThreadPoolExecutor` (stdlib) + a single static `index.html` with vanilla JS (no bundler, no framework, no npm). Justification: multipart upload and path/body validation are the two places hand-rolled code gets security-sensitive (`cgi` is gone in 3.13), and FastAPI handles both for ~3 pip packages (`fastapi`, `uvicorn`, `python-multipart`). Everything else (queue, executor, DB, logs, artifacts) is stdlib. A `requirements.txt` + `python3 -m venv` is the entire setup.

Fallback if "zero pip deps" is a hard requirement: option A, using `email`/manual parsing for uploads or accepting raw-body uploads (`PUT /uploads/<name>` with the file as the request body, no multipart at all). That is genuinely simple and removes the multipart need; the UI uses `fetch(url, {method:'PUT', body:file})`. Worth considering seriously: it makes A about as small as B. Decision deferred to the user (see questions).

UI shape (single page, hash-routed or just sections): pipelines list -> pipeline page (config form, upload dropzone, "Run" button, build history) -> build page (stage list with status badges, live log pane polling every 1-2 s, artifacts list). Plain `<form>`, `<dialog>`, `fetch`, `<details>` cover it; no libraries.

Process model: one server process; executor threads run `subprocess.Popen(cmd, shell=False or sh -c, cwd=workspace, env=..., stdout=logfile, stderr=STDOUT, start_new_session=True)`; timeouts kill the whole process group (`os.killpg`). On startup, builds left in `running` are marked `aborted` (crash recovery) and `queued` ones re-enqueued.

## 4. Data model sketch (SQLite)

```
pipeline(id, name UNIQUE, description, config_json, next_build_no, created_at)
  -- config_json: {params:[{name,default,choices}], env:{K:V},
  --   stages:[{name, command, timeout_s, on_fail:'stop'|'continue', enabled, platform?}]}

upload(id, pipeline_id, filename, stored_path, size, sha256, uploader, created_at)

build(id, pipeline_id, number, status, config_snapshot_json, params_json,
      triggered_by, created_at, started_at, finished_at)
  -- status: queued|running|success|failed|aborted
  -- config_snapshot_json: pipeline config frozen at trigger time (reproducible)

build_upload(build_id, upload_id)       -- which files are in the build

stage_run(id, build_id, name, seq, status, exit_code, log_path, started_at, finished_at)
  -- status: pending|running|success|failed|skipped|timeout

artifact(id, build_id, stage_run_id?, rel_path, size)  -- or just list the directory on demand
```

Disk layout: `data/uploads/<sha256>` (content-addressed, name stored only in DB), `data/builds/<pipeline_id>/<n>/{workspace,logs,artifacts}`. Logs and artifacts live on disk, not in SQLite. YAGNI: artifact table can be dropped (list the directory); `build_upload` can be a JSON list in `build`. Keep SQLite in WAL mode with a short-lived connection per request/thread.

## 5. Security at trust boundaries

This system's core feature is "run commands from files users upload" - i.e. it is remote code execution by design. The goal is to confine it to the team, not to make it safe against hostile users.

1. **Filenames / path traversal.** Never use client filenames as paths. Store by hash or generated id; keep the original name as metadata only. When unpacking into the workspace, normalize and reject names with `..`, absolute paths, drive letters, NULs, or symlinks that escape (`Path.resolve().is_relative_to(workspace)`). If zip/tar are accepted, validate every member (zip-slip) or avoid extraction in MVP.
2. **Command execution.** Commands come only from the pipeline config (admin-edited), never from request fields of a trigger call. Build parameters reach commands as environment variables, never interpolated into the command string (no shell injection via params). Validate param names (`[A-Z_][A-Z0-9_]*`) and values against `choices`. Run with a scrubbed env (do not inherit server secrets), cwd in the workspace, per-stage timeout, process-group kill. Uploaded files that become executable test scripts mean uploaders effectively have shell access as the server user: run the server as a dedicated unprivileged user, and say so in the docs. No Docker here, so real sandboxing is out of scope (macOS `sandbox-exec` is deprecated and fiddly).
3. **Size and count limits.** Cap upload size (e.g. 100 MB; enforce while streaming, not after buffering), files per build, total workspace size, log size (truncate/rotate at e.g. 10 MB), and concurrent builds (pool size). Disk-usage retention: keep last N builds per pipeline and delete older workspaces.
4. **Auth.** Minimal sensible option: bind to `127.0.0.1` or the LAN/VPN only, and require a shared team token (`Authorization: Bearer ...` or a login form that sets a signed cookie) read from an env var; store nothing in the DB. Slightly better: per-user tokens in a small `user` table so `uploader`/`triggered_by` are real (audit trail). Full roles (viewer / uploader / admin) can wait; at minimum separate "run builds" from "edit pipeline commands", since the latter is the code-execution lever. Do not roll own password hashing; if passwords are needed use `hashlib.scrypt`. Use constant-time compare (`hmac.compare_digest`) for tokens. No TLS in the app; terminate with a reverse proxy if exposed beyond a trusted network.
5. **Output handling.** Logs are untrusted text: render with `textContent`, never `innerHTML` (XSS). Serve artifacts/uploads with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`. Set CORS to same-origin only (serve the UI from the same server).
6. **SQL.** Parameterized queries only.

## 6. Open questions for the user

1. Is a pip dependency acceptable (FastAPI path), or must the backend be stdlib-only (http.server + raw-body uploads)?
2. What is an "upload" - single files, a zip/tar of a build, or a git-like set of files? Does a new upload replace the previous build contents or add to them (cumulative workspace)?
3. Who are the users and how many? Is a shared team token enough, or are per-user accounts and roles needed from day one? Where will it be hosted (laptop, shared server, VPN)?
4. How are test suites supplied: inside the uploaded files, in a server-side directory managed by admins, or both? Any required results format (exit code only vs JUnit XML) and result history/trends?
5. Platform/target: what does "platform" mean (OS, device, environment)? Single machine only, or must builds eventually dispatch to other machines/agents?
6. Should a failed BVT always stop the pipeline, or configurable per stage (current proposal: configurable, default stop)?
7. Triggers beyond manual (on upload, scheduled/nightly, webhook)? Notifications (email/Slack) on failure?
8. Retention: how long to keep builds, logs, artifacts, and uploads; any disk quota?
9. Can users edit pipeline commands in the UI, or only admins (or only via a checked-in config file)?
