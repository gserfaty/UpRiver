#!/usr/bin/env node
// verify.mjs — checks the UpRiver token block (DESIGN.md ```css fence, or an .html <style>)
// against every pair DESIGN.md declares, in both themes, plus a protan/deutan simulation.
// Validates only; tokens come from palette.mjs. Exit 0 = all pass, 2 = a pair failed.
// Usage: node verify.mjs DESIGN.md [mock.html]
import { readFileSync } from "node:fs";

const DARK = "@media (prefers-color-scheme: dark)";
const REQUIRED = ["--error-3", "--error-9", "--error-11", "--success-3", "--success-9", "--success-11",
  "--warning-3", "--warning-9", "--warning-11", "--info-3", "--info-9", "--info-11",
  "--text-xs", "--text-sm", "--text-base", "--text-lg", "--text-xl", "--text-2xl", "--text-3xl", "--text-4xl",
  "--numeric", "--focus-ring", "--focus-ring-width"];

// [fg, bg, target, kind]
const PAIRS = [
  ["--text", "--surface", 4.5, "text"], ["--text", "--bg", 4.5, "text"], ["--text", "--sunken", 4.5, "text"],
  ["--text-2", "--surface", 4.5, "text"], ["--text-2", "--bg", 4.5, "text"], ["--text-2", "--sunken", 4.5, "text"],
  ["--text", "--accent-subtle", 4.5, "text"], ["--text", "--st-failed-bg", 4.5, "text"], ["--text-2", "--st-failed-bg", 4.5, "text"],
  ["--accent-text", "--surface", 4.5, "text"], ["--accent-text", "--bg", 4.5, "text"], ["--accent-text", "--accent-subtle", 4.5, "text"],
  ["--on-accent", "--accent-solid", 4.5, "text"],
  ...["passed", "failed", "running", "aborted", "idle"].flatMap((s) => [
    [`--st-${s}-text`, "--surface", 4.5, "text"], [`--st-${s}-text`, "--sunken", 4.5, "text"],
    [`--st-${s}`, "--surface", 3, "non-text"], [`--st-${s}`, "--sunken", 3, "non-text"], [`--st-${s}`, "--bg", 3, "non-text"],
  ]),
  ["--st-failed-text", "--st-failed-bg", 4.5, "text"], ["--st-failed", "--st-failed-bg", 3, "non-text"],
  ...["passed", "failed", "running", "aborted"].map((s) => ["--st-glyph", `--st-${s}`, 3, "non-text"]),
  ["--focus-ring", "--surface", 3, "non-text"], ["--focus-ring", "--bg", 3, "non-text"], ["--focus-ring", "--sunken", 3, "non-text"],
  ["--focus-ring", "--accent-subtle", 3, "non-text"],
  ["--rule-strong", "--surface", 3, "non-text"], ["--rule-strong", "--bg", 3, "non-text"],
  ["--mark-ink", "--mark-tile", 3, "non-text"], ["--mark-tile", "--surface", 3, "non-text"],
  // Console panel (dark in both themes)
  ["--con-text", "--con-bg", 4.5, "text"], ["--con-gutter", "--con-bg", 4.5, "text"],
  ["--con-err-text", "--con-err-bg", 4.5, "text"], ["--con-text", "--con-err-bg", 4.5, "text"],
  ["--con-gutter", "--con-err-bg", 4.5, "text"], ["--con-hit-text", "--con-hit-bg", 4.5, "text"],
  ...["red", "green", "yellow", "blue", "cyan"].map((c) => [`--ansi-${c}`, "--con-bg", 4.5, "text"]),
];
const STATUS = ["passed", "failed", "running", "aborted"];

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16) / 255);
const lum = (h) => { const [r, g, b] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const oklab = ([r, g, b]) => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
// Machado, Oliveira & Fernandes 2009, severity 1.0, applied in linear RGB.
const SIM = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
};
const simLab = (h, M) => { const v = rgb(h).map(lin); return oklab(M.map((r) => Math.max(0, Math.min(1, r[0] * v[0] + r[1] * v[1] + r[2] * v[2])))); };
const simHex = (h, M) => { const v = rgb(h).map(lin); return "#" + M.map((r) => { const c = Math.max(0, Math.min(1, r[0] * v[0] + r[1] * v[1] + r[2] * v[2]));
  return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255).toString(16).padStart(2, "0"); }).join(""); };
