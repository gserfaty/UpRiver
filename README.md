# UpRiver

Custom CI/CD pipeline framework (Jenkins-inspired): upload files, build, run BVT/FVT test suites with user-defined configurations.

Status: phase 3 (uploads, builds and runner; the UI is still a placeholder). See `docs/plan.md` for the roadmap and `CHANGELOG.md` for progress.

## Setup and run

    python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    UPRIVER_TOKEN=team-secret UPRIVER_ADMIN_TOKEN=admin-secret \
      .venv/bin/uvicorn upriver.app:app --host 127.0.0.1 --port 8080
    .venv/bin/python -m pytest          # run from repo root

API docs at http://127.0.0.1:8080/docs. Every `/api` call needs `Authorization: Bearer <token>`; writes also need `X-UpRiver-User: <name>`. Creating/updating pipelines needs the admin token.

## Using the UI
Open `http://localhost:8000/`. The first visit shows the sign-in page: enter your name and the team token (and the admin token if you create or edit pipelines); they are stored in the browser's localStorage. The user menu (top right) has Edit credentials and Sign out. A breadcrumb and a context sidebar (Dashboard, Pipeline, Build) are on every page. Then:
- **Dashboard** (`#/`): filter the list by name ("Name contains..."), read the trend strip (last 20 builds per pipeline), pick a pipeline, or paste JSON under "New pipeline" (admin).
- **Pipeline page**: upload files by drop or choose (progress bar, result list with stored/unchanged per path; a batch is all-or-nothing; tick "Extract zip files" to unpack archives), open a file's History to pin an older version for the next build, pick a saved run config or set params and stages, then "Build now" or "Save as config". The Builds list filters by status and text (`#12`, user, config) and has Load more (up to 500). Rebuild on a row reuses that build's params, stages and file versions. Settings is a structured editor for the pipeline's description, params and stages (admin; read-only with a team token), with an "Advanced: raw JSON" view; saving updates the Run panel at once, and unsaved edits prompt before you leave. Removing a file or deleting a config asks for confirmation.
- **Build page** (`#/b/{id}`, or `#/b/{id}/s/{seq}` for a stage): a failed build opens on the failed stage with a summary line (stage, exit code, first error line) that jumps to the log. Click a stage to read its log; search it (`/`), toggle Follow (`f`), jump to the first error, copy or download it. Rebuild reuses the build's params, stages and file versions ("Rebuild with current files" uses the latest files). Abort asks for confirmation. Previous/Next build and "Compare with #N…" are in the sidebar; the compare page (`#/c/{a}/{b}`) shows param, file and stage differences and can swap sides; artifacts download when the build is done.

## Environment variables

| var | default | meaning |
|---|---|---|
| UPRIVER_TOKEN | required (startup fails if unset) | shared team token |
| UPRIVER_ADMIN_TOKEN | required | admin token (also accepted wherever the team token is) |
| UPRIVER_DATA | ./data | DB, blobs, builds |
| UPRIVER_EXECUTORS | 2 | concurrent builds |
| UPRIVER_MAX_UPLOAD_MB | 200 | per-file and per-zip-uncompressed cap |

On first start a `demo` pipeline (bvt, fvt; run configs `quick`, `full`) is seeded from `samples/demo.json`.

## Plugging in stages and tests

A pipeline's `config.stages` is an ordered list of `{name, kind, command, timeout_s, on_fail}`. Each build copies the pipeline's current file set (or pinned versions) into a fresh workspace, then runs every selected stage as `/bin/sh -c "<command>"` with the workspace as the working directory. Exit 0 passes; anything else fails. `on_fail: stop` skips the remaining stages, `continue` runs them (the build still ends `failed`). A stage over `timeout_s` is killed (SIGTERM, then SIGKILL after 5 s) and fails.

Uploaded files are not executable; call them through an interpreter, e.g. `sh tests/run.sh` or `python3 -m pytest tests`. `$UPRIVER_ROOT/...` reaches the scripts shipped in `samples/`.

The command sees only this environment (nothing from the server's own env):

| var | value |
|---|---|
| PATH, HOME, LANG | inherited from the server |
| UPRIVER_ROOT | UpRiver checkout directory |
| UPRIVER_PIPELINE, UPRIVER_STAGE | pipeline and stage names |
| UPRIVER_BUILD_ID, UPRIVER_BUILD_NUMBER | global build id, per-pipeline number |
| UPRIVER_WORKSPACE | the working directory |
| ARTIFACTS_DIR | write results here; listed and downloadable via `/api/builds/{id}/artifacts` |
| UPRIVER_PARAM_<NAME> | one per declared build parameter (values are never interpolated into the command) |

stdout and stderr go to one log per stage, readable while it runs with `GET /api/builds/{id}/stages/{seq}/log?offset=N`. Trigger with `POST /api/pipelines/{id}/builds` (body optional: `config_id`, `params`, `stages`, `upload_ids` to pin file versions); abort with `POST /api/builds/{id}/abort`. A pipeline with `auto_build: true` builds once per upload request that changed something.

## Security

Uploaded files can be executed by stage commands, so uploaders effectively have shell access as the server user. Run UpRiver as a dedicated unprivileged user and bind it to localhost/LAN/VPN only. There is no TLS; use a reverse proxy if exposed beyond a trusted network.

## Contributing

Open a pull request against `main`. Every PR needs approval from the code owner (@gserfaty) before it can merge.
