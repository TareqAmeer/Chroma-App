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
  // 2026-09-09 (3.1.1): the app now has a real wrapper (.fx-undogrp) matching the wireframe's
  // .undogrp — was pointed at #fx-deskbar as a stand-in before this existed.
  '.tb-left .undogrp': { app: '.fx-undogrp', label: 'undo/redo cluster', zone: 'topbar' },
  '.zoomctl': { app: '#fx-zoom-ctrl', label: 'zoom control', zone: 'zoom' },
  // 2026-09-09: Tools/View/⋯ merged into one settings gear docked at the far right (after
  // Export, matching the Library top bar's own order) — #fx-tools no longer exists standalone.
  '#btn-tools': { app: '#fx-settings .fx-db', label: 'Settings button (was Tools)', zone: 'topbar' },
  '#btn-allfx': { app: '.js-allfx', label: 'All FX button', zone: 'topbar' },
  '.btn-export': { app: '#btn-fx-export, [onclick*="exportFX"]', label: 'Export button', zone: 'topbar' },
  '.rail': { app: '#fx-toolrail', label: 'tool rail', zone: 'rail' },
  '.toolpanel': { app: '.fx-panel', label: 'tool panel', zone: 'panel' },
  '.filmstrip': { app: '#lib-overlay:not(.full)', label: 'filmstrip (docked library)', zone: 'filmstrip' },
  '.statusbar': { app: '#fx-statusbar', label: 'status bar', zone: 'statusbar' }, // app equivalent added in Phase F — until then this is a real "missing" finding, not a placeholder mapping
  // 2026-09-10 — first implemented panel of the redesign (docs/editor-redesign-plan.md). The
  // wireframe panel IS the spec now (Stage 4 merge, test/panel_proposals.mjs), so this maps its
  // real container straight to the app's real container rather than to any specific child —
  // per-control fidelity is what editor_wireframe_behaviour.mjs's new retouch tests check.
  '.tp-panel[data-panel="retouch"]': { app: '.fx-ctrl[data-fxsec="retouch"]', label: 'retouch panel', zone: 'retouch-panel' },
  // 2026-09-10 — Detail panel (Stage 4 merge). Unlike Retouch, this panel groups three
  // pre-existing app sections (nr/lens/deconv) rather than one — no single app container spans
  // them, so each wireframe .grp maps to its own real .fx-ctrl card.
  '.tp-panel[data-panel="detail"] .grp[data-fxsec="nr"]': { app: '.fx-ctrl[data-fxsec="nr"]', label: 'noise reduction section', zone: 'detail-panel' },
  '.tp-panel[data-panel="detail"] .grp[data-fxsec="lens"]': { app: '.fx-ctrl[data-fxsec="lens"]', label: 'lens correction section', zone: 'detail-panel' },
  '.tp-panel[data-panel="detail"] .grp[data-fxsec="deconv"]': { app: '.fx-ctrl[data-fxsec="deconv"]', label: 'deconvolution section', zone: 'detail-panel' },
  // 2026-09-10 — Film panel (Stage 4 merge). Same shape as Detail: five pre-existing app
  // sections (grain/hal/bloom/art/vig), no single app container spans them.
  '.tp-panel[data-panel="film"] .grp[data-fxsec="grain"]': { app: '.fx-ctrl[data-fxsec="grain"]', label: 'film grain section', zone: 'film-panel' },
  '.tp-panel[data-panel="film"] .grp[data-fxsec="hal"]': { app: '.fx-ctrl[data-fxsec="hal"]', label: 'halation section', zone: 'film-panel' },
  '.tp-panel[data-panel="film"] .grp[data-fxsec="bloom"]': { app: '.fx-ctrl[data-fxsec="bloom"]', label: 'bloom section', zone: 'film-panel' },
  '.tp-panel[data-panel="film"] .grp[data-fxsec="art"]': { app: '.fx-ctrl[data-fxsec="art"]', label: 'film artifacts section', zone: 'film-panel' },
  '.tp-panel[data-panel="film"] .grp[data-fxsec="vig"]': { app: '.fx-ctrl[data-fxsec="vig"]', label: 'vignette section', zone: 'film-panel' },
  // 2026-09-10 — Frame panel (Stage 4 merge). Two pre-existing app sections (borders, canvas).
  '.tp-panel[data-panel="frame"] .grp[data-fxsec="borders"]': { app: '.fx-ctrl[data-fxsec="borders"]', label: 'border section', zone: 'frame-panel' },
  '.tp-panel[data-panel="frame"] .grp[data-fxsec="canvas"]': { app: '.fx-ctrl[data-fxsec="canvas"]', label: 'canvas section', zone: 'frame-panel' },
  // 2026-09-10 — Crop panel (Stage 4 merge). One real app section (crop), regrouped into
  // "Aspect ratio" / "Transform" subheads within the same card — see spec CR1 for why the
  // aspect-ratio picker itself (chips, not the proposal's checklist) was kept as-is.
  '.tp-panel[data-panel="crop"] .grp[data-fxsec="crop"]': { app: '.fx-ctrl[data-fxsec="crop"]', label: 'crop panel', zone: 'crop-panel' },
  // 2026-09-10 — Export panel (Stage 4 merge). One real app section, but a much bigger one than
  // the proposal covers — Save/Load session, Styles, and Google Photos are real, shipped
  // features with no equivalent in the design at all (tracked as R11, not this pass's scope).
  '.tp-panel[data-panel="export"]': { app: '.fx-ctrl[data-fxsec="export"]', label: 'export panel', zone: 'export-panel' },
  // 2026-09-10 — Info panel (Stage 4 merge). #fx-info (EXIF)/#fx-people are dynamically built by
  // showExif()/fxRenderPeoplePanel() from real photo data — already in the metadata-then-people
  // order the user asked for, in an earlier fix that predates this redesign pass, so no app change
  // was needed here beyond confirming it. The wireframe's third group, Keywords, has no real
  // implementation yet (R12) — its backend exists (library-ui.js's addKeywordToPhoto/
  // removeKeywordFromPhoto/catalog_keywords) but is private to that file's closure, not bridged
  // to the Editor, so it is deliberately excluded from this mapping rather than compared against
  // nothing.
  '.tp-panel[data-panel="info"]': { app: '.fx-ctrl[data-fxsec="info"]', label: 'info panel', zone: 'info-panel' },
  // 2026-09-10 — Color panel (Stage 4 merge). Four pre-existing app sections; wheels was
  // homeless (spec D2) until this pass wired it into FX_GROUPS.color.members.
  '.tp-panel[data-panel="color"] .grp[data-fxsec="curves"]': { app: '.fx-ctrl[data-fxsec="curves"]', label: 'tone curves section', zone: 'color-panel' },
  '.tp-panel[data-panel="color"] .grp[data-fxsec="hsl"]': { app: '.fx-ctrl[data-fxsec="hsl"]', label: 'color mixer section', zone: 'color-panel' },
  '.tp-panel[data-panel="color"] .grp[data-fxsec="pointcolor"]': { app: '.fx-ctrl[data-fxsec="pointcolor"]', label: 'point color section', zone: 'color-panel' },
  '.tp-panel[data-panel="color"] .grp[data-fxsec="wheels"]': { app: '.fx-ctrl[data-fxsec="wheels"]', label: 'colour wheels section', zone: 'color-panel' },
};
// T9 (editor_ux_spec.json): 'width' added 2026-09-10 — a row could match on every OTHER
// property yet still be visibly cramped or oversized because its spacing drifted from the
// wireframe, with no gate on that class of regression at all before this.
// ⚠️ 'padding'/'gap' were also added and immediately found 41 findings across nearly every
// panel — the app consistently uses container padding (e.g. 10px on `.grp`) where the wireframe
// consistently uses gap-with-no-padding on the equivalent wrapper. That is a real, repo-wide
// convention difference, not 41 independent bugs, but it's a DESIGN question (which convention
// is actually correct) this tool has no way to answer and this session has no context to decide
// — per explicit user decision, dropped back out of PROPS rather than guessed at or broadly
// allowlisted. Re-add once someone with wireframe/design context has ruled on it; see this
// commit's message for the full finding list.
const PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight',
  'backgroundColor', 'color', 'borderRadius', 'borderColor', 'borderWidth', 'boxShadow', 'height',
  'width'];

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
  width: ['width'],
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
    // ⚠️ RESOLVED 2026-09-10 (was UNRESOLVED as of 2026-09-08 — see test/editor_gates.mjs's E7
    // comment for the full repro/fix). The forced reflow below was a partial, luck-based
    // mitigation for the wrong theory (body.light/--txt WERE always correct — never the cause).
    // The real cause was an in-flight CSS transition on #fx-deskbar's inherited `color` surviving
    // settleForCapture()'s `transition-duration:0` override, which only blocks FUTURE
    // transitions per spec. Fixed at the source in test/wireframe_diff_lib.mjs's
    // settleForCapture() (forces every in-flight Animation to .finish()), not here. The reflow
    // below is left in as harmless belt-and-suspenders, not load-bearing any more.
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
