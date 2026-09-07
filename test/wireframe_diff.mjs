// Visual-fidelity check for the Library view against its Claude Design source, per the plan at
// .claude/plans/use-the-claude-design-mcp-memoized-abelson.md. Loads the literal wireframe
// (chromasmith-design/project/Library View.html) and the real app (?libtest=1) side by side at
// the same viewport, in both themes, and reports:
//   - a computed-style mismatch table per named element pair (font/color/border/radius/box)
//   - full-page screenshots of both, for the human side-by-side check
//
// This is a CHECK, not a search: the app's CSS was transplanted from the wireframe's own values
// (not re-derived by eye), so the expected result is a clean pass on the first run. A mismatch
// here names the exact property + expected/actual value, so it points straight at its own fix —
// no pixel-diff heatmap loop needed for this half; see calib/wireframe_diff.py for the pixel-level
// half that catches structural drift computed styles can't (missing/misplaced elements).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS, settleForCapture,
  toRecords, writeReport, recheck, printRecheck } from './wireframe_diff_lib.mjs';

const REPORT_PATH = 'test/output/wireframe_diff_report.json';

const ROOT = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const d = await readFile(path.join(ROOT, u.slice(1)));
    const ext = path.extname(u);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.otf': 'font/otf' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const port = server.address().port;

const VIEWPORT = { width: 1440, height: 900 };
// wireframe selector -> [app selector, human label]. One row per topbar/sidebar/grid element
// class named in the plan.
const PAIRS = {
  '.topbar': ['#lib-top', 'topbar'],
  '.search': ['.lib-search-wrap', 'search pill'],
  '.search input': ['.lib-search-wrap input', 'search input'],
  '.viewtoggle': ['.lib-viewtoggle', 'view toggle'],
  '.pillbtn': ['.lib-pill', 'pill button'],
  '.btn-export': ['.lib-btn-export', 'export button'],
  '.flagrow': ['.lib-flagrow', 'flag row'],
  '.sidebar': ['#lib-side', 'sidebar'],
  '.sec-head': ['.lib-coll-heading', 'section eyebrow'],
  '.row:not(.sel)': ['.lib-coll-row:not(.on)', 'sidebar row'],
  '.row.sel': ['.lib-coll-row.on', 'selected sidebar row'],
  '.card': ['.lib-card .lib-thumb-wrap', 'grid card'],
  '.statusbar': ['#lib-bottom', 'status bar'],
};
const PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight',
  'backgroundColor', 'color', 'borderRadius', 'borderColor', 'borderWidth', 'boxShadow', 'height'];

function near(a, b) {
  // font-size/height etc come back as "16px" — allow +/-1px for sub-pixel layout noise.
  const na = parseFloat(a), nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb) && /px$/.test(a) && /px$/.test(b)) return Math.abs(na - nb) <= 1;
  return a === b;
}

// selectorMap: { key -> actual CSS selector to query }. Returns { key -> styles|null }.
async function extract(page, selectorMap) {
  return page.evaluate(({ selectorMap, PROPS }) => {
    const out = {};
    for (const [key, sel] of Object.entries(selectorMap)) {
      const el = document.querySelector(sel);
      if (!el) { out[key] = null; continue; }
      const cs = getComputedStyle(el);
      out[key] = Object.fromEntries(PROPS.map((p) => [p, cs[p]]));
    }
    return out;
  }, { selectorMap, PROPS });
}

// Structural DOM signature per pair: descendant tag+class shape and own text, independent of
// computed style. Catches what extract() above cannot — a missing/extra child node (e.g. a
// `<span class="dayname">`), not just a wrong colour/size on an element both sides do have.
// This is the gap that let the day-of-week label and card-filename mismatches through a
// style-only diff undetected.
async function extractStructure(page, selectorMap) {
  return page.evaluate(({ selectorMap }) => {
    const sig = (el) => {
      if (!el) return null;
      const descendants = Array.from(el.querySelectorAll('*'))
        .map((d) => `${d.tagName.toLowerCase()}${d.className && typeof d.className === 'string' ? '.' + d.className.trim().split(/\s+/).join('.') : ''}`)
        .sort();
      const ownText = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return { childCount: el.children.length, descendantCount: descendants.length, descendants, ownText };
    };
    const out = {};
    for (const [key, sel] of Object.entries(selectorMap)) out[key] = sig(document.querySelector(sel));
    return out;
  }, { selectorMap });
}

