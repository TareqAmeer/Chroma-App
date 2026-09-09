// Editor design-coverage map — "what is designed, what is mapped, what is checked".
//
// WHY THIS EXISTS
// The Editor redesign is a REGROUPING, not a restyle: the app has 23 tool sections
// (`data-fxsec`) which the deskx rail already folds into 12 rail buttons via FX_GROUPS, while
// the wireframe (chromasmith-design/project/Editor (Developer) View.dc.html) proposes 10 rail
// tabs over 11 `.tp-panel`s — and 9 of those 11 panels are still literal placeholders reading
// "<X> tools live here." So the honest state of the redesign is not "N findings to fix", it is
// "9 panels have no design yet, and nothing tells you which".
//
// Every OTHER Editor tool answers a question about elements someone already listed:
//   - editor_wireframe_diff.mjs   → do the 11 hand-mapped PAIRS match on 12 properties?
//   - editor_wireframe_inventory  → does a zone's atom inventory match?
//   - editor_wireframe_behaviour  → does clicking things still work?
// None can answer "is this panel designed at all, and if it is, is anything checking it?"
// That gap is exactly how a redesign reports green while most of it hasn't started, which is
// the failure this repo has already paid for twice (HANDOVER_EDITOR.md §1, CLAUDE.md §10.14).
//
// This is a REPORT by default (always exit 0) so it can't block work in progress. `--strict`
// makes it a gate: every panel that HAS a design must also have a PAIRS entry, a spec item and
// a behaviour test. Turn that on per-panel as the redesign lands, not before — a gate that
// fails on work nobody has started yet gets ignored, and an ignored gate is worse than none.
//
// Usage:
//   node test/editor_coverage.mjs            # table + summary, exit 0
//   node test/editor_coverage.mjs --json     # machine-readable
//   node test/editor_coverage.mjs --strict   # exit 1 if a DESIGNED panel is unchecked
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const APP = path.join(ROOT, 'chromasmith-22.html');
const WF = path.join(ROOT, 'chromasmith-design/project/Editor (Developer) View.dc.html');
const SPEC = path.join(ROOT, 'test/editor_ux_spec.json');
const DIFF = path.join(ROOT, 'test/editor_wireframe_diff.mjs');
const BEHAV = path.join(ROOT, 'test/editor_wireframe_behaviour.mjs');

const argv = new Set(process.argv.slice(2));
const asJson = argv.has('--json');
const strict = argv.has('--strict');

const app = readFileSync(APP, 'utf8');
const wf = readFileSync(WF, 'utf8');
const spec = JSON.parse(readFileSync(SPEC, 'utf8'));
const diffSrc = readFileSync(DIFF, 'utf8');
const behavSrc = readFileSync(BEHAV, 'utf8');

// ── App side ────────────────────────────────────────────────────────────────────────────────
// Sections are `data-fxsec="key"` on .fx-ctrl cards. One occurrence is a template literal
// (`data-fxsec="${cardOrName}"`, the dynamically built card) — excluded by the [a-z] class.
const appSections = [...new Set([...app.matchAll(/data-fxsec="([a-z]+)"/g)].map((m) => m[1]))].sort();

// FX_GROUPS folds several sections behind one deskx rail button. Parsed from the real source
// rather than restated here: a hand-copied second list is the "drifting second source of truth"
// class this repo keeps getting bitten by (CLAUDE.md §2's worker note, §10.10's complexity note).
const groupsBlock = app.slice(app.indexOf('const FX_GROUPS='), app.indexOf('const FX_GROUP_OF='));
const groupOf = {};
const groupLabel = {};
for (const m of groupsBlock.matchAll(/(\w+):\{label:'([^']+)',icon:'[^']+',members:\[([^\]]+)\]\}/g)) {
  const [, key, label, members] = m;
  groupLabel[key] = label;
  for (const raw of members.split(',')) groupOf[raw.trim().replace(/'/g, '')] = key;
}

// ── Wireframe side ──────────────────────────────────────────────────────────────────────────
const wfRailTabs = [...wf.matchAll(/class="rail-btn[^"]*"[^>]*data-tab="([a-z]+)"/g)].map((m) => m[1]);
const railTabs = wfRailTabs.length
  ? wfRailTabs
  : [...new Set([...wf.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]))];

// A panel is UNDESIGNED when its whole body is the placeholder sentence the wireframe author
// left behind — "Crop & straighten tools live here.", "Sharpening & noise reduction live here."
// The invariant is the trailing "live here", not the noun in front of it, so this must NOT be a
// list of the specific sentences: a new placeholder worded differently would silently read as
// designed. Matching the shape is also self-invalidating — the moment real content is authored
// the panel flips to designed on its own, with nobody having to remember to update anything.
const PLACEHOLDER = /^\s*<p[^>]*>[^<]*live\s+here\.?\s*<\/p>\s*$/i;
const panels = [];
for (const m of wf.matchAll(/<div class="tp-panel[^"]*" data-panel="([a-z]+)">([\s\S]*?)<\/div>\s*(?=<div class="tp-panel|<\/div>)/g)) {
  const [, key, body] = m;
  panels.push({ key, designed: !PLACEHOLDER.test(body), bodyLen: body.trim().length });
}
// The active/first panel uses a slightly different opening tag; catch any data-panel we missed.
for (const m of wf.matchAll(/data-panel="([a-z]+)"/g)) {
  if (!panels.some((p) => p.key === m[1])) panels.push({ key: m[1], designed: true, bodyLen: -1 });
}

