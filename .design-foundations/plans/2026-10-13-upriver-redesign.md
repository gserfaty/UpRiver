# Design plan: UpRiver UI redesign

- **Date:** 2026-10-13
- **Source brief:** `.design-foundations/research/2026-10-13-upriver.md`
- **Track:** Full · **Entry stage:** Discover (neither `DESIGN.md` nor `JOURNEY.md` exists)
- **Phases:** 3 · **DAG:** 1 → 2 → 3
- **Gates:** `JOURNEY.md ## Page specs` before any Design page work; `DESIGN.md` locked before tokens, design system, or styled mocks
- **Status:** in-progress · **Started:** 2026-10-13 · **Current Phase:** 2

## Context

**Problem:** Redesign UpRiver's web UI as a modern, Jenkins-familiar CI/CD console. The Build page (stage view plus live console) is the centerpiece and failures are the focal point. It gets a new UpRiver identity (mark plus palette) in which status colors keep their meaning.

**Success criteria:**
- AA contrast in both themes, status colors included.
- Status is shown by icon shape plus text, never by color alone.
- The failing stage and its log are reachable in one click.
- The design-review-agent returns no Critical findings.
- The Phase 4 manual checklist in `docs/plan.md` still passes.

## Constraints

- Vanilla HTML/CSS/JS, no frameworks, no npm or build step; files stay in `upriver/static/` and are served as-is. No CDNs, no webfonts, no icon sets at runtime. Use system font stacks, with inline SVG or CSS shapes for icons.
- Keep every current feature and API contract (pipelines list/create/get/update; configs list/upsert/delete; files list/history/upload/remove/download; build trigger with `config_id`, `params`, `stages`, `upload_ids`; builds list/get; stage log with `offset`; abort; artifacts list/download via fetch-to-blob, token never in a URL). Backend changes may only add endpoints. Hash routes `#/`, `#/p/{id}` and `#/b/{id}` stay; new routes are additive. Pollers stop when their node leaves the document.
- Untrusted text (logs, names, params, paths, descriptions) goes in only through `textContent` / the `el()` helper, never `innerHTML`. ANSI is built as DOM nodes. `test_index_served` and the `docs/plan.md` Phase 4 checklist (including `<img onerror>` in a log rendering as text) still apply.
- Light and dark themes follow the OS through `prefers-color-scheme`. Each theme is designed on its own, not inverted from the other. `prefers-reduced-motion` is respected.
- Works from 360px to wide desktop and is fully keyboard operable.

## Chosen Approach

Discover first. `JOURNEY.md` fixes the jobs, the information architecture (sidebar, breadcrumbs and route map, including `#/c/{a}/{b}`), the flows (trigger → watch → fail → diagnose, and compare) and the page specs. Phase 2 then runs the DNA pipeline (ground → diverge → critique → converge → gate) under the brief's taste pins and locks `DESIGN.md`, covering mark, palette, type scale and the status set. Phase 3 turns the locked DNA into token tiers, component specs and microcopy. Build order puts the Build page first, and the other pages inherit from it.

## Rejected Approaches

- **Restyling the current UI in place without a journey pass.** The pain points are mainly about information architecture (no sidebar, no previous/next build, failure not dominant, Run panel spread across a long form). A reskin would leave all of them in place.
- **Blue Ocean–style full-screen views.** The brief rules out the large whitespace and single-purpose screens. Density is a stated requirement.
- **Separate phases for words and data surfaces.** The microcopy and the data surfaces (Stage View grid, recent-build trend) are small, and both depend on the same component specs. They are folded into Phase 3 so the DAG stays linear and nothing is split without need.

## Assumptions

- Compare is a client-side diff of two existing build snapshots (params, files@version, stage results). It needs no new endpoint.
- Settings becomes a structured editor, with raw JSON kept behind an "Advanced" disclosure.
- Logs get client-side line numbers, search and a follow toggle. Per-line timestamps are out of scope because they would need a backend change.
- The admin/team capability can be inferred client-side from which tokens are present, plus 403 responses. No roles API exists.

