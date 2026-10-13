# UpRiver JOURNEY

Companion to DESIGN.md (created in Phase 2). Scope: jobs, IA, flows, page specs. No styling, tokens or final copy (labels below are working names; Phase 3 sets final microcopy).
Basis: `.design-foundations/research/2026-10-13-upriver.md`, wireframe `.design-foundations/mocks/build-page-failed.html` (approved), current `upriver/static/app.js` and `upriver/app.py`.
Owner: UpRiver maintainers (repo owner as named contact: Gabriel). Update cadence: when a route, page block or API contract changes. Research basis is code reading plus the brief; no user interviews, card sort or tree test, so the journey and the IA are unvalidated hypotheses to check against first team use. Accepted: small team, no research budget. The journey table has no touchpoint lane (optional, accepted).

## Job

JTBD school: Moesta (Switch), four forces. One primary job story, one secondary.

**Primary.** When a build I started (or a teammate started) goes red, I want to see which stage failed and read why within one click, so I can fix it or re-run without hunting through a UI.

| Force | Content |
|---|---|
| Push (away from now) | Failure is not dominant today: stages are a vertical button list, a skipped stage looks like a pending one, the log is a 28rem box with no search or line numbers. |
| Pull (toward new) | A Jenkins-like page I already know (sidebar, `Dashboard > pipeline > #12`, Console Output) where the failed stage is already selected and its log is open and searchable. |
| Anxiety | A new UI hides things I rely on (Jenkins muscle memory), loses the live log, or lets me click Abort/Remove by accident. |
| Habit | Jenkins vocabulary, `#N` build numbers, status balls, hash URLs pasted into chat. Routes stay. |

**Secondary.** When I have a change ready, I want to upload it, pick a run config and trigger a build in one sitting, so I can start a build without filling a long form.

**Users.** Small engineering team sharing one team token; some hold the admin token. Desktop first, phone check of a running build at 360px.

## Journey

Stages are a loop, not a funnel (McKinsey loyalty loop 2009): diagnose often returns to run.

| Stage | User does | Page | Feeling | Risk | Design response |
|---|---|---|---|---|---|
| Upload | Adds files, sees what changed | Pipeline > Files | Confident when the result is itemised | One-line result disappears | Per-file result list stays until dismissed |
| Trigger | Picks config, tweaks params, Build now | Pipeline > Run | Slightly anxious: "is this the config I saved?" | Unsaved edits mistaken for saved config, or lost | Run summary + "Modified" marker, Reset to saved, edits kept per pipeline (see Unsaved edits) |
| Watch | Follows stages and live log | Build | Calm if status is loud and live | Not knowing a stage moved | Auto-follow running stage; status announced politely |
| Fail | Notices red | Build | Focused, wants cause | Failure buried | Failure summary on top, failing stage focused, log at first error |
| Diagnose | Reads log, searches, downloads | Build | Wants speed | Long log | Search, jump to first error, copy/download |
| Re-run / Compare | Rebuilds, or asks what changed vs last green | Build, Compare | Wants a clear delta | Rerun with different inputs unknowingly | Rebuild note beside the button says what it reuses; Compare shows changed rows first |

## IA

Four IA systems (Rosenfeld/Morville): organization (Dashboard > Pipeline > Build, plus Compare as a build-pair view), labeling (Jenkins vocabulary), navigation (breadcrumb + context sidebar), search (client-side only: pipeline filter, build filter, log search). Hick's law (1952): each sidebar has at most 6 entries.

### Route map

All hash routes. Existing three are unchanged. Additive routes are marked.

| Route | Page | Notes |
|---|---|---|
| `#/` | Dashboard | Also the fallback for an empty hash |
| `#/p/{pid}` | Pipeline | Sections (Builds, Files, Run, Configs, Settings; Configs is the saved-config list inside the Run block) are in-page, reached from the sidebar by scroll + focus; no extra routes |
| `#/b/{bid}` | Build | Auto-selects running, else failed, else last stage |
| `#/b/{bid}/s/{seq}` (additive) | Build with stage `seq` selected | Deep link used by history rows and failure chips; behaves as if the user picked that stage |
| `#/c/{a}/{b}` (additive) | Compare | `a` = baseline build id (left), `b` = subject build id (right). Ids are build ids, as in `#/b/{id}` |
| `#/signin` (additive) | Sign-in / first run | Also the forced view when credentials are missing, on any route (see Flows). Original hash is remembered and restored after sign-in |
| any other hash | Not found state inside the shell | Message plus link to Dashboard. Replaces today's silent fallback to the list |

