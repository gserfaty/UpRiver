# Discovery + Design: Phase 2 - Design DNA + type + color

## Artifacts Found / Current State
- `JOURNEY.md` (Phase 1): it covers IA, flows F1–F7, and page specs. It assigns two items to this phase: a focus-ring token (≥3:1 in both themes) and the ball glyph geometry. It also fixes the ball glyph meanings: check = passed, cross = failed, pulse/spinner = running, stop = aborted, dash = skipped, hollow = queued/pending.
- `.design-foundations/mocks/build-page-failed.html`: the approved greyscale wireframe. Its layout is user-pinned: top bar, 200px sidebar, header, Stage View row, dark console, artifacts.
- No `DESIGN.md` exists yet. No tokens exist yet. `upriver/static/` still holds the old UI and is not touched in this phase.

## Gaps
- The wireframe draws the failed ball as a rotated square (a diamond). The dealer pin says "round indicator with a distinct glyph per state". **Decision:** every ball is round, and the glyph is what tells states apart. The pin wins over the wireframe detail. The wireframe's layout is still followed exactly.
- `palette.mjs` reports contrast only for its own ramp pairs. The pairs this product actually uses also need checking: the console panel, status balls against surfaces, glyphs on balls, the focus ring, and input borders. **Decision:** a small checker, `.design-foundations/build/palette/verify.mjs`, parses the token block in DESIGN.md (and in the mock), resolves `var()`, and checks every pair DESIGN.md declares. It also runs a protan/deutan simulation (Machado 2009, severity 1.0). Tokens still come only from `palette.mjs` output. The checker validates them and edits nothing.
- `palette.mjs` tints its neutrals toward the seed hue (OKLCH C ≤ 0.018). The user pin calls for "greyscale". **Decision:** keep the generated neutrals unedited (the doctrine favors hue-shifted greys over flat grey, and the no-hand-edit rule applies). At this chroma they read as grey. This is flagged in DESIGN.md as an explicit point for the user to confirm.

## Gate Status
- DESIGN.md: not present. This phase creates it and leaves it "proposed — awaiting user confirmation". The orchestrator does the lock (DW-2.1).
- JOURNEY.md: present. Prerequisites are met.

## DNA pipeline (ground → diverge → critique → converge)
Dealer: `node scripts/dealer.mjs --project upriver --date 2026-10-13 --pin hue=teal --pin chroma=muted --used .design-foundations/used-dna.json` (exit 0). Pins come from the plan constraints: hue = teal (the "cool blue/teal accent"), chroma = muted ("restrained", "muted, no neon"). Layout is user-pinned by the approved wireframe.

### 1. Signal Monolith
GROUNDING   VT220 manual's phosphor-on-glass discipline + a Swiss railway clock's single-hand focus
TYPE        system sans over system mono · COLOR seed teal h168, mono · COMPOSITION terminal-mono + monolith-center (variance 1)
SIGNATURE   headings interrupt their top border like a map legend
Critique: the map-legend heading is the strongest element and fits the river idea. Weakest: monolith-center is sparse, which contradicts both "dense, not airy" and the approved layout. Tells: mono as aesthetic (High risk). **Marked weak.**

### 2. River Ledger
GROUNDING   Jenkins classic Stage View's shared-border cell grid + a ship's logbook (ruled columns, stamped entries)
TYPE        system sans, mono for data · COLOR seed teal h174, muted, mono · COMPOSITION neo-brutalist + ledger-grid (variance 2)
SIGNATURE   small rubber-stamp-style status marks
Critique: this matches the approved wireframe almost one to one: shared borders, ruled rows, dense flat hierarchy. Stamps are a natural, authored home for the FAILED tag. Weakest: h174 sits 29° from success green (h145), so the accent and passed would blur. Tells: none.

### 3. Soft Tide
GROUNDING   Teenage Engineering OP-1 manual's soft hardware forms + The Economist chart room's editorial captions
COMPOSITION soft-futurism + editorial-spread (variance 7) · SIGNATURE single diagonal per view
Critique: the oversized display type fights the density pin. Soft futurism drifts toward glassmorphism, which is banned by pin. Tells: Medium. **Marked weak.**

