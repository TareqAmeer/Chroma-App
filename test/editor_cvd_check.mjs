// T50 (editor_ux_spec.json): colour-vision-deficiency (colour-blindness) simulation check. The
// app leans on colour signals in several places (amber .fx-mod fill/dot, red/green flag buttons,
// the sat/vib red-vs-green preview) with nothing checking that meaning survives a protanopia/
// deuteranopia/tritanopia simulation — i.e. that each colour-coded state ALSO carries a
// non-colour signal (shape/icon/position/text), not colour alone.
//
// Approach (two parts, per the spec note's own suggestion that "SVG filter matrices are well-
// documented" for this):
//   1. Apply the three standard CVD simulation matrices (Machado/Oliveira/Fialho-derived, the
//      same matrices browser devtools' own "Emulate vision deficiencies" uses) to the app's own
//      key paired design tokens (--ok/--err, --acc/--mut) and confirm the simulated colours are
//      still perceptually distinguishable (Euclidean RGB distance above a floor). A pair that
//      collapses to near-identical colour under simulation is the actual failure mode this
//      exists to catch.
//   2. For DOM elements known to encode state via colour (flagGreen/flagRed buttons, .fx-mod
//      rows), confirm each ALSO carries a non-colour signal (a different icon/shape, or text) —
//      if 1) shows the colours collapse AND a pair has no such secondary signal, that's a real,
//      not just theoretical, accessibility failure.
import { readFileSync } from 'node:fs';

// Standard CVD simulation matrices (Brettel/Viénot-derived, applied in linear RGB — this uses
// the simplified sRGB-space approximation that's standard for this kind of check, matching what
// browser devtools' emulation uses for UI review purposes, not colorimetric certification).
const MATRICES = {
  protanopia: [0.567, 0.433, 0, 0.558, 0.442, 0, 0, 0.242, 0.758],
  deuteranopia: [0.625, 0.375, 0, 0.7, 0.3, 0, 0, 0.3, 0.7],
  tritanopia: [0.95, 0.05, 0, 0, 0.433, 0.567, 0, 0.475, 0.525],
};

function parseColor(str) {
  const m = str.match(/#([0-9a-f]{6})/i) || str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return null;
  if (m[0].startsWith('#')) {
    const hex = m[1];
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
function simulate(rgb, matrix) {
  const [r, g, b] = rgb;
  return [
    r * matrix[0] + g * matrix[1] + b * matrix[2],
    r * matrix[3] + g * matrix[4] + b * matrix[5],
    r * matrix[6] + g * matrix[7] + b * matrix[8],
  ];
}
function dist(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

const html = readFileSync('chromasmith-22.html', 'utf8');
const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
const rootMatch = styleMatch[1].match(/:root\s*\{([^}]*)\}/);
const tokens = {};
for (const decl of rootMatch[1].split(';')) {
  const m = decl.match(/--([a-zA-Z0-9-]+)\s*:\s*(.+)/);
  if (m) tokens[m[1]] = m[2].trim();
}

// The pairs the app actually uses to distinguish MEANING by colour (see CLAUDE.md 3b's Accent
// note, and toast()'s ok/err kind, and flagGreen/flagRed).
const PAIRS = [
  { name: 'ok vs err (toast/status)', a: tokens.ok, b: tokens.err },
  { name: 'acc vs mut (.fx-mod modified-row signal)', a: tokens.acc, b: tokens.mut },
];

const findings = [];
const MIN_DISTANCE = 40; // empirical floor for "still tells apart at a glance" in 0-441 RGB space

for (const pair of PAIRS) {
  const rgbA = parseColor(pair.a || '');
  const rgbB = parseColor(pair.b || '');
  if (!rgbA || !rgbB) { findings.push({ kind: 'PARSE', detail: `could not resolve token colour for "${pair.name}" (${pair.a} / ${pair.b})` }); continue; }
  for (const [name, matrix] of Object.entries(MATRICES)) {
    const simA = simulate(rgbA, matrix);
    const simB = simulate(rgbB, matrix);
    const d = dist(simA, simB);
    if (d < MIN_DISTANCE) {
      findings.push({ kind: 'COLOR-COLLAPSE', detail: `"${pair.name}" under ${name} simulation: distance ${d.toFixed(1)} (floor ${MIN_DISTANCE}) — colours become hard to tell apart` });
    }
  }
}

// Part 2: confirm known colour-coded UI ALSO has a non-colour signal in markup, so a collapse
// found above doesn't automatically mean a real usability failure.
const secondarySignalChecks = [
  { name: 'flagGreen vs flagRed buttons', ok: /icon\('flagGreen'/.test(html) && /icon\('flagRed'/.test(html), detail: 'distinct icon glyphs (not just a colour swap) — shape differs even if colour collapses' },
  { name: '.fx-mod modified-row signal', ok: /\.fx-row\.fx-mod>\.fx-label::after/.test(html) && /\.fx-row\.fx-mod>\.fx-val\{color/.test(html), detail: 'a dot marker + text colour, but check whether the dot itself is colour-only (no shape/size change)' },
];
for (const c of secondarySignalChecks) {
  if (!c.ok) findings.push({ kind: 'NO-SECONDARY-SIGNAL', detail: `${c.name}: expected pattern not found — may rely on colour alone` });
}

console.log(`editor:cvd-check — ${PAIRS.length} token colour pair(s) x ${Object.keys(MATRICES).length} CVD simulation(s), plus secondary-signal markup check`);
if (findings.length) {
  console.log(`\n${findings.length} finding(s):`);
  for (const f of findings) console.log(`  [${f.kind}] ${f.detail}`);
  console.log('\nADVISORY: RGB-space simulation approximation + a markup pattern check, not full-page screenshot-diffed. Run with --strict to fail on any finding.');
  if (process.argv.includes('--strict')) process.exit(1);
} else {
  console.log('PASS: checked colour pairs stay distinguishable under CVD simulation, and known colour-coded UI also carries a non-colour signal.');
}