## Decision Log

| # | Decision | Why |
|---|---|---|
| D1 | Full track, entry at Discover | This is a redesign plus a new identity, and no gating artifacts exist yet |
| D2 | Phase 2 model is opus | Explicit override: fable is unavailable on this account |
| D3 | Phase 3 gate is Full | Phase 3 introduces new seams (token tiers, component API, Compare/Stage View components) that the implementation agents consume directly |
| D4 | Hit targets: 32px with a fine pointer, 44px with a coarse pointer | Reconciles the brief's "dense, 32px minimum" with the interaction/responsive doctrine's 44px touch minimum |
| D5 | System fonts are intentional | Required by the constraint, which overrides the `ai-tells` "system-ui default" flag. The justification is recorded in `DESIGN.md` |

---

### Phase 1: Journey & page specs
**Stage:** Discover
**Model:** sonnet
**Doctrine:** journey, usability
**Gate:** Standard

**Goal:** Write `JOURNEY.md` so that every Design phase builds from a specified route and page structure.

**Scope:**
- IN: a JTBD job story (Moesta four forces); the journey across trigger → watch → fail → diagnose → re-run/compare; IA (sidebar actions per context, breadcrumbs, route map including `#/c/{a}/{b}`); flows (first-run sign-in, upload, trigger, failure diagnosis, compare, admin settings); page specs for Dashboard, Pipeline, Build, Compare and Sign-in/first-run.
- OUT: visual styling, tokens, final copy.

**Constraints:** Keep the Jenkins vocabulary (sidebar, `Dashboard > pipeline > #12`, Console Output). Do not change any route. Every page spec lists purpose, entry points, content blocks in order, states (empty, loading, error, success, running, failed), primary CTA and exit.

**Edge cases:**
- A build fails while the user is watching: focus moves automatically to the failed stage, unless the user has manually picked a stage; then a persistent failure banner with a one-click "View log" appears instead (amended 2026-10-13 after Phase 1 review: never yank the user away from what they are reading). Hick's law and Nielsen #1 (visibility of system status) apply.
- A team-only user opens an admin action: it is hidden or disabled with a reason, not left to fail with a 403.
- A pipeline has 0 builds, 0 files or 0 configs: each of these empty states has a next step.
- Compare is given a non-existent or identical pair of builds, or builds whose stage lists differ.
- Unsaved Run-panel edits are not the same as the saved config.
- The pages work at 360px without losing any function.

**Produces:** `JOURNEY.md` (`## Job`, `## Journey`, `## IA`, `## Flows`, `## Page specs`)
**Depends on:** research doc | **Unlocks:** Phase 2

**Done when:**
- [ ] DW-1.1: `JOURNEY.md` `## Page specs` has a complete entry for each of the 5 pages, each with purpose, entry points, ordered blocks, all states, primary CTA and exit.
- [ ] DW-1.2: The Build page spec shows the failing stage and its log reachable in one click from the Build page, and from the pipeline history row in at most two clicks.
- [ ] DW-1.3: The IA defines the sidebar actions per context, the breadcrumb pattern and the full route map, including Compare.
- [ ] DW-1.4: Each of the 14 brief pain points maps to a page-spec block or a flow, or is marked out of scope with a reason.
- [ ] DW-1.5: Heuristic pass: the design-review-agent's usability walk of the flows returns no Critical findings, and Major findings are resolved or explicitly accepted.

---

### Phase 2: Design DNA + type + color
**Stage:** Design
**Model:** opus (override: fable unavailable)
**Doctrine:** design-dna, color, fonts, ai-tells
**Gate:** Full

**Goal:** Lock `DESIGN.md` with the UpRiver mark, the palette, the type scale and an AA status set for both themes.

**Scope:**
- IN: the DNA pipeline (dealer with pins, 5 candidates, critique, converge); the mark (inline SVG, monochrome-capable, legible at 16px as a favicon); `palette.mjs` tokens for light and dark; the status set (passed, failed, running, aborted, queued/pending/skipped), each with a hue and a glyph; the type scale; the motion budget.
- OUT: component specs, microcopy.

