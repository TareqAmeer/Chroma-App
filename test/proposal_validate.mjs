// Validates a rendered design proposal (a panels/*.compare.html PROPOSED column, or a standalone
// .dc.html canvas artboard) against two sources of truth:
//   - test/output/panel_inventory.json (Stage 1's live-app extraction) — every real control's
//     label, kind and numeric range.
//   - design/tokens.json — every colour the design system actually has a name for.
//
// This exists because test/panel_proposals.mjs has twice shipped fabricated content that looked
// plausible on read-through: invented sliders standing in for a section's real controls (commit
// 247110c), and invented/wrong colours and control values (commit 8eed9f0). Both were caught by
// hand, after the fact. This script is the automated version of that same check, run before
// implementation rather than after.
//
// Usage: node test/proposal_validate.mjs <file.compare.html | file.dc.html> [--json]
//
// Hard fail (exit 1): a control whose label/kind/range matches nothing in panel_inventory.json,
// or a colour that matches no design/tokens.json value.
// Report only (exit 0, printed): a spacing/size/radius value that isn't a token — shown, not
// blocking, since the approved wireframe itself is mostly off-grid literals (S1 finding).
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const AS_JSON = argv.includes('--json');
if (!file) {
  console.error('Usage: node test/proposal_validate.mjs <file.compare.html|file.dc.html> [--json]');
  process.exit(2);
}

const stripTags = (s) => (s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
// Real labels sometimes concatenate a trailing info-i button's "i" text into the same string
// (panel_extract.mjs's own labelFor() does this when a control's label and its info button
// share one .fx-row) — e.g. "Shadow protect i", "Style i". Strip that same trailing token so a
// clean proposal label ("Shadow protect") still matches its real counterpart.
const normLabel = (s) => stripTags(s).toLowerCase().replace(/\s+i$/, '').trim();

// ── Load sources of truth ───────────────────────────────────────────────────────────────────
const inventory = JSON.parse(await readFile(path.join(ROOT, 'test/output/panel_inventory.json'), 'utf8'));
const tokens = JSON.parse(await readFile(path.join(ROOT, 'design/tokens.json'), 'utf8'));

// Flatten every {$value} leaf in tokens.json, keeping its $type so colour and dimension pools
// stay separate.
const tokenLeaves = [];
(function walk(o) {
  if (o && typeof o === 'object') {
    if ('$value' in o) tokenLeaves.push({ value: o.$value, type: o.$type });
    else for (const v of Object.values(o)) walk(v);
  }
})(tokens);

const hexToRgb = (hex) => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// Colour token pool, as RGB triples (alpha-agnostic — a translucent wash of a real token, e.g.
// rgba(135,15,19,.16) over --red-oxide, is still that token; CLAUDE.md/docs/editor-redesign-plan.md
// §3 treat that as the correct way to reuse a colour that's too dark for text on its own).
// One level of var(--x) indirection is resolved via each token's own recorded appVar, since some
// $values are themselves "var(--other-token)" rather than a literal.
const byAppVar = new Map();
(function collect(o) {
  if (o && typeof o === 'object') {
    if ('$value' in o && o.$extensions?.chromasmith?.appVar) {
      byAppVar.set(o.$extensions.chromasmith.appVar, o.$value);
    }
    if (!('$value' in o)) for (const v of Object.values(o)) collect(v);
    else if (o.$extensions) { /* leaf handled above */ }
  }
})(tokens);

function resolveColorValue(raw, depth = 0) {
  if (depth > 3 || typeof raw !== 'string') return raw;
  const m = raw.match(/^var\((--[\w-]+)\)$/);
  if (m && byAppVar.has(m[1])) return resolveColorValue(byAppVar.get(m[1]), depth + 1);
  return raw;
}

const colorRgbPool = new Set(); // "r,g,b" strings
for (const t of tokenLeaves) {
  if (t.type !== 'color') continue;
  const resolved = resolveColorValue(t.value);
  if (typeof resolved !== 'string') continue;
  if (resolved.startsWith('#')) {
    const rgb = hexToRgb(resolved);
    if (rgb) colorRgbPool.add(rgb.join(','));
  } else {
    const m = resolved.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
    if (m) colorRgbPool.add([m[1], m[2], m[3]].map(Number).join(','));
  }
}

// Dimension token pool (spacing/radius/size) — report-only, not a hard fail (S1 already found
// the approved wireframe itself is mostly off-grid literals; docs/ui-workflow/STATE.md).
const dimensionPool = new Set();
for (const t of tokenLeaves) {
  if (t.type !== 'dimension') continue;
  const v = String(t.value).trim();
  dimensionPool.add(v);
  const n = v.match(/^(-?[\d.]+)px$/);
  if (n) dimensionPool.add(`${n[1]}px`);
}

// ── Load & scope the proposal file ──────────────────────────────────────────────────────────
const raw = await readFile(path.isAbsolute(file) ? file : path.join(ROOT, file), 'utf8');

// panels/*.compare.html has CURRENT and PROPOSED side by side; only PROPOSED is authored content
// worth validating (CURRENT is mechanically regenerated from the live app, per panel_proposals.mjs's
// own header comment). A standalone .dc.html canvas artboard has no such split — validate the
// whole file.
const proposedMatch = raw.match(/<div class="col proposed"[^>]*>([\s\S]*?)<ul class="changes">/);
const controlsFragment = proposedMatch ? proposedMatch[1] : raw;
// Colours are checked over the markup fragment PLUS every authored `.wf ...` rule in <style> — a
// fabricated colour can live in a shared CSS rule (e.g. .wide-btn.danger{color:#e79a9d}, commit
// 8eed9f0's PROPOSAL_CSS) rather than an inline style attribute. `.wf` is PROPOSAL_CSS's own
// prefix for every authored component rule; page-shell CSS (body background, the changes-list
// merged/kept/cut badge colours, from panel_compare_build.mjs, not panel_proposals.mjs) is
// deliberately excluded — it isn't part of the proposal being reviewed.
const styleBlocks = [...raw.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const wfRules = [...styleBlocks.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, sel]) => sel.includes('.wf'))
  .map(([, , body]) => body)
  .join('\n');
