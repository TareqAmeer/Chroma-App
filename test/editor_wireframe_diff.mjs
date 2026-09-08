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
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS, settleForCapture,
  toRecords, writeReport, recheck, printRecheck } from './wireframe_diff_lib.mjs';

const REPORT_PATH = 'test/output/editor_wireframe_diff_report.json';
// ⚠️ 2026-09-08: this used to gate on REGRESSIONS ONLY — compare against the previous run's
// report, then overwrite that same report in the same run, so a new defect failed exactly once
// and read as "persisting" (exit 0) forever after; on a clean checkout the report doesn't exist,
// recheck() returns null, and it always exited 0. This is the EXACT bug found and fixed in
// Library's wireframe_inventory.mjs — same root cause, same fix, applied here before Editor
// alignment work starts so the same "9 fixed" -> "14 more reported" trust collapse can't repeat.
// The ~59-item backlog this file already had is seeded verbatim (exact string match, not a
// pattern) into editor_wireframe_accepted.json as explicitly UNTRIAGED — not silently accepted
// as fine, just not re-litigated by this tooling-only pass. Remove an entry once its item is
// actually addressed or confirmed intentional.
let ACCEPTED = [];
try { ACCEPTED = JSON.parse(await readFile('test/editor_wireframe_accepted.json', 'utf8')); } catch { /* none yet */ }
function isAccepted(finding) {
  return ACCEPTED.some((a) => a.exact ? finding === a.match : finding.includes(a.match));
}
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

const b = await chromium.launch({ args: DETERMINISTIC_LAUNCH_ARGS });
let mismatches = [];
let missing = [];
let notes = [];

for (const theme of ['dark', 'light']) {
  const wf = await b.newPage({ viewport: VIEWPORT, ...DETERMINISTIC_CONTEXT_OPTIONS });
  await wf.goto(`http://127.0.0.1:${port}/chromasmith-design/project/Editor%20(Developer)%20View.dc.html`, { waitUntil: 'load' });
  if (theme === 'light') await wf.evaluate(() => document.getElementById('app')?.classList.add('light'));
  await settleForCapture(wf);
  const wfSelMap = Object.fromEntries(Object.keys(PAIRS).map((k) => [k, k]));
  const wfStyles = await extract(wf, wfSelMap);
  const wfRail = await railLabels(wf, '.rail');
  await wf.screenshot({ path: `test/output/editor_wireframe_${theme}.png`, fullPage: false });
  await wf.close();

  const app = await b.newPage({ viewport: VIEWPORT, ...DETERMINISTIC_CONTEXT_OPTIONS });
  app.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await app.goto(`http://127.0.0.1:${port}/chromasmith-22.html?deskx=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await app.waitForTimeout(1500);
  await app.evaluate(() => {
    // Dismiss the first-run "Welcome to Chromasmith" modal, unrelated to layout fidelity.
    document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); });
  });
  if (theme === 'light') await app.evaluate(() => { if (typeof toggleTheme === 'function' && !document.body.classList.contains('light')) toggleTheme(); });
  await app.waitForTimeout(200);
  await settleForCapture(app);
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

const allFindings = [...missing, ...mismatches];
const unaccepted = allFindings.filter((f) => !isAccepted(f));
const acceptedHit = allFindings.length - unaccepted.length;
console.log(`editor_wireframe_diff: ${mismatches.length} style/order mismatches, ${missing.length} missing elements (${acceptedHit} allowlisted in test/editor_wireframe_accepted.json)`);
const unaccMissing = missing.filter((f) => !isAccepted(f));
const unaccMismatches = mismatches.filter((f) => !isAccepted(f));
if (unaccMissing.length) { console.log('\nMissing:'); unaccMissing.forEach((m) => console.log('  ' + m)); }
if (unaccMismatches.length) { console.log('\nMismatches:'); unaccMismatches.forEach((m) => console.log('  ' + m)); }
if (acceptedHit) console.log(`\n  (+${acceptedHit} allowlisted findings suppressed)`);
notes.forEach((n) => console.log(n));

const records = toRecords(mismatches, missing);
const rc = await recheck(REPORT_PATH, records);
printRecheck(rc);
await writeReport(REPORT_PATH, records);

console.log(unaccepted.length ? '\nRESULT: FAIL' : '\nRESULT: PASS');
// HARD gate: fail on anything not explicitly allowlisted — see the comment on ACCEPTED above.
process.exit(unaccepted.length ? 1 : 0);
