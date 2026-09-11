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

// FX_GROUPS folds several sections behind one deskx rail button. EVALUATED from the real source
// (not regex-parsed) so this can never drift from FX_GROUPS's actual shape the way a hand-copied
// second list, or a regex tuned to today's formatting, silently could (T27, editor_ux_spec.json —
// a regex here is itself "a separate copy of that logic" if FX_GROUPS's literal syntax ever
// changes in a way the pattern doesn't anticipate; `new Function` on the real statement can't).
const groupsStmtStart = app.indexOf('const FX_GROUPS=');
const groupOfStmtEnd = app.indexOf(';', app.indexOf('const FX_GROUP_OF=', groupsStmtStart)) + 1;
const groupsSrc = app.slice(groupsStmtStart, groupOfStmtEnd);
const { FX_GROUPS, FX_GROUP_OF } = new Function(`${groupsSrc}\nreturn { FX_GROUPS, FX_GROUP_OF };`)();
const groupOf = FX_GROUP_OF;
const groupLabel = {};
for (const [key, def] of Object.entries(FX_GROUPS)) groupLabel[key] = def.label;

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
  // Spec attribution is by the item's OWN fields — its controlled-vocabulary `category`, or an
  // explicit `panel` field — never by scanning source/note prose. Free-text matching was tried
  // and immediately produced false positives: a single item whose note explains a decision
  // across several panels ("wheels joins Color, deconv joins Detail...") credited itself to
  // every panel it named, so panels with no tracked work at all reported spec coverage.
  const specHits = specItems.filter(([, v]) =>
    (v.panel && v.panel === key) || (v.category || '').split('-')[0] === key || (v.category || '') === `${key}-panel`);
  const hasBehaviour = mentions(behavSrc, key);
  return { inPairs, specOpen: specHits.filter(([, v]) => v.status === 'open').length, specTotal: specHits.length, hasBehaviour };
}

// ── T29 (editor_ux_spec.json, 2026-09-10): fully-dynamic panels ───────────────────────────────
// A panel like Masks builds its actual content (the mask list) entirely from JS at runtime — the
// static HTML has only an EMPTY container the rebuild function fills via getElementById+innerHTML/
// appendChild. editor_wireframe_inventory.mjs walks static markup, so there is nothing for it to
// inventory until JS runs: no structural-diff safety net under that panel at all, unlike every
// other panel. Detected structurally (not a hand-maintained panel list, per CLAUDE.md §2's
// "drifting second source of truth" lesson): find an empty `id="*-list"`/`id="*-ctl"` container in
// a section's static markup, then confirm some function actually repopulates it via
// getElementById(id) + .innerHTML=/appendChild.
const appSectionSpans = [...app.matchAll(/<div class="fx-ctrl" data-fxsec="([a-z]+)">/g)].map((m, i, arr) => {
  const start = m.index;
  const end = i + 1 < arr.length ? arr[i + 1].index : app.indexOf('</body>', start);
  return { key: m[1], body: app.slice(start, end) };
});
function dynamicContainerFor(sectionKey) {
  const span = appSectionSpans.find((s) => s.key === sectionKey);
  if (!span) return null;
  for (const cm of span.body.matchAll(/id="([a-z0-9-]+(?:-list|-ctl))"[^>]*><\/div>/g)) {
    const id = cm[1];
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // The container is usually captured into a local var (`const list=document.getElementById(...)`)
    // and populated a few statements later, not chained directly — so look for the getElementById
    // call and an .innerHTML=/.appendChild( call ANYWHERE in the same enclosing function body
    // (approximated as the 2000 chars following the getElementById call, which comfortably covers
    // a rebuild function's body without needing a real JS parser).
    const getM = app.match(new RegExp(`getElementById\\(['"]${escaped}['"]\\)`));
    if (getM) {
      const after = app.slice(getM.index, getM.index + 2000);
      if (/\.innerHTML\s*=|\.appendChild\(/.test(after)) return id;
    }
  }
  return null;
}
// Add/edit/delete-shaped smoke test: the panel's own behaviour describe block must show the
// dynamic container's item COUNT both going up (add) and down (delete/remove) — "a test exists"
// is not enough per T29's note; a boolean click-happened test would have missed the mskRebuild()
// infinite-loop bug (T28) just as easily as no test at all.
function hasSmokeTest(containerId) {
  const escaped = containerId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`#${escaped}[^\\n]*toHaveCount`, 'g');
  return [...behavSrc.matchAll(re)].length >= 2;
}

// T24 (editor_ux_spec.json): "has a behaviour test" (coverageFor's hasBehaviour, above) only
// proves the PANEL is mentioned somewhere in the file — it says nothing about whether the test(s)
// actually exercise any GIVEN control inside it. Detail's Lens Correction alone shipped 9 sliders
// with exactly 1 (the Auto toggle) ever referenced by a test, and the old boolean metric reported
// "detail: behav yes" the whole time. Cross-reference every real sl-/cl-/tg- id inside a section's
// own markup span against whether that id string appears anywhere in the behaviour-test source —
// approximate (a test could reference an id in a comment, or via a non-literal selector this can't
// see), but far more honest than a per-panel boolean.
function controlIdsFor(sectionKey) {
  const span = appSectionSpans.find((s) => s.key === sectionKey);
  if (!span) return [];
  const ids = new Set();
  for (const m of span.body.matchAll(/\bid="((?:sl|cl|tg)-[a-z0-9-]+)"/g)) ids.add(m[1]);
  return [...ids];
}
function controlCoverageFor(members) {
  const ids = members.flatMap(controlIdsFor);
  if (!ids.length) return null;
  const tested = ids.filter((id) => behavSrc.includes(id));
  return { total: ids.length, tested: tested.length, untested: ids.filter((id) => !tested.includes(id)) };
}