// Content-based, not class-name-based: the app's markup uses its own `.lib-*` class names
// throughout, so comparing literal class strings between wireframe and app false-positives on
// every element (tried and reverted, see the call site's comment). Comparing rendered TEXT
// content for a specific expected substring is robust to that renaming and still catches a
// genuinely dropped concept, like the day row's "· Sun" weekday suffix.
function diffDayRowWeekday(theme, w, a) {
  const out = [];
  if (!w || !a) return out;
  const wHasWeekday = /·\s*(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/i.test(w.ownText);
  const aHasWeekday = /·\s*(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/i.test(a.ownText);
  if (wHasWeekday && !aHasWeekday) {
    out.push(`[${theme}] By Date day row: wireframe shows a weekday suffix ("${w.ownText}"), app does not ("${a.ownText}")`);
  }
  return out;
}

const b = await chromium.launch({ args: DETERMINISTIC_LAUNCH_ARGS });
let mismatches = [];
let missing = [];

for (const theme of ['dark', 'light']) {
  const wf = await b.newPage({ viewport: VIEWPORT, ...DETERMINISTIC_CONTEXT_OPTIONS });
  await wf.goto(`http://127.0.0.1:${port}/chromasmith-design/project/Library%20View.html`, { waitUntil: 'load' });
  if (theme === 'dark') await wf.evaluate(() => document.getElementById('app').classList.add('dark'));
  await settleForCapture(wf);
  const wfSelMap = Object.fromEntries(Object.keys(PAIRS).map((k) => [k, k]));
  const wfStyles = await extract(wf, wfSelMap);
  // The By Date tree is real JS, not a static image — its day rows (`.row.sub`) are expanded by
  // DEFAULT here (`.date-group.collapsed` is the toggled-OFF state, confirmed by reading the
  // wireframe's own CSS/JS rather than assuming), so no click is needed to see the "· Sun"
  // weekday suffix. Verify this assumption stays true if the wireframe file ever changes.
  const wfDayRow = await extractStructure(wf, { dayrow: '.row.sub' });
  await wf.screenshot({ path: `test/output/wireframe_${theme}.png`, fullPage: false });
  await wf.close();

  const app = await b.newPage({ viewport: VIEWPORT, ...DETERMINISTIC_CONTEXT_OPTIONS });
  app.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await app.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=60`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await app.waitForTimeout(2000);
  await settleForCapture(app);
  await app.evaluate((light) => {
    document.getElementById('lib-overlay')?.classList.toggle('lib-light', light);
    document.querySelector('.lib-coll-row')?.classList.add('on'); // ensure a .on row exists to sample
    // Dismiss the base app's first-run "Welcome to Chromasmith" modal — unrelated to the
    // Library and otherwise covers most of the viewport in a fresh harness run.
    document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); });
    document.querySelector('[class*="welcome"] [class*="close"], [id*="welcome"] [class*="close"]')?.click();
  }, theme === 'light');
  await app.waitForTimeout(200);
  const appSel = Object.fromEntries(Object.entries(PAIRS).map(([wfSel, [appSelector]]) => [wfSel, appSelector]));
  const appStyles = await extract(app, appSel);
  // Expand the app's own By Date tree the same way a user would (click the toggle), rather than
  // assuming its default state — this is the app equivalent of the wireframe expand-check above.
  const hasDateSection = await app.evaluate(() => !!document.querySelector('[data-date-tree-toggle]'));
  if (!hasDateSection) {
    console.log(`[${theme}] WARNING: By Date section did not render in ?libtest=1 (dateCounts.days` +
      ' is empty in the mock) — the day-row weekday check is SKIPPED, not passing, this run.');
  }
  await app.evaluate(() => document.querySelector('[data-date-tree-toggle]')?.click());
  await app.waitForTimeout(150);
  await app.evaluate(() => document.querySelectorAll('[data-chev-toggle]').forEach((c) => c.click()));
  await app.waitForTimeout(150);
  // A day (leaf) row still carries `data-date-toggle=""` (empty — see dateTreeHtml's `row()`),
  // so it must be matched by the empty value, not by the attribute's absence.
  const appDayRow = hasDateSection
    ? await extractStructure(app, { dayrow: '.lib-tree-row[data-date-toggle=""]:not([data-date-scope="date-nodate"])' })
    : { dayrow: null };
  await app.screenshot({ path: `test/output/app_${theme}.png`, fullPage: false });
  await app.close();

  for (const [wfSel, [appSelector, label]] of Object.entries(PAIRS)) {
    const w = wfStyles[wfSel], a = appStyles[wfSel];
    if (!w) continue; // wireframe itself has no such element in this theme (shouldn't happen)
    if (!a) { missing.push(`[${theme}] ${label} (${appSelector}) — not found in app`); continue; }
    for (const p of PROPS) {
      if (!near(w[p], a[p])) mismatches.push(`[${theme}] ${label}: ${p} — wireframe "${w[p]}" vs app "${a[p]}"`);
    }
    // NOTE: a raw class-name structural diff was tried here and dropped — the app's markup uses
    // its own `.lib-*`-prefixed class names throughout, so a naive descendant-class comparison
    // flags nearly every element as "missing" even where the visual/semantic equivalent exists
    // under a different name (PAIRS above is exactly the hand-built map for that reason). Only
    // the day-row check below is targeted enough (both sides mapped, checking for a genuinely
    // absent CONCEPT — a weekday suffix — not a differently-named class) to be worth keeping.
  }
  if (appDayRow.dayrow) mismatches.push(...diffDayRowWeekday(theme, wfDayRow.dayrow, appDayRow.dayrow));
  else missing.push(`[${theme}] By Date day row — could not check (By Date section did not render in the harness)`);
}
await b.close();
server.close();

console.log(`wireframe_diff: ${mismatches.length} style mismatches, ${missing.length} missing elements`);
if (missing.length) { console.log('\nMissing:'); missing.forEach((m) => console.log('  ' + m)); }
if (mismatches.length) { console.log('\nMismatches:'); mismatches.forEach((m) => console.log('  ' + m)); }

// Repair loop: compare this run's records against the LAST run's saved report before
// overwriting it, so applying a fix and re-running actually tells you resolved/persisting/new
// instead of requiring a by-eye diff of two console dumps.
const records = toRecords(mismatches, missing);
const rc = await recheck(REPORT_PATH, records);
printRecheck(rc);
await writeReport(REPORT_PATH, records);

console.log(mismatches.length === 0 && missing.length === 0 ? 'RESULT: PASS' : 'RESULT: SEE ABOVE');
