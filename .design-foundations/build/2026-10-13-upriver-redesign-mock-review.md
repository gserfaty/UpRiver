# Design Review: Mock - Build page (failed state)

## Rendered Evidence (Step 0)
- Supplied screenshot path did not exist on disk (`.../mcp-Claude_Browser__blob-1791901181048-uobjwx.jpg`), so I rendered the mock myself.
- Desktop screenshot (800x600): `/Users/gabriel/.claude/projects/-Users-gabriel-code/ed5f0e36-9a35-4ad8-b1d6-11166477cbcc/tool-results/mcp-Claude_Browser-blob-1791901203356-fnhjgx.jpg`
- Mobile screenshot (375x812, mobile preset): `/Users/gabriel/.claude/projects/-Users-gabriel-code/ed5f0e36-9a35-4ad8-b1d6-11166477cbcc/tool-results/mcp-Claude_Browser-blob-1791901209821-wsc8ju.jpg`
- Surface: `.design-foundations/mocks/build-page-failed.html`, a greyscale wireframe (no DESIGN.md or JOURNEY.md)
- Measured at 375px: `.layout` is 375px wide, but `nav.side`, `main` and `header.bh` are each **885px**. The layout viewport grows to 939px (`documentElement.scrollWidth` = 939), and the `dl` resolves to 5 columns of 157px.

## Assessment B — Deterministic Detector
- Command: `node /Users/gabriel/.claude/plugins/cache/rtd/design-for-ai/4.2.0/scripts/detect.mjs .design-foundations/mocks/build-page-failed.html > .design-foundations/build/detect.json`
- Exit: 0 (ran, `status: "ran"`, 16 rules)
- Findings: 0
- I opened the file only after the Assessment A findings were frozen: YES

## Triage
- Baseline (always on): visual and usability
- Dispatched: content-design, lightly. The page has real status microcopy (FAILED, exit 1, log lines).
- Not applicable: data-viz (no charts), journey (single page), behavioral and deceptive-patterns (no conversion surface)
- Deferred: none

## Cross-Pillar Findings
| Severity | Pillar | Problem (rendered) | Principle | Fix |
|---|---|---|---|---|
| Critical | visual/usability | At 375px the page overflows sideways to 939px. The mobile nav strip is `display:flex` with `white-space:nowrap` links. As a grid item with `min-width:auto`, its min-content width (~883px) sets the size of the single `1fr` track, so `main` is also 885px wide. In the screenshot the header shows only Triggered by and Config: Duration, Params and Files are off-screen. Follow and Download log are off-screen, and log line 7 is clipped. The nav's own `overflow-x:auto` never triggers. | WCAG 1.4.10 Reflow (no 2-D scrolling at 320 CSS px). Nielsen #8 (key info must be visible). | Add `nav.side{min-width:0}` (or use `grid-template-columns:minmax(0,1fr)`) inside the `max-width:700px` query. Re-render at 375px and confirm scrollWidth equals 375. |
| Major | usability | Rebuild is the most likely next step after a failure. It sits third in the sidebar list with the same weight as view links (Console, Artifacts) and history links (Previous/Next). On mobile it ends up in a sideways-scrolling strip. Commands and navigation are mixed in one list. | Fitts's law (the dominant action needs a large, near target). Nielsen #4 (consistency: actions vs. navigation). Visual hierarchy (design-dna). | Make Rebuild a primary button in the build header next to FAILED. Keep the sidebar for views and history only. |
| Major | usability | Stage cards are plain `div`s with no button/link role and no `aria-current`. The selected outline on fvt implies you can click them, but keyboard and screen-reader users cannot operate them. | Nielsen #3 (user control). WCAG 2.1.1 Keyboard and 4.1.2 Name/Role/Value. | Render stages as buttons or links, marking the selected one with `aria-current="step"` or `aria-pressed`. |
| Minor | usability | "Abort (disabled)" and "Next build (none)" are live `<a href="#">` links. Only grey text marks them as unavailable: no `aria-disabled` and no inert styling. | Nielsen #1 (visibility of system status). WCAG 4.1.2. | Use a disabled `<button>`, or a span with `aria-disabled="true"`, and drop the `href`. |
| Minor | usability/content | The header never names the cause. To find which stage failed and why, the user has to scan the stage strip and then the log. The log also highlights only the assertion and exit lines; line 6 (`test_retry ... FAILED`) is not marked. | Nielsen #9 (help users recognize and diagnose errors). | Add a one-line failure summary under the H1, e.g. "fvt failed: test_retry, AssertionError 503". Highlight the failing test line too. |
| Minor | visual | At about 800px wide the stage strip shows a horizontal scrollbar even though all three stages fit. That is extra visual noise. | Data-ink ratio (Tufte). | Check the `margin-right:-1px` and border overflow, or use `overflow-x:auto` only where it is needed. |
| Minor | visual | Text sizes are small: 13px body, 11px uppercase `dt`, 12px log. That is acceptable for a dense ops-tool register but at the floor for legibility on a phone. | Medium-form fit (ch03). | Raise to 14px body and 12px labels inside the mobile query. |

The detector returned 0 findings, so it adds no rows. That fits what I see: no gradients, glassmorphism, purple palette or template card patterns.

## Requirement Fulfillment
### DW-MOCK.1
PREMISE:  the mock renders a viewable surface for the named page(s): the Build page of a CI/CD tool, failed state.
EVIDENCE: The desktop render shows a Build #12 header with a FAILED tag and diamond-X glyph, a stage strip (bvt passed, fvt failed with exit 1, smoke skipped), console output with error lines highlighted, artifacts, and build actions and history in the sidebar.
VERDICT:  PASS

### DW-MOCK.2
PREMISE:  wireframe structure is sound (this is a wireframe — no DESIGN.md exists). Check also that status is distinguishable without color and that the layout works at ~375px width.
EVIDENCE:
- Structure is sound at desktop width: semantic nav, main, header and sections, a sensible order, and clear grouping.
- Status works without color: passed is an outlined circle with ✓, failed is a filled diamond with ✕, skipped is a dashed circle with –, and every stage has a text label (PASSED/FAILED/SKIPPED). The failed state also carries the "FAILED" tag and bold weight.
- The layout does **not** work at 375px. Measured content width is 885px against a 375px viewport, so the page scrolls sideways. Header metadata, log controls and log text are cut off (see the mobile screenshot).
VERDICT:  FAIL. The structure and color-independence parts pass; the 375px layout fails.

**All requirements met:** NO

## Notes (non-blocking)
- The supplied screenshot path was missing, so I captured pixels myself (paths above).
- Distinctiveness: the aesthetic reads as a "dense utilitarian ops console". Three choices go beyond generic defaults: the shape-coded status glyphs (diamond vs. circle vs. dashed), the line-numbered log with highlighted error lines, and stage cells that share borders. As a greyscale wireframe it is not a template AI-tell surface. Identity proper waits on DESIGN.md.
- The mobile media query bumps targets to 44px, which is good. It is undone by the overflow bug above.

## Issues (FAIL)
1. Mobile grid blowout at 375px: the nav's min-content width sets the size of the `1fr` track, so content is 885px wide. Severity Critical / pillar visual+usability / WCAG 1.4.10 Reflow / fix: `nav.side{min-width:0}` or `minmax(0,1fr)`.

**Verdict: FAIL. Blocker: the layout does not work at 375px (DW-MOCK.2).**