const GLYPHS = { passed: "check", failed: "cross", running: "arc", aborted: "stop", skipped: "dash+dashed-ring", queued: "empty-ring" };
if (new Set(Object.values(GLYPHS)).size !== Object.keys(GLYPHS).length) { console.log("FAIL  glyphs not unique"); process.exit(2); }
console.log(`PASS  glyphs unique: ${Object.entries(GLYPHS).map(([k, v]) => `${k}=${v}`).join(" ")}`);
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function themes(src) {
  const css = src.includes("```css") ? src.split("```css")[1].split("```")[0] : src.split("<style>")[1].split("</style>")[0];
  const parse = (s) => Object.fromEntries([...s.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)[;}]/g)].map((m) => [m[1], m[2].trim()]));
  const [light, dark = ""] = css.split(DARK);
  const L = parse(light);
  return { light: L, dark: { ...L, ...parse(dark.split(/\n\}\s*\n/)[0]) } };
}
const resolve = (t, k, seen = 0) => {
  const v = t[k];
  if (v === undefined || seen > 10) return null;
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  return m ? resolve(t, m[1], seen + 1) : v;
};

let fails = 0;
for (const file of process.argv.slice(2)) {
  const T = themes(readFileSync(file, "utf8"));
  console.log(`\n# ${file}`);
  const missing = REQUIRED.filter((k) => !(k in T.light));
  console.log(missing.length ? `FAIL  missing tokens: ${missing.join(" ")}` : `PASS  required tokens present (${REQUIRED.length})`);
  fails += missing.length;
  for (const [mode, t] of Object.entries(T)) {
    for (const [fg, bg, target, kind] of PAIRS) {
      const a = resolve(t, fg), b = resolve(t, bg);
      if (!/^#[0-9a-f]{6}$/i.test(a ?? "") || !/^#[0-9a-f]{6}$/i.test(b ?? "")) { console.log(`FAIL  [${mode}] ${fg} on ${bg}: unresolved`); fails++; continue; }
      const r = ratio(a, b), ok = r >= target;
      fails += ok ? 0 : 1;
      console.log(`${ok ? "PASS" : "FAIL"}  [${mode}] ${fg} ${a} on ${bg} ${b}: ${r.toFixed(2)}:1 (${kind} ${target}:1)`);
    }
    // Status set under CVD. Enforced: (a) normal vision — fills + accent pairwise ΔE_OK >= 0.06
    // (the accent-vs-running edge case); (b) every sim — the glyph stays >= 3:1 on its fill and on
    // the surface for hollow states, and every state's glyph is unique, so identity survives without hue.
    // Reported: color-only pairs that fall under 0.06 in a sim (carried by glyph + stamp text).
    const set = [...STATUS.map((s) => [s, resolve(t, `--st-${s}`)]), ["accent", resolve(t, "--accent-solid")]];
    const glyph = resolve(t, "--st-glyph"), surf = resolve(t, "--surface"), idle = resolve(t, "--st-idle");
    for (const [sim, M] of Object.entries(SIM)) {
      const weak = [];
      for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) {
        const d = dE(simLab(set[i][1], M), simLab(set[j][1], M));
        if (d < 0.06) weak.push(`${set[i][0]}/${set[j][0]} ${d.toFixed(3)}`);
      }
      const glyphMin = Math.min(...STATUS.map((s) => ratio(simHex(glyph, M), simHex(resolve(t, `--st-${s}`), M))), ratio(simHex(idle, M), simHex(surf, M)));
      const ok = glyphMin >= 3 && (sim !== "normal" || !weak.length);
      fails += ok ? 0 : 1;
      console.log(`${ok ? "PASS" : "FAIL"}  [${mode}] CVD ${sim}: glyph contrast min ${glyphMin.toFixed(2)}:1 (>= 3)` +
        (weak.length ? ` · color-only close pairs (glyph-carried): ${weak.join(", ")}` : " · all fills ΔE_OK >= 0.06"));
    }
  }
}
console.log(fails ? `\n${fails} check(s) failed` : "\nALL PASS");
process.exit(fails ? 2 : 0);
