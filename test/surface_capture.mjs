// As-built wireframe capture (docs/ui-workflow/STATE.md S6). For every surface in a
// design/surfaces.json `group`, and every state that S5's surface_inventory.mjs recorded as
// having actually fired, this:
//   1. drives the live app into that surface+state (same open/driver steps as surface_inventory)
//   2. screenshots the surface root -> design/asbuilt/<id>/<state>.webp
//   3. walks the surface's DOM, records computed values for a curated CSS-property set, maps
//      each value to a design/tokens.json token by VALUE + property-role family (S1(a)'s
//      role-aware match — not `_ds` var() names, which S1 found unusable), and writes
//      design/asbuilt/<id>/spec.json (element tree + unmapped list)
//   4. writes design/asbuilt/<id>/block.dc.html — the surface's real outerHTML (rest state),
//      wrapped in a `.tp-panel[data-panel]` shell matching "Editor (Developer) View.dc.html"'s
//      structure. Generated straight from the live DOM, never hand-authored.
//
//   5. LAYOUT MATRIX (docs/ui-workflow/STATE.md, second S6-extension pass): for every state x
//      theme (dark/light, via the app's real fxSetTheme()) x width (test/editor_responsive_qa.mjs's
//      VIEWPORTS + 768 + 390) x sidebar (expanded/collapsed for Editor, docked/full for Library,
//      n/a elsewhere) combination, screenshots the surface, content-addresses the image by sha256
//      into design/asbuilt-full/<id>/ (gitignored — thousands of images), records the combo->hash
//      mapping in spec.json's `matrix`, and builds a labelled contact-sheet grid per theme at
//      design/asbuilt/<id>/contact-<theme>.webp (committed). Resumable: combos already in
//      spec.json's matrix are skipped on a re-run.
//   6. SCENARIO STATES: a fixed set of named states (keyboard focus, portrait/landscape/panorama
//      photo, RAW/video loaded, masks, export progress, split/loupe/crop, Library states, mobile
//      states, zoom/forced-colors/reduced-motion, WebKit) applied only to the specific surface(s)
//      each one is about (panel-fx, library, mobile-sheet — see SCENARIOS below), at 1400x900,
//      both themes. Recorded in spec.json's `scenarios`.
//
// Usage:
//   node test/surface_capture.mjs --group=A
//   node test/surface_capture.mjs --group=A --id=fxsec-looks   # one surface, debugging
//   node test/surface_capture.mjs --group=A --no-matrix         # phases 1-4 only (fast)
//   node test/surface_capture.mjs --group=A --smoke             # tiny matrix (2 themes x 2
//                                                                 widths x first 2 states) to
//                                                                 validate the mechanism fast
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS, settleForCapture } from './wireframe_diff_lib.mjs';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const GROUP = (argv.find((a) => a.startsWith('--group=')) || '').split('=')[1];
const ONLY_ID = (argv.find((a) => a.startsWith('--id=')) || '').split('=')[1] || null;
const NO_MATRIX = argv.includes('--no-matrix');
const SMOKE = argv.includes('--smoke');
if (!GROUP) { console.error('usage: node test/surface_capture.mjs --group=A [--id=...] [--no-matrix] [--smoke]'); process.exit(1); }

const surfacesDoc = JSON.parse(await readFile(path.join(ROOT, 'design/surfaces.json'), 'utf8'));
const allSelected = surfacesDoc.surfaces.filter((s) => s.group === GROUP && (!ONLY_ID || s.id === ONLY_ID));
if (!allSelected.length) { console.error(`no surfaces with group=${GROUP}`); process.exit(1); }

// splash has no live DOM route (surfaces.json: `opened: null`, "no live DOM route — first-load
// native splash") — per the user, use the existing wireframe as its as-built stand-in instead of
// attempting to capture it live. Copy it verbatim rather than drive a page that doesn't exist.
const splashEntry = allSelected.find((s) => s.id === 'splash');
const targets = allSelected.filter((s) => s.id !== 'splash');
if (splashEntry) {
  const wireframeName = 'Splash Screen.html';
  const wireframePath = path.join(ROOT, 'chromasmith-design/project', wireframeName);
  const dir = path.join(ROOT, 'design/asbuilt/splash');
  await mkdir(dir, { recursive: true });
  try {
    const html = await readFile(wireframePath, 'utf8');
    await writeFile(path.join(dir, 'block.dc.html'), html);
    await writeFile(path.join(dir, 'spec.json'), JSON.stringify({
      id: 'splash', group: splashEntry.group, generatedAt: new Date().toISOString(),
      note: `No live DOM route to capture — this surface is the "${wireframeName}" wireframe used verbatim as its as-built stand-in, per user instruction. No screenshots, no computed-value spec.`,
      wireframeSource: `chromasmith-design/project/${wireframeName}`,
    }, null, 2));
    console.log(`[splash] copied ${wireframeName} as stand-in (no live capture)`);
  } catch (e) {
    console.log(`[splash] FAILED to copy stand-in: ${e.message}`);
  }
}
if (!targets.length && !splashEntry) { console.error(`no surfaces with group=${GROUP}`); process.exit(1); }
if (!targets.length) { console.log('no live-capturable surfaces in this group (splash-only); done.'); process.exit(0); }

// ── token index (design/tokens.json, DTCG) ─────────────────────────────────────────────────────
const tokensDoc = JSON.parse(await readFile(path.join(ROOT, 'design/tokens.json'), 'utf8'));
const TOKENS = [];
(function walk(o, p) {
  if (!o || typeof o !== 'object') return;
  if (o.$value !== undefined && o.$extensions) {
    const ext = o.$extensions.chromasmith || {};
    TOKENS.push({ path: p, type: o.$type, value: o.$value, role: ext.role || null, appVar: ext.appVar || null, modes: ext.modes || null });
  } else {
    for (const k of Object.keys(o)) if (!k.startsWith('$')) walk(o[k], p + '/' + k);
  }
})(tokensDoc, '');

// property -> role-family prefix, per S3/S1(a)'s role-aware mapping (fontSize->typography,
// padding/gap->spacing, radius->radius, colors->color.*). Only these get token-matched; anything
// else (transform, z-index, etc.) is never captured.
const PROP_ROLE_FAMILY = {
  color: 'color', backgroundColor: 'color', borderColor: 'color', outlineColor: 'color',
  fontSize: 'typography', fontWeight: 'typography', fontFamily: 'typography', lineHeight: 'typography', letterSpacing: 'typography',
  paddingTop: 'spacing', paddingRight: 'spacing', paddingBottom: 'spacing', paddingLeft: 'spacing', gap: 'spacing', rowGap: 'spacing', columnGap: 'spacing',
  borderRadius: 'radius', borderTopLeftRadius: 'radius', borderTopRightRadius: 'radius', borderBottomLeftRadius: 'radius', borderBottomRightRadius: 'radius',
  transitionDuration: 'motion', transitionTimingFunction: 'motion',
  boxShadow: 'elevation',
};
const CAPTURED_PROPS = Object.keys(PROP_ROLE_FAMILY);

