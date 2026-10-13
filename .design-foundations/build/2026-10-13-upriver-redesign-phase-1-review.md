# Design Review: Phase 1 - UpRiver redesign journey spec (JOURNEY.md)

## Rendered Evidence (Step 0)
- Screenshot: none. Spec-only phase; the artifact is `/Users/gabriel/code/UpRiver/JOURNEY.md` (279 lines). Structure-level critique only; pixel evidence does not apply to a spec.
- Surface: JOURNEY.md, all sections (Job, Journey, IA, Flows F1-F7, Page specs 1-5, Pain-point map, Open items). Requirements source: `.design-foundations/research/2026-10-13-upriver.md` "## Current UI pain points".
- Re-review note: this file replaces an earlier review at the same path. The earlier review's two blockers (Pipeline page missing not-found and no-match states; Pipeline row Rebuild with no reuse disclosure) do not hold against the current file: the Pipeline States table has "Not found" (line 165) and "History filter: no match" (line 166), and block 3 says the row Rebuild "carries the same reuse disclosure as the Build page" (line 154). Its F4 two-click finding also does not hold (line 110 is consistent).

## Assessment B — Deterministic Detector
- Command: `node /Users/gabriel/.claude/plugins/cache/rtd/design-for-ai/4.2.0/scripts/detect.mjs` (no HTML path supplied; stdout to the session scratchpad, not the review dir).
- Exit: 3 (N/A, no rendered artifact). Status `"na"`.
- Findings: N/A — no rendered artifact. Not a skipped detector.
- Opened only after Assessment A findings were written: YES. The output carries no findings, so it changed nothing below.

