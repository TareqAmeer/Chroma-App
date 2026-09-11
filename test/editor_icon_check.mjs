// T53 (editor_ux_spec.json): static scan of the ICONS stroke set (CLAUDE.md 3b) and every
// icon(name,size) call site in chromasmith-22.html. Same shape as T5/T10's token-drift check
// (editor_token_check.mjs), applied to the icon system instead of colour/spacing.
//
// Checks:
// 1. Every icon(...) call site references a name that exists in ICONS (a typo silently renders
//    nothing — icon() falls back to '' rather than throwing).
// 2. Every call site's size argument is one of the three documented sizes: 16, 20, 22
//    (CLAUDE.md 3b: "rendered via icon(name,size) at 16 / 20 / 22px only").
// 3. Every ICONS entry has at least one non-empty <path>/<rect>/<circle>/... child (a broken/
//    empty SVG value would render as an invisible icon with no error anywhere).
// 4. Every ICONS entry has a plausible stroke-width story: paths that set their own stroke-width
//    are flagged if it deviates from the shared default '2' baked into _SVG (a spot-check for
//    stroke-weight drift across the set, not a hard rule — see ALLOWLIST below).
//
// Known limits: only literal `icon(` call sites with a literal name/size are checked — a
// dynamically-built name (`icon(someVar, 20)`) or size (`icon('x', sz)`) can't be statically
// resolved and is skipped, not flagged. Advisory-shaped like editor_token_check.mjs: report
// findings, only hard-fail on --strict or on an ICONS lookup that would actually render blank.
import { readFileSync } from 'node:fs';

const html = readFileSync('chromasmith-22.html', 'utf8');

const iconsMatch = html.match(/const ICONS\s*=\s*\{([\s\S]*?)\n\};/);
if (!iconsMatch) { console.log('FAIL: could not locate ICONS map'); process.exit(1); }
const iconsBody = iconsMatch[1];

// Parse ICONS keys -> raw SVG-fragment value (strip full-line comments first).
const iconEntries = new Map();
{
  const cleaned = iconsBody.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const re = /(?:^|,)\s*(?:\/\*[\s\S]*?\*\/)?\s*([a-zA-Z0-9_]+)\s*:\s*'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = re.exec(cleaned))) iconEntries.set(m[1], m[2]);
}
console.log(`editor:icon-check — ${iconEntries.size} entries in ICONS`);

const findings = [];

// Check 3: empty/degenerate SVG fragments.
for (const [name, val] of iconEntries) {
  const hasDrawable = /<(path|circle|rect|line|polyline|polygon|ellipse)\b[^>]*\/?>/.test(val);
  if (!hasDrawable || val.trim() === '') {
    findings.push({ kind: 'empty', name, detail: 'ICONS entry has no drawable child — renders blank' });
  }
}

// Check 4: stroke-width drift (the shared default baked into _SVG is 2; flag any explicit
// per-path stroke-width that isn't 2 or the deliberate accent emphasis 2.4 already used twice
// above for flag/eyedropper-style glyphs).
const ALLOWED_STROKE_WIDTHS = new Set(['2', '2.4']);
for (const [name, val] of iconEntries) {
  const swMatches = [...val.matchAll(/stroke-width="([^"]+)"/g)].map((m) => m[1]);
  for (const sw of swMatches) {
    if (!ALLOWED_STROKE_WIDTHS.has(sw)) {
      findings.push({ kind: 'stroke-width', name, detail: `explicit stroke-width="${sw}" (expected 2 or 2.4)` });
    }
  }
}

// Checks 1+2: call sites.
const callRe = /\bicon\(\s*(?:'([a-zA-Z0-9_]+)'|"([a-zA-Z0-9_]+)")\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g;
const ALLOWED_SIZES = new Set([16, 20, 22]);
let siteCount = 0;
let dynamicSkipped = 0;
let m2;
while ((m2 = callRe.exec(html))) {
  siteCount++;
  const name = m2[1] || m2[2];
  const size = Number(m2[3]);
  if (!iconEntries.has(name)) {
    findings.push({ kind: 'missing-icon', name, detail: `icon('${name}', ${size}) — no such key in ICONS (renders blank)` });
  }
  if (!ALLOWED_SIZES.has(size)) {
    findings.push({ kind: 'bad-size', name, detail: `icon('${name}', ${size}) — size not in {16,20,22}` });
  }
}
// Rough count of dynamic call sites we intentionally can't check (name/size not a literal).
const allCallRe = /\bicon\(\s*[^)]*\)/g;
const allCalls = html.match(allCallRe) || [];
dynamicSkipped = allCalls.length - siteCount;

console.log(`  ${siteCount} literal icon() call site(s) checked, ${dynamicSkipped} dynamic call site(s) skipped (can't statically resolve)`);

if (findings.length) {
  const blocking = findings.filter((f) => f.kind === 'empty' || f.kind === 'missing-icon');
  console.log(`\n${findings.length} finding(s):`);
  for (const f of findings.slice(0, 200)) console.log(`  [${f.kind}] ${f.name}: ${f.detail}`);
  if (findings.length > 200) console.log(`  ... and ${findings.length - 200} more`);
  if (blocking.length) {
    console.log(`\nFAIL: ${blocking.length} finding(s) mean a real blank-icon render (missing key or empty ICONS entry).`);
    process.exit(1);
  }
  console.log('\nADVISORY: stroke-width drift only — not auto-failing. Run with --strict to fail on any finding.');
  if (process.argv.includes('--strict')) process.exit(1);
} else {
  console.log('PASS: every icon() call site resolves to a real, non-empty ICONS entry at an approved size.');
}