function normColor(v) {
  // rgb(a)(...) -> lowercase hex when fully opaque, else keep rgba as-is for comparison.
  const m = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/.exec(v || '');
  if (!m) return (v || '').toLowerCase();
  const [, r, g, b, a] = m;
  if (a !== undefined && parseFloat(a) < 1) return `rgba(${r}, ${g}, ${b}, ${a})`;
  return '#' + [r, g, b].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toLowerCase();
}
function normValue(prop, v) {
  if (PROP_ROLE_FAMILY[prop] === 'color') return normColor(v);
  return (v || '').trim().toLowerCase();
}

function matchToken(prop, value) {
  const family = PROP_ROLE_FAMILY[prop];
  if (!family || value === '' || value == null) return null;
  const nv = normValue(prop, value);
  for (const t of TOKENS) {
    if (!t.role || !t.role.startsWith(family === 'color' ? '' : family)) {
      // color tokens' role strings don't all start with "color." (e.g. "surface.page",
      // "text.primary") — for color family, match by $type==='color' instead of role prefix.
      if (!(family === 'color' && t.type === 'color')) continue;
    }
    const candidates = [t.value, ...(t.modes ? Object.values(t.modes) : [])];
    for (const c of candidates) {
      if (typeof c === 'string' && normValue(prop, c) === nv) {
        return { tokenPath: t.path, appVar: t.appVar, role: t.role };
      }
    }
  }
  return null;
}

// ── boot the app (mirrors surface_inventory.mjs) ───────────────────────────────────────────────
const server = createServer(async (req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const d = await readFile(path.join(ROOT, u.slice(1)));
    const ext = path.extname(u);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.otf': 'font/otf', '.wasm': 'application/wasm', '.mp4': 'video/mp4' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const port = server.address().port;

const b = await chromium.launch({ args: DETERMINISTIC_LAUNCH_ARGS });
const page = await b.newPage({ ...DETERMINISTIC_CONTEXT_OPTIONS });
page.setDefaultTimeout(4000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
page.on('dialog', async (d) => { await d.dismiss().catch(() => {}); });

await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  document.querySelectorAll('button').forEach((btn) => { if (btn.textContent.trim() === 'Got it') btn.click(); });
  if (typeof applyFxLayout === 'function') applyFxLayout();
});
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// export_harness.mjs's fixture set is the project's existing deterministic test photo — reused
// here rather than adding a new asset, per the user's ask to use "a test photo from the export
// harness fixtures".
const fixtureB64 = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
async function loadPhoto() {
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'portrait.png', { type: 'image/png' });
    if (typeof window.loadFXImages === 'function') await window.loadFXImages([file]);
  }, fixtureB64);
  await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages && fxImages.length > 0, { timeout: 10000 }).catch(() => {});
  await settleForCapture(page);
}

async function runStep(step) {
  if (step.click) await page.click(step.click, { timeout: 5000 }).catch(async () => {
    await page.evaluate((s) => document.querySelector(s)?.click(), step.click);
  });
  else if (step.eval) await page.evaluate(step.eval);
  else if (step.wait) await page.waitForTimeout(step.wait);
  else if (step.key) await page.keyboard.press(step.key);
}
async function closeAnyOverlay() {
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => {
    document.getElementById('cs-modal-ov')?.remove();
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    if (typeof settingsClose === 'function') settingsClose();
    const split = document.getElementById('fx-split-popover'); if (split) split.style.display = 'none';
    const timeline = document.getElementById('fx-timeline-popover'); if (timeline) timeline.style.display = 'none';
  }).catch(() => {});
  await page.waitForTimeout(80);
}

// Per-state re-entry drivers. Mirrors surface_inventory.mjs's per-surface logic but re-applies
// the SPECIFIC state named (not "run through all states once") so a capture call for "hover" is
// independent of one for "disabled".
async function enterState(entry, state) {
  // mobile-sheet's surfaces.json openSteps is a human-readable description ("resize viewport to
  // <=700px width, applyFxLayout()"), not runnable JS — surface_inventory.mjs drove it with
  // dedicated code, not withSurface()/runStep(). Same special-case here instead of eval'ing text.
  if (entry.id === 'mobile-sheet') {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    await page.evaluate(() => { if (typeof applyFxLayout === 'function') applyFxLayout(); });
    await page.waitForTimeout(150);
    const sectionKeys = await page.evaluate(() =>
      [...document.querySelectorAll('.fx-ctrl[data-fxsec]')].map((el) => el.dataset.fxsec).filter((k) => k && k !== '${cardOrName}'));
    // fxSection(key) on the ALREADY-active section is a CLOSE, not an open — chromasmith-22.html's
    // fxSection() returns early into a close branch (mobile sheet-close, or deskx panel-close)
    // whenever the target section is already `sec-active`. Pick a key that ISN'T active so the
    // call falls through to the open path instead.
    const activeKey = await page.evaluate(() => document.querySelector('.fx-ctrl.sec-active')?.dataset.fxsec);
    const openKey = sectionKeys.find((k) => k !== activeKey) || sectionKeys[0];
    if (state === 'loaded' && openKey) {
      await page.evaluate((k) => { if (typeof fxSection === 'function') fxSection(k); }, openKey);
      await page.waitForTimeout(500); // .fx-panel's sheet-open height is a 280ms CSS transition
    }
    if (state === 'empty' && openKey) {
      // open then tap the now-active tool again to close, landing on the closed (sheet-not-open) state
      await page.evaluate((k) => { if (typeof fxSection === 'function') fxSection(k); }, openKey);
      await page.waitForTimeout(400);
      await page.evaluate((k) => { if (typeof fxSection === 'function') fxSection(k); }, openKey);
      await page.waitForTimeout(300);
    }
    return;
  }

  for (const step of entry.openSteps) await runStep(step);
  await page.waitForTimeout(150);
  const sel = entry.selector;
  const key = entry.id.startsWith('fxsec-') ? entry.id.slice('fxsec-'.length) : null;

  if (state === 'rest') return;
  if (state === 'hover') {
    const titleSel = key ? `${sel} .fx-ctrl-title` : `${sel} button, ${sel} [role=menuitem]`;
    await page.hover(titleSel).catch(() => {});
    return;
  }
  // 'disabled' is handled by the explicit on/off pass in the main loop, not here.
  if (state === 'longText') {
    const textSel = `${sel} input[type=text],${sel} input:not([type])`;
    if (await page.$(textSel)) await page.fill(textSel, 'A'.repeat(80)).catch(() => {});
    return;
  }
  if (state === 'loaded' && entry.id === 'cs-modal') {
    await page.evaluate(() => window.chromasmithShowShortcuts && window.chromasmithShowShortcuts());
    return;
  }
  // empty/loaded for other kinds fall through to whatever openSteps already produced —
  // surface_inventory.mjs's drivers for these are transient (toast pump, menu item count) and
  // not independently re-enterable; captured as the state the surface was already in.
}