const colorScope = controlsFragment + '\n' + wfRules;

const findings = []; // {level:'FAIL'|'REPORT', kind, label, detail}

// Which panel_inventory.json sections each authored panel is allowed to draw controls from.
// Matching must be scoped this way, not pooled across the whole app: two real, unrelated
// controls can share a label and a numeric range by coincidence (e.g. "Strength" is a real 0-100
// slider in Looks/LUT-mix — a fabricated Halation "Strength" 0-100 slider would silently pass a
// global-pool match against that unrelated control). The panel->section lists below mirror
// test/panel_proposals.mjs's own PROPOSALS structure and header comments about what "arrives here
// from its own rail section" (Deconvolution/Colour wheels).
const PANEL_SECTIONS = {
  color: ['curves', 'hsl', 'pointcolor', 'wheels'],
  detail: ['nr', 'lens', 'deconv'],
  film: ['grain', 'hal', 'bloom', 'art', 'vig'],
  frame: ['borders', 'canvas'],
  crop: ['crop'],
  retouch: ['retouch'],
  masks: ['local'],
  export: ['export'],
  info: ['info'],
};
const panelKey = Object.keys(PANEL_SECTIONS).find((k) => path.basename(file).startsWith(k));
const allowedSections = panelKey ? PANEL_SECTIONS[panelKey] : Object.keys(inventory);
if (!panelKey) {
  console.error(`Note: "${path.basename(file)}" doesn't match a known panel name (${Object.keys(PANEL_SECTIONS).join('/')}) — matching against the WHOLE inventory instead of one panel's sections, which is less precise (may miss a same-label/same-range collision from an unrelated panel).`);
}

const sliderIndex = new Map();   // normLabel -> [{min,max,section,id}]
const checkboxIndex = new Map(); // normLabel -> [{section,id}]
const selectIndex = new Map();   // normLabel -> [{options,section,id}]
const labelExists = new Set();   // any label/option/button text seen anywhere in-scope, normalized
// Reviewed Masks proposal vocabulary: the compact proposal calls the real Hue range slider
// "Range". Keep the exact runtime label in the inventory and make the approved presentation
// alias explicit here instead of corrupting extraction or globally weakening label matching.
const PANEL_LABEL_ALIASES = panelKey === 'masks' ? new Map([['range', 'hue range']]) : new Map();

function push(map, key, val) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(val);
}