### Breadcrumb pattern

Jenkins style, always in the top bar next to the UpRiver mark, each ancestor a link, the current page plain text (`aria-current="page"`), separator `›`:

- Dashboard: `Dashboard`
- Pipeline: `Dashboard › {pipeline}`
- Build: `Dashboard › {pipeline} › #12`
- Compare: `Dashboard › {pipeline} › #11 vs #12`
- Sign-in: `Sign in`

Names are untrusted text (textContent only). Long pipeline names truncate with ellipsis and a title; at 360px the trail collapses to the parent and current page (`… › demo › #12`). `document.title` mirrors it (`#12 failed · demo · UpRiver`).

### Sidebar actions per context

The sidebar is a list of links/buttons; the current view has `aria-current`; unavailable actions stay visible but disabled with a reason (Nielsen #6 recognition, #1 status). At <=700px it becomes a horizontal scrolling bar under the top bar (as in the wireframe).

| Context | Entries (in order) | Disabled-with-reason cases |
|---|---|---|
| Dashboard | Pipelines (current) · New pipeline | New pipeline: "Admin token required" when no admin token is stored; hidden-state reasons shown as tooltip and `aria-describedby` text |
| Pipeline | Build now · Builds · Files · Run · Configs · Settings | Build now: "Select at least one stage" when none checked; Settings: "Admin token required" without admin token |
| Build | Console (current) · Artifacts (n) · Abort · Compare… · separator · Previous build #n-1 · Next build #n+1 | Abort: "Not running" when finished; Previous/Next: "No earlier build" / "No later build"; Artifacts: "(0)" with no items still opens the empty state |
| Compare | Back to build #b · Swap sides · Pick other build… | Swap disabled while loading |
| Sign-in | none (no sidebar; single column) | n/a |

Build now in the Pipeline sidebar runs the Run panel's current values, identical to the panel's primary button. Previous/Next come from `GET /pipelines/{pid}/builds?limit=500` (current API accepts up to 500), matched by build id.

### Unsaved edits

- **Run panel.** Edits (config choice, params, stages, pins) are kept per pipeline in `sessionStorage`, so leaving and returning restores them. A visible "Modified" marker plus per-field highlight shows the panel differs from the selected saved config (or from defaults), with a "Reset to saved" action. Switching config while Modified asks Keep edits / Discard (Discard loads the new config's values; Keep cancels the switch and leaves the select and edits as they were). Build now and Save as config clear the marker only on Save as config; a triggered build keeps the panel as is.
- **Settings editor (admin) and New pipeline editor.** Unsaved changes ask for confirmation on leaving: in-app confirm on `hashchange` (Stay / Leave without saving) and a `beforeunload` prompt for tab close or reload. Save clears the dirty state.
- Not persisted: the Settings editor does not use sessionStorage (admin documents may hold commands; kept in memory only).

### Capability model (admin vs team)

No roles API. Client infers: admin controls are enabled when an admin token is stored. A stored admin token that gets a 403 is marked invalid for the session and the control explains "Admin token was rejected. Re-enter it in the user menu." Team-only users see admin controls disabled with a reason, not failing with a 403 (Nielsen #5 error prevention).

### User menu

Top bar right: shows `name` and role chip (`team` or `team + admin`). Opens: Edit credentials (`#/signin`), Sign out (clears the three localStorage keys and the per-pipeline Run-panel edits in sessionStorage, returns to first-run). If any Run panel is Modified, it first asks "Sign out and discard unsaved run changes?" (Sign out / Cancel), the same Stay/Leave pattern as the Settings leave-confirm; with no unsaved edits there is no dialog. Replaces the three permanent header inputs.

## Flows

Notation: `→` step, `?` decision.

### F1 First-run sign-in
Open any URL → credentials missing? yes → Sign-in page, original hash remembered → enter name, team token, optional admin token → Continue → wrong token? the first API call returns 401 → stay on Sign-in with cause → fix → restore original hash. Admin token is optional and skippable ("Skip, I only need team access").

### F2 Upload files
Pipeline › Files → drop files or choose → optional "extract zips" → Upload → progress per file → result list (stored / unchanged / error per path, kept until dismissed) → file table updates with version → optional: History on a path to pin an older version for the next build.

### F3 Trigger a build
Pipeline › Run → choose config (or defaults) → params prefilled → stages prefilled → edits show "Modified" and Reset to saved (switching config with edits asks Keep/Discard; leaving the page keeps edits for this pipeline in the session) → Build now → lands on Build page (watch). If the trigger fails (400: unknown stage, pin clash, no stages), the error stays on Pipeline in the Run block with cause and fix; no redirect. Optional: name + Save as config first. Pinned versions listed in the Run summary ("app.zip pinned to v4") with remove (x).

### F4 Failure diagnosis (the core flow)
Build page open, stage running → stage fails → status announced (polite live region) → if the user has not picked a stage: focus view moves to the failed stage, log scrolls to the first error line; if the user picked another stage: a a persistent failure banner "fvt failed - View log" appears with a one-click View log button (it stays until the user selects the failed stage); the selection is never changed under a user's pick (Nielsen #3). With `on_fail: continue`, once a stage has failed with no pick the failed stage stays selected and Follow does not advance; a "Running: <stage> · View" chip offers one click to the running stage → read log, search, copy/download → decide: Rebuild (same inputs), Compare with the previous green build, or fix the files and re-run from Pipeline.
Click counts (DW-1.2): from the Build page, failed stage log = 0 clicks when auto-focused, 1 click otherwise (stage cell or banner). From a Pipeline history row: click the failure chip (`fvt failed`) = 1 click straight to `#/b/{id}/s/{seq}`; click the row's `#N` = 1 click and the failed stage is auto-focused. Worst case from the Pipeline history is 1 click (chip or `#N`), within the 2-click limit. From the Dashboard, the pipeline's failure chip is also 1 click to the log; going via the pipeline row then the history chip is 2.

### F5 Compare two builds
Build › Compare… → picker lists builds of the same pipeline (default: previous build) → open `#/c/{a}/{b}` → changes first: params, files@version, stages → click a differing stage to open that stage's log on its build (`#/b/{id}/s/{seq}`). Swap sides keeps the route valid.
Shortcut: History row action "Compare with previous" and Dashboard none.

### F6 Admin settings
Pipeline › Settings (admin) → structured editor: description, auto build, params (name, default, choices), stages (name, kind, command, timeout, on fail) → inline validation per field → leaving the editor with unsaved changes asks Stay / Leave without saving (hashchange confirm + beforeunload) → Save → success: new params and stages appear in Run panel immediately with no page reload (pain point 1) → "Advanced: raw JSON" disclosure for the same document; changes sync both ways, invalid JSON blocks Save with line/cause. New pipeline uses the same editor with a starter template.

### F7 Abort
Build running → Abort (sidebar, header, or the running row on Pipeline; all use this same confirm) → confirm dialog naming build and what is lost → status goes `aborted`, running stage `aborted`, pending `skipped`. 409 "already finished" is shown as information, not an error.

## Page specs

Common to all pages: top bar (mark, breadcrumb, user menu), skip link to main content, sidebar per context, one `aria-live="polite"` region for status changes, errors in a banner above content with cause and fix, every poller stops when its node leaves the document. Status is always icon shape plus text plus color (ball glyphs: check passed, cross failed, pulse/spinner running, stop aborted, dash skipped, hollow queued/pending).

### 1. Dashboard `#/`

**Purpose.** Scan every pipeline's health and open one; admin creates a pipeline.
**Entry points.** Logo, breadcrumb root, sign-in success default, Not-found link, Pipeline breadcrumb.
**Blocks (in order).**
1. Page header: "Pipelines", count, filter input (client-side name filter).
2. Pipeline table, one row per pipeline: status ball + name (link `#/p/{id}`) · description · trend strip (last 10 builds, shape-coded, fetched lazily via `GET /pipelines/{pid}/builds?limit=10`, row shows status only until it arrives) · last build `#N` + relative time · failure chip when last build failed (`fvt failed`, links to `#/b/{id}/s/{seq}`, loaded lazily from `GET /builds/{id}`).
At 360px each pipeline row is a stacked card (ball and name, then description, trend strip, last build, failure chip), the filter is full width.
3. New pipeline (admin) entry: opens the structured pipeline editor (same editor as F6) in a panel under the table.
**States.**
| State | Behaviour |
|---|---|
| Loading | Skeleton rows, count "Loading..." |
| Success | Table as above |
| Empty (0 pipelines) | "No pipelines yet." + next step: admin sees "Create the first pipeline" button; team-only sees "Ask an admin to create one" |
| Filter no match | "No pipeline matches 'x'" + Clear filter |
| Error | Banner with cause and fix (401: "Token rejected, re-enter it" → `#/signin`; network: Retry) |
| Running | Row shows running ball and elapsed time; row refreshes every 5 s while any pipeline's last build is queued/running |
| Failed | Row shows failed ball and failure chip |
**Primary CTA.** Open a pipeline (row link). Admin secondary: New pipeline.
**Exit.** Pipeline, Build (failure chip), Sign-in.

### 2. Pipeline `#/p/{pid}`

**Purpose.** Hub to upload files, configure and trigger a run, and read build history.
**Entry points.** Dashboard row and failure chip, Build breadcrumb, Compare breadcrumb, sign-in restore.
**Blocks (in order).**
1. Header: pipeline name, description, last-build ball, Build now (primary). With unsaved Run-panel edits the label reads "Build with unsaved changes" (same in the sidebar and Run block); no extra dialog.
2. Run: config select (with "(defaults)"), "Modified" marker + Reset to saved, params (select for choices, text otherwise), stages as checkboxes, pinned versions list with remove, Build now, Save as config (name field), Delete config (confirm). At 360px the Files table becomes stacked rows (path, then version, size and uploader; actions in a row below) and the drop zone is full width. At 360px the Run block is a single column: config select, params and stages stack at full width, stage checkboxes get 44px rows, Build now and Save as config sit in a sticky bottom bar. Run summary line: "nightly - ENV=staging - 3 stages - 1 pinned". Modified-vs-saved diff is highlighted per field; edits persist per pipeline in the session (see Unsaved edits) (pain point 8).
3. Builds (history): filter by status and text, rows: ball · `#N` (link) · failure chip or "all passed" · config · by · created · duration · row actions (Rebuild, Compare with previous). Row Rebuild carries the same reuse disclosure as the Build page: accessible name/description "Rebuild #N: reuses params, stages, files@vN as in #N", shown as a tooltip and visibly on hover and keyboard focus, and written out in the action label at narrow widths (no hover there); it triggers immediately, no extra dialog. Stage cells for the latest 10 builds (Stage View grid, per-stage ball + duration, click a cell = `#/b/{id}/s/{seq}`), degrading to status only for older rows. At 360px the grid becomes one stacked row per build with its stage balls wrapping beneath the `#N` line (no sideways page scroll). "Load more" raises the limit from 50 up to 500.
4. Files: drop zone + file picker, "extract zips" option, Upload; result list after upload; table of path · version · size · uploader · actions (Download, History, Remove with confirm); History shows versions with Pin for next build.
5. Settings (admin): structured editor + Advanced JSON disclosure (F6). Team-only view: block visible, read-only values, Save disabled with the reason "Admin token required" (and the Advanced JSON is read-only). At 360px the structured editor is a single column: each param and stage is a collapsible card (name and kind in the summary), fields stack, Save sits in a sticky bottom bar.
**States.**
| State | Behaviour |
|---|---|
| Loading | Skeleton per block; blocks load independently so Run is usable before history |
| Success | As above |
| Empty: 0 files | "No files yet. Drop files here to upload." + Upload button. Build now stays allowed (the stage decides) with the inline hint "No files in this pipeline yet" beside the button |
| Empty: 0 builds | "No builds yet." + Build now |
| Empty: 0 configs | Config select shows "(defaults)" only; hint "Save these settings as a config to reuse them" |
| Not found (unknown pipeline id) | "Pipeline {id} not found" with next step: link to Dashboard (and the filter hint if the id was mistyped); sidebar shows Dashboard only |
| History filter: no match | "No builds match this filter" + Clear filter (and "Load more" if the cap of 50 hides older builds) |
| Error | Per-block banner, other blocks keep working (upload error does not hide Run) |
| Running | A running build row at top with running ball, elapsed time, and Open/Abort (row Abort uses the F7 confirm); history refreshes every 3 s while any row is queued/running |
| Failed | Failed rows carry the failure chip; the header ball is the failed shape |
| Upload in progress | Per-file progress, Upload disabled, then result list |
| Unsaved edits | Run block shows Modified + Reset to saved; config switch asks Keep/Discard; Settings leave asks Stay/Leave |
| Settings, team-only | Visible and read-only, Save disabled with reason |
| Build trigger error | 400s (unknown stage, pin clash, no stages) shown at the Run panel with cause and fix |
**Primary CTA.** Build now.
**Exit.** Build (after trigger, or from history), Compare, Dashboard.

### 3. Build `#/b/{bid}` (and `#/b/{bid}/s/{seq}`)

**Purpose.** Watch a build live and, when it fails, read the failing stage's log immediately. Layout follows the approved wireframe `.design-foundations/mocks/build-page-failed.html`.
**Entry points.** Build now redirect, history row/stage cell/failure chip, Dashboard failure chip, Compare stage click, Previous/Next build, pasted URL.
**Blocks (in order).**
1. Header (`h1`): status ball + "Build #12" + status tag; primary CTA "Rebuild" at the right with a one-line note beneath: "Reuses params, stages, files@vN as in #12" (secondary "Rebuild with current files").
2. Failure summary line (failed/aborted only): "fvt failed - exit 1" and, when running, "fvt running - 1m 12s". Plain text from stage data (name, exit code); no test count, since the API has none.
3. Meta list: Triggered by · Config · Duration · Params · Files (n files, first two `path@vN`, expand for all).
4. Stages (Stage View row): one cell per stage in order: ball, name, status text, duration, exit code when present. Failed cell visually dominant; skipped vs pending distinct by glyph and text. Cell is a button with `aria-pressed`; selecting it swaps the console. Failed cell is auto-selected when the user has not picked one.
5. Console output (stage name in the header): toolbar (search, Follow toggle, Jump to first error, Copy, Download log, Full height; shortcuts `/` focuses log search and `f` toggles Follow, both ignored while typing in a field; at 360px search takes its own row and the actions collapse into a "More" menu, Follow and Jump stay visible), line-numbered log, ANSI colors as DOM nodes, `tabindex=0`. Log is raw text so no per-line timestamps. Polls stage log by `offset` every 1.5 s until complete; build every 2 s while queued/running.
6. Artifacts: file name, size, Download (fetch to blob); shown once the build is not active.
**Sidebar (wireframe).** Console · Artifacts (n) · Abort · Compare… · Previous build · Next build.
**One-click failure access (DW-1.2).** Failing stage cell and log visible on arrival (0 clicks); if another stage is selected, one click on the failed cell or the "fvt failed - View log" banner. From the Pipeline history row: failure chip = 1 click to the log; `#N` = 1 click with the failed stage pre-selected; Dashboard failure chip = 1 click.
**States.**
| State | Behaviour |
|---|---|
| Loading | Header and stage skeleton; console shows "Loading log..." |
| Queued | Queued ball, "Waiting for a runner", Abort enabled, no stages yet ("No stages started yet."), console empty with explanation |
| Running | Running ball (pulse unless reduced motion), the running stage auto-selected with Follow on; pending stages hollow; Abort enabled; polite announcement on each stage change |
| Passed | Passed ball, no failure line, last stage selected, Artifacts listed, Rebuild remains |
| Failed | Failure line, failed stage selected, log scrolled to first error, later stages marked skipped (`on_fail: stop`) or continuing (`on_fail: continue`) |
| Aborted | Aborted ball (stop glyph), running stage aborted, pending skipped, "Aborted by {who}" only if the API exposes it, otherwise "Aborted" |
| Failure while watching | Rule: auto-focus the failed stage (select it, scroll the log to the first error, announce it) unless the user manually picked a stage; if they did, a persistent failure banner "fvt failed - View log" with a one-click button appears and the selection is not changed |
| Stage failed, no user pick, build continues (`on_fail: continue`) | The failed stage stays selected; Follow does not advance to the next running stage. A chip "Running: <stage> · View" appears, one click selects it |
| Next stage starts, user picked a stage | The picked stage stays selected (Follow only applies when the user has not picked); the stage change is announced politely and the running cell is marked so it can be selected in one click |
| Empty log | "This stage has produced no output yet." (running) or "No output." (finished) |
| Log very long | Rendered incrementally, search results capped with count, page does not freeze; hostile content (`<img onerror>`) shows as text |
| Not found (404) | "Build not found" + link to Dashboard |
| Error | Banner with cause and Retry; stale data stays visible, marked "Last updated hh:mm:ss" |
| No artifacts | "This build produced no artifacts." Next step: "Write files to $ARTIFACTS_DIR in a stage command to list them here" with a link to the README environment table (README.md, "ARTIFACTS_DIR") |
**Primary CTA.** Rebuild (finished builds) / Abort (running builds, becomes the emphasized action, with confirmation).
Rebuild reuses the build's params, stages and file versions (`upload_ids` from `files`) and says so in the note beside the button; a secondary "Rebuild with current files" is offered. If a pinned upload no longer exists the API 400 is shown with its cause.
**Exit.** Pipeline (breadcrumb), Compare, Previous/Next build, Artifact download (stays on page).

### 4. Compare `#/c/{a}/{b}`

**Purpose.** Answer "what changed between #11 (green) and #12 (red)?" with a client-side diff of two existing build snapshots (`GET /builds/{a}`, `GET /builds/{b}`).
**Entry points.** Build sidebar Compare…, history row "Compare with previous", a pasted URL.
**Blocks (in order).**
1. Header: ball + "#11 vs #12", pipeline name, Swap sides, Pick other build.
2. Verdict line: "2 params, 1 file and 1 stage differ." or "No differences."
3. Params table: name · baseline · subject, changed rows first and marked "changed"; unchanged collapsed behind "Show 3 unchanged".
4. Files table: path · baseline version · subject version, marked changed, added, removed.
5. Stages table: matched by stage name: baseline ball+duration · subject ball+duration · delta; a stage present on one side only is marked "only in #12" with a placeholder, not an error. Differing rows link to that build's log (`#/b/{id}/s/{seq}`).
6. Build facts: triggered by, config, created, duration for each side.

At 360px the Compare tables become stacked cards per row (name, then baseline and subject values on two labelled lines); changed rows stay first.
**States.**
| State | Behaviour |
|---|---|
| Loading | Skeleton for both columns |
| Success (differences) | As above |
| Picker, pipeline has only one build | Picker shows "No other build to compare with yet" and a link back to the build; Compare... stays enabled in the sidebar so the reason is visible |
| Identical pair (a == b) | "These are the same build." + Pick other build; no table |
| Identical content | "No differences in params, files or stages" + durations still shown |
| Builds with different stage lists | Stages matched by name; unmatched shown as "only in #N"; verdict counts them |
| Non-existent build | "Build {id} not found" naming which side, with Pick other build for that side; the valid side still renders |
| Different pipelines | Info banner "These builds belong to different pipelines"; comparison still renders |
| Running build in the pair | Values shown with a running ball and "still running"; refreshes every 3 s until finished |
| Error | Banner with cause and Retry |
**Primary CTA.** Open the first differing stage's log.
**Exit.** Build a or b (breadcrumb/headers), Pipeline.

### 5. Sign-in / first run `#/signin` (and forced on any route)

**Purpose.** Capture who you are and the tokens; replaces the permanent header inputs.
**Entry points.** First visit on any URL, 401 response, user menu Edit credentials, Sign out.
**Blocks (in order).**
1. Mark + one-line description ("UpRiver: pipelines and builds for your team").
2. Form: name, team token (password), admin token (password, optional, labelled "Only needed to create pipelines and edit settings"). Show/hide token toggle.
3. Continue (primary), Skip admin note.
**States.**
| State | Behaviour |
|---|---|
| Empty (first run) | Fields blank, only name + team token required |
| Prefilled (edit) | Name shown, tokens masked, Sign out available |
| Loading | Continue disabled with "Checking..." while the first `GET /pipelines` verifies the team token |
| Error | 401: "The team token was not accepted. Check it with your admin and try again." keeps the typed name |
| Admin rejected | Later 403 shows in context and points back here; sign-in itself does not verify the admin token |
| Success | Redirect to the remembered hash or Dashboard; user menu shows role chip |
**Primary CTA.** Continue.
**Exit.** The originally requested page, Dashboard.

## Pain-point map

| # | Pain point | Where it is addressed |
|---|---|---|
| 1 | JSON textareas, reload to see changes | F6; Pipeline block 5 (structured editor + Advanced JSON; Run panel refreshes without reload); Dashboard block 3 (New pipeline) |
| 2 | No sidebar, no prev/next build | IA sidebar per context; Build sidebar Previous/Next; Build primary CTA |
| 3 | Minimal breadcrumbs, no pipeline name on Dashboard, no build number in title | IA breadcrumb pattern and `document.title`; Dashboard block 2 shows the last build as `#N` with pipeline context in each row |
| 4 | Status shapes, failing stage in list, trend | Common status rule; Dashboard block 2 (trend strip, failure chip); Pipeline block 3 (failure chip, stage cells) |
| 5 | Stages as vertical button list, failure not dominant | Build blocks 2 and 4; Pipeline Stage View cells |
| 6 | Log usability | Build block 5 (line numbers, Follow, search, copy/download, ANSI, jump to first error, full height). Per-line timestamps: out of scope (API returns raw text; needs a backend change) |
| 7 | Upload feedback | F2; Pipeline block 4 (drop zone, progress, per-file result list). Diff of changed content: out of scope beyond stored/unchanged/version (no content-diff API) |
| 8 | Run panel long form, invisible pins, unsaved vs saved | Pipeline block 2 (summary line, edited marker, pinned list, per-field diff) |
| 9 | Empty states bare | Empty rows in every page spec, each with a next step |
| 10 | Errors unstyled, no confirmation | Page-common error banner (cause + fix); confirms on Abort (F7), Remove, Delete config, history Remove. Undo: out of scope, no restore API for removed files except re-upload; confirmation used instead |
| 11 | Sign-in, no sign-out, admin vs team | Sign-in page spec; user menu; capability model (disabled with reason) |
| 12 | No compare, re-run, filter, paging | Compare page; Build Rebuild; Pipeline block 3 filter and Load more (to 500). Server-side build search: out of scope, client-side filter only |
| 13 | Responsive | IA sidebar collapse, breadcrumb collapse; Build stages stack at <=700px; tables become stacked rows at 360px; hit targets 32px fine pointer, 44px coarse (plan D4). All functions remain at 360px |
| 14 | Accessibility gaps | Common rules: skip link, polite live region for status/log events, ball glyph + text, `aria-pressed` stage cells, `aria-current`, focus-visible. Visual focus style is a Phase 2/3 token |

## Open items for Phase 2 and 3

- Visual weight of the failed cell, ball glyph geometry, focus ring: Phase 2/3.
- Final copy for all strings above: Phase 3 (the text here is working copy).
- Optional additive backend endpoint to avoid N+1 fetches for trend/failure chips (`GET /pipelines/{pid}/builds` with a failing-stage field): implementation phase may add it; the spec degrades without it.
- Accepted, owner Phase 2: focus-visible styling is not specified here. DESIGN.md must define a focus-ring token passing >=3:1 non-text contrast in both themes.
- Accepted: IA and journey unvalidated by card sort or tree test (small team, no research budget); no touchpoint swim lane. Other keyboard shortcuts beyond `/` (log search) and `f` (Follow) are deferred to Phase 2/3.
- Accepted, owner Gabriel: Remove (file) and Delete config are confirm-only; there is no restore API.