// ── element-tree walk ───────────────────────────────────────────────────────────────────────────
async function extractTree(selector) {
  return page.evaluate(({ sel, props }) => {
    function styleOf(el) {
      const cs = getComputedStyle(el);
      const out = {};
      for (const p of props) out[p] = cs[p];
      return out;
    }
    function walk(el, depth) {
      if (!el || depth > 6) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0 && el.children.length === 0) return null;
      // id + data-fxsec are the only stable hooks a later stage can use to match this element
      // back to a wireframe control (S1(b): wireframe controls carry no ids of their own) —
      // dataFxsec falls back to the nearest ancestor's [data-fxsec] since most controls sit
      // inside a section div that carries it, not the control itself.
      const node = {
        tag: el.tagName.toLowerCase(),
        id: el.id || undefined,
        dataFxsec: el.dataset && el.dataset.fxsec ? el.dataset.fxsec : (el.closest('[data-fxsec]')?.dataset.fxsec || undefined),
        classes: el.className && typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean) : undefined,
        text: el.children.length === 0 ? (el.textContent || '').trim().slice(0, 60) || undefined : undefined,
        style: styleOf(el),
        children: [],
      };
      for (const child of el.children) {
        const c = walk(child, depth + 1);
        if (c) node.children.push(c);
      }
      return node;
    }
    const root = document.querySelector(sel);
    return root ? walk(root, 0) : null;
  }, { sel: selector, props: CAPTURED_PROPS });
}

function buildSpec(tree) {
  const unmapped = [];
  function mapNode(node) {
    if (!node) return node;
    const mappedStyle = {};
    for (const [prop, value] of Object.entries(node.style)) {
      const m = matchToken(prop, value);
      if (m) mappedStyle[prop] = { value, token: m.tokenPath, appVar: m.appVar, role: m.role };
      else {
        mappedStyle[prop] = { value, token: null };
        unmapped.push({ tag: node.tag, id: node.id, classes: node.classes, prop, value });
      }
    }
    return { ...node, style: mappedStyle, children: node.children.map(mapNode) };
  }
  return { tree: mapNode(tree), unmapped };
}

// ── .dc.html block ─────────────────────────────────────────────────────────────────────────────
async function extractBlockHtml(selector, panelName) {
  const inner = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return '';
    const clone = root.cloneNode(true);
    // strip runtime cruft a hand-authored wireframe wouldn't carry: inline event handlers,
    // data-testid-style noise stays (useful), but drop inline style attrs that are just
    // computed-layout leftovers and any <script>.
    clone.querySelectorAll('script').forEach((n) => n.remove());
    clone.querySelectorAll('*').forEach((n) => {
      [...n.attributes].forEach((a) => { if (a.name.startsWith('on')) n.removeAttribute(a.name); });
    });
    return clone.innerHTML;
  }, selector);
  return `<div class="tp-panel active" data-panel="${panelName}">\n${inner}\n</div>`;
}

async function shootIfVisible(entry, filename, dir) {
  const visible = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }, entry.selector);
  if (!visible) return false;
  const elHandle = await page.$(entry.selector);
  if (!elHandle) return false; // same transient-element race as captureBuffer() below
  await elHandle.screenshot({ path: path.join(dir, filename), type: 'webp', quality: 90 });
  return true;
}

// ── pass 1: no-photo state (before any photo is loaded) ──────────────────────────────────────
// Only 4/41 surfaces.json entries have a recorded "loaded" state, so most Editor sections would
// otherwise be captured empty/greyed-out by default. "No photo" is captured as its own explicit
// state, not skipped, since most of the app's real usage starts from that empty state too.
const noPhotoReport = [];
for (const entry of targets) {
  if (!entry.selector) continue;
  const dir = path.join(ROOT, 'design/asbuilt', entry.id);
  await mkdir(dir, { recursive: true });
  try {
    await enterState(entry, 'rest');
    await page.waitForTimeout(150);
    const ok = await shootIfVisible(entry, 'noPhoto.webp', dir);
    noPhotoReport.push({ id: entry.id, written: ok });
  } catch (e) {
    noPhotoReport.push({ id: entry.id, written: false, error: e.message.slice(0, 80) });
  } finally {
    await closeAnyOverlay();
  }
}
console.log(`[noPhoto pass] ${noPhotoReport.filter((r) => r.written).length}/${noPhotoReport.length} written`);

await loadPhoto();

// ── pass 2: per-state captures + spec/block, with the photo loaded ───────────────────────────
const report = [];
for (const entry of targets) {
  if (!entry.selector) { report.push({ id: entry.id, error: 'no selector (unenterable surface)' }); continue; }
  const states = Object.entries(entry.states || {}).filter(([, fired]) => fired === true).map(([k]) => k);
  if (!states.length) states.push('rest');
  const dir = path.join(ROOT, 'design/asbuilt', entry.id);
  await mkdir(dir, { recursive: true });

  const missing = [];
  const written = ['noPhoto']; // recorded in pass 1
  for (const state of states) {
    if (state === 'disabled') continue; // superseded by the explicit on/off pass below
    try {
      await enterState(entry, state);
      await page.waitForTimeout(150);
      const ok = await shootIfVisible(entry, `${state}.webp`, dir);
      if (ok) written.push(state); else missing.push(state);
    } catch (e) {
      missing.push(`${state} (error: ${e.message.slice(0, 80)})`);
    } finally {
      await closeAnyOverlay();
    }
  }

  // Explicit on/off capture: sections dim rather than hide when switched off, so "off" needs its
  // own screenshot, not just the boolean surfaces.json recorded for whether disabling fired.
  const hasToggle = await page.evaluate((s) => !!document.querySelector(s + ' .fx-toggle'), entry.selector).catch(() => false);
  if (hasToggle) {
    try {
      await enterState(entry, 'rest');
      await page.waitForTimeout(150);
      const onState = await page.evaluate((s) => !document.querySelector(s + ' .fx-fields')?.classList.contains('ff-off'), entry.selector);
      if (!onState) await page.evaluate((s) => document.querySelector(s + ' .fx-toggle')?.click(), entry.selector);
      await page.waitForTimeout(120);
      if (await shootIfVisible(entry, 'on.webp', dir)) written.push('on'); else missing.push('on');

      await page.evaluate((s) => document.querySelector(s + ' .fx-toggle')?.click(), entry.selector);
      await page.waitForTimeout(120);
      if (await shootIfVisible(entry, 'off.webp', dir)) written.push('off'); else missing.push('off');

      await page.evaluate((s) => document.querySelector(s + ' .fx-toggle')?.click(), entry.selector); // restore on
      await page.waitForTimeout(120);
    } catch (e) {
      missing.push(`on/off (error: ${e.message.slice(0, 80)})`);
    } finally {
      await closeAnyOverlay();
    }
  }

  // spec.json + block.dc.html from the 'rest' state (or first available)
  try {
    await enterState(entry, 'rest');
    await page.waitForTimeout(150);
    const tree = await extractTree(entry.selector);
    const spec = buildSpec(tree);
    await writeFile(path.join(dir, 'spec.json'), JSON.stringify({ id: entry.id, group: entry.group, generatedAt: new Date().toISOString(), hasToggle, ...spec }, null, 2));
    const panelName = entry.id.startsWith('fxsec-') ? entry.id.slice('fxsec-'.length) : entry.id.replace(/^panel-/, '');
    const block = await extractBlockHtml(entry.selector, panelName);
    await writeFile(path.join(dir, 'block.dc.html'), block);
    await closeAnyOverlay();
  } catch (e) {
    report.push({ id: entry.id, specError: e.message.slice(0, 100) });
  }

  report.push({ id: entry.id, statesExpected: states, statesWritten: written, statesMissing: missing });
  console.log(`[capture] ${entry.id}: ${written.length}/${states.length} states (${written.join(',')})${missing.length ? '  MISSING: ' + missing.join(',') : ''}`);

  if (entry.id === 'mobile-sheet') {
    // restore desktop viewport so any later surface in this run (or the noPhoto pass, if this
    // were re-ordered) isn't left mobile-sized.
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.waitForTimeout(150);
    await page.evaluate(() => { if (typeof applyFxLayout === 'function') applyFxLayout(); });
  }
}

