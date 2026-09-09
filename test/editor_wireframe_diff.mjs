// Visual-fidelity check for the EDITOR view against its Claude Design source, mirroring
// test/wireframe_diff.mjs (Library). See the "Wireframe fidelity gate" memory: a diff tool for
// the Library view existed unused for 7 commits; this extends the same discipline to the Editor,
// which had NO automated check at all before this — every "Editor matches the wireframe" claim
// prior to this file was a code read, never a driven comparison.
//
// Loads the literal wireframe (chromasmith-design/project/Editor (Developer) View.dc.html) and
// the real app (desktop/dist/index.html?libtest=1&deskx=1) side by side at the same viewport, in
// both themes, and reports a computed-style mismatch table + screenshots.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS, settleForCapture,
  toRecords, writeReport, recheck, printRecheck } from './wireframe_diff_lib.mjs';
import { loadAllowlist, isAccepted, hardGate } from './wireframe_checks_lib.mjs';

const REPORT_PATH = 'test/output/editor_wireframe_diff_report.json';
// Findings are ZONE-qualified as `[zone] [theme] label: prop — ...` so the shared allowlist's
// zone-scoped matching (wireframe_checks_lib.mjs) can't let a topbar waiver silence an identical
// rail finding — see that file's own comment for the Library bug this already caused once.
let ACCEPTED = [];
try { ACCEPTED = loadAllowlist(JSON.parse(await readFile('test/editor_wireframe_accepted.json', 'utf8'))); } catch { /* none yet */ }

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
// wireframe selector -> { app: appSelector, label, zone }. One row per topbar/rail/panel element
// named in UI_SPEC.md's Editor zones. `zone` drives allowlist scoping (see ACCEPTED above).
const PAIRS = {
  '.topbar': { app: '#fx-deskbar', label: 'topbar', zone: 'topbar' },
  '.tb-left .undogrp': { app: '#fx-deskbar', label: 'undo/redo cluster', zone: 'topbar' }, // app has no wrapper box — see NOTE below
  '.zoomctl': { app: '#fx-zoom-ctrl', label: 'zoom control', zone: 'zoom' },
  '#btn-tools': { app: '#fx-tools .fx-db', label: 'Tools button', zone: 'topbar' },
  '#btn-allfx': { app: '.js-allfx', label: 'All FX button', zone: 'topbar' },
  '.btn-export': { app: '#btn-fx-export, [onclick*="exportFX"]', label: 'Export button', zone: 'topbar' },
  '.rail': { app: '#fx-toolrail', label: 'tool rail', zone: 'rail' },
  '.toolpanel': { app: '.fx-panel', label: 'tool panel', zone: 'panel' },
  '.filmstrip': { app: '#lib-overlay:not(.full)', label: 'filmstrip (docked library)', zone: 'filmstrip' },
  '.statusbar': { app: '#fx-statusbar', label: 'status bar', zone: 'statusbar' }, // app equivalent added in Phase F — until then this is a real "missing" finding, not a placeholder mapping
};
const PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight',
  'backgroundColor', 'color', 'borderRadius', 'borderColor', 'borderWidth', 'boxShadow', 'height'];

function near(a, b) {
  const na = parseFloat(a), nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb) && /px$/.test(a) && /px$/.test(b)) return Math.abs(na - nb) <= 1;
  return a === b;
}
// Blink re-serializes `BlinkMacSystemFont` in a font stack as `"system-ui"`, so a wireframe stack
// naming BlinkMacSystemFont and an app stack naming system-ui can be the SAME stack reported as
// different strings. Normalize before comparing so that isn't a permanent false finding.
function normFont(f) { return (f || '').replace(/BlinkMacSystemFont/g, 'system-ui'); }