for (const [section, s] of Object.entries(inventory)) {
  if (!allowedSections.includes(section)) continue;
  for (const c of s.controls || []) {
    if (!c.label) continue;
    const key = normLabel(c.label);
    labelExists.add(key);
    if (c.kind === 'slider') {
      push(sliderIndex, key, { min: Number(c.min), max: Number(c.max), section, id: c.id });
    } else if (c.kind === 'checkbox') {
      push(checkboxIndex, key, { section, id: c.id });
    } else if (c.kind === 'select') {
      push(selectIndex, key, { options: c.options || [], section, id: c.id });
      for (const opt of c.options || []) labelExists.add(normLabel(opt));
    } else if (c.kind === 'button') {
      labelExists.add(key);
    }
  }
}

// ── Extract controls from the proposal fragment ─────────────────────────────────────────────

// Sliders: sl() → <div class="slider-row"><div class="sr-top"><span>LABEL[+info]</span>...
//   </div><input type="range" min="M" max="X" value="V"></div>
for (const m of controlsFragment.matchAll(
  /<div class="slider-row"><div class="sr-top"><span>(.*?)<\/span>.*?<\/div><input type="range" min="(-?[\d.]+)" max="(-?[\d.]+)" value="(-?[\d.]+)">/g,
)) {
  const label = stripTags(m[1]);
  const key = PANEL_LABEL_ALIASES.get(normLabel(label)) || normLabel(label);
  const min = Number(m[2]), max = Number(m[3]);
  const candidates = sliderIndex.get(key);
  if (!candidates) {
    findings.push({ level: 'FAIL', kind: 'slider', label, detail: `no real control named "${label}" (checked against every slider in panel_inventory.json)` });
    continue;
  }
  const rangeOk = candidates.some((c) => c.min === min && c.max === max);
  if (!rangeOk) {
    findings.push({
      level: 'FAIL', kind: 'slider-range', label,
      detail: `range ${min}..${max} matches no real "${label}" slider — real range(s): ${candidates.map((c) => `${c.min}..${c.max} (${c.section}${c.id ? '#' + c.id : ''})`).join(', ')}`,
    });
  }
}

// Checkboxes/toggles: .cb-row → <div class="cb-row"><button class="sw"...></button><span>LABEL[+info]</span></div>
// The real app renders most boolean toggles as a `.fx-toggle` DIV, not an <input type=checkbox> —
// panel_extract.mjs's own extractor only records a `checkbox` kind for the rare literal
// <input type=checkbox>; the rest surface as `button` entries instead (their nearby info-i tooltip
// button, labelled via the same preceding-sibling text as the toggle itself — e.g. Halation's real
// White glow/No remjet/Extreme toggles all land in panel_inventory.json as kind:"button"). So a
// cb-row is valid if its label matches ANY real control anywhere in scope, not checkbox kind only.
for (const m of controlsFragment.matchAll(/<div class="cb-row"><button class="sw"[^>]*><\/button><span>(.*?)<\/span>/g)) {
  const label = stripTags(m[1]);
  const key = normLabel(label);
  if (!labelExists.has(key)) {
    findings.push({ level: 'FAIL', kind: 'checkbox', label, detail: `no real control named "${label}" (checkbox/toggle/button) in scope of panel_inventory.json` });
  }
}

// field(label, select(value)) pairs — select() renders a <button class="select-btn"> with no
// direct DOM link back to its field() label, so pair each select-btn with the nearest PRECEDING
// .fieldlabel (field() always emits them adjacently; anything further than ~300 chars away is not
// this pattern and is left unpaired rather than guessed).
const fieldLabels = [...controlsFragment.matchAll(/<span class="fieldlabel">(.*?)<\/span>/g)]
  .map((m) => ({ index: m.index, label: stripTags(m[1]) }));
for (const m of controlsFragment.matchAll(/<button class="select-btn"><span>(.*?)<\/span>/g)) {
  const value = stripTags(m[1]);
  let nearest = null;
  for (const fl of fieldLabels) {
    if (fl.index < m.index && m.index - fl.index < 300) nearest = fl;
  }
  if (!nearest) continue;
  const key = normLabel(nearest.label);
  const candidates = selectIndex.get(key);
  if (!candidates) {
    findings.push({ level: 'FAIL', kind: 'select', label: nearest.label, detail: `no real select named "${nearest.label}" in panel_inventory.json` });
    continue;
  }
  const valueOk = candidates.some((c) => c.options.includes(value));
  if (!valueOk) {
    findings.push({
      level: 'FAIL', kind: 'select-value', label: nearest.label,
      detail: `value "${value}" is not one of ${nearest.label}'s real options: ${candidates.map((c) => c.options.join('|')).join(' / ')}`,
    });
  }
}