console.log('\n=== SUMMARY (phases 1-4: baseline states) ===');
for (const r of report) {
  console.log(`${r.id}: written=${r.statesWritten ? r.statesWritten.length : 0} missing=${r.statesMissing ? r.statesMissing.join('|') : '-'}${r.specError ? ' specError=' + r.specError : ''}`);
}
const totalMissing = report.reduce((n, r) => n + (r.statesMissing ? r.statesMissing.length : 0), 0);
console.log(`${report.length} surfaces, ${totalMissing} missing states total`);

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PHASE 5+6: layout matrix + scenario states
// ══════════════════════════════════════════════════════════════════════════════════════════════
let matrixTotals = { captured: 0, duplicate: 0, skipped: 0, failed: 0 };
let scenarioTotals = { captured: 0, duplicate: 0, skipped: 0, failed: 0 };

if (!NO_MATRIX) {
  await mkdir(path.join(ROOT, 'design/asbuilt-full'), { recursive: true });

  // Same viewport list as test/editor_responsive_qa.mjs (do not invent sizes) + 768 (tablet —
  // not in that list, added per user instruction) + 390 (phone, matches the mobile-sheet 390x844
  // used elsewhere in this file).
  const RESPONSIVE_VIEWPORTS = [
    { w: 1440, h: 900, label: '1440x900 (normal)' },
    { w: 1200, h: 800, label: '1200x800' },
    { w: 1024, h: 768, label: '1024x768 (small laptop)' },
    { w: 960, h: 760, label: '960x760' },
    { w: 900, h: 760, label: '900x760' },
    { w: 820, h: 700, label: '820x700 (narrow — the squeeze floor)' },
    { w: 768, h: 1024, label: '768x1024 (tablet — added, not in editor_responsive_qa.mjs)' },
    { w: 760, h: 700, label: "760x700 (wireframe's own min-width floor)" },
    { w: 700, h: 700, label: "700x700 (below the wireframe's floor)" },
    { w: 390, h: 844, label: '390x844 (phone)' },
  ];
  const ALL_WIDTHS = SMOKE ? [RESPONSIVE_VIEWPORTS[0], RESPONSIVE_VIEWPORTS[8]] : RESPONSIVE_VIEWPORTS;
  const THEMES = ['dark', 'light'];

  function sidebarValuesFor(entry, width) {
    if (entry.id === 'library') return width.w > 700 ? ['docked', 'full'] : ['docked'];
    if (entry.kind === 'fxsec' || entry.id === 'panel-fx') return width.w > 700 ? ['expanded', 'collapsed'] : ['expanded'];
    return ['n/a'];
  }
  function sidebarSkipReason(entry, width, sidebar) {
    if (sidebar === 'collapsed' && width.w <= 700) return 'mobile layout (<=700px) has no deskx panel-closed concept';
    if (entry.id === 'library' && sidebar === 'full' && width.w <= 700) return 'mobile width — Library has no docked/full distinction, always full-screen';
    return null;
  }

  async function setTheme(theme) {
    const cur = await page.evaluate(() => document.body.classList.contains('light') ? 'light' : 'dark');
    if (cur === theme) return;
    await page.evaluate((t) => { if (typeof fxSetTheme === 'function') fxSetTheme(t); }, theme);
    await page.waitForTimeout(150);
  }
  async function setWidth(width) {
    await page.setViewportSize({ width: width.w, height: width.h });
    await page.waitForTimeout(150);
    await page.evaluate(() => { if (typeof applyFxLayout === 'function') applyFxLayout(); });
    await page.waitForTimeout(150);
  }
  async function setSidebar(entry, sidebar) {
    if (sidebar === 'n/a') return;
    if (entry.id === 'library') {
      const isFull = await page.evaluate(() => document.getElementById('lib-overlay')?.classList.contains('full'));
      if ((sidebar === 'full') !== !!isFull) {
        await page.click('#lib-expand', { timeout: 3000 }).catch(async () => {
          await page.evaluate(() => document.querySelector('#lib-expand')?.click());
        });
        await page.waitForTimeout(250);
      }
      return;
    }
    // Editor toolpanel: chromasmith-22.html's fxSection(key) toggles `body.panel-closed` (deskx)
    // — closes when called on the section that's ALREADY `.sec-active` and the panel is currently
    // open; reopens (regardless of which key) whenever the panel is currently closed, because its
    // `!panel-closed` guard on the close-branch then fails and execution falls through to the
    // open path. One call, either direction, driven off the section that's actually active now
    // (S6 groups B-E already found and used this exact mechanism for mobile-sheet).
    const isClosed = await page.evaluate(() => document.body.classList.contains('panel-closed'));
    const wantClosed = sidebar === 'collapsed';
    if (isClosed !== wantClosed) {
      const key = await page.evaluate(() => document.querySelector('.fx-ctrl.sec-active')?.dataset.fxsec || document.querySelector('.fx-ctrl[data-fxsec]')?.dataset.fxsec);
      if (key) await page.evaluate((k) => { if (typeof fxSection === 'function') fxSection(k); }, key);
      await page.waitForTimeout(300);
    }
  }
  async function resetLayout() {
    await setTheme('dark');
    await setWidth(RESPONSIVE_VIEWPORTS[0]);
    await setSidebar({ id: '__reset__', kind: '' }, 'n/a');
  }

  async function captureBuffer(entry) {
    const visible = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }, entry.selector);
    if (!visible) return null;
    await settleForCapture(page).catch(() => {}); // finishes in-flight CSS animations/transitions
    // (export progress bar, panel-close grid-column transition, …) that otherwise made
    // elementHandle.screenshot()'s "wait for stable" check exceed the 4000ms default timeout.
    const elHandle = await page.$(entry.selector);
    // fx-toast (and anything else transient) can disappear in the gap between the visibility
    // check above and this re-query — page.$() then returns null. Treat that race as "not
    // visible" too, not a crash (group B found this: 11 combos threw "Cannot read properties of
    // null" on fx-toast, which only holds ~1900ms and easily loses that race once theme/width/
    // sidebar setup eats into the window).
    if (!elHandle) return null;
    return elHandle.screenshot({ type: 'webp', quality: 85, timeout: 10000 });
  }

  async function storeBuffer(id, buffer) {
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const dir = path.join(ROOT, 'design/asbuilt-full', id);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${hash}.webp`);
    const relPath = `design/asbuilt-full/${id}/${hash}.webp`;
    let isNew = true;
    try { await readFile(filePath); isNew = false; } catch {}
    if (isNew) await writeFile(filePath, buffer);
    return { hash, path: relPath, isNew };
  }

  async function loadSpec(id) {
    try { return JSON.parse(await readFile(path.join(ROOT, 'design/asbuilt', id, 'spec.json'), 'utf8')); }
    catch { return { id }; }
  }
  async function saveSpec(id, spec) {
    await writeFile(path.join(ROOT, 'design/asbuilt', id, 'spec.json'), JSON.stringify(spec, null, 2));
  }

  console.log('\n=== PHASE 5: layout matrix ===');
  for (const entry of targets) {
    if (!entry.selector) continue;
    const spec = await loadSpec(entry.id);
    spec.matrix = spec.matrix || { dimensions: {}, entries: [] };
    // `failed` entries are deliberately NOT "done" — resuming should retry them, not lock in a
    // transient flake forever. Drop them from both the resumability set and the stored entries
    // (a retry that succeeds replaces the failed record; a retry that fails again re-appends it).
    spec.matrix.entries = spec.matrix.entries.filter((e) => !e.failed);
    const doneKeys = new Set(spec.matrix.entries.map((e) => e.key));
    const states = Object.entries(entry.states || {}).filter(([, fired]) => fired === true).map(([k]) => k);
    if (!states.length) states.push('rest');
    const statesForMatrix = SMOKE ? states.slice(0, 2) : states;
    spec.matrix.dimensions = { states: statesForMatrix, themes: THEMES, widths: ALL_WIDTHS.map((w) => `${w.w}x${w.h}`), sidebars: [...new Set(ALL_WIDTHS.flatMap((w) => sidebarValuesFor(entry, w)))] };

    let captured = 0, duplicate = 0, skipped = 0, failed = 0;
    const photoStates = statesForMatrix.filter((s) => s !== 'noPhoto');
    const passes = statesForMatrix.includes('noPhoto') ? [['noPhoto'], photoStates] : [photoStates];
    let photoLoadedForMatrix = false;
    for (const passStates of passes) {
      if (!passStates.length) continue;
      if (passStates[0] !== 'noPhoto' && !photoLoadedForMatrix) { await loadPhoto(); photoLoadedForMatrix = true; }
      for (const state of passStates) {
        for (const theme of THEMES) {
          await setTheme(theme);
          for (const width of ALL_WIDTHS) {
            await setWidth(width);
            for (const sidebar of sidebarValuesFor(entry, width)) {
              const key = `${state}|${theme}|${width.w}x${width.h}|${sidebar}`;
              if (doneKeys.has(key)) continue;
              const reason = sidebarSkipReason(entry, width, sidebar);
              if (reason) { spec.matrix.entries.push({ key, state, theme, width: width.w, height: width.h, sidebar, skipped: true, reason }); doneKeys.add(key); skipped++; continue; }
              try {
                await enterState(entry, state);
                await setSidebar(entry, sidebar);
                await page.waitForTimeout(80);
                const buf = await captureBuffer(entry);
                if (!buf) { spec.matrix.entries.push({ key, state, theme, width: width.w, height: width.h, sidebar, skipped: true, reason: 'not visible in this combo' }); doneKeys.add(key); skipped++; }
                else {
                  const { hash, path: relPath, isNew } = await storeBuffer(entry.id, buf);
                  spec.matrix.entries.push({ key, state, theme, width: width.w, height: width.h, sidebar, hash, path: relPath });
                  doneKeys.add(key);
                  if (isNew) captured++; else duplicate++;
                }
              } catch (e) {
                spec.matrix.entries.push({ key, state, theme, width: width.w, height: width.h, sidebar, failed: true, error: e.message.slice(0, 120) });
                doneKeys.add(key); failed++;
              } finally { await closeAnyOverlay().catch(() => {}); }
            }
          }
        }
      }
    }
    await resetLayout().catch(() => {});
    await saveSpec(entry.id, spec);
    matrixTotals.captured += captured; matrixTotals.duplicate += duplicate; matrixTotals.skipped += skipped; matrixTotals.failed += failed;
    console.log(`[matrix] ${entry.id}: captured=${captured} duplicate=${duplicate} skipped=${skipped} failed=${failed} (total combos so far: ${spec.matrix.entries.length})`);
  }
  console.log(`[matrix totals] captured=${matrixTotals.captured} duplicate=${matrixTotals.duplicate} skipped=${matrixTotals.skipped} failed=${matrixTotals.failed}`);

  // ── contact sheets: one labelled grid per surface per theme, built by rendering an HTML grid
  // page through the SAME browser (no new image-composition dependency — this repo has no sharp)
  // and screenshotting it. Split into parts if a single grid would exceed ~72 cells.
  console.log('\n=== contact sheets ===');
  const contactServer = createServer(async (req, res) => {
    try {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const d = await readFile(path.join(ROOT, u.slice(1)));
      const ext = path.extname(u);
      const types = { '.html': 'text/html', '.webp': 'image/webp' };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      res.end(d);
    } catch { res.writeHead(404); res.end(); }
  }).listen(0, '127.0.0.1');
  await new Promise((r) => contactServer.on('listening', r));
  const contactPort = contactServer.address().port;
  const contactPage = await b.newPage({ viewport: { width: 1800, height: 1200 } });

  async function buildContactSheet(id, theme, entries, partIndex, partCount) {
    const cells = entries.map((e) => `
      <div class="cell">
        <img src="/${e.path}" loading="eager">
        <div class="lbl">${e.state} · ${e.width}x${e.height} · ${e.sidebar}</div>
      </div>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf8"><style>
      body{margin:0;background:#1a1a1a;font-family:-apple-system,sans-serif}
      h1{color:#fff;font-size:16px;padding:12px 16px;margin:0}
      .grid{display:grid;grid-template-columns:repeat(8,1fr);gap:10px;padding:12px}
      .cell{background:#2a2a2a;border-radius:6px;overflow:hidden}
      .cell img{width:100%;display:block;background:#000}
      .lbl{color:#bbb;font-size:9px;padding:4px 6px;line-height:1.3;word-break:break-all}
    </style></head><body>
      <h1>${id} — ${theme}${partCount > 1 ? ` (part ${partIndex + 1}/${partCount})` : ''} — ${entries.length} cells</h1>
      <div class="grid">${cells}</div>
    </body></html>`;
    const tmpPath = path.join(ROOT, `design/asbuilt-full/_contact_tmp_${id}_${theme}_${partIndex}.html`);
    await writeFile(tmpPath, html);
    const outName = partCount > 1 ? `contact-${theme}-part${partIndex + 1}.webp` : `contact-${theme}.webp`;
    const outPath = path.join(ROOT, 'design/asbuilt', id, outName);
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await contactPage.goto(`http://127.0.0.1:${contactPort}/${path.relative(ROOT, tmpPath)}`, { waitUntil: 'load', timeout: 30000 });
        await contactPage.waitForFunction(() => [...document.images].every((img) => img.complete), { timeout: 15000 }).catch(() => {});
        await contactPage.waitForTimeout(200);
        // Element screenshot of the wrapper (not page.screenshot({fullPage:true})) — the latter
        // intermittently threw "Unable to capture screenshot" (CDP protocol error) on some grids
        // for no visible reason (same page, same images, adjacent theme's grid succeeded);
        // element-handle capture proved reliable across repeated runs.
        const bodyHandle = await contactPage.$('body');
        await bodyHandle.screenshot({ path: outPath, type: 'webp', quality: 82, timeout: 20000 });
        lastErr = null;
        break;
      } catch (e) { lastErr = e; await contactPage.waitForTimeout(500); }
    }
    await unlink(tmpPath).catch(() => {});
    if (lastErr) throw lastErr;
    return outName;
  }

  const CELLS_PER_SHEET = 72;
  for (const entry of targets) {
    const spec = await loadSpec(entry.id);
    if (!spec.matrix || !spec.matrix.entries) continue;
    const withImages = spec.matrix.entries.filter((e) => e.hash && !e.skipped && !e.failed);
    spec.contactSheets = spec.contactSheets || {};
    for (const theme of THEMES) {
      const themeEntries = withImages.filter((e) => e.theme === theme);
      if (!themeEntries.length) continue;
      const parts = [];
      for (let i = 0; i < themeEntries.length; i += CELLS_PER_SHEET) parts.push(themeEntries.slice(i, i + CELLS_PER_SHEET));
      const files = [];
      for (let i = 0; i < parts.length; i++) {
        try { files.push(await buildContactSheet(entry.id, theme, parts[i], i, parts.length)); }
        catch (e) { console.log(`[contact] FAILED ${entry.id}/${theme} part ${i + 1}: ${e.message.slice(0, 100)}`); }
      }
      spec.contactSheets[theme] = files;
    }
    await saveSpec(entry.id, spec);
    console.log(`[contact] ${entry.id}: ${Object.entries(spec.contactSheets).map(([t, f]) => `${t}=${f.length}`).join(' ')}`);
  }
  await contactPage.close();
  contactServer.close();

  // ── PHASE 6: scenario states — fixed 1400x900, both themes, only on the surface(s) each
  // scenario is actually about (not every surface — the user's instruction frames these as
  // "extra states on the surfaces they affect", not a full-matrix multiplier).
  console.log('\n=== PHASE 6: scenario states ===');
  const SCENARIO_WIDTH = { w: 1400, h: 900 };
  async function captureScenario(entry, name, driver) {
    const spec = await loadSpec(entry.id);
    spec.scenarios = spec.scenarios || [];
    spec.scenarios = spec.scenarios.filter((s) => !s.failed); // same "failed isn't done" rule as the matrix
    const already = new Set(spec.scenarios.map((s) => s.key));
    for (const theme of THEMES) {
      const key = `${name}|${theme}`;
      if (already.has(key)) { scenarioTotals.duplicate++; continue; }
      try {
        await setTheme(theme);
        await setWidth(SCENARIO_WIDTH);
        await driver();
        await page.waitForTimeout(150);
        const buf = await captureBuffer(entry);
        if (!buf) { spec.scenarios.push({ key, name, theme, skipped: true, reason: 'not visible after scenario setup' }); scenarioTotals.skipped++; }
        else {
          const { hash, path: relPath, isNew } = await storeBuffer(entry.id, buf);
          spec.scenarios.push({ key, name, theme, hash, path: relPath });
          if (isNew) scenarioTotals.captured++; else scenarioTotals.duplicate++;
        }
      } catch (e) {
        spec.scenarios.push({ key, name, theme, failed: true, error: e.message.slice(0, 150) });
        scenarioTotals.failed++;
      } finally { await closeAnyOverlay().catch(() => {}); }
    }
    await saveSpec(entry.id, spec);
  }
  function skipScenario(entry, name, reason) {
    return (async () => {
      const spec = await loadSpec(entry.id);
      spec.scenarios = spec.scenarios || [];
      for (const theme of THEMES) {
        const key = `${name}|${theme}`;
        if (spec.scenarios.some((s) => s.key === key)) continue;
        spec.scenarios.push({ key, name, theme, skipped: true, reason });
        scenarioTotals.skipped++;
      }
      await saveSpec(entry.id, spec);
      console.log(`[scenario] SKIPPED ${entry.id}/${name}: ${reason}`);
    })();
  }

  const panelFx = targets.find((t) => t.id === 'panel-fx');
  const library = targets.find((t) => t.id === 'library');
  const mobileSheet = targets.find((t) => t.id === 'mobile-sheet');

  if (panelFx) {
    await loadPhoto();
    await captureScenario(panelFx, 'keyboard-focus', async () => {
      await page.evaluate(() => document.querySelector('#fx-secnav .fx-sec-btn, button')?.focus());
      await page.keyboard.press('Tab');
    });
    await captureScenario(panelFx, 'pressed', async () => {
      const sel = await page.$('.fx-ctrl-title, button');
      if (sel) { const box = await sel.boundingBox(); if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); }
      await page.mouse.down();
    });
    await page.mouse.up().catch(() => {});
    await captureScenario(panelFx, 'modified-fx-mod', async () => {
      // .fx-mod marks a control whose value differs from default — flip Adjust>Exposure to trigger it
      await page.evaluate(() => { if (typeof fxSection === 'function') fxSection('adjust'); });
      await page.waitForTimeout(150);
      await page.evaluate(() => {
        const s = document.querySelector('#adjust-exposure, input[type=range]');
        if (s) { s.value = String(Number(s.max || 100) * 0.8); s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); }
      });
    });

    async function loadFixture(fixtureRelPath) {
      const b64 = (await readFile(path.join(ROOT, fixtureRelPath))).toString('base64');
      await page.evaluate(async ({ b64, name }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const file = new File([bytes], name, { type: 'image/png' });
        if (typeof window.loadFXImages === 'function') await window.loadFXImages([file]);
      }, { b64, name: path.basename(fixtureRelPath) });
      await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages && fxImages.length > 0, { timeout: 10000 }).catch(() => {});
      await settleForCapture(page);
    }
    await captureScenario(panelFx, 'photo-orientation-portrait', () => loadFixture('test/fixtures/orientation_portrait.png'));
    await captureScenario(panelFx, 'photo-orientation-landscape', () => loadFixture('test/fixtures/gradient.png'));
    await captureScenario(panelFx, 'photo-orientation-panorama', () => loadFixture('test/fixtures/orientation_panorama.png'));

    await captureScenario(panelFx, 'multi-photo-batch', async () => {
      const files = ['portrait.png', 'gradient.png', 'chart.png'];
      const b64s = await Promise.all(files.map((f) => readFile(path.join(ROOT, 'test/fixtures', f)).then((b) => b.toString('base64'))));
      await page.evaluate(async (items) => {
        const fileObjs = items.map(({ b64, name }) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); return new File([bytes], name, { type: 'image/png' }); });
        if (typeof window.loadFXImages === 'function') await window.loadFXImages(fileObjs);
      }, files.map((f, i) => ({ b64: b64s[i], name: f })));
      await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages && fxImages.length > 1, { timeout: 10000 }).catch(() => {});
      await settleForCapture(page);
    });

    // RAW: T11 (editor_ux_spec.json) already documents no RAW/.rw2 fixture exists in this repo.
    await skipScenario(panelFx, 'raw-loaded', 'no RAW/.rw2 fixture exists (editor_ux_spec.json T11) — confirmed, not generated (binary RAW format, not something to fabricate)');

    const hasVideoFixture = await readFile(path.join(ROOT, 'test/fixtures/video_tiny.mp4')).then(() => true).catch(() => false);
    if (hasVideoFixture) {
      await captureScenario(panelFx, 'video-loaded', async () => {
        const b64 = (await readFile(path.join(ROOT, 'test/fixtures/video_tiny.mp4'))).toString('base64');
        await page.evaluate(async (b64) => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const file = new File([bytes], 'video_tiny.mp4', { type: 'video/mp4' });
          if (typeof window.loadFXImages === 'function') await window.loadFXImages([file]);
        }, b64);
        await page.waitForTimeout(1500);
        await settleForCapture(page);
      });
    } else await skipScenario(panelFx, 'video-loaded', 'test/fixtures/video_tiny.mp4 not found');

    await loadFixture('test/fixtures/portrait.png'); // back to the standard single-photo fixture for the rest
    await captureScenario(panelFx, 'masks-none', async () => { await page.evaluate(() => { if (typeof fxSection === 'function') fxSection('local'); }); });
    // mskAdd(type) takes a MASKS key ('radial'/'linear'/'color'/'lum'/'depth'/'brush'/'sky'/'ai'/
    // 'skin'/'coat' — chromasmith-22.html:10904), not a number. 'radial' needs no drawn geometry
    // or segmentation model to show up in the mask list, unlike 'ai'/'skin'/'coat'.
    await captureScenario(panelFx, 'masks-one', async () => {
      await page.evaluate(() => { if (typeof fxSection === 'function') fxSection('local'); if (typeof mskAdd === 'function') mskAdd('radial'); });
      await page.waitForTimeout(200);
    });
    await captureScenario(panelFx, 'masks-several', async () => {
      await page.evaluate(() => { if (typeof fxSection === 'function') fxSection('local'); if (typeof mskAdd === 'function') { mskAdd('radial'); mskAdd('linear'); } });
      await page.waitForTimeout(200);
    });

    // Real export entry point is exportFX() / #btn-fx-export (chromasmith-22.html:2424) — not a
    // guessed name. #fx-export-prog is the progress bar shown while exportFX() runs.
    await captureScenario(panelFx, 'export-progress', async () => {
      await page.evaluate(() => { if (typeof fxSection === 'function') fxSection('export'); });
      await page.waitForTimeout(150);
      await page.evaluate(() => { if (typeof exportFX === 'function') exportFX(); });
      await page.waitForTimeout(200);
    });
    await captureScenario(panelFx, 'export-error', async () => {
      await page.evaluate(() => { window.__forceExportError = true; if (typeof toast === 'function') toast('Export failed (simulated for capture)', 'err'); });
    });
    await captureScenario(panelFx, 'export-empty', async () => {
      await page.evaluate(() => { if (typeof fxSection === 'function') fxSection('export'); });
    });

    await captureScenario(panelFx, 'split-view', async () => { await page.evaluate(() => { if (typeof toggleSplit === 'function') toggleSplit(); }); });
    await captureScenario(panelFx, 'loupe-1to1', async () => { await page.evaluate(() => { if (typeof toggleLoupe === 'function') toggleLoupe(); }); });
    await captureScenario(panelFx, 'crop-mode', async () => { await page.evaluate(() => { if (typeof fxSection === 'function') fxSection('crop'); }); });

    await captureScenario(panelFx, 'zoom-125', async () => { await page.evaluate(() => { document.documentElement.style.zoom = '125%'; }); });
    await captureScenario(panelFx, 'zoom-200', async () => { await page.evaluate(() => { document.documentElement.style.zoom = '200%'; }); });
    await page.evaluate(() => { document.documentElement.style.zoom = ''; });

    await captureScenario(panelFx, 'forced-colors', async () => { await page.emulateMedia({ forcedColors: 'active' }); });
    await page.emulateMedia({ forcedColors: 'none' });
    await captureScenario(panelFx, 'reduced-motion', async () => { await page.emulateMedia({ reducedMotion: 'reduce' }); });
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // WebKit engine: a SEPARATE browser instance (playwright's own `webkit`), same pattern as
    // test/editor_webkit_smoke.mjs — gracefully skipped if not installed locally, not launched
    // from scratch every scenario (this repo's boot is ~1.5s, worth doing once).
    try {
      const wk = await webkit.launch();
      const wkPage = await wk.newPage({ viewport: { width: 1400, height: 900 } });
      await wkPage.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await wkPage.waitForTimeout(1500);
      await wkPage.evaluate(() => { document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); }); });
      await wkPage.keyboard.press('Escape');
      const b64 = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
      await wkPage.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const file = new File([bytes], 'portrait.png', { type: 'image/png' });
        if (typeof window.loadFXImages === 'function') await window.loadFXImages([file]);
      }, b64);
      await wkPage.waitForTimeout(1500);
      const spec = await loadSpec(panelFx.id);
      spec.scenarios = spec.scenarios || [];
      for (const theme of THEMES) {
        const key = `webkit-rest|${theme}`;
        if (spec.scenarios.some((s) => s.key === key)) continue;
        await wkPage.evaluate((t) => { if (typeof fxSetTheme === 'function') fxSetTheme(t); }, theme);
        await wkPage.waitForTimeout(200);
        try {
          const elHandle = await wkPage.$(panelFx.selector);
          const buf = elHandle ? await elHandle.screenshot({ type: 'png' }) : null; // webkit's screenshot() has no webp encoder
          if (!buf) { spec.scenarios.push({ key, name: 'webkit-rest', theme, skipped: true, reason: 'selector not visible under WebKit' }); scenarioTotals.skipped++; }
          else {
            const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16);
            const dir = path.join(ROOT, 'design/asbuilt-full', panelFx.id);
            await mkdir(dir, { recursive: true });
            const relPath = `design/asbuilt-full/${panelFx.id}/${hash}.png`;
            let isNew = true;
            try { await readFile(path.join(ROOT, relPath)); isNew = false; } catch {}
            if (isNew) await writeFile(path.join(ROOT, relPath), buf);
            spec.scenarios.push({ key, name: 'webkit-rest', theme, hash, path: relPath });
            if (isNew) scenarioTotals.captured++; else scenarioTotals.duplicate++;
          }
        } catch (e) {
          spec.scenarios.push({ key, name: 'webkit-rest', theme, failed: true, error: e.message.slice(0, 120) });
          scenarioTotals.failed++;
        }
      }
      await saveSpec(panelFx.id, spec);
      await wk.close();
    } catch (e) {
      await skipScenario(panelFx, 'webkit-rest', `WebKit not available: ${e.message.slice(0, 150)}`);
    }

    await resetLayout().catch(() => {});
  }

  if (library) {
    await captureScenario(library, 'library-empty', async () => {
      await page.evaluate(() => { document.getElementById('lib-overlay')?.classList.add('on'); });
    });
    // #lib-viewmode-seg is `.lib-fullview-only` — CSS hides it entirely while docked
    // (desktop/library-ui.js:1581, `#lib-overlay:not(.full) .lib-fullview-only{display:none}`),
    // so grid/list/multi-select need the FULL view first or the click silently no-ops. Real
    // toggle is the #lib-viewmode-seg [data-v=grid|list] button pair (desktop/library-ui.js
    // ~6513/1850) — clicked, since state.viewMode is a closure-local var with no window export.
    async function goFull() {
      const isFull = await page.evaluate(() => document.getElementById('lib-overlay')?.classList.contains('full'));
      if (!isFull) { await page.click('#lib-expand', { timeout: 3000 }).catch(() => {}); await page.waitForTimeout(250); }
    }
    await captureScenario(library, 'library-grid-view', async () => {
      await goFull();
      await page.click('#lib-viewmode-seg [data-v="grid"]', { timeout: 3000 }).catch(() => {});
    });
    await captureScenario(library, 'library-list-view', async () => {
      await goFull();
      await page.click('#lib-viewmode-seg [data-v="list"]', { timeout: 3000 }).catch(() => {});
    });
    await captureScenario(library, 'library-multi-select', async () => {
      await page.evaluate(() => {
        document.querySelectorAll('#lib-grid [data-id]').forEach((el, i) => { if (i < 3) el.classList.add('sel'); });
      });
    });
    if (await page.evaluate(() => typeof window.libtestLrConnect === 'function')) {
      await captureScenario(library, 'library-lightroom-connected', async () => { await page.evaluate(() => window.libtestLrConnect()); });
    } else await skipScenario(library, 'library-lightroom-connected', 'window.libtestLrConnect() not defined in this build');
    await skipScenario(library, 'library-large', 'no large-library fixture/mock wired into this script (would need a ?libn=N mock like test/library_dock_states.mjs uses, not implemented this pass)');
  }

  if (mobileSheet) {
    await captureScenario(mobileSheet, 'mobile-sheet-open', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => { if (typeof applyFxLayout === 'function') applyFxLayout(); });
      await page.waitForTimeout(150);
      // Same active-section trap as the phase-1-4 mobile-sheet driver above: fxSection(key) on
      // the section that's ALREADY active closes rather than opens (fxSection's early-return
      // branch) — pick one that isn't.
      const activeKey = await page.evaluate(() => document.querySelector('.fx-ctrl.sec-active')?.dataset.fxsec);
      const keys = await page.evaluate(() => [...document.querySelectorAll('.fx-ctrl[data-fxsec]')].map((el) => el.dataset.fxsec).filter(Boolean));
      const openKey = keys.find((k) => k !== activeKey) || keys[0];
      for (let i = 0; i < 2 && openKey; i++) {
        if (await page.evaluate(() => document.body.classList.contains('sheet-open'))) break;
        await page.evaluate((k) => { if (typeof fxSection === 'function') fxSection(k); }, openKey);
        await page.waitForTimeout(400);
      }
    });
    await captureScenario(mobileSheet, 'mobile-sheet-closed', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => { if (typeof applyFxLayout === 'function') applyFxLayout(); });
      if (await page.evaluate(() => document.body.classList.contains('sheet-open'))) {
        const key = await page.evaluate(() => document.querySelector('.fx-ctrl.sec-active')?.dataset.fxsec);
        if (key) await page.evaluate((k) => { if (typeof fxSection === 'function') fxSection(k); }, key);
        await page.waitForTimeout(300);
      }
    });
    await captureScenario(mobileSheet, 'mobile-landscape-phone', async () => {
      await page.setViewportSize({ width: 844, height: 390 });
      await page.evaluate(() => { if (typeof applyFxLayout === 'function') applyFxLayout(); });
    });
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => { if (typeof applyFxLayout === 'function') applyFxLayout(); });
  }

  console.log(`[scenario totals] captured=${scenarioTotals.captured} duplicate=${scenarioTotals.duplicate} skipped=${scenarioTotals.skipped} failed=${scenarioTotals.failed}`);
} else {
  console.log('\n(--no-matrix: skipping layout matrix + scenario phases)');
}

await page.close();
await b.close();
server.close();

console.log('\n=== FINAL TOTALS ===');
console.log(`matrix: captured=${matrixTotals.captured} duplicate=${matrixTotals.duplicate} skipped=${matrixTotals.skipped} failed=${matrixTotals.failed}`);
console.log(`scenarios: captured=${scenarioTotals.captured} duplicate=${scenarioTotals.duplicate} skipped=${scenarioTotals.skipped} failed=${scenarioTotals.failed}`);