## Triage
- Baseline (always-on): visual + usability. For a spec, the visual pillar is limited to structure: states, CTA, failure-path hierarchy. Visual decisions are deferred to Phase 2/3 by the spec itself.
- Dispatched: `usability` (Nielsen 10 walk of F1-F7 and the five page specs; Hick's law on sidebars) and `journey` (JTBD, journey table, IA, route map, breadcrumb, page-spec completeness, unsaved-edit flow).
- Not applicable: `data-viz` (no charts); `content-design` (copy is working text, deferred to Phase 3 by the spec); `behavioral` and `deceptive-patterns` (no conversion surface).
- Deferred (if capped): none.

## Heuristic walk (Nielsen 10, usability doctrine)
| # | Heuristic | Result |
|---|-----------|--------|
| 1 | Visibility of status | Strong: status shape + text + color (line 124), running/queued states, polite live region. One gap: Follow after failure (Finding 2). |
| 2 | Match with real world | Pass: Jenkins vocabulary kept (research brief; IA labeling). |
| 3 | User control and freedom | Gap: sign-out discards unsaved Run edits (Finding 1). Remove has confirm but no undo (Finding 5, Minor). |
| 4 | Consistency | Pass: one breadcrumb pattern, one status rule, one sidebar pattern. |
| 5 | Error prevention | Good: disabled-with-reason, Keep/Discard, Build-with-unsaved-changes label, Abort confirm. Abort emphasized as primary (Finding 3, Minor). |
| 6 | Recognition over recall | Pass: sidebar per context, breadcrumb, reuse note on Rebuild. |
| 7 | Flexibility and efficiency | Pass with accepted deferral: `/` and `f` shortcuts; others deferred (Open items). |
| 8 | Aesthetic and minimal design | Pass at spec level (dense rows, one accent, no decoration). |
| 9 | Recover from errors | Pass: cause + fix banners, 400 trigger errors shown at Run block, Retry. |
| 10 | Help and documentation | Pass: next-step empty states; "No artifacts" links to README. |

## Cross-Pillar Findings (ONE ranked report)
| Severity | Pillar | Problem | Principle | Fix |
|----------|--------|---------|-----------|-----|
| Major | usability (DW-1.5) | Sign out clears the per-pipeline Run-panel edits in sessionStorage with no confirmation (line 93). The Settings editor gets a leave-confirm (line 84), so the two unsaved-work paths are inconsistent. The journey table names "unsaved edits ... lost" as a risk (line 31). | Nielsen #5 error prevention; Nielsen #3 user control; the doc's own Trigger risk row | When Run edits are Modified, confirm before sign-out ("Discard N unsaved edits?"). Or keep sessionStorage edits through sign-out, since they are tab-scoped. Either resolves it; an "Accepted, owner Gabriel: ..." line would also clear it. |
| Major | usability (DW-1.5; F4 core flow) | With `on_fail: continue`, Follow stays on for a user who has not picked a stage (line 200: "Follow only applies when the user has not picked"). When the next stage starts after the failure, selection moves to the running stage, which undoes the failure auto-focus the spec relies on (lines 109, 199). The spec covers the pick case and the moment of failure, not the continuing run. | Nielsen #1 visibility of status; the spec's own failure-focus rule (line 199) | After a failure with no user pick, stop Follow from advancing selection: keep the failed stage selected, and mark the running stage with a one-click chip, as the picked-stage case already does (line 200). |
| Minor | usability | Abort is the emphasized primary CTA on a running build (line 206). The JTBD anxiety force names "clicks Abort by accident" (line 17). The confirm dialog reduces the harm but does not remove it. | Nielsen #5 error prevention; Fitts's law (1954) on a destructive target | Keep Abort a secondary destructive control and emphasize View log or Follow instead, or record an owner acceptance. |
| Minor | journey (360px) | The 360px behaviour is specified for Pipeline Builds, Build, Compare and Settings. Dashboard (lines 126-145) and Pipeline Files (line 155) have no narrow layout. They are covered only by the global pain-map row "tables become stacked rows at 360px" (line 270). | Edge case "works at 360px without losing any function"; Nielsen #7 | Add one narrow-layout line to the Dashboard and Files blocks. |
| Minor | usability (DW-1.5) | Remove (file, history) and Delete config are confirmation-only with no undo. The reason is recorded in the pain-point map (row 10) but not as an "Accepted, owner" line. | Nielsen #3 user control; Nielsen #5 | Add an "Accepted, owner Gabriel" line to Open items. |
| Note | usability | "Build now" with zero files has no specified behaviour. The trigger 400s (line 173) cover unknown stage, pin clash and no stages, not no-files. Not a listed edge case. | Nielsen #9 | Optional: add a row to the Build trigger error state. |

Accepted, recorded, not blocking: focus-visible style deferred to a Phase 2 token with an owner (Open items, "Accepted, owner Phase 2"); IA and journey unvalidated by card sort or tree test (header, line 5); no touchpoint lane (header, line 5).

## Requirement Fulfillment

### DW-1.1
PREMISE:  "`JOURNEY.md` `## Page specs` has a complete entry for each of the 5 pages, each with purpose, entry points, ordered blocks, all states, primary CTA and exit."
EVIDENCE: All five pages have `**Purpose.**`, `**Entry points.**`, `**Blocks (in order).**`, `**States.**`, `**Primary CTA.**`, `**Exit.**`:
- Dashboard (126-145): states 135-143 (Loading, Success, Empty with next step, Filter no match, Error, Running, Failed); CTA 144; Exit 145.
- Pipeline (147-175): states 158-173 incl. Not found (165), history no-match (166), Empty 0 files/builds/configs (162-164), Unsaved edits (171), Settings team-only (172); CTA 174; Exit 175.
- Build (177-208): states 191-205 (Loading, Queued, Running, Passed, Failed, Aborted, Failure while watching, next stage, empty log, very long log, 404, error, no artifacts); CTA 206; Exit 208.
- Compare (210-237): states 224-235 (Loading, Success, one-build picker, identical pair, identical content, different stage lists, non-existent build, different pipelines, running, error); CTA 236; Exit 237.
- Sign-in (239-257): states 247-254 (Empty, Prefilled, Loading, Error, Admin rejected, Success); CTA 256; Exit 257.
VERDICT:  PASS

### DW-1.2
PREMISE:  "The Build page spec shows the failing stage and its log reachable in one click from the Build page, and from the pipeline history row in at most two clicks."
EVIDENCE: Build block 4 (185): failed cell auto-selected, 0 clicks. Build "Failure while watching" (199) and the banner "fvt failed - View log" when a stage was picked: 1 click. "One-click failure access (DW-1.2)" (189): Pipeline history failure chip = 1 click to `#/b/{id}/s/{seq}`; `#N` = 1 click with the failed stage auto-focused. F4 (110) repeats this; worst case from the history is 1 click, within the 2-click limit. Route `#/b/{bid}/s/{seq}` in the route map (50).
VERDICT:  PASS

### DW-1.3
PREMISE:  "The IA defines the sidebar actions per context, the breadcrumb pattern and the full route map, including Compare."
EVIDENCE: Route map (45-53) includes `#/c/{a}/{b}` Compare with a=baseline and b=subject. Breadcrumb pattern (57-65) includes the Compare form `Dashboard › {pipeline} › #11 vs #12`. Sidebar-per-context table (71-77) covers Dashboard, Pipeline, Build, Compare and Sign-in, with disabled-with-reason cases.
VERDICT:  PASS

### DW-1.4
PREMISE:  "Each of the 14 brief pain points maps to a page-spec block or a flow, or is marked out of scope with a reason."
EVIDENCE: Pain-point map (261-276) has all 14 rows. Out-of-scope rows carry reasons: 6 (per-line timestamps need a backend change), 7 (no content-diff API), 10 (no restore API; confirmation used), 12 (server-side search out of scope). Row 14's focus style is an accepted deferral (283).
VERDICT:  PASS

### DW-1.5
PREMISE:  "Heuristic pass: your usability walk of the flows (Nielsen's 10 heuristics) returns no Critical findings, and Major findings are resolved or explicitly accepted (an "Accepted, owner …" line in the artifact counts as explicit acceptance)."
EVIDENCE: No Critical findings in the walk. Two Major findings are unresolved and have no "Accepted, owner …" line: (1) sign-out discards unsaved Run-panel edits with no confirmation (line 93 vs line 84; risk row line 31); (2) Follow after a failure with `on_fail: continue` moves selection off the failed stage (lines 109, 199, 200).
VERDICT:  FAIL (blockers: the two unresolved Majors above)

**All requirements met:** NO (DW-1.5 only; DW-1.1 to DW-1.4 pass)

## Edge cases — verify handling
- **Build fails while watching** — PASS. Build "Failure while watching" (199) and F4 (109): auto-focus the failed stage unless the user picked one; otherwise a persistent "fvt failed - View log" banner that stays until the failed stage is selected. The continuing-run case is Finding 2, under DW-1.5.
- **Team-only user opens an admin action** — PASS. Dashboard New pipeline disabled "Admin token required" (73); Pipeline sidebar Settings disabled (74); Settings read-only with Save disabled and reason (156, 170); capability model (89) covers the rejected-token 403.
- **0 builds / 0 files / 0 configs, each with a next step** — PASS. Upload button (162), Build now (163), "Save these settings as a config" hint (164).
- **Compare with non-existent, identical, or differing-stage pairs** — PASS. Identical pair (229), non-existent build names the side and the other side still renders (232), stages matched by name with "only in #N" (231).
- **Unsaved Run-panel edits vs saved config** — PASS. Modified marker, Reset to saved, Keep/Discard on config switch (83, 106); "Build with unsaved changes" label (152); Unsaved edits states (171). Sign-out loss is Finding 1, under DW-1.5.
- **Pages work at 360px without losing any function** — PASS with a Minor note. Build toolbar collapses to a More menu with Follow and Jump visible (186); Build stages stack at ≤700px (195; pain map 275); Settings single column with sticky Save (156); Pipeline Run block single column with sticky bar (153); Compare stacked cards (222). Dashboard and Files have only the global rule (Finding 4).

## Notes (non-blocking)
- Structure-level critique only; no pixel evidence exists for a spec-only phase. Expected here, not a FAIL.
- The Dashboard trend strip and failure chips make one request per pipeline (N+1 against `GET /pipelines/{pid}/builds?limit=10` and `GET /builds/{id}`). Acknowledged as an open item.
- Team token is stored in localStorage. Out of scope for a usability review; noted for the security owner.
- The earlier review at this path cited two blockers that the current file no longer has (see Rendered Evidence). Those are not counted here.

## Issues (blockers for DW-1.5)
1. **Sign-out discards unsaved Run-panel edits silently.** Severity: Major / usability / Nielsen #5, #3; the doc's own Trigger risk row. Fix: confirm when Modified, or keep sessionStorage edits through sign-out, or add an "Accepted, owner Gabriel" line.
2. **Failure focus lost on `on_fail: continue` when the user has not picked.** Severity: Major / usability / Nielsen #1; F4 core flow. Fix: stop Follow from advancing selection after a failure with no user pick; keep the failed stage selected and mark the running stage with a one-click chip.

**Verdict: FAIL — blockers: DW-1.5 (two unresolved Major findings: sign-out discards unsaved Run edits; Follow moves selection off the failed stage after a failure with on_fail: continue). Each clears with a small spec edit or an explicit "Accepted, owner …" line.**

**DESIGN-REVIEW FAIL.** Report written to /Users/gabriel/code/UpRiver/.design-foundations/build/2026-10-13-upriver-redesign-phase-1-review.md