// Darkroom-style option-list rows (ratioList()) — the exact vector for both fabricated-suffix
// aspect ratios caught in 247110c (Frame's "4:5 Instagram"/"3:4 Classic" and Crop's "2:3 35mm"/
// "XPan"/etc.). The real app renders these same options as literal button labels (see crop/canvas
// in panel_inventory.json), so match against the pooled label/option/button set.
for (const m of controlsFragment.matchAll(/<span class="rlb">(.*?)<\/span>/g)) {
  const label = stripTags(m[1]);
  if (label === 'Custom') continue; // ratioList's custom row has no fixed real counterpart
  if (!labelExists.has(normLabel(label))) {
    findings.push({ level: 'FAIL', kind: 'ratio-option', label, detail: `"${label}" matches no real control/option/button label anywhere in panel_inventory.json` });
  }
}

// ── Colours ──────────────────────────────────────────────────────────────────────────────────
const seenColors = new Set();
const colorMatches = [
  ...colorScope.matchAll(/(?:background|background-color|color|border-color|--b|--acc)\s*:\s*(#[0-9a-fA-F]{3,8})/g),
  ...colorScope.matchAll(/style="[^"]*background:\s*(#[0-9a-fA-F]{3,8})/g),
];
for (const m of colorMatches) {
  const hex = m[1].toLowerCase();
  if (seenColors.has(hex)) continue;
  seenColors.add(hex);
  const rgb = hexToRgb(hex.length > 7 ? hex.slice(0, 7) : hex); // drop 8-digit alpha channel
  if (!rgb) continue;
  if (!colorRgbPool.has(rgb.join(','))) {
    findings.push({ level: 'FAIL', kind: 'colour', label: hex, detail: `${hex} matches no design/tokens.json colour value` });
  }
}
for (const m of colorScope.matchAll(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*,\s*[\d.]+)?\s*\)/g)) {
  const key = `${m[1]},${m[2]},${m[3]}`;
  if (seenColors.has(key)) continue;
  seenColors.add(key);
  if (!colorRgbPool.has(key)) {
    findings.push({ level: 'FAIL', kind: 'colour', label: m[0], detail: `${m[0]} (rgb ${key}) matches no design/tokens.json colour value` });
  }
}

// ── Report-only: spacing/size/radius literals that aren't tokens ───────────────────────────────
const seenDims = new Set();
for (const m of controlsFragment.matchAll(/(?:padding|gap|border-radius|width|height|font-size|margin)\s*:\s*(-?[\d.]+px)/g)) {
  const v = m[1];
  if (seenDims.has(v) || dimensionPool.has(v)) continue;
  seenDims.add(v);
  findings.push({ level: 'REPORT', kind: 'dimension', label: v, detail: `${v} is not a design/tokens.json dimension (spacing/radius/size) — report only, per S1: the approved wireframe itself is mostly off-grid literals` });
}

// ── Output ───────────────────────────────────────────────────────────────────────────────────
const fails = findings.filter((f) => f.level === 'FAIL');
const reports = findings.filter((f) => f.level === 'REPORT');

if (AS_JSON) {
  console.log(JSON.stringify({ file, fails, reports }, null, 2));
} else {
  console.log(`\nproposal_validate — ${path.relative(ROOT, path.isAbsolute(file) ? file : path.join(ROOT, file))}`);
  console.log('='.repeat(78));
  if (fails.length) {
    console.log(`\n${fails.length} HARD FAIL(S):`);
    for (const f of fails) console.log(`  ✗ [${f.kind}] ${f.detail}`);
  } else {
    console.log('\n0 hard fails.');
  }
  if (reports.length) {
    console.log(`\n${reports.length} report-only (not blocking):`);
    for (const r of reports) console.log(`  · [${r.kind}] ${r.detail}`);
  }
  console.log('');
}

process.exit(fails.length ? 1 : 0);