// ── Check coverage ──────────────────────────────────────────────────────────────────────────
// PAIRS keys are wireframe selectors; a panel is "in PAIRS" when some entry targets it.
const pairsBlock = diffSrc.slice(diffSrc.indexOf('const PAIRS'), diffSrc.indexOf('const PROPS'));
const pairsSelectors = [...pairsBlock.matchAll(/'([^']+)':\s*\{\s*app:/g)].map((m) => m[1]);
const specItems = Object.entries(spec.items || {});

// The wireframe and the app disagree on a few NAMES for the same thing. Only genuine synonyms
// belong here — anything listed becomes invisible in the orphan report below, so a wrong entry
// hides real work. `local` (Local Adjustments) is the app's key for what the wireframe calls
// Masks; the app's own UI already labels that section "Masks".
const PANEL_ALIAS = { masks: ['local'] };

// Word-boundary match, not substring: "film" is a substring of "filmstrip" and "frame" of
// "iframe", so a naive includes() reported behaviour coverage for panels that had none.
function mentions(src, key) {
  return new RegExp(`(^|[^a-z])${key}([^a-z]|$)`, 'i').test(src);
}

function coverageFor(key) {
  const inPairs = pairsSelectors.some((s) => mentions(s, key)) || pairsBlock.includes(`data-panel="${key}"`);
  const specHits = specItems.filter(([, v]) =>
    (v.category || '').includes(key) || mentions(`${v.source || ''} ${v.note || ''}`, key));
  const hasBehaviour = mentions(behavSrc, key);
  return { inPairs, specOpen: specHits.filter(([, v]) => v.status === 'open').length, specTotal: specHits.length, hasBehaviour };
}

const rows = panels.map((p) => {
  const aliases = PANEL_ALIAS[p.key] || [];
  const members = appSections.filter((s) => (groupOf[s] || s) === p.key || aliases.includes(s));
  return { ...p, onRail: railTabs.includes(p.key), appSections: members, ...coverageFor(p.key) };
});

// App sections that no wireframe panel claims — these need a design decision, not a code fix.
const claimed = new Set(rows.flatMap((r) => r.appSections));
const orphans = appSections.filter((s) => !claimed.has(s));
// Wireframe panels with no app section behind them.
const emptyPanels = rows.filter((r) => r.appSections.length === 0).map((r) => r.key);

if (asJson) {
  console.log(JSON.stringify({ rows, orphans, emptyPanels, railTabs, appSections }, null, 2));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\nEDITOR DESIGN COVERAGE\n' + '='.repeat(78));
  console.log(pad('panel', 10) + pad('designed', 10) + pad('rail', 6) + pad('PAIRS', 7) + pad('spec', 12) + pad('behav', 7) + 'app sections');
  console.log('-'.repeat(78));
  for (const r of rows.sort((a, b) => Number(b.designed) - Number(a.designed) || a.key.localeCompare(b.key))) {
    console.log(pad(r.key, 10)
      + pad(r.designed ? 'yes' : 'NO', 10)
      + pad(r.onRail ? 'yes' : 'no', 6)
      + pad(r.inPairs ? 'yes' : 'no', 7)
      + pad(r.specTotal ? `${r.specOpen}/${r.specTotal} open` : '-', 12)
      + pad(r.hasBehaviour ? 'yes' : 'no', 7)
      + (r.appSections.join(', ') || '(none)'));
  }
  console.log('-'.repeat(78));
  const designed = rows.filter((r) => r.designed);
  console.log(`${designed.length}/${rows.length} panels designed; ${appSections.length} app sections total`);
  if (orphans.length) console.log(`\n⚠ app sections no wireframe panel claims (needs a DESIGN decision, not a fix):\n  ${orphans.join(', ')}`);
  if (emptyPanels.length) console.log(`⚠ wireframe panels with no app section behind them:\n  ${emptyPanels.join(', ')}`);
  const unchecked = designed.filter((r) => !r.inPairs || !r.hasBehaviour);
  if (unchecked.length) {
    console.log(`\n⚠ DESIGNED but not fully checked (${unchecked.length}):`);
    for (const r of unchecked) console.log(`  ${r.key}: ${[!r.inPairs && 'no PAIRS entry', !r.hasBehaviour && 'no behaviour test'].filter(Boolean).join(', ')}`);
  }
  console.log('');
  if (strict && unchecked.length) {
    console.log('RESULT: FAIL (--strict: a designed panel must have a PAIRS entry and a behaviour test)');
    process.exit(1);
  }
  console.log('RESULT: PASS' + (strict ? ' (--strict)' : ' (report only — use --strict to gate)'));
}
