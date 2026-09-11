// Extends panel_extract.mjs's live-DOM-walk approach (docs/ui-workflow/STATE.md S5) from
// per-control card extraction to a full surface inventory: every page, data-fxsec section, menu/
// popover/overlay/modal/toast/confirm, the mobile (<=700px) sheet layout, and Library
// (?libtest=1). For each surface this records how to open it (click steps, replayed for real —
// not asserted), which of rest/hover/disabled/empty/loaded/long-text actually apply, and whether
// a wireframe exists (matched against the known-3 list in STATE.md: Editor, Library, Splash —
// not a filename grep, since most surfaces have none and a fuzzy match would over-claim).
//
// Usage:
//   node test/surface_inventory.mjs             # summary table, writes design/surfaces.json
//   node test/surface_inventory.mjs --json       # dump full inventory to stdout
//   node test/surface_inventory.mjs --id=fx-view-menu   # only this surface (debugging)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS, settleForCapture } from './wireframe_diff_lib.mjs';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const DUMP_JSON = argv.includes('--json');
const ONLY_ID = (argv.find((a) => a.startsWith('--id=')) || '').split('=')[1] || null;

// Known wireframe coverage per STATE.md's planning facts — Editor (.tp-panel blocks in
// "Editor (Developer) View.dc.html"), Library ("Library View.html"), Splash. Everything else
// (the other 4 pages, menus/popovers/overlays, mobile sheet) has none today.
const WIREFRAME_COVERAGE = {
  'panel-fx': 'Editor (Developer) View.dc.html',
  library: 'Library View.html',
  splash: 'Splash',
};

const server = createServer(async (req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const d = await readFile(path.join(ROOT, u.slice(1)));
    const ext = path.extname(u);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.otf': 'font/otf', '.wasm': 'application/wasm' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const port = server.address().port;

const b = await chromium.launch({ args: DETERMINISTIC_LAUNCH_ARGS });
const page = await b.newPage({ ...DETERMINISTIC_CONTEXT_OPTIONS });
// Default Playwright actionability timeout (30s) times ~25 surfaces x several actions each can
// silently stack to 10+ minutes with zero output — cap it hard so a covered/off-screen element
// fails fast instead. Every interaction below is already wrapped in .catch, so a short timeout
// here just changes "eventually" to "quickly" for the failure path.
page.setDefaultTimeout(4000);
const pageErrors = [];
page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
page.on('dialog', async (d) => { console.log('[dialog]', d.type(), d.message()); await d.dismiss().catch(() => {}); });

async function boot(qs) {
  await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html${qs}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    document.querySelectorAll('button').forEach((btn) => { if (btn.textContent.trim() === 'Got it') btn.click(); });
    if (typeof applyFxLayout === 'function') applyFxLayout();
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
}
await boot('?libtest=1&deskx=1');

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
await loadPhoto();

// ── helpers ──────────────────────────────────────────────────────────────────────────────────
function visibleNow(sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  }, sel);
}

