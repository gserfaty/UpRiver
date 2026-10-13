# Design: River Ledger
**Date:** 2026-10-13 · **Status:** proposed — awaiting user confirmation
**Archetype:** operator's instrument (CI/CD console) · **Register:** calm, dense structure · expressive at: the failed build (failure stamp + failed stage cell), the running ball
**Grounding:** Jenkins classic Stage View's shared-border cell grid + a ship's logbook's ruled columns and stamped entries
**DNA:** Neo-Brutalist + Ledger Grid · **Dominant axis:** composition (the ruling system)
**Composition:** neo-brutalist × ledger-grid, variance 2 (`dealer.mjs --project upriver --date 2026-10-13 --pin hue=teal --pin chroma=muted`, hand 2 of 5)
**Pins:** hue = teal and chroma = muted (from the brief: "restrained palette led by a cool blue/teal accent"). Layout = the approved wireframe `.design-foundations/mocks/build-page-failed.html`. User pin from mock sign-off: exactly ONE non-greyscale brand color (the accent), everything else greyscale, with semantic status hues on top. Converge-time swap: hue 174 → **190**, which stays in the teal band and keeps ≥45° from success green and 50° from running blue. System fonts. OS theme only.

## Direction
A ruled logbook for builds. Hairlines and shared borders do the structuring, rows are dense, the type is small and steady, and nothing floats. The palette is grey with one river-teal ink for "you can act here": the mark, links, the primary action, focus, and the current view. Status color is the only other color, so when a build fails, the red stamp and the red-ruled stage cell are the loudest things on the page. It serves engineers who already know Jenkins. The vocabulary stays (sidebar, breadcrumbs, `#N`, balls, Stage View, Console Output) and the clutter goes.

## Signature move
**Status stamps.** Every status label is a small rubber-stamp mark: uppercase, 0.08em tracking, `--text-xs` bold, 1.5px border in the status text color, square corners, transparent fill (`FAILED`, `PASSED`, `RUNNING`, `ABORTED`, `SKIPPED`, `QUEUED`). Stamps appear in the build header next to `#N`, in history rows, and in list rows, set the same way everywhere. Inside a bordered Stage View cell the status is the stamp's text without the frame (uppercase, `--text-xs`, 700, 0.08em, status text color), because a frame inside a frame would be a box-in-box. They are never rotated, never given a texture, and never filled.

## Expressive moments
- **Failed build:** the header stamp `FAILED`, plus a failed stage cell with a 3px top rule in `--st-failed` and a `--st-failed-bg` tint. This is the only tinted cell on the page. Error lines in the console get a 3px left mark in `--con-err-mark`.
- **Running:** the running ball's arc rotates (the only perpetual motion in the product).
- Everything else holds the calm, structured baseline.

## The mark
A river bend that rises into an up-chevron ("upstream"), on a square tile. The tile is `currentColor`, so it can be used in one color. Paste it inline:

```html
<svg class="mark" viewBox="0 0 32 32" width="20" height="20" role="img" aria-label="UpRiver">
  <rect width="32" height="32" rx="6" fill="var(--mark-tile)"/>
  <path d="M9 27C9 19 23 21 23 13V8" fill="none" stroke="var(--mark-ink)" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M18 12l5-5 5 5" fill="none" stroke="var(--mark-ink)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```
- Sizes: 16px (favicon, compact), 20px (top bar), 32px (sign-in). Strokes stay ≥1.75px at 16px.
- Monochrome: drop the `rect` and stroke the paths with `currentColor`.
- Favicon: the same SVG as a `data:` URI with literal hexes (`#486b68` tile, `#fcfdfd` ink), because `var()` does not resolve inside a favicon.
- Wordmark: "UpRiver" in `--font-ui`, 700, `--text-lg`, letter-spacing 0.01em, set right of the mark with an 8px gap.

## Status set
One ball per state, round, at 16px in rows and cells and 20px in the build header. The ball always comes with a stamp or text. Glyphs are drawn in a 16×16 viewBox. The glyph color is `--st-glyph` (the surface color) on a filled ball.