const rows = panels.map((p) => {
  const aliases = PANEL_ALIAS[p.key] || [];
  const members = appSections.filter((s) => (groupOf[s] || s) === p.key || aliases.includes(s));
  const dynamicContainer = members.map(dynamicContainerFor).find(Boolean) || null;
  const fullyDynamic = Boolean(dynamicContainer);
  return {
    ...p,
    onRail: railTabs.includes(p.key),
    appSections: members,
    ...coverageFor(p.key),
    fullyDynamic,
    dynamicContainer,
    hasSmokeTest: fullyDynamic ? hasSmokeTest(dynamicContainer) : null,
    controlCoverage: controlCoverageFor(members),
  };
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
  console.log(pad('panel', 10) + pad('designed', 10) + pad('rail', 6) + pad('PAIRS', 7) + pad('spec', 12) + pad('behav', 7) + pad('dynamic', 9) + pad('ctrls', 10) + 'app sections');
  console.log('-'.repeat(78));
  for (const r of rows.sort((a, b) => Number(b.designed) - Number(a.designed) || a.key.localeCompare(b.key))) {
    console.log(pad(r.key, 10)
      + pad(r.designed ? 'yes' : 'NO', 10)
      + pad(r.onRail ? 'yes' : 'no', 6)
      + pad(r.inPairs ? 'yes' : 'no', 7)
      + pad(r.specTotal ? `${r.specOpen}/${r.specTotal} open` : '-', 12)
      + pad(r.hasBehaviour ? 'yes' : 'no', 7)
      + pad(r.fullyDynamic ? (r.hasSmokeTest ? 'smoke-ok' : 'NO-SMOKE') : '-', 9)
      + pad(r.controlCoverage ? `${r.controlCoverage.tested}/${r.controlCoverage.total}` : '-', 10)
      + (r.appSections.join(', ') || '(none)'));
  }
  console.log('-'.repeat(78));
  const designed = rows.filter((r) => r.designed);
  console.log(`${designed.length}/${rows.length} panels designed; ${appSections.length} app sections total`);
  // An orphan is a section with nowhere to live. That is a DESIGN decision, not a code fix —
  // but once the decision is made it stays listed here until FX_GROUPS actually changes, so
  // point at the spec item rather than re-asking a question that has already been answered.
  if (orphans.length) {
    const d2 = spec.items?.D2?.status;
    console.log(`\n⚠ app sections no wireframe panel claims (${d2 === 'open' ? 'decision recorded in spec D2 — not yet implemented in FX_GROUPS' : 'needs a DESIGN decision, not a fix'}):\n  ${orphans.join(', ')}`);
  }
  if (emptyPanels.length) console.log(`⚠ wireframe panels with no app section behind them:\n  ${emptyPanels.join(', ')}`);
  const unchecked = designed.filter((r) => !r.inPairs || !r.hasBehaviour);
  if (unchecked.length) {
    console.log(`\n⚠ DESIGNED but not fully checked (${unchecked.length}):`);
    for (const r of unchecked) console.log(`  ${r.key}: ${[!r.inPairs && 'no PAIRS entry', !r.hasBehaviour && 'no behaviour test'].filter(Boolean).join(', ')}`);
  }
  const dynamicPanels = rows.filter((r) => r.fullyDynamic);
  if (dynamicPanels.length) {
    console.log(`\n⚠ FULLY DYNAMIC panels (no static markup — structural inventory impossible, T29):`);
    for (const r of dynamicPanels) {
      console.log(`  ${r.key} (container #${r.dynamicContainer}): ${r.hasSmokeTest ? 'has add/edit/delete smoke test' : 'NO add/edit/delete-shaped smoke test'}`);
    }
  }
  const dynamicUncovered = dynamicPanels.filter((r) => !r.hasSmokeTest);
  // T24: per-control detail, informational — a panel-level "behav yes" can still hide most of a
  // section's own sliders having zero behaviour coverage (that's the exact bug this replaces).
  const thin = rows.filter((r) => r.controlCoverage && r.controlCoverage.tested < r.controlCoverage.total);
  if (thin.length) {
    console.log(`\n⚠ per-control behaviour coverage below 100% (T24 — panel-level "behav yes" can still hide this):`);
    for (const r of thin) {
      console.log(`  ${r.key}: ${r.controlCoverage.tested}/${r.controlCoverage.total} tested — untested: ${r.controlCoverage.untested.join(', ')}`);
    }
  }
  console.log('');
  if (strict && unchecked.length) {
    console.log('RESULT: FAIL (--strict: a designed panel must have a PAIRS entry and a behaviour test)');
    process.exit(1);
  }
  if (strict && dynamicUncovered.length) {
    console.log('RESULT: FAIL (--strict: a fully-dynamic panel needs an add/edit/delete-shaped smoke test, not just "a test exists" — T29)');
    process.exit(1);
  }
  console.log('RESULT: PASS' + (strict ? ' (--strict)' : ' (report only — use --strict to gate)'));
}
