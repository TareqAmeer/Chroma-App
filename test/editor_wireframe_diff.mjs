// Visual-fidelity check for the EDITOR view against its Claude Design source, mirroring
// test/wireframe_diff.mjs (Library). See the "Wireframe fidelity gate" memory: a diff tool for
// the Library view existed unused for 7 commits; this extends the same discipline to the Editor,
// which had NO automated check at all before this — every "Editor matches the wireframe" claim
// prior to this file was a code read, never a driven comparison.
//
// Loads the literal wireframe (chromasmith-design/project/Editor (Developer) View.dc.html) and
// the real app (chromasmith-22.html?deskx=1, the desktop one-tool-rail layout) side by side at
// the same viewport, in both themes, and reports a computed-style mismatch table + screenshots.
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
// wireframe selector -> [app selector, human label]. One row per topbar/rail/panel element
// named in UI_SPEC.md's Editor zones.
const PAIRS = {
  '.topbar': ['#fx-deskbar', 'topbar'],
  '.tb-left .undogrp': ['#fx-deskbar', 'undo/redo cluster'], // app has no wrapper box — see NOTE below
  '.zoomctl': ['#fx-zoom-ctrl', 'zoom control'],
  '#btn-tools': ['#fx-tools .fx-db', 'Tools button'],
  '#btn-allfx': ['.js-allfx', 'All FX button'],
  '.btn-export': ['#btn-fx-export, [onclick*="exportFX"]', 'Export button'],
  '.rail': ['#fx-toolrail', 'tool rail'],
  '.toolpanel': ['.fx-panel', 'tool panel'],
  '.filmstrip': ['#lib-overlay', 'filmstrip (docked library)'],
  '.statusbar': ['#fx-deskbar', 'status bar — NO EQUIVALENT, see NOTE'],
};
const PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight',
  'backgroundColor', 'color', 'borderRadius', 'borderColor', 'borderWidth', 'boxShadow', 'height'];

function near(a, b) {
  const na = parseFloat(a), nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb) && /px$/.test(a) && /px$/.test(b)) return Math.abs(na - nb) <= 1;
  return a === b;
}

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

// Rail item ORDER is the thing UI_SPEC.md names explicitly (Looks/Adjust/Color/Detail/Retouch/
// Masks/Film/Frame/Export/Info) — a computed-style diff on `.rail` as a whole can't see this,
// so extract the actual visible button label sequence from both sides.
async function railLabels(page, railSel) {
  return page.evaluate((sel) => {
    const rail = document.querySelector(sel);
    if (!rail) return null;
    return Array.from(rail.querySelectorAll('button')).map((b) => b.textContent.trim()).filter(Boolean);
  }, railSel);
}

const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
let mismatches = [];
let missing = [];
let notes = [];

for (const theme of ['dark', 'light']) {
  const wf = await b.newPage({ viewport: VIEWPORT });
  await wf.goto(`http://127.0.0.1:${port}/chromasmith-design/project/Editor%20(Developer)%20View.dc.html`, { waitUntil: 'load' });
  if (theme === 'light') await wf.evaluate(() => document.getElementById('app')?.classList.add('light'));
  const wfSelMap = Object.fromEntries(Object.keys(PAIRS).map((k) => [k, k]));
  const wfStyles = await extract(wf, wfSelMap);
  const wfRail = await railLabels(wf, '.rail');
  await wf.screenshot({ path: `test/output/editor_wireframe_${theme}.png`, fullPage: false });
  await wf.close();

  const app = await b.newPage({ viewport: VIEWPORT });
  app.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await app.goto(`http://127.0.0.1:${port}/chromasmith-22.html?deskx=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await app.waitForTimeout(1500);
  await app.evaluate(() => {
    // Dismiss the first-run "Welcome to Chromasmith" modal, unrelated to layout fidelity.
    document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); });
  });
  if (theme === 'light') await app.evaluate(() => { if (typeof toggleTheme === 'function' && !document.body.classList.contains('light')) toggleTheme(); });
  await app.waitForTimeout(200);
  const appSel = Object.fromEntries(Object.entries(PAIRS).map(([wfSel, [appSelector]]) => [wfSel, appSelector]));
  const appStyles = await extract(app, appSel);
  const appRail = await railLabels(app, '#fx-toolrail');
  await app.screenshot({ path: `test/output/editor_app_${theme}.png`, fullPage: false });
  await app.close();

  for (const [wfSel, [appSelector, label]] of Object.entries(PAIRS)) {
    const w = wfStyles[wfSel], a = appStyles[wfSel];
    if (!w) continue;
    if (!a) { missing.push(`[${theme}] ${label} (${appSelector}) — not found in app`); continue; }
    for (const p of PROPS) {
      if (!near(w[p], a[p])) mismatches.push(`[${theme}] ${label}: ${p} — wireframe "${w[p]}" vs app "${a[p]}"`);
    }
  }

  if (wfRail && appRail) {
    if (JSON.stringify(wfRail) !== JSON.stringify(appRail)) {
      mismatches.push(`[${theme}] rail order/content — wireframe [${wfRail.join(', ')}] vs app [${appRail.join(', ')}]`);
    }
  } else {
    missing.push(`[${theme}] rail labels — could not read one or both sides (wf:${!!wfRail} app:${!!appRail})`);
  }
}
await b.close();
server.close();

notes.push('CAVEAT: no photo is loaded in this harness (loading a real image needs the file-drop path,');
notes.push('  not wired up here yet) — the app hides #fx-zoom-ctrl/#fx-tools/gear until a photo is');
notes.push('  open (relocatePreviewTools), so "zoom control"/"Tools button" mismatches above may be');
notes.push('  comparing the wireframe against an app state that legitimately looks different, not a');
notes.push('  real bug. Treat those two pairs as unverified until a photo-loaded pass is added.');
notes.push('NOTE: ".statusbar" has no real app equivalent (mapped to #fx-deskbar as a placeholder) —');
notes.push('  the Editor topbar itself doubles as the deskbar; this pair exists to be visibly wrong');
notes.push('  until a real statusbar zone is confirmed to exist or not in the app, not silently skipped.');
notes.push('NOTE: ".filmstrip" is mapped to "#lib-overlay" per the plan\'s finding that the wireframe\'s');
notes.push('  filmstrip IS the docked Library overlay, not a separate #fx-filmstrip element.');

console.log(`editor_wireframe_diff: ${mismatches.length} style/order mismatches, ${missing.length} missing elements`);
if (missing.length) { console.log('\nMissing:'); missing.forEach((m) => console.log('  ' + m)); }
if (mismatches.length) { console.log('\nMismatches:'); mismatches.forEach((m) => console.log('  ' + m)); }
notes.forEach((n) => console.log(n));
console.log(mismatches.length === 0 && missing.length === 0 ? 'RESULT: PASS' : 'RESULT: SEE ABOVE');