**Constraints:** Dealer pins, taken verbatim from the brief's taste signals:
- **Jenkins vocabulary stays:** sidebar, breadcrumbs, `#N` build numbers, status balls, Stage View grid, "Console Output".
- **Status balls:** round indicator with a distinct glyph per state (check, cross, spinner/pulse, dash, stop), consistent everywhere a status appears.
- **OS theme:** follow `prefers-color-scheme`, no manual toggle required; both themes polished.
- **Build page first:** stage pipeline view on top, live log dominating the rest, failure is the focal point; other pages inherit its styling.
- **Dense, not airy:** compact rows, small-but-legible type, information over decoration.
- **Self-contained and plain:** system fonts, inline SVG, no dependencies; modernized, not trendy (no glassmorphism, no illustrations).
- **Brand direction (to invent):** a simple mark suggesting an upward flow or river bend; restrained palette led by a cool blue/teal accent so the status colors keep their meaning.
- **User pin from mock sign-off (2026-10-13):** the approved greyscale wireframe gets exactly ONE non-greyscale brand color (the accent). Everything else stays greyscale; only the semantic status hues are added on top. Layout follows `.design-foundations/mocks/build-page-failed.html` (approved).

**Edge cases:**
- The accent and the running status are both blue. They must be distinguishable by hue or lightness, and running always carries its glyph.
- Teal on dark is the `ai-tells` "cyan-on-dark" cell. The accent must be muted and justified by the river idea, with no neon or glow.
- `palette.mjs` exits with code 2 when a pair misses AA. The token is rejected and re-run, not hand-edited.
- The Console panel is dark in both themes, so its contrast is checked separately.
- Monospace is for data only (logs, ids, paths, params).

**Produces:** `DESIGN.md` locked (token block, type scale, status set, mark, motion, Never list)
**Depends on:** Phase 1 | **Unlocks:** Phase 3

**Done when:**
- [ ] DW-2.1: `DESIGN.md` is locked: the token block is present and the user has confirmed the direction.
- [ ] DW-2.2: All text/background pairs pass WCAG AA (≥4.5:1 body, ≥3:1 large) in both light and dark ramps, verified via `palette.mjs`. The Console panel pairs pass too.
- [ ] DW-2.3: Every status hue reaches ≥3:1 non-text contrast against its surface in both themes. Each state has a distinct glyph, and the set passes a deuteranopia/protanopia simulation.
- [ ] DW-2.4: The functional colors (`--error/success/warning/info-*`) are defined, and the type scale `--text-xs`…`--text-4xl` uses tabular numerals for durations.
- [ ] DW-2.5: The mark renders as self-contained inline SVG at 16px and 32px in both themes.
- [ ] DW-2.6: Heuristic pass: the critique's tells scan shows no unjustified High tells, and the design-review-agent returns no Critical findings.

---

### Phase 3: Design system + words
**Stage:** Design
**Model:** sonnet
**Doctrine:** design-systems, content-design, interaction, responsive, data-viz
**Gate:** Full (it introduces new seams consumed by implementation; see D3)

**Goal:** Turn the locked DNA into token tiers, component specs and microcopy ready for implementation.

**Scope:**
- IN: three token tiers (global → alias → component). Component specs for the status ball, the stage cell and Stage View grid, the Console panel (line numbers, search, follow toggle, copy/download, jump to first error, full height), sidebar, breadcrumbs, tables, forms (structured Settings plus the "Advanced" JSON section), upload dropzone, empty states, confirmations, and the recent-build trend strip. Microcopy (voice attributes, labels, errors, empty states, confirmations) applied to the page specs.
- OUT: the production CSS/JS in `upriver/static/`.

**Constraints:** Every component designs all 8 states. Focus uses `:focus-visible` at 2px or more with ≥3:1 contrast. Layout is mobile-first with `min-width` breakpoints set by content, not devices. Hit targets follow D4. No emoji and no marketing copy.