// ── Authored-property filter ────────────────────────────────────────────────────────────────
// The wireframe deliberately does not link _ds/tokens/base.css (the only file setting
// line-height), so it renders every element at the browser default line-height:normal. Diffing
// PROPS unconditionally therefore reports a permanent, unfixable "normal vs 24px" finding on
// every zone — 12 of the 59 pre-existing findings were exactly this. Rather than hand-listing
// line-height as a permanent exception (a hand-list is itself an unfalsifiable constant that
// drifts the moment the wireframe is re-exported — the "check that always passes" class,
// HANDOVER_EDITOR.md §4), this derives the exception from the wireframe's OWN cascade: walk its
// stylesheets for rules matching the element (and its ancestors, for inherited properties), and
// only assert a PROPS entry the wireframe actually declares somewhere in that chain.
const INHERITED = new Set(['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'color']);
// Map each camelCase PROPS name to the CSS longhand(s) that would satisfy it — Chrome enumerates
// shorthands into longhands in cssRules, so `border-bottom:1px solid X` never appears as
// `border-color` itself but does appear as `border-bottom-color`.
const LONGHANDS = {
  fontFamily: ['font-family'], fontSize: ['font-size'], fontWeight: ['font-weight'],
  letterSpacing: ['letter-spacing'], lineHeight: ['line-height'], color: ['color'],
  backgroundColor: ['background-color', 'background'],
  borderRadius: ['border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius'],
  borderColor: ['border-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'border'],
  borderWidth: ['border-width', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'],
  boxShadow: ['box-shadow'],
  height: ['height'],
};
async function authoredProps(page, selectorMap) {
  return page.evaluate(({ selectorMap, LONGHANDS, INHERITED }) => {
    INHERITED = new Set(INHERITED);
    function declaredOn(el) {
      const set = new Set();
      if (el.getAttribute && el.getAttribute('style')) {
        for (const prop of el.style) set.add(prop);
      }
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of rules) {
          if (!rule.selectorText || !rule.style) continue;
          try { if (!el.matches(rule.selectorText)) continue; } catch { continue; }
          for (const prop of rule.style) set.add(prop);
        }
      }
      return set;
    }
    const out = {};
    for (const [key, sel] of Object.entries(selectorMap)) {
      const el = document.querySelector(sel);
      if (!el) { out[key] = null; continue; }
      const authored = new Set();
      const propKeys = Object.keys(LONGHANDS);
      for (const propKey of propKeys) {
        const longhands = LONGHANDS[propKey];
        let node = el, found = false;
        do {
          const declared = declaredOn(node);
          if (longhands.some((lh) => declared.has(lh))) { found = true; break; }
          node = node.parentElement;
        } while (node && INHERITED.has(propKey) && !found);
        if (found) authored.add(propKey);
      }
      out[key] = Array.from(authored);
    }
    return out;
  }, { selectorMap, LONGHANDS, INHERITED: Array.from(INHERITED) });
}

async function extract(page, selectorMap) {
  return page.evaluate(({ selectorMap, PROPS }) => {
    // ⚠️ 2026-09-08, UNRESOLVED — kept in as a partial mitigation, not a fix. A targeted repro
    // (forcing a reflow then reading `#fx-deskbar`'s computed `color` right after a theme toggle
    // + photo load) found body.light correctly applied and --txt correctly resolving to the
    // light-theme value, yet the ELEMENT's computed `color` still intermittently reads the DARK
    // value — the custom property and the property derived from it can disagree, which shouldn't
    // be possible if the read were simply stale. Adding a forced reflow here appeared to fix it
    // 4/4 in a small sample, but a larger sample (8 more runs) still showed ~5/8 failing — the
    // earlier result was luck, not a fix. This is left in (harmless, occasionally helps) but the
    // [light/photo] color findings below must still be treated as genuinely flaky pending a
    // dedicated debugging session — see editor_ux_spec.json E7. Do NOT assume this comment block
    // means it's solved; it explicitly is not.
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
// Crop/Masks/Film/Frame/Export/Info) — a computed-style diff on `.rail` as a whole can't see this,
// so extract the actual visible button label sequence from both sides.
async function railLabels(page, railSel) {
  return page.evaluate((sel) => {
    const rail = document.querySelector(sel);
    if (!rail) return null;
    return Array.from(rail.querySelectorAll('button')).map((b) => b.textContent.trim()).filter(Boolean);
  }, railSel);
}

async function loadImage(page) {
  // Copies the fixture-drop mechanism from export_harness.mjs so #fx-zoom-ctrl/#fx-tools/gear —
  // inline display:none until a photo is open (relocatePreviewTools) — are actually measurable.
  const buf = await readFile(path.join(ROOT, 'test/fixtures/portrait.png'));
  const b64 = buf.toString('base64');
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'portrait.png', { type: 'image/png' });
    if (typeof window.loadFXImages === 'function') await window.loadFXImages([file]);
  }, b64);
  await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages && fxImages.length > 0, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);
}

const b = await chromium.launch({ args: DETERMINISTIC_LAUNCH_ARGS });
let mismatches = [];
let missing = [];
let notes = [];

// Runs the whole PAIRS/rail sweep once per {theme, photoState}, tagging every finding with which
// state produced it — the zoom-control/Tools-button pairs are meaningless without a photo loaded,
// and everything else should hold in BOTH states.
for (const theme of ['dark', 'light']) {
  const wf = await b.newPage({ viewport: VIEWPORT, ...DETERMINISTIC_CONTEXT_OPTIONS });
  await wf.goto(`http://127.0.0.1:${port}/chromasmith-design/project/Editor%20(Developer)%20View.dc.html`, { waitUntil: 'load' });
  if (theme === 'light') await wf.evaluate(() => document.getElementById('app')?.classList.add('light'));
  await settleForCapture(wf);
  const wfSelMap = Object.fromEntries(Object.keys(PAIRS).map((k) => [k, k]));
  const wfStyles = await extract(wf, wfSelMap);
  const wfAuthored = await authoredProps(wf, wfSelMap);
  const wfRail = await railLabels(wf, '.rail');
  await wf.screenshot({ path: `test/output/editor_wireframe_${theme}.png`, fullPage: false });
  await wf.close();

  for (const photoState of ['no-photo', 'photo']) {
    const app = await b.newPage({ viewport: VIEWPORT, ...DETERMINISTIC_CONTEXT_OPTIONS });
    app.on('pageerror', (e) => console.log('[pageerror]', e.message));
    // ⚠️ 2026-09-08: was chromasmith-22.html?deskx=1 (repo root) — that document never loads
    // desktop/library-ui.js, so #lib-overlay does not exist in it (the "filmstrip … not found"
    // findings were a harness artifact). It also never sets window.__TAURI__, so
    // _eachSection()/fxDesktopFoldImageIntoLooks() keep the 'image' rail item the real desktop
    // app drops — an artifact rail-order finding. desktop/dist/index.html?libtest=1&deskx=1 is
    // what library_responsive_qa.mjs already uses — ?libtest=1 stubs window.__TAURI__ AND loads
    // library-ui.js (library-ui.js:13-15,525), fixing both with no app change. Needs
    // `bash build-desktop.sh` first (verify.py does this).
    await app.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await app.waitForTimeout(1500);
    await app.evaluate(() => {
      // Dismiss the first-run "Welcome to Chromasmith" modal, unrelated to layout fidelity.
      document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); });
      // The rail is first built by applyFxLayout() at the main script's top-level execution
      // (chromasmith-22.html:20427) — BEFORE library-ui.js's <script src> tag (which stubs
      // window.__TAURI__ under ?libtest=1) has even loaded. So the FIRST rail build always sees
      // __TAURI__ undefined and keeps the 'image' item real desktop users never get. Re-invoke it
      // now that library-ui.js has definitely run, so the harness measures the rail the way the
      // shipped desktop app actually builds it.
      if (typeof applyFxLayout === 'function') applyFxLayout();
    });
    // ⚠️ CORRECTION (found while building editor_wireframe_inventory.mjs): the intermittent
    // "light theme color findings" flake below was mis-attributed to generic SwiftShader/
    // Chromium flakiness. The real cause is chromasmithForceLibraryReady() (library-ui.js:5655),
    // which forces the Library into its FULL window takeover (body.lib-full, which hides
    // #fx-deskbar entirely) as a splash-hiding fallback if a boot watchdog fires before boot
    // settles — a TIMING race against this harness's own waits, not app flakiness. When it wins,
    // every computed style this file reads comes from whatever's left visible under the Library
    // overlay, not the editor — producing spurious-looking mismatches on EVERY property, not
    // just color; color was just the one that happened to get reported first. Escape reliably
    // exits full-view (library-ui.js:5924) regardless of which side of the race fired.
    await app.keyboard.press('Escape');
    await app.waitForTimeout(150);
    if (theme === 'light') {
      await app.evaluate(() => { if (typeof toggleTheme === 'function' && !document.body.classList.contains('light')) toggleTheme(); });
      let applied = await app.waitForFunction(() => document.body.classList.contains('light'), { timeout: 3000 }).then(() => true).catch(() => false);
      if (!applied) {
        // One retry of the toggle itself before treating it as a real finding.
        await app.evaluate(() => { if (typeof toggleTheme === 'function' && !document.body.classList.contains('light')) toggleTheme(); });
        applied = await app.waitForFunction(() => document.body.classList.contains('light'), { timeout: 3000 }).then(() => true).catch(() => false);
        if (!applied) console.log(`[warn] [${theme}/${photoState}] light theme did not apply after retry — findings this state may be spurious`);
      }
    }
    if (photoState === 'photo') await loadImage(app);
    await app.waitForTimeout(200);
    await settleForCapture(app);
    const appSel = Object.fromEntries(Object.entries(PAIRS).map(([wfSel, p]) => [wfSel, p.app]));
    const appStyles = await extract(app, appSel);
    const appRail = await railLabels(app, '#fx-toolrail');
    await app.screenshot({ path: `test/output/editor_app_${theme}_${photoState}.png`, fullPage: false });
    await app.close();

    const stateTag = `[${theme}/${photoState}]`;
    for (const [wfSel, { app: appSelector, label, zone }] of Object.entries(PAIRS)) {
      const w = wfStyles[wfSel], a = appStyles[wfSel];
      const authored = wfAuthored[wfSel] || [];
      if (!w) continue;
      if (!a) { missing.push(`[${zone}] ${stateTag} ${label} (${appSelector}) — not found in app`); continue; }
      for (const p of PROPS) {
        if (!authored.includes(p)) continue; // wireframe never authors this property — assert only what it declares
        const wv = p === 'fontFamily' ? normFont(w[p]) : w[p];
        const av = p === 'fontFamily' ? normFont(a[p]) : a[p];
        if (!near(wv, av)) mismatches.push(`[${zone}] ${stateTag} ${label}: ${p} — wireframe "${w[p]}" vs app "${a[p]}"`);
      }
    }

    if (wfRail && appRail) {
      if (JSON.stringify(wfRail) !== JSON.stringify(appRail)) {
        mismatches.push(`[rail] ${stateTag} rail order/content — wireframe [${wfRail.join(', ')}] vs app [${appRail.join(', ')}]`);
      }
    } else {
      missing.push(`[rail] ${stateTag} rail labels — could not read one or both sides (wf:${!!wfRail} app:${!!appRail})`);
    }
  }
}
await b.close();
server.close();