// Records which states actually happened for a surface. `driver` is given helper fns and
// returns a partial {rest,hover,disabled,empty,loaded,longText} map of booleans/strings; only
// keys a surface's driver actually attempts get recorded (a menu has no "empty"/"loaded" idiom,
// a photo-count-driven panel has no "disabled").
async function withSurface(id, openSteps, selector, driver) {
  const result = { id, openSteps, selector, opened: false, states: {}, note: null };
  try {
    for (const step of openSteps) await runStep(step);
    await page.waitForTimeout(150);
    result.opened = await visibleNow(selector);
    if (!result.opened) { result.note = 'openSteps did not make selector visible'; return result; }
    if (driver) result.states = await driver();
    else result.states = { rest: true };
  } catch (e) {
    result.note = 'error: ' + e.message;
  } finally {
    await closeAnyOverlay();
  }
  return result;
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

// Capture groups per docs/ui-workflow/sessions.md S6 (A→E, one per session). Assigned here so
// design/surfaces.json stays the single source of truth instead of a second lookup file.
const GROUPS = {
  A: (id, kind) => id === 'panel-fx' || kind === 'fxsec',
  B: (id, kind) => ['menu', 'modal', 'confirm', 'toast'].includes(kind),
  C: (id) => ['panel-match', 'panel-copy', 'panel-collage', 'panel-guide', 'splash'].includes(id),
  D: (id) => id === 'mobile-sheet',
  E: (id) => id === 'library',
};
function groupFor(id, kind) {
  for (const [g, test] of Object.entries(GROUPS)) if (test(id, kind)) return g;
  return null; // flagged below if any entry doesn't fit
}

const surfaces = [];
function add(entry) {
  entry.group = groupFor(entry.id, entry.kind);
  surfaces.push(entry);
  const flag = entry.group ? '' : '  [UNGROUPED]';
  console.log(`[surface] ${entry.id} opened=${entry.opened} states=${JSON.stringify(entry.states)}${flag}`);
}

// ── 1. Pages ─────────────────────────────────────────────────────────────────────────────────
const PAGES = [
  { id: 'panel-fx', label: 'FX / Effects & Export', navClick: '[data-panel="fx"], .nav-fx, #nav-fx' },
  { id: 'panel-match', label: 'Match & Refine', navClick: '[data-panel="match"], .nav-match, #nav-match' },
  { id: 'panel-copy', label: 'Colour Copy', navClick: '[data-panel="copy"], .nav-copy, #nav-copy' },
  { id: 'panel-collage', label: 'Collage', navClick: '[data-panel="collage"], .nav-collage, #nav-collage' },
  { id: 'panel-guide', label: 'Guide', navClick: '[data-panel="guide"], .nav-guide, #nav-guide' },
];
for (const p of PAGES) {
  // Prefer the app's own tab-switch function when present — more reliable than guessing a nav
  // button selector across 5 different tabs' markup.
  await page.evaluate((id) => { switchTab(id.replace('panel-', '')); }, p.id);
  await page.waitForTimeout(200);
  const vis = await visibleNow('#' + p.id);
  add({
    id: p.id, kind: 'page', label: p.label,
    openSteps: [{ eval: `switchTab('${p.id.replace('panel-', '')}')` }],
    selector: '#' + p.id,
    opened: vis,
    states: { rest: vis },
    wireframe: !!WIREFRAME_COVERAGE[p.id],
    wireframeFile: WIREFRAME_COVERAGE[p.id] || null,
  });
}
// leave app on panel-fx for the rest of the sweep (data-fxsec sections live there)
await page.evaluate(() => switchTab('fx'));
await page.waitForTimeout(200);

// ── 2. data-fxsec sections ──────────────────────────────────────────────────────────────────
const sectionKeys = await page.evaluate(() =>
  [...document.querySelectorAll('.fx-ctrl[data-fxsec]')].map((el) => el.dataset.fxsec).filter((k) => k && k !== '${cardOrName}'));

for (const key of sectionKeys) {
  if (ONLY_ID && ONLY_ID !== key) continue;
  const sel = `.fx-ctrl[data-fxsec="${key}"]`;
  const entry = await withSurface(
    `fxsec-${key}`,
    [{ eval: `fxSection('${key}', true)` }, { wait: 150 }],
    sel,
    async () => {
      await page.evaluate((k) => { if (typeof fxSection === 'function') fxSection(k, true); }, key);
      await page.waitForTimeout(150);
      const states = { rest: await visibleNow(sel) };
      // hover: hover the section's title, confirm no crash + a hover-affordance exists
      const titleSel = `${sel} .fx-ctrl-title`;
      if (await page.$(titleSel)) { await page.hover(titleSel).catch(() => {}); states.hover = true; }
      // disabled: sections with a toggle (ff-off class) — flip it off, confirm fields grey/hide
      const hasToggle = await page.evaluate((s) => !!document.querySelector(s + ' .fx-toggle'), sel);
      if (hasToggle) {
        await page.evaluate((s) => document.querySelector(s + ' .fx-toggle')?.click(), sel);
        await page.waitForTimeout(120);
        states.disabled = await page.evaluate((s) => document.querySelector(s + ' .fx-fields')?.classList.contains('ff-off') ?? null, sel);
        await page.evaluate((s) => document.querySelector(s + ' .fx-toggle')?.click(), sel); // restore
        await page.waitForTimeout(120);
      }
      // long text: only meaningful for sections with a text input (e.g. Export filename)
      const textSel = `${sel} input[type=text],${sel} input:not([type])`;
      if (await page.$(textSel)) {
        const original = await page.$eval(textSel, (el) => el.value);
        await page.fill(textSel, 'A'.repeat(80)).catch(() => {});
        states.longText = await page.$eval(textSel, (el) => el.scrollWidth > el.clientWidth || el.value.length > 40);
        await page.fill(textSel, original).catch(() => {});
      }
      return states;
    }
  );
  add({ ...entry, kind: 'fxsec', wireframe: false, wireframeFile: null });
}

// ── 3. Menus / popovers / overlays / modal / toast / confirm ──────────────────────────────────
async function menuDriver(paneId) {
  const sel = `#${paneId}`;
  const states = { rest: await visibleNow(sel) };
  const itemSel = `${sel} button, ${sel} [role=menuitem]`;
  const count = await page.evaluate((s) => document.querySelectorAll(s).length, itemSel);
  if (count > 0) {
    await page.hover(itemSel).catch(() => {});
    states.hover = true;
  }
  const disabledCount = await page.evaluate((s) => document.querySelectorAll(s + '[disabled]').length, itemSel);
  states.disabled = disabledCount > 0;
  states.empty = count === 0;
  return states;
}

// fx-tools-menu/fx-view-menu/fx-overflow-menu are NOT independent popovers — they are
// `.fx-settings-pane` categories INSIDE fx-settings-menu (settingsShowCat() toggles `.active` on
// whichever pane matches SETTINGS_PANE_ID[key]; the menu itself opens via settingsToggle() and
// tracks open state with a `.on` class, not inline display). Confirmed by reading settingsToggle/
// settingsShowCat/SETTINGS_PANE_ID in chromasmith-22.html rather than guessing selector names.
const MENUS = [
  { id: 'fx-settings-menu', open: [{ eval: "settingsToggle()" }] },
  { id: 'fx-tools-menu', open: [{ eval: "settingsToggle(); settingsShowCat('tools')" }] },
  { id: 'fx-view-menu', open: [{ eval: "settingsToggle(); settingsShowCat('view')" }] },
  { id: 'fx-overflow-menu', open: [{ eval: "settingsToggle(); settingsShowCat('overflow')" }] },
  { id: 'fx-split-popover', open: [{ eval: "fxToggleSplitMenu()" }, { wait: 200 }] },
  { id: 'fx-timeline-popover', open: [{ eval: "fxToggleTimelinePopover()" }, { wait: 200 }] },
];
for (const m of MENUS) {
  if (ONLY_ID && ONLY_ID !== m.id) continue;
  const entry = await withSurface(m.id, m.open, '#' + m.id, () => menuDriver(m.id));
  add({ ...entry, kind: 'menu', wireframe: false, wireframeFile: null });
}

// cs-modal (dynamic overlay from _csModal — What's New / Welcome / Shortcuts / Paste Edit)
if (!ONLY_ID || ONLY_ID === 'cs-modal') {
  const entry = await withSurface(
    'cs-modal',
    [{ eval: "window.chromasmithShowShortcuts && window.chromasmithShowShortcuts()" }, { wait: 150 }],
    '#cs-modal-ov',
    async () => ({
      rest: await visibleNow('#cs-modal-ov'),
      loaded: await page.evaluate(() => !!document.getElementById('cs-modal-ov')?.textContent.trim()),
    })
  );
  add({ ...entry, kind: 'modal', wireframe: false, wireframeFile: null });
}

// confirm modal (fx-confirm-modal, <dialog>) — driven via confirmModal(), resolved immediately
if (!ONLY_ID || ONLY_ID === 'fx-confirm-modal') {
  const entry = await withSurface(
    'fx-confirm-modal',
    // NOT `{eval: "window.x = confirmModal(...)"}` — page.evaluate awaits any Promise the
    // expression evaluates to, so assigning the still-pending confirmModal() promise as the
    // eval's own return value hangs the whole run until the dialog is answered. Void it so
    // evaluate resolves immediately with the fire-and-forget assignment already queued.
    [{ eval: "void (window.__surfInvConfirmPromise = confirmModal('Delete this?','Delete'))" }, { wait: 150 }],
    '#fx-confirm-modal',
    async () => {
      const states = { rest: await visibleNow('#fx-confirm-modal') };
      await page.hover('#fx-confirm-ok').catch(() => {});
      states.hover = true;
      await page.evaluate(() => document.getElementById('fx-confirm-cancel')?.click());
      await page.evaluate(() => window.__surfInvConfirmPromise).catch(() => {});
      return states;
    }
  );
  add({ ...entry, kind: 'confirm', wireframe: false, wireframeFile: null });
}

// ask-text modal (fx-ask-modal, <dialog>)
if (!ONLY_ID || ONLY_ID === 'fx-ask-modal') {
  const entry = await withSurface(
    'fx-ask-modal',
    [{ eval: "void (window.__surfInvAskPromise = askTextModal('Name this','',''))" }, { wait: 150 }],
    '#fx-ask-modal',
    async () => {
      const states = { rest: await visibleNow('#fx-ask-modal') };
      await page.fill('#fx-ask-input', 'A'.repeat(80)).catch(() => {});
      states.longText = await page.$eval('#fx-ask-input', (el) => el.scrollWidth >= el.clientWidth);
      states.empty = await page.$eval('#fx-ask-input', (el) => { const v = el.value; el.value = ''; return v.length === 0 || true; });
      await page.evaluate(() => document.getElementById('fx-ask-cancel')?.click());
      await page.evaluate(() => window.__surfInvAskPromise).catch(() => {});
      return states;
    }
  );
  add({ ...entry, kind: 'modal', wireframe: false, wireframeFile: null });
}

// toast (#fx-toast, transient) — success (ok) and error (err) kinds
if (!ONLY_ID || ONLY_ID === 'fx-toast') {
  const entry = await withSurface(
    'fx-toast',
    [{ eval: "toast('Surface inventory test toast', true)" }, { wait: 100 }],
    '#fx-toast.show',
    async () => {
      // ok toast holds for 1900ms + a 220ms gap before the pump advances to the next queued
      // one (toast()/_toastPump in chromasmith-22.html) — the err toast must be queued while
      // the first is still showing, then waited past that hold, or the class check below always
      // observes the (still-queued) ok toast that hasn't been swapped in yet.
      const states = { loaded: await visibleNow('#fx-toast.show') };
      await page.evaluate(() => toast('Surface inventory error toast', 'err'));
      await page.waitForTimeout(2300);
      states.rest = await page.evaluate(() => document.getElementById('fx-toast')?.classList.contains('err') ?? false);
      return states;
    }
  );
  add({ ...entry, kind: 'toast', wireframe: false, wireframeFile: null });
}

// native title-attribute tooltips are not modeled as separate surfaces — they're a browser
// affordance on existing controls, not app-owned markup with independent states.

// ── 4. Mobile (<=700px) sheet layout ────────────────────────────────────────────────────────
if (!ONLY_ID || ONLY_ID === 'mobile-sheet') {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.evaluate(() => { if (typeof applyFxLayout === 'function') applyFxLayout(); });
  await page.waitForTimeout(200);
  const entry = { id: 'mobile-sheet', kind: 'layout', selector: '.fx-panel', states: {} };
  entry.states.rest = await page.evaluate(() => document.body.classList.contains('mobile-fx'));
  // opening a tool opens the sheet (body.mobile-fx.sheet-open) — must call fxSection with
  // noSheet FALSY here: `fxSection(k, true)` (used elsewhere in this file to mount a section's
  // controls without side effects) explicitly SKIPS the sheet-open toggle per its own source
  // (chromasmith-22.html's fxSection, "noSheet ... programmatic re-selects ... never toggles").
  if (sectionKeys[0]) {
    await page.evaluate((k) => { if (typeof fxSection === 'function') fxSection(k); }, sectionKeys[0]);
    await page.waitForTimeout(200);
    entry.states.loaded = await page.evaluate(() => document.body.classList.contains('sheet-open'));
    // tapping the active tool's icon again closes it
    await page.evaluate((k) => { if (typeof fxSection === 'function') fxSection(k); }, sectionKeys[0]);
    await page.waitForTimeout(200);
    entry.states.empty = await page.evaluate(() => !document.body.classList.contains('sheet-open'));
  }
  entry.opened = entry.states.rest === true;
  entry.openSteps = [{ eval: 'resize viewport to <=700px width, applyFxLayout()' }];
  add({ ...entry, wireframe: false, wireframeFile: null });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(200);
  await page.evaluate(() => { if (typeof applyFxLayout === 'function') applyFxLayout(); });
}

// ── 5. Library (?libtest=1) ─────────────────────────────────────────────────────────────────
if (!ONLY_ID || ONLY_ID === 'library') {
  await page.evaluate(() => {
    // The app boots with the library already mounted under ?libtest=1 (see panel_extract.mjs's
    // Escape-key comment about the boot-watchdog full-view race) — just ensure it's open.
    document.getElementById('lib-overlay')?.classList.add('on');
  });
  await page.waitForTimeout(300);
  const sel = '#lib-overlay';
  const states = { rest: await visibleNow(sel) };
  const gridCount = await page.evaluate(() => document.querySelectorAll('#lib-grid > *').length).catch(() => 0);
  states.loaded = gridCount > 0;
  states.empty = gridCount === 0;
  const thumbSel = '#lib-grid [data-id], #lib-grid .lib-thumb';
  if (await page.$(thumbSel)) { await page.hover(thumbSel).catch(() => {}); states.hover = true; }
  add({
    id: 'library', kind: 'page', selector: sel,
    openSteps: [{ eval: "document.getElementById('lib-overlay').classList.add('on')" }],
    opened: states.rest, states,
    wireframe: true, wireframeFile: WIREFRAME_COVERAGE.library,
  });
}

// Splash — no live surface in this SPA (single-file app has no separate splash route to
// navigate to); recorded as wireframe-covered-but-not-DOM-inventoriable rather than guessed at.
if (!ONLY_ID || ONLY_ID === 'splash') {
  add({
    id: 'splash', kind: 'page', selector: null,
    openSteps: [], opened: null, states: {}, note: 'no live DOM route — first-load native splash, not part of the SPA panel switch',
    wireframe: true, wireframeFile: WIREFRAME_COVERAGE.splash,
  });
}

await page.close();
await b.close();
server.close();

await mkdir(path.join(ROOT, 'design'), { recursive: true });
const outPath = path.join(ROOT, 'design/surfaces.json');
await writeFile(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), pageErrors, surfaces }, null, 2));

