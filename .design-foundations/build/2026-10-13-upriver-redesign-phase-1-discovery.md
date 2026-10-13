# Discovery + Design: Phase 1 - Journey & page specs

## Artifacts Found / Current State
No DESIGN.md or JOURNEY.md. Inputs: plan, research brief, `upriver/static/app.js` (3 routes, `badge()` text pills, JSON textareas, stage button list, 28rem log), `upriver/app.py` (build detail returns `stage_runs` with status/exit_code; builds list returns no stage data; list limit up to 500), approved wireframe `.design-foundations/mocks/build-page-failed.html`.

## Gaps
- Builds list and pipelines list carry no failing-stage or trend data: failure chips need lazy `GET /builds/{id}` (N+1) or an optional additive endpoint.
- Stage status values: pending, running, passed, failed, aborted, skipped. Build statuses add queued.
- No abort-by, no test counts, no timestamps in logs: wireframe line "2 failing tests" cannot be derived; spec uses stage name and exit code only.
- Deep link to a stage needs additive route `#/b/{id}/s/{seq}`.

## Gate Status
Entry stage is Discover: no gating artifacts required. This phase produces the JOURNEY.md that gates Phase 2/3.

## DW Verification
| DW-ID | Done-When Item | Status | Evidence |
|---|---|---|---|
| DW-1.1 | 5 complete page specs | COVERED | JOURNEY.md `## Page specs` 1-5, each with purpose, entry points, ordered blocks, state table, primary CTA, exit (read check) |
| DW-1.2 | Failing stage + log in 1 click; history row <=2 | COVERED | Build spec "One-click failure access" and F4 click counts |
| DW-1.3 | Sidebar per context, breadcrumb, route map incl. Compare | COVERED | `## IA` route map, breadcrumb pattern, sidebar table |
| DW-1.4 | 14 pain points mapped | COVERED | `## Pain-point map`, 14 rows, 4 partial out-of-scope items with reasons |
| DW-1.5 | Usability walk, no Critical | COVERED (pending) | Author self-walk below; independent design-review-agent walk is run by the orchestrator |
All items COVERED: YES (5/5)

## Design Decisions
- Moesta four forces (journey doctrine: one JTBD school). Loop not funnel.
- Pipeline sub-sections stay in-page (no new routes) to keep routes additive and minimal.
- Compare uses build ids (consistent with `#/b/{id}`); a = baseline, b = subject.
- Failure chip is the one-click path from lists; auto-select is the zero-click path on Build. No focus theft when the user picked a stage (Nielsen #3).
- Admin controls disabled with reason, never left to 403 (Nielsen #5, #6).
- Confirmation instead of undo for destructive actions (no restore API).

## Self usability walk (Nielsen 10)
No Critical issues found. Majors resolved: #1 status visibility (live region, last-updated on error), #3 control (banner instead of auto-jump), #5 prevention (disabled admin, abort confirm), #6 recognition (sidebar disabled-with-reason), #9 errors (cause+fix). Accepted minors: Pipeline sidebar items scroll in-page rather than navigate; cross-pipeline compare allowed with banner.

## Recommendation
BUILD (done)