notes.push('NOTE: every sweep now runs against desktop/dist/index.html?libtest=1&deskx=1, in both');
notes.push('  a no-photo and a photo-loaded state (test/fixtures/portrait.png) — findings are tagged');
notes.push('  [theme/photoState]. zoom-control findings from the no-photo state reflect');
notes.push('  #fx-zoom-ctrl legitimately being display:none (relocatePreviewTools), not a bug.');
notes.push('NOTE: ".statusbar" has no app equivalent yet (#fx-statusbar does not exist until the');
notes.push('  status bar is built) — this is a real, expected "missing" finding until then.');
notes.push('NOTE: ".filmstrip" is mapped to "#lib-overlay:not(.full)" — the wireframe\'s filmstrip IS');
notes.push('  the docked Library overlay, not a separate #fx-filmstrip element (that element is');
notes.push('  unused under deskx — see CLAUDE.md).');

const allFindings = [...missing, ...mismatches];
console.log(`editor_wireframe_diff: ${mismatches.length} style/order mismatches, ${missing.length} missing elements`);
notes.forEach((n) => console.log(n));
console.log('');

const records = toRecords(mismatches, missing);
const rc = await recheck(REPORT_PATH, records);
printRecheck(rc);
await writeReport(REPORT_PATH, records);

const ok = await hardGate(allFindings, ACCEPTED, null, {});
process.exit(ok ? 0 : 1);
