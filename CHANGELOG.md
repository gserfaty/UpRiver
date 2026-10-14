# Changelog

## UI redesign: shell, sign-in, Build page
- Design work (research, journey, tokens, mocks) was done locally and is not in the repo; only the resulting UI is committed.
- New app shell: tokens ("River Ledger", light/dark, system fonts), top bar with mark, breadcrumbs and user menu (Edit credentials, Sign out), per-context sidebar (horizontal bar under 44em), skip link, `#/signin` first-run page replacing the header inputs, Not-found page for unknown routes, in-app `<dialog>` confirms (Abort, Remove file, Delete config).
- Build page (`#/b/{id}`, `#/b/{id}/s/{seq}`): status ball and stamp, failure summary line linking to the log, Rebuild (same params, stages and file versions) and Rebuild with current files, Abort with confirm, Stage View grid, line-numbered console (search with count, Follow, Jump to first error, Copy, Download, Wrap, Full height; 100k lines render in chunks), failed stage auto-focused unless you picked one (then a banner), Previous/Next build, artifacts. `/` focuses search and `f` toggles Follow (ignored while typing).
- Dashboard and Pipeline pages restyled with the same components; behavior unchanged.
- Not yet: Compare page, dashboard filter/trend strip, structured Settings editor, Run-panel unsaved-edit tracking, ANSI colors (escapes are stripped).

## Keep design/planner artifacts local
- `.design-foundations/`, `JOURNEY.md` and `DESIGN.md` are no longer tracked and are now gitignored (they stay on disk as working files for the redesign).

## Design phase 2: DNA, type and color (proposed, awaiting lock)
- `DESIGN.md` "River Ledger": greyscale UI plus one muted river-teal accent (light `#486b68`, dark `#84c6c1`), semantic status hues, round status balls with distinct glyphs and rubber-stamp status labels, system font stack, dark console in both themes, focus-ring token, inline-SVG mark, motion budget, Never list.
- Evidence: palette.mjs exit 0; all text pairs ≥5.17:1, console ≥7.7:1, status balls ≥3:1 both themes; detector 0 tells. Independent review PASS (Minors only).
- Styled Build mock + light/dark screenshots in `.design-foundations/mocks/`.

## Design phase 1: journey and page specs
- `JOURNEY.md`: job story, journey (trigger → watch → fail → diagnose → re-run/compare), IA (route map incl. `#/b/{id}/s/{seq}`, `#/c/{a}/{b}`, `#/signin`; breadcrumbs; sidebar actions per context), flows F1–F7, and page specs (purpose, entry points, blocks, states, CTA, exit) for Dashboard, Pipeline, Build, Compare, Sign-in.
- Key rules: failed stage auto-focused unless the user picked a stage (then a "View log" banner); Follow never moves off a failed stage; unsaved Run-panel edits kept per pipeline with "Modified" + "Reset to saved"; leave/sign-out confirms on unsaved edits; admin actions disabled with a reason for team-only users; every empty state has a next step; 360px layouts per page; `/` focuses log search, `f` toggles Follow.
- All 14 research pain points mapped; out of scope: per-line log timestamps, content diff on upload, undo for deletes, server-side build search.
- Review: 3 independent design reviews (fail → fixed); final two usability fixes applied with owner approval.

## Design groundwork
- Repo made public; `.github/CODEOWNERS` (`* @gserfaty`) and `main` protection: PRs need code-owner approval (owner can still push).
- `.design-foundations/`: research brief, redesign plan (journey → DNA → design system), approved greyscale Build-page wireframe mock + review. Mock sign-off pin: greyscale UI plus exactly one brand accent color; status colors stay semantic.

## Phase 4 review fixes
- Navigation: each route now renders into a fresh container and pollers stop when their node leaves the page. Before, a slow page from the previous route appended into the new one (list content showed up under a build), and a build poller started after a quick navigation-away kept polling forever.
- Build page: the log follows the running stage, then the failed one, until the user picks a stage (it used to stay on the stage that was running when the page opened). Pipeline is fetched once, not on every 2 s poll.
- Accessibility: stages are buttons (`aria-pressed`), inputs/textareas/pin checkboxes have labels, History has `aria-expanded`, the sign-in bar is a form (Enter saves). History errors show inline instead of an unhandled rejection.
- Dark mode: `color-scheme` set so native controls match; badges use dark text on the light dark-mode colors (white on light green was unreadable).

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