| State | Fill (light / dark) | Glyph | SVG |
|---|---|---|---|
| passed | `--st-passed` = success-11 / success-9 | check | `<circle cx="8" cy="8" r="8" fill="var(--st-passed)"/><path d="M4.6 8.3l2.2 2.2 4.6-4.8" stroke="var(--st-glyph)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` |
| failed | `--st-failed` = error-9 (both themes) | cross | `<circle … fill="var(--st-failed)"/><path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" stroke="var(--st-glyph)" stroke-width="2" stroke-linecap="round"/>` |
| running | `--st-running` = vivid-run info-11 `#226a95` / info-9 | three-quarter arc, rotates (static when reduced motion) | `<circle … fill="var(--st-running)"/><path class="spin" d="M8 4.2A3.8 3.8 0 1 1 4.2 8" stroke="var(--st-glyph)" stroke-width="2" fill="none" stroke-linecap="round"/>` |
| aborted | `--st-aborted` = neutral-12 (both themes, Jenkins' grey family) | stop (square) | `<circle … fill="var(--st-aborted)"/><rect x="5.25" y="5.25" width="5.5" height="5.5" fill="var(--st-glyph)"/>` |
| skipped | hollow, `--st-idle` | dash, dashed ring | `<circle cx="8" cy="8" r="7" fill="none" stroke="var(--st-idle)" stroke-width="1.5" stroke-dasharray="2.2 2"/><path d="M5 8h6" stroke="var(--st-idle)" stroke-width="2" stroke-linecap="round"/>` |
| queued / pending | hollow, `--st-idle` | empty solid ring | `<circle cx="8" cy="8" r="7" fill="none" stroke="var(--st-idle)" stroke-width="1.5"/>` |

Filled vs hollow splits "has an outcome or is happening" from "not started". Within each group the glyph decides. Running is blue and the accent is teal. Running is never drawn without its arc glyph, and the accent never fills a ball.

## Type
- UI: `--font-ui` = `system-ui, -apple-system, "Segoe UI", "Helvetica Neue", sans-serif` (user pin: system fonts, offline, no dependencies).
- Data: `--font-data` = `ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`. Use it **only** for logs, build/stage ids, paths, params, hashes, and versions (`app.zip@v7`).
- Scale (about 1.125, base 13px desktop / 14px at ≤700px): `--text-xs` 11 · `--text-sm` 12 · `--text-base` 13 · `--text-lg` 15 · `--text-xl` 17 · `--text-2xl` 20 · `--text-3xl` 24 · `--text-4xl` 28. At ≤700px xs and sm both become 12 and base becomes 14.
- Roles: h1 build title `--text-2xl`/700. Section label `--text-xs`/700 uppercase, tracking 0.06em, `--text-2`. Body and rows `--text-base`/400. Meta `--text-sm`. Console `--text-sm` mono, leading 1.5.
- Leading: `--leading` 1.45 (UI), `--leading-tight` 1.2 (headings), `--leading-log` 1.5. Weights: 400, 600, 700.
- **Numerals:** durations, `#N`, counts, sizes, times and line numbers use `font-variant-numeric: var(--numeric)` (`tabular-nums`) through `.num`, so columns and ticking timers never jitter.

## Color tokens
Generated by `palette.mjs` in two runs. Values are pasted verbatim and never hand-edited:
1. Brand + neutrals: `node scripts/palette.mjs --seed 190 --chroma muted --harmony mono` (exit 0)
2. Functional / status: `node scripts/palette.mjs --seed 190 --chroma balanced --harmony mono` (exit 0). Only the `error/success/warning/info` ramps are taken from this run, because at muted chroma "failed" came out brown.
3. One token from `node scripts/palette.mjs --seed 190 --chroma vivid --harmony mono` (exit 0): light `info-11` = `#226a95`, used only as `--st-running` in light. The balanced `info-11` (`#3d6886`) sat at ΔE_OK 0.053 from the accent, below the 0.06 separation floor, so it failed the plan's accent-vs-running edge case.

The console uses the dark-ramp hexes in both themes. The semantic layer below is the only thing components may reference.

```css
:root {
  color-scheme: light dark;
  /* neutral ramp (light) — palette.mjs seed 190 muted */
  --neutral-1: #fcfdfd; --neutral-2: #f7f9f9; --neutral-3: #eef1f1; --neutral-4: #e4e9e9;
  --neutral-5: #d8e0df; --neutral-6: #cbd4d4; --neutral-7: #bbc6c5; --neutral-8: #a1aead;
  --neutral-9: #abbbba; --neutral-10: #99a8a7; --neutral-11: #5d6564; --neutral-12: #2a2f2e;
  /* accent ramp (light) — the ONE brand color */
  --accent-1: #fafefd; --accent-2: #f4fafa; --accent-3: #e6f4f3; --accent-4: #d8edeb;
  --accent-5: #c9e5e2; --accent-6: #b7dbd8; --accent-7: #a2ceca; --accent-8: #82b7b2;
  --accent-9: #84c6c1; --accent-10: #74b2ad; --accent-11: #486b68; --accent-12: #203230;
  --accent-on-solid: #04100f;
  /* functional (light) — palette.mjs seed 190 balanced */
  --error-3: #ffebe9; --error-9: #e1524f; --error-11: #974843;
  --success-3: #e0f8e0; --success-9: #5ad664; --success-11: #337437;
  --warning-3: #f9f0dd; --warning-9: #dbb155; --warning-11: #76602f;
  --info-3: #e3f3ff; --info-9: #5baee5; --info-11: #3d6886;

  /* semantic: surfaces + text */
  --bg: var(--neutral-3);            /* page ground, top bar */
  --surface: var(--neutral-1);       /* panels */
  --sunken: var(--neutral-2);        /* selected stage cell, hover rows */
  --rule: var(--neutral-7);          /* ledger hairlines (decorative) */
  --rule-strong: var(--neutral-11);  /* input/control boundaries (>=3:1) */
  --text: var(--neutral-12);
  --text-2: var(--neutral-11);
  /* semantic: the accent */
  --accent-solid: var(--accent-11);  /* primary button fill */
  --on-accent: var(--neutral-1);
  --accent-text: var(--accent-11);   /* links */
  --accent-subtle: var(--accent-3);  /* current sidebar item */
  --mark-tile: var(--accent-11); --mark-ink: var(--neutral-1);
  /* focus */
  --focus-ring: var(--accent-11); --focus-ring-width: 2px; --focus-ring-offset: 2px;
  /* status */
  --st-passed: var(--success-11);  --st-passed-text: var(--success-11);
  --st-failed: var(--error-9);     --st-failed-text: var(--error-11); --st-failed-bg: var(--error-3);
  --st-running: #226a95;           --st-running-text: #226a95; /* vivid-run info-11, see Status set */
  --st-aborted: var(--neutral-12); --st-aborted-text: var(--neutral-12);
  --st-idle: var(--neutral-11);    --st-idle-text: var(--neutral-11);
  --st-glyph: var(--surface);
  /* console — dark in both themes (dark-ramp hexes, verbatim) */
  --con-bg: #191a1a; --con-text: #e3e9e9; --con-gutter: #b0bab9; --con-rule: #424b4a;
  --con-err-bg: #331a18; --con-err-text: #f49c95; --con-err-mark: #e1524f;
  --con-hit-bg: #dbb155; --con-hit-text: #191a1a;
  --ansi-red: #f49c95; --ansi-green: #88cb8a; --ansi-yellow: #cdb482; --ansi-blue: #90bedf; --ansi-cyan: #9ac0bd;

  /* type */
  --font-ui: system-ui, -apple-system, "Segoe UI", "Helvetica Neue", sans-serif;
  --font-data: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --text-xs: 11px; --text-sm: 12px; --text-base: 13px; --text-lg: 15px;
  --text-xl: 17px; --text-2xl: 20px; --text-3xl: 24px; --text-4xl: 28px;
  --leading: 1.45; --leading-tight: 1.2; --leading-log: 1.5;
  --numeric: tabular-nums;
  /* space, shape */
  --sp-1: 2px; --sp-2: 4px; --sp-3: 8px; --sp-4: 12px; --sp-5: 16px; --sp-6: 24px; --sp-7: 32px;
  --radius: 0; --radius-control: 2px; --rule-w: 1px;
  --shadow-overlay: 0 6px 16px rgb(32 50 48 / .18); /* menus + dialogs only, accent-12 tinted */
  /* motion */
  --dur-fast: 120ms; --dur: 200ms; --ease: cubic-bezier(.2, 0, 0, 1); --spin: 1.1s;
}
@media (prefers-color-scheme: dark) {
  :root {
    --neutral-1: #121313; --neutral-2: #191a1a; --neutral-3: #202322; --neutral-4: #272b2b;
    --neutral-5: #2e3433; --neutral-6: #363e3d; --neutral-7: #424b4a; --neutral-8: #576362;
    --neutral-9: #abbbba; --neutral-10: #bfcecd; --neutral-11: #b0bab9; --neutral-12: #e3e9e9;
    --accent-1: #111313; --accent-2: #161a1a; --accent-3: #1a2424; --accent-4: #1d2e2c;
    --accent-5: #203736; --accent-6: #234240; --accent-7: #29514e; --accent-8: #386b67;
    --accent-9: #84c6c1; --accent-10: #9ad9d4; --accent-11: #9ac0bd; --accent-12: #d7edeb;
    --accent-on-solid: #04100f;
    --error-3: #331a18; --error-9: #e1524f; --error-11: #f49c95;
    --success-3: #152715; --success-9: #5ad664; --success-11: #88cb8a;
    --warning-3: #282113; --warning-9: #dbb155; --warning-11: #cdb482;
    --info-3: #17242d; --info-9: #5baee5; --info-11: #90bedf;

    --bg: var(--neutral-1); --surface: var(--neutral-2); --sunken: var(--neutral-3);
    --rule: var(--neutral-7); --rule-strong: var(--neutral-11);
    --text: var(--neutral-12); --text-2: var(--neutral-11);
    --accent-solid: var(--accent-9); --on-accent: var(--accent-on-solid);
    --accent-text: var(--accent-11); --accent-subtle: var(--accent-3);
    --mark-tile: var(--accent-9); --mark-ink: var(--accent-on-solid);
    --focus-ring: var(--accent-9);
    --st-passed: var(--success-9);   --st-passed-text: var(--success-11);
    --st-failed: var(--error-9);     --st-failed-text: var(--error-11); --st-failed-bg: var(--error-3);
    --st-running: var(--info-9);     --st-running-text: var(--info-11);
    --st-aborted: var(--neutral-12); --st-aborted-text: var(--neutral-12);
    --st-idle: var(--neutral-11);    --st-idle-text: var(--neutral-11);
    --st-glyph: var(--surface);
    --shadow-overlay: 0 6px 16px rgb(0 0 0 / .5);
  }
}
@media (max-width: 700px) {
  :root { --text-xs: 12px; --text-sm: 12px; --text-base: 14px; }
}
```

**Contrast (palette.mjs, both runs exit 0):** light: neutral-11/neutral-2 5.65, neutral-12/neutral-2 12.88, accent-11/neutral-2 5.57 (5.50 balanced), accent-on-solid/accent-9 9.94. Dark: neutral-11/neutral-2 8.79, neutral-12/neutral-2 14.28, accent-11/neutral-2 8.90, accent-on-solid/accent-9 9.94. All PASS.

**Contrast (product pairs, `node .design-foundations/build/palette/verify.mjs DESIGN.md`, exit 0, 134 checks):** every text pair is ≥4.5:1, and every ball, glyph-on-ball, focus ring, control boundary and mark is ≥3:1, in both themes, console included. Full log: `.design-foundations/build/palette/verify.log`.

**CVD (Machado 2009, severity 1.0):** with normal vision, all four filled status hues and the accent are ≥0.06 ΔE_OK apart. Running vs accent is 0.078 light and 0.106 dark. Under protan and deutan every glyph stays ≥3:1 on its fill (lowest is 3.23:1), and the six glyphs are unique. One known limit: in the light theme under **protanopia**, passed and failed are close by color alone (ΔE_OK 0.033). A red and a green that both clear 3:1 on near-white converge for protans. That pair is told apart by its glyph (check vs cross) and its stamp text, never by hue. This is the redundant-cue rule (ch08), not a gap. The dark theme separates every pair by color in all simulations.

## Focus
`:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: var(--focus-ring-offset); }` applies to every interactive element, with no exceptions and no `outline: none` without this replacement. The offset puts the ring on the surrounding surface (≥3:1 on `--surface`, `--bg`, `--sunken` and `--accent-subtle` in both themes). That includes the dark console `pre`, whose ring sits on the light panel around it.

## Space, shape, depth
- Spacing: `--sp-1…7` = 2/4/8/12/16/24/32. Tight inside a row (4–8), 16 between sections. Rows are 32px (36px for sidebar items, 44px at ≤700px).
- Radius: `0` for panels, cells and stamps (the ledger). `--radius-control` 2px for inputs and buttons. Balls are round. The mark tile uses rx 6/32.
- Depth: **rules, not shadows.** Panels are `--surface` with a 1px `--rule` border. Adjacent cells share borders (`margin-right:-1px`), as in Stage View. `--shadow-overlay` is used only for menus and dialogs.

## Motion
- Timing: `--dur-fast` 120ms (hover/press color), `--dur` 200ms (disclosure, banner in). Easing: `--ease` (sharp ease-out).
- Allowed: color/background transitions on interactive elements. Disclosure height. The running ball's arc rotating at `--spin` 1.1s linear, which is the only infinite animation. The log follow-scroll is instant.
- Never: entrance animations, staggered fade-up, bounce or elastic easing, glow, skeleton shimmer (skeletons are static `--sunken` blocks), and animated counters.
- `prefers-reduced-motion: reduce`: all transitions and animations are off, and the running arc stays static. The glyph still differs from queued.

## Never (this project's tells at risk)
Tells scan: `detect.mjs` on the styled mock finds 0 (`.design-foundations/build/phase-2-detect.json`). The first pass flagged stamps inside stage cells as nested cards, so cells now show unframed status text. The only catalogued tell left is system-ui as the primary font, and it is justified by the user pin (system fonts, offline).
- No second brand hue. Teal is used only for the mark, links, the primary action, focus, and the current view. It never appears in status, charts or decoration.
- No cyan-on-dark dashboard look: dark is never the default (OS decides), the accent stays muted (C ≤ 0.08), and nothing glows.
- No neon, no gradients, no glassmorphism or blur, no illustrations.
- No cards-in-cards: panels are ruled sections, and cells inside them share borders.
- No stamp variations (rotation, texture, fill). One stamp style everywhere.
- No mono for UI chrome or headings. Mono is for data only.
- No pure `#000`/`#fff`. Use the ramp ends.
- No color-only status: ball glyph + stamp/text + color, always.
- No uniform 0.1-opacity shadows on panels.

## Open questions (for the lock)
- **Neutrals are faintly cool** (palette.mjs tints the neutral ramp toward the seed, OKLCH C ≤ 0.018). They read as grey. If you want strictly achromatic greys, say so before the lock.
- Aborted is a filled neutral ball (near-black in light, near-white in dark) with a stop glyph, matching Jenkins' grey aborted. An amber aborted collapsed into passed-green under deuteranopia (ΔE_OK 0.014), so the warning hue is not used for any status. It stays available for warnings and search hits.