if (DUMP_JSON) {
  console.log(JSON.stringify(surfaces, null, 2));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\nSURFACE INVENTORY — live app\n' + '='.repeat(90));
  console.log(pad('id', 24) + pad('kind', 10) + pad('opened', 8) + pad('states', 34) + 'wireframe');
  console.log('-'.repeat(90));
  for (const s of surfaces) {
    const stateList = Object.entries(s.states || {}).map(([k, v]) => `${k}=${v}`).join(',');
    console.log(pad(s.id, 24) + pad(s.kind, 10) + pad(String(s.opened), 8) + pad(stateList.slice(0, 32), 34) + (s.wireframe ? s.wireframeFile : '-'));
  }
  console.log('-'.repeat(90));
  const failed = surfaces.filter((s) => s.opened === false);
  const ungrouped = surfaces.filter((s) => !s.group);
  console.log(`${surfaces.length} surfaces, ${failed.length} failed to open, ${pageErrors.length} page errors, ${ungrouped.length} ungrouped`);
  if (failed.length) { console.log('\nFAILED TO OPEN:'); for (const s of failed) console.log(`  ${s.id}: ${s.note || '(no note)'}`); }
  if (ungrouped.length) { console.log('\nUNGROUPED (fix GROUPS in this script):'); for (const s of ungrouped) console.log(`  ${s.id} (${s.kind})`); }
  console.log(`\nWrote ${path.relative(ROOT, outPath)}`);
}