**Edge cases:**
- Running pulse under `prefers-reduced-motion`.
- A log with 100k lines, or an `<img onerror>` payload in the log, renders as text.
- A Stage View with many stages at 360px adapts rather than scrolling the page sideways.
- Destructive actions (Remove, Delete config, Abort) get confirmation or undo.
- Errors follow cause → fix (Yifrah).
- The trend strip shows status by shape, not color alone, and its y-axis starts at zero.

**Produces:** token tiers plus component specs in `DESIGN.md` (`## Tokens`, `## Components`), and `JOURNEY.md` page specs updated with microcopy
**Depends on:** Phase 2 | **Unlocks:** implementation

**Done when:**
- [ ] DW-3.1: All semantic aliases resolve (`--background`, `--surface`, `--text`, `--accent-solid`, `--status-*`), and component tokens reference aliases only.
- [ ] DW-3.2: Every listed component has a spec with all 8 states and responsive behavior from 360px to wide desktop.
- [ ] DW-3.3: Interactive elements pass AA non-text contrast (≥3:1), including focus rings, in both themes.
- [ ] DW-3.4: Every page spec carries final microcopy. Each error has cause and fix, each empty state names a next step, and each destructive action has confirmation copy.
- [ ] DW-3.5: Mock renders: a self-contained Build page `.html` in its failed state, with no hard-coded hex.
- [ ] DW-3.6: Heuristic pass: the design-review-agent returns no Critical findings on the Build mock, and Major findings are resolved or accepted.

---

## Verification plan

**Level:** Full (design-review-agent dual-blind on every phase; contrast and token evidence attached).

| Check | Covers | Method |
|---|---|---|
| Page-spec completeness | DW-1.1, 1.3, 1.4 | Read `JOURNEY.md`; walk the pain-point → spec map |
| One-click failure path | DW-1.2 | Trace the Build flow in specs, then on the DW-3.5 mock |
| Usability walk | DW-1.5 | design-review-agent heuristic evaluation |
| DESIGN.md lock | DW-2.1 | Token block present + recorded user confirmation |
| Contrast both themes | DW-2.2, 2.3, 3.3 | `palette.mjs` contrast report; computed ratios for status, Console and focus pairs; CVD simulation |
| Token coverage | DW-2.4, 3.1 | Grep the token block for the aliases, functional colors and type steps |
| Mark render | DW-2.5 | Render the SVG at 16/32px on light and dark |
| Component specs | DW-3.2, 3.4 | Read `## Components`; check the state matrix and microcopy per spec |
| Mock render + no hex | DW-3.5 | Open the mock; `detect.mjs` hard-coded color scan |
| Heuristic gates | DW-2.6, 3.6 | design-review-agent synthesis (Assessment A + `detect.mjs`) |

**Dirty cases (each must be caught):**
- **Phase 1:** A Design phase starts while `JOURNEY.md ## Page specs` is missing. Expect a gate violation, with wireframe mode flagged. A Compare spec without the "builds have different stages" state fails DW-1.1.
- **Phase 2:** If the running status matches the accent in hue and lightness, or a status hue is below 3:1 in dark mode, the token is rejected and `palette.mjs` is re-run. A neon teal-on-dark accent with no rationale is a High tell.
- **Phase 3:** Tokens are authored before `DESIGN.md` is locked: gate violation. If a log containing `<img src=x onerror=alert(1)>` renders an element in the mock instead of text, that is a Critical finding. If the Stage View causes horizontal page scroll at 360px, DW-3.2 fails.

---

After build: implementation into `upriver/static/` by developer + critic agents (outside this plugin's scope).

## Execution log

### Phase 1: Journey & page specs (Gate: Standard)
- [x] BUILD: Discovery + design + production complete
- [x] REVIEW: fail->fixed (3 attempts; final two Majors fixed with owner approval, no 4th review)
- [x] Committed
Commit: (this commit)
Summary: JOURNEY.md defines job, journey, IA (routes, breadcrumbs, per-context sidebars), flows F1–F7 and complete page specs for Dashboard, Pipeline, Build, Compare and Sign-in; Phase 2 must define a focus-ring token (≥3:1 both themes).