### 4. Night Survey
GROUNDING   USGS topo quad margin legends + an Avid editing-suite timeline
COMPOSITION cinematic-dark + marginalia (variance 5) · SIGNATURE duotone imagery
Critique: dark by default plus a teal accent lands on the cyan-on-dark tell (High). It also breaks the OS-theme pin. The margin-legend idea is good synthesis material. **Rejected.**

### 5. Gauge Bands
GROUNDING   Vignelli's NYC subway signage bands + a river-gauge tide board
COMPOSITION swiss-international + frieze-bands (variance 4) · SIGNATURE oversize punctuation
Critique: the stage band and console band do map onto frieze bands. Oversize punctuation breaks density, though. Tells: none. Medium.

### Converge
**Pick: River Ledger (#2)**, with one converge-time hue swap: h174 → **h190**. That keeps it inside the pinned teal band (≤195) and puts it ≥45° from success green (145) and 50° from running blue (240), as the plan's accent-vs-status edge case requires. The composition cell is unchanged. The signature (stamps) is kept. In this non-interactive build the pick is proposed, and the user confirms at the lock.

## DW Verification
| DW-ID | Done-When Item | Status | Evidence |
|-------|---------------|--------|----------|
| DW-2.1 | DESIGN.md locked, token block present, user confirmed | COVERED (lock pending user) | DESIGN.md is written with its token block and status "proposed — awaiting user confirmation". Styled mock and light/dark screenshots are ready for the orchestrator's confirmation. |
| DW-2.2 | All text/bg pairs AA in light + dark, console pairs too | COVERED | `palette.mjs` exits 0 on both runs. `verify.mjs` exits 0 on every declared text pair, console included, in both themes. |
| DW-2.3 | Status hues ≥3:1 non-text vs surface both themes; distinct glyphs; CVD pass | COVERED | `verify.mjs` checks ball fill vs surface and glyph vs fill (≥3:1), plus a protan/deutan simulation (pairwise ΔE_OK and luminance separation). Glyph set table in DESIGN.md. |
| DW-2.4 | Functional `--error/success/warning/info-*` defined; `--text-xs…--text-4xl`; tabular numerals for durations | COVERED | Token block inspection (`verify.mjs` asserts the names exist). The `.num` rule and the `--numeric` token are applied in the mock. |
| DW-2.5 | Mark renders as inline SVG at 16 and 32px in both themes | COVERED | Mark specimen row in the styled mock, shown in the light and dark screenshots. |
| DW-2.6 | No unjustified High tells; design-review-agent no Critical | COVERED (tells scan here; agent review at the orchestrator's REVIEW gate) | `detect.mjs` on the styled mock, plus the manual tells scan in DESIGN.md's Never list. |
**All items COVERED:** YES (DW-2.1's confirmation and DW-2.6's agent review are owned by the orchestrator's gates)

## Design Decisions
- **One accent, used sparingly** (ch09: a muted palette with one strong accent signals confident authority). The teal is used only for the mark, links, the primary action (Rebuild), the focus ring, and the current-nav marker. It never appears as a status. Everything else is neutral.
- **Status set uses a separate `palette.mjs` run at `--chroma balanced`.** At muted chroma, error-11 comes out brown (#86534f), and "failed" must read as red, since failure is the focal point. The brand stays muted and only the semantics get stronger chroma. The functional tokens are taken from the balanced run.
- **Ball fills are chosen per theme so they clear ≥3:1.** Light theme uses the -11 steps (and error-9, which clears 3.7:1). Dark theme uses the -9 steps. The glyph colour is the surface colour, which gives ≥3:1 on the fill.
- **Console is dark in both themes** and is built from the dark-ramp hexes, so its pairs are checked on their own.
- **Type: the system stack is user law** ("system fonts, no dependencies"). ai-tells lists system-ui as a tell only when there is no rationale. Here the rationale is the self-contained and offline constraint plus OS-native density. Identity comes from the stamps, ledger rules, and the mark, not from the font.
- **The mark is a river bend that rises into an up-chevron** ("upstream"). It sits on a square tile with a 3px radius, with `currentColor` so it can go monochrome.

## Recommendation
BUILD
