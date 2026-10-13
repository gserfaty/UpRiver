# Design Review: Phase 2 - River Ledger tokens + failed-build styled mock

## Rendered Evidence
- Screenshots: .design-foundations/mocks/build-page-failed-styled-light.jpg, -dark.jpg (both read). Surface: styled build page + specimen block (mark, status, CVD sims, type).

## Assessment B - Detector
- Command: node detect.mjs build-page-failed-styled.html > scratchpad/detect.json. Exit 0, findings 0. Opened only after A was frozen: YES.

## Triage
Baseline visual + usability; color, fonts, ai-tells doctrine. data-viz/journey/behavioral N/A.

## Findings
| Severity | Pillar | Problem | Principle | Fix |
|---|---|---|---|---|
| Minor | color | Light running (#226a95) and accent (#486b68) have equal luminance (0.128 vs 0.129); separated by hue only (dE_OK 0.078). Passes the edge case (hue OR lightness) but is weak under CVD/greyscale. Running always carries its arc glyph, which backstops it. | Redundant cue (ch08); hue-only separation | Keep as is; optionally darken running ~10% L |
| Minor | fonts | `.ic` sidebar icons (>_, grid glyphs) and the `(f)` hint use --font-data (mono) for UI chrome, against "mono for data only". | Medium-form/role discipline; DESIGN.md Never list | Move .ic to --font-ui or SVG icons |
| Minor | color | Neutral ramp non-monotonic in light (neutral-8 #a1aead darker than neutral-9 #abbbba). Unused for text; no visible effect. | Ramp integrity (ch08) | Note for palette.mjs, do not hand-edit |
| Minor | ai-tells | system-ui primary font is a catalogued tell; justified by user pin (offline, system fonts). Distinctiveness carried by ledger ruling, stamps, shared borders, square corners - nameable direction "neo-brutalist ledger". Not generic. | ai-tells CHECKER | None |
| Note | visual | Mark at 16px reads as a small hammer/wrench-like glyph; river bend legibility is marginal. | Pictogram legibility at small size | Review at lock |

No Critical or Major findings. Teal accent is muted, no glow/gradient; dark is OS-driven, console dark in both themes (not a cyan-on-dark dashboard). Exactly one brand hue (teal) plus semantic status hues: confirmed in screenshots.

## Requirement Fulfillment
### DW-2.1
PREMISE: DESIGN.md locked: token block present and complete; user confirmation collected separately.
EVIDENCE: Full :root light block, dark @media block, mobile type override, status, console, type, motion tokens all present. Header says "proposed - awaiting user confirmation".
VERDICT: PASS (token block complete). User confirmation: PENDING.

### DW-2.2
PREMISE: All text/background pairs pass AA in both ramps via palette.mjs; Console pairs too.
EVIDENCE: Re-derived with WCAG script. Light: text/surface 13.34, text-2/bg 5.27 (lowest), accent/bg 5.17, accent/accent-subtle 5.20, on-accent 5.76, failed-text/failed-bg 5.51. Dark: text 14.20, text-2/surface 8.78, accent 8.84, on-accent 9.97. Console (checked separately): text 14.20, gutter 8.78, err text/err bg 7.71, ANSI colors 8.3-9.1, hit 8.66. palette.mjs exit 0; verify.mjs exits ALL PASS.
VERDICT: PASS

### DW-2.3
PREMISE: Status hues >=3:1 non-text vs surface both themes; distinct glyphs; passes deutan/protan sim.
EVIDENCE: Light vs surface: passed 5.58, failed 3.73, running 5.78, aborted 13.34, idle 5.87; on failed-bg tint failed ball 3.32. Dark: passed 9.33, failed 4.59 (4.24 on tint), running 7.17. Six unique glyphs (check, cross, arc, square, dashed dash, ring). Specimen shows protan/deutan rows legible; verify.mjs CVD min glyph contrast 3.47 protan, 5.29 deutan dark; light min 3.23 per DESIGN.md. Known passed/failed color closeness under light protan is covered by glyph + stamp text.
VERDICT: PASS

### DW-2.4
PREMISE: --error/success/warning/info-* defined; type scale xs..4xl; tabular numerals for durations.
EVIDENCE: All four functional families (3/9/11) defined in both themes; --text-xs..4xl defined (11..28); --numeric: tabular-nums applied via .num on 2m 41s, 0:38, 2:03, #12 in the HTML.
VERDICT: PASS

### DW-2.5
PREMISE: Mark renders as self-contained inline SVG at 16px and 32px in both themes.
EVIDENCE: Inline SVG symbol in the document (no external file), aria-label set; specimen row shows mark at several sizes incl. 16/32 and mono in light and dark; tile and ink flip per theme.
VERDICT: PASS (16px legibility noted as Minor).

### DW-2.6
PREMISE: No unjustified High tells; no Critical findings.
EVIDENCE: Detector 0 findings; A found only Minor/Note; system-ui justified by user pin.
VERDICT: PASS

### Edge cases
- Accent vs running: PASS (dE 0.078 light / 0.106 dark, hue distinct; arc glyph always; lightness equal in light, Minor).
- Cyan-on-dark: PASS (muted, justified by river idea, no glow).
- palette.mjs exit 2 handling: PASS (balanced info-11 rejected at dE 0.053, replaced via a re-run, not hand-edit; all runs exit 0).
- Console dark both themes checked separately: PASS.
- Mono for data only: PARTIAL, minor leak in sidebar icon glyphs and "(f)" hint; logs, ids, params, filenames correct. Not blocking (cosmetic glyphs, not headings/text).
- Greyscale + ONE brand color: PASS.

**All requirements met:** YES (DW-2.1 confirmation PENDING)

**Verdict: PASS**
