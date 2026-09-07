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

const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
let mismatches = [];
let missing = [];

for (const theme of ['dark', 'light']) {
  const wf = await b.newPage({ viewport: VIEWPORT });
  await wf.goto(`http://127.0.0.1:${port}/chromasmith-design/project/Library%20View.html`, { waitUntil: 'load' });
  if (theme === 'dark') await wf.evaluate(() => document.getElementById('app').classList.add('dark'));
  const wfStyles = await extract(wf, Object.fromEntries(Object.keys(PAIRS).map((k) => [k, k])));
  await wf.screenshot({ path: `test/output/wireframe_${theme}.png`, fullPage: false });
  await wf.close();

  const app = await b.newPage({ viewport: VIEWPORT });
  app.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await app.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=60`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await app.waitForTimeout(2000);
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
  await app.screenshot({ path: `test/output/app_${theme}.png`, fullPage: false });
  await app.close();

  for (const [wfSel, [appSelector, label]] of Object.entries(PAIRS)) {
    const w = wfStyles[wfSel], a = appStyles[wfSel];
    if (!w) continue; // wireframe itself has no such element in this theme (shouldn't happen)
    if (!a) { missing.push(`[${theme}] ${label} (${appSelector}) — not found in app`); continue; }
    for (const p of PROPS) {
      if (!near(w[p], a[p])) mismatches.push(`[${theme}] ${label}: ${p} — wireframe "${w[p]}" vs app "${a[p]}"`);
    }
  }
}
await b.close();
server.close();

console.log(`wireframe_diff: ${mismatches.length} style mismatches, ${missing.length} missing elements`);
if (missing.length) { console.log('\nMissing:'); missing.forEach((m) => console.log('  ' + m)); }
if (mismatches.length) { console.log('\nMismatches:'); mismatches.forEach((m) => console.log('  ' + m)); }
console.log(mismatches.length === 0 && missing.length === 0 ? 'RESULT: PASS' : 'RESULT: SEE ABOVE');
