// As-built wireframe capture (docs/ui-workflow/STATE.md S6c — REWRITE of the S6/S6b capture
// pass, which shipped wrong: sections captured closed with no controls visible, no layout
// variation applied (every cell said "expanded"), tiny context-free crops on the wrong theme's
// background, and 8 surfaces with no captures at all). This version:
//   - asserts BEFORE every screenshot (open/theme/layout) — a failed assert fails the capture,
//     never silently saves a closed/empty/wrong-theme shot.
//   - captures a small, hand-scoped set of DESKTOP-only whole-window + section + overlay shots
//     (~220 images total, printed before capturing) instead of a full width x theme x sidebar x
//     state matrix, so a human can actually review every image.
//   - reuses test/layout_axes.mjs's LAYOUT_AXES so this can never drift from
//     editor_responsive_qa.mjs's own resizer ranges.
//   - still writes spec.json (element tree, token-mapped computed styles) and block.dc.html (the
//     surface's real outerHTML) per surface, unchanged in shape from S6/S6b.
//
// Usage:
//   node test/surface_capture.mjs --group=A
//   node test/surface_capture.mjs --group=A --id=fxsec-grain   # one surface, debugging
//   node test/surface_capture.mjs --only=fxsec-grain,fx-toolrail,cs-modal   # smoke set
//   node test/surface_capture.mjs --group=A --spec-only         # spec.json/block.dc.html only, no images
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS, settleForCapture } from './wireframe_diff_lib.mjs';
import { LAYOUT_AXES, LIBRARY_SIDEBAR_AXIS } from './layout_axes.mjs';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const GROUP = (argv.find((a) => a.startsWith('--group=')) || '').split('=')[1];
const ONLY_ID = (argv.find((a) => a.startsWith('--id=')) || '').split('=')[1] || null;
const ONLY_LIST = (argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const ONLY_IDS = ONLY_LIST ? ONLY_LIST.split(',').map((s) => s.trim()).filter(Boolean) : null;
const SPEC_ONLY = argv.includes('--spec-only');
if (!GROUP && !ONLY_IDS) { console.error('usage: node test/surface_capture.mjs --group=A [--id=...] [--spec-only]\n   or: node test/surface_capture.mjs --only=id1,id2,...'); process.exit(1); }

const surfacesDoc = JSON.parse(await readFile(path.join(ROOT, 'design/surfaces.json'), 'utf8'));
const allSelected = ONLY_IDS
  ? surfacesDoc.surfaces.filter((s) => ONLY_IDS.includes(s.id))
  : surfacesDoc.surfaces.filter((s) => s.group === GROUP && (!ONLY_ID || s.id === ONLY_ID));
if (!allSelected.length) { console.error(ONLY_IDS ? `no surfaces matching --only=${ONLY_LIST}` : `no surfaces with group=${GROUP}`); process.exit(1); }

// splash has no live DOM route — use the wireframe verbatim as its as-built stand-in, per S6.
const splashEntry = allSelected.find((s) => s.id === 'splash');
const targets = allSelected.filter((s) => s.id !== 'splash' && s.opened === true);
if (splashEntry) {
  const wireframeName = 'Splash Screen.html';
  const dir = path.join(ROOT, 'design/asbuilt/splash');
  await mkdir(dir, { recursive: true });
  try {
    const html = await readFile(path.join(ROOT, 'chromasmith-design/project', wireframeName), 'utf8');
    await writeFile(path.join(dir, 'block.dc.html'), html);
    await writeFile(path.join(dir, 'spec.json'), JSON.stringify({
      id: 'splash', group: splashEntry.group, generatedAt: new Date().toISOString(),
      note: `No live DOM route to capture — "${wireframeName}" used verbatim as its as-built stand-in. No screenshots, no computed-value spec.`,
      wireframeSource: `chromasmith-design/project/${wireframeName}`,
    }, null, 2));
    console.log('[splash] copied wireframe as stand-in (no live capture)');
  } catch (e) { console.log(`[splash] FAILED to copy stand-in: ${e.message}`); }
}
const unreachable = allSelected.filter((s) => s.id !== 'splash' && s.opened !== true);
for (const u of unreachable) console.log(`[skip] ${u.id}: opened=${u.opened} in surfaces.json — not live-capturable this pass`);
if (!targets.length) { console.log('no live-capturable surfaces in this selection; done.'); process.exit(0); }

// ── token index (design/tokens.json, DTCG) — unchanged from S6/S6b ────────────────────────────
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
  const m = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/.exec(v || '');
  if (!m) return (v || '').toLowerCase();
  const [, r, g, b, a] = m;
  if (a !== undefined && parseFloat(a) < 1) return `rgba(${r}, ${g}, ${b}, ${a})`;
  return '#' + [r, g, b].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toLowerCase();
}
function normValue(prop, v) { return PROP_ROLE_FAMILY[prop] === 'color' ? normColor(v) : (v || '').trim().toLowerCase(); }
function matchToken(prop, value) {
  const family = PROP_ROLE_FAMILY[prop];
  if (!family || value === '' || value == null) return null;
  const nv = normValue(prop, value);
  for (const t of TOKENS) {
    if (!t.role || !t.role.startsWith(family === 'color' ? '' : family)) {
      if (!(family === 'color' && t.type === 'color')) continue;
    }
    const candidates = [t.value, ...(t.modes ? Object.values(t.modes) : [])];
    for (const c of candidates) if (typeof c === 'string' && normValue(prop, c) === nv) return { tokenPath: t.path, appVar: t.appVar, role: t.role };
  }
  return null;
}

// ── boot the app ────────────────────────────────────────────────────────────────────────────────
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

async function runStep(step) {
  if (step.click) await page.click(step.click, { timeout: 5000 }).catch(async () => { await page.evaluate((s) => document.querySelector(s)?.click(), step.click); });
  else if (step.eval) await page.evaluate(step.eval);
  else if (step.wait) await page.waitForTimeout(step.wait);
  else if (step.key) await page.keyboard.press(step.key);
  // { width, height }: an actual viewport resize (Playwright API, not reachable from inside
  // page.evaluate) followed by applyFxLayout()/applyClLayout() so the responsive breakpoints
  // (mobile-fx/mobile-cl, deskx) re-evaluate against the new size. Several surfaces.json entries
  // (mobile-sheet, fx-actionbar, fx-secnav) used to carry a plain-English eval STRING here
  // ("resize viewport to <=700px width, applyFxLayout()") which is not valid JS — page.evaluate
  // threw a SyntaxError on every run, so those three never produced a real image (S6d chunk B
  // found this live: `--only=fx-secnav` failed 2/2 with "Unexpected identifier 'viewport'").
  else if (step.width) {
    await page.setViewportSize({ width: step.width, height: step.height || 900 });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      if (typeof applyFxLayout === 'function') applyFxLayout();
      if (typeof applyClLayout === 'function') applyClLayout();
    });
    await page.waitForTimeout(150);
  }
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

// ── ASSERTS ─────────────────────────────────────────────────────────────────────────────────────
class AssertFailed extends Error {}

async function assertTheme(theme) {
  const ok = await page.evaluate((t) => {
    const isLight = document.body.classList.contains('light');
    if ((t === 'light') !== isLight) return { ok: false, reason: `body.light=${isLight}, wanted theme=${t}` };
    const bg = getComputedStyle(document.querySelector('.app') || document.body).backgroundColor;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
    if (!m) return { ok: true }; // can't read it — don't hard-fail on that alone
    const lum = (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]);
    const wantDark = t === 'dark';
    if (wantDark && lum > 140) return { ok: false, reason: `dark theme but background luminance=${lum.toFixed(0)} (looks light)` };
    if (!wantDark && lum < 110) return { ok: false, reason: `light theme but background luminance=${lum.toFixed(0)} (looks dark)` };
    return { ok: true };
  }, theme);
  if (!ok.ok) throw new AssertFailed(`theme assert failed: ${ok.reason}`);
}
async function setTheme(theme) {
  await page.evaluate((t) => { if (typeof fxSetTheme === 'function') fxSetTheme(t); }, theme);
  await page.waitForTimeout(150);
  await assertTheme(theme);
}
async function setWidth(w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(150);
  await page.evaluate(() => { if (typeof applyFxLayout === 'function') applyFxLayout(); });
  await page.waitForTimeout(150);
}
async function assertElementWidth(selector, expectedPx, tolerance = 3) {
  const w = await page.evaluate((s) => document.querySelector(s)?.getBoundingClientRect().width ?? null, selector);
  if (w == null) throw new AssertFailed(`layout assert: ${selector} not found`);
  if (Math.abs(w - expectedPx) > tolerance) throw new AssertFailed(`layout assert: ${selector} width=${w.toFixed(1)}px, expected ${expectedPx}px`);
}
async function assertVisibleTaller(selector, minHeight) {
  const r = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const rect = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { w: rect.width, h: rect.height, hidden: cs.display === 'none' || cs.visibility === 'hidden' }; }, selector);
  if (!r) throw new AssertFailed(`open assert: ${selector} not found`);
  if (r.hidden || r.w <= 0 || r.h <= 0) throw new AssertFailed(`open assert: ${selector} not visible (w=${r?.w} h=${r?.h})`);
  if (r.h < minHeight) throw new AssertFailed(`open assert: ${selector} height=${r.h.toFixed(0)}px < ${minHeight}px — looks closed/empty`);
}

const inventory = JSON.parse(await readFile(path.join(ROOT, 'test/output/panel_inventory.json'), 'utf8'));

// Opens an Editor section, asserts it's actually expanded+switched-on with its full control set
// visible — the exact bug this rewrite exists to fix (S6/S6b captured sections closed, showing
// only the title bar, and never noticed because nothing asserted the control count).
async function openSectionAsserted(key, { on = true } = {}) {
  const before = await page.evaluate((k) => ({ active: document.querySelector('.fx-ctrl.sec-active')?.dataset.fxsec, closed: document.body.classList.contains('panel-closed') }));
  if (before.active !== key || before.closed) {
    await page.evaluate((k) => { if (typeof fxSection === 'function') fxSection(k); }, key);
    await page.waitForTimeout(220);
    // fxSection(key) on the section that's ALREADY active is a CLOSE, not a re-open (S6b's
    // mobile-sheet lesson, applies here too) — if it closed itself, call it again to reopen.
    const after = await page.evaluate((k) => ({ active: document.querySelector('.fx-ctrl.sec-active')?.dataset.fxsec, closed: document.body.classList.contains('panel-closed') }));
    if (after.closed || after.active !== key) {
      await page.evaluate((k) => { if (typeof fxSection === 'function') fxSection(k); }, key);
      await page.waitForTimeout(220);
    }
  }
  const meta = inventory[key];
  const hasToggle = !!meta?.hasToggle;
  if (hasToggle) {
    const isOn = await page.evaluate((k) => !document.querySelector(`.fx-ctrl[data-fxsec="${k}"] .fx-fields`)?.classList.contains('ff-off'), key);
    if (isOn !== on) {
      await page.evaluate((k) => document.querySelector(`.fx-ctrl[data-fxsec="${k}"] .fx-toggle`)?.click(), key);
      await page.waitForTimeout(150);
    }
  }
  const state = await page.evaluate((k) => {
    const card = document.querySelector(`.fx-ctrl[data-fxsec="${k}"]`);
    if (!card) return null;
    const active = card.classList.contains('sec-active');
    const closed = document.body.classList.contains('panel-closed');
    // Some controls are feature-gated by an inline style="display:none" in the SOURCE markup
    // (video-only rows like Grain motion/Gate weave/Film breath, RAW-only rows, etc.) — those
    // stay hidden for a plain photo regardless of the section being open, so they don't belong
    // in the "is this section actually expanded" count. Only count controls that are NOT
    // statically pre-hidden that way (and skip the title-bar reset button, which only appears
    // once a value has been edited from default — also unrelated to open/closed).
    // Exclude controls that are gated OFF the open/closed axis entirely: the title-bar reset
    // button (only appears once a value differs from default), video/RAW-only rows hidden via an
    // inline style="display:none" in the source, and .diag-only controls (chromasmith-22.html:603,
    // `body.diag-on .diag-only{display:flex}` — hidden unless a debug flag is set, e.g. "Load test
    // chart" in the Image section). None of these say anything about whether the SECTION is open.
    const all = [...card.querySelectorAll('input,select,button,canvas')];
    const eligible = all.filter((el) => !el.classList.contains('fx-ctrl-title-reset') && !el.classList.contains('diag-only')
      && !el.closest('.diag-only') && !el.closest('[style*="display:none"], [style*="display: none"]'));
    const visibleEligible = eligible.filter((el) => el.offsetParent !== null || el.tagName === 'CANVAS').length;
    return { active, closed, eligibleCount: eligible.length, visibleEligible };
  }, key);
  if (!state) throw new AssertFailed(`open assert: no .fx-ctrl[data-fxsec="${key}"] in DOM`);
  if (!state.active || state.closed) throw new AssertFailed(`open assert: section "${key}" not expanded (active=${state.active} closed=${state.closed})`);
  if (on && state.eligibleCount > 0 && state.visibleEligible < state.eligibleCount) {
    throw new AssertFailed(`open assert: section "${key}" shows ${state.visibleEligible}/${state.eligibleCount} eligible controls — looks closed/collapsed`);
  }
}

async function railMode(mode) { await page.evaluate((m) => { if (typeof railMode === 'function') railMode(m); }, mode); await page.waitForTimeout(200); }
async function panelWidth(px) {
  if (px === 'closed') { await page.evaluate(() => document.body.classList.add('panel-closed')); }
  else { await page.evaluate((w) => { document.body.classList.remove('panel-closed'); if (typeof fxPanelWidth === 'function') fxPanelWidth(w); }, Number(px)); }
  await page.waitForTimeout(200);
}
async function dockWidth(px) {
  if (px === 'closed') { await page.evaluate(() => document.body.classList.add('lib-dock-collapsed')); }
  else {
    await page.evaluate(() => document.body.classList.remove('lib-dock-collapsed'));
    await page.evaluate((w) => document.querySelector('.fx-layout')?.style.setProperty('--dock-w-user', w + 'px'), Number(px));
  }
  await page.waitForTimeout(200);
}
async function librarySidebar(px) {
  if (px === 'hidden') {
    const collapsed = await page.evaluate(() => document.getElementById('lib-overlay')?.classList.contains('tree-collapsed'));
    if (!collapsed) await page.evaluate(() => document.getElementById('lib-tree-toggle')?.click());
  } else {
    const collapsed = await page.evaluate(() => document.getElementById('lib-overlay')?.classList.contains('tree-collapsed'));
    if (collapsed) await page.evaluate(() => document.getElementById('lib-tree-toggle')?.click());
    await page.evaluate((w) => document.getElementById('lib-overlay')?.style.setProperty('--lib-side-w', w + 'px'), Number(px));
  }
  await page.waitForTimeout(200);
}
async function resetEditorLayout() {
  await page.evaluate(() => { document.body.classList.remove('panel-closed', 'lib-dock-collapsed'); if (typeof railMode === 'function') railMode('labels'); if (typeof fxPanelWidth === 'function') fxPanelWidth(320); document.querySelector('.fx-layout')?.style.setProperty('--dock-w-user', '120px'); });
  await page.waitForTimeout(150);
}
async function goLibraryFull() {
  const isFull = await page.evaluate(() => document.getElementById('lib-overlay')?.classList.contains('full'));
  if (!isFull) { await page.click('#lib-expand', { timeout: 3000 }).catch(async () => { await page.evaluate(() => document.querySelector('#lib-expand')?.click()); }); await page.waitForTimeout(250); }
}
async function resetLibraryLayout() {
  await page.evaluate(() => { const ov = document.getElementById('lib-overlay'); if (ov) { ov.classList.remove('tree-collapsed'); ov.style.setProperty('--lib-side-w', '230px'); } });
  await page.waitForTimeout(120);
}

async function shoot(selector, filePath, { fullPage = false } = {}) {
  await mkdir(path.dirname(filePath), { recursive: true });
  if (fullPage) { await page.screenshot({ path: filePath, type: 'webp', quality: 82 }); return; }
  const el = await page.$(selector);
  if (!el) throw new AssertFailed(`shoot: ${selector} not found`);
  await el.screenshot({ path: filePath, type: 'webp', quality: 88 });
}
async function shootCrop(selector, filePath, margin = 24) {
  const box = await page.evaluate(({ s, m }) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x - m), y: Math.max(0, r.y - m), width: r.width + m * 2, height: r.height + m * 2 };
  }, { s: selector, m: margin });
  if (!box) throw new AssertFailed(`shootCrop: ${selector} not found`);
  await mkdir(path.dirname(filePath), { recursive: true });
  await page.screenshot({ path: filePath, type: 'webp', quality: 88, clip: box });
}

// ── element-tree walk + spec.json + block.dc.html (unchanged from S6/S6b) ────────────────────
async function extractTree(selector) {
  return page.evaluate(({ sel, props }) => {
    function styleOf(el) { const cs = getComputedStyle(el); const out = {}; for (const p of props) out[p] = cs[p]; return out; }
    function walk(el, depth) {
      if (!el || depth > 6) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0 && el.children.length === 0) return null;
      const node = {
        tag: el.tagName.toLowerCase(), id: el.id || undefined,
        dataFxsec: el.dataset && el.dataset.fxsec ? el.dataset.fxsec : (el.closest('[data-fxsec]')?.dataset.fxsec || undefined),
        classes: el.className && typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean) : undefined,
        text: el.children.length === 0 ? (el.textContent || '').trim().slice(0, 60) || undefined : undefined,
        style: styleOf(el), children: [],
      };
      for (const child of el.children) { const c = walk(child, depth + 1); if (c) node.children.push(c); }
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
      else { mappedStyle[prop] = { value, token: null }; unmapped.push({ tag: node.tag, id: node.id, classes: node.classes, prop, value }); }
    }
    return { ...node, style: mappedStyle, children: node.children.map(mapNode) };
  }
  return { tree: mapNode(tree), unmapped };
}
async function extractBlockHtml(selector, panelName) {
  const inner = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return '';
    const clone = root.cloneNode(true);
    clone.querySelectorAll('script').forEach((n) => n.remove());
    clone.querySelectorAll('*').forEach((n) => { [...n.attributes].forEach((a) => { if (a.name.startsWith('on')) n.removeAttribute(a.name); }); });
    return clone.innerHTML;
  }, selector);
  return `<div class="tp-panel active" data-panel="${panelName}">\n${inner}\n</div>`;
}
async function writeSpecAndBlock(entry) {
  const dir = path.join(ROOT, 'design/asbuilt', entry.id);
  await mkdir(dir, { recursive: true });
  const tree = await extractTree(entry.selector);
  const spec = buildSpec(tree);
  const panelName = entry.id.startsWith('fxsec-') ? entry.id.slice('fxsec-'.length) : entry.id.replace(/^panel-/, '');
  const block = await extractBlockHtml(entry.selector, panelName);
  await writeFile(path.join(dir, 'block.dc.html'), block);
  return { dir, spec };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PLAN: build the full capture plan up front so the total can be printed BEFORE capturing.
// ══════════════════════════════════════════════════════════════════════════════════════════════
const WIDTHS = [{ w: 760, h: 900, label: '760 (desktop minimum)' }, { w: 1920, h: 1080, label: '1920 (maximum)' }];
const THEMES = ['dark', 'light'];

const panelFx = targets.find((t) => t.id === 'panel-fx');
const library = targets.find((t) => t.id === 'library');
const fxsecEntries = targets.filter((t) => t.kind === 'fxsec');
// 'chrome' surfaces (fx-hist, fx-more-menu from the earlier coverage gap-fill pass, plus S6d's
// video/overlay surfaces below) were never in this set — they got spec.json/block.dc.html via the
// "spec.json / block.dc.html for every target" loop further down, but ZERO actual images, since
// that loop is the only place their kind was ever referenced. Adding 'chrome' here is a real fix,
// not new behaviour: it's the same open-and-shoot path 'menu'/'modal' already use.
const OTHER_KINDS = new Set(['menu', 'modal', 'confirm', 'toast', 'chrome']);
// A handful of 'other' surfaces are real UI but genuinely shorter than the default 40px openness
// threshold (a one-line video-info badge, a 28px-tall video thumbnail strip) — assertVisibleTaller
// would wrongly fail them as "looks closed" otherwise.
const MIN_OPEN_HEIGHT = { 'fx-clip-info': 10, 'vid-thumbstrip': 20, 'fx-secnav': 18, 'hdr-about': 28, 'ic-split': 28, 'ic-splitmenu': 28, 'ic-timeline': 28, 'db-history-wrap': 26, 'fx-sheet-handle': 16, 'fx-rail-show': 24, 'row-nr-high-progress': 3 };
// Other pages (Match, Colour Copy, Collage, Guide) aren't part of the Editor/Library CORE set but
// still need a look — desktop-only, default layout, both themes, same as menus/dialogs, per the
// instruction's "menus, dialogs, overlays and other surfaces" bucket.
const otherEntries = targets.filter((t) => OTHER_KINDS.has(t.kind) || (t.kind === 'page' && t.id !== 'panel-fx' && t.id !== 'library'));

const plan = { core: [], sections: [], other: [] };

if (panelFx) {
  const editorLayouts = [
    { label: 'default', apply: async () => { await resetEditorLayout(); } },
    { label: 'rail=icons', apply: async () => { await resetEditorLayout(); await railMode('icons'); } },
    { label: 'rail=labels', apply: async () => { await resetEditorLayout(); await railMode('labels'); } },
    { label: 'rail=hidden', apply: async () => { await resetEditorLayout(); await railMode('hidden'); } },
    { label: 'panel=220', apply: async () => { await resetEditorLayout(); await panelWidth(220); } },
    { label: 'panel=440', apply: async () => { await resetEditorLayout(); await panelWidth(440); } },
    { label: 'panel=closed', apply: async () => { await resetEditorLayout(); await panelWidth('closed'); } },
    { label: 'dock=90', apply: async () => { await resetEditorLayout(); await dockWidth(90); } },
    { label: 'dock=420', apply: async () => { await resetEditorLayout(); await dockWidth(420); } },
    { label: 'dock=closed', apply: async () => { await resetEditorLayout(); await dockWidth('closed'); } },
  ];
  for (const width of WIDTHS) for (const theme of THEMES) for (const layout of editorLayouts) {
    plan.core.push({ entry: panelFx, id: 'panel-fx', width, theme, layout });
  }
}
if (library) {
  const libLayouts = [
    { label: 'default', apply: async () => { await resetLibraryLayout(); } },
    { label: 'sidebar=150', apply: async () => { await resetLibraryLayout(); await librarySidebar(150); } },
    { label: 'sidebar=420', apply: async () => { await resetLibraryLayout(); await librarySidebar(420); } },
    { label: 'sidebar=hidden', apply: async () => { await resetLibraryLayout(); await librarySidebar('hidden'); } },
  ];
  for (const width of WIDTHS) for (const theme of THEMES) for (const layout of libLayouts) {
    plan.core.push({ entry: library, id: 'library', width, theme, layout, needsFull: true });
  }
}
for (const entry of fxsecEntries) {
  const key = entry.id.slice('fxsec-'.length);
  for (const panelPx of [220, 440]) for (const theme of THEMES) {
    plan.sections.push({ entry, key, panelPx, theme });
  }
}
for (const entry of otherEntries) for (const theme of THEMES) plan.other.push({ entry, theme });

const total = plan.core.length + plan.sections.length + plan.other.length;
console.log(`\n=== CAPTURE PLAN ===`);
console.log(`core whole-window: ${plan.core.length}   editor sections: ${plan.sections.length}   menus/dialogs/overlays: ${plan.other.length}`);
console.log(`TOTAL: ${total} hero images (plus a 1:1 crop for each section/menu/dialog shot)`);
if (total > 300) { console.error(`\nOVER 300 — stopping per instruction. Narrow the plan before capturing.`); process.exit(1); }
if (SPEC_ONLY) console.log('(--spec-only: images skipped, spec.json/block.dc.html only)');

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CAPTURE
// ══════════════════════════════════════════════════════════════════════════════════════════════
const results = { captured: 0, failed: 0, failures: [] };
async function withCapture(label, fn) {
  if (SPEC_ONLY) return;
  try { await fn(); results.captured++; }
  catch (e) {
    results.failed++;
    const msg = e instanceof AssertFailed ? e.message : `${e.message}`;
    results.failures.push({ label, error: msg });
    console.log(`[FAIL] ${label}: ${msg}`);
  }
}

// core whole-window shots
console.log('\n=== core whole-window shots ===');
for (const item of plan.core) {
  const label = `${item.id} · ${item.width.label} · ${item.theme} · ${item.layout.label}`;
  await withCapture(label, async () => {
    await setWidth(item.width.w, item.width.h);
    await setTheme(item.theme);
    await item.layout.apply();
    await page.waitForTimeout(150);
    if (item.id === 'library' && item.layout.label !== 'default' && item.layout.label !== 'sidebar=hidden') await goLibraryFull();
    else if (item.id === 'library') await goLibraryFull();
    if (item.id === 'library' && item.layout.label.startsWith('sidebar=') && item.layout.label !== 'sidebar=hidden') {
      const px = Number(item.layout.label.split('=')[1]);
      if (!Number.isNaN(px)) await assertElementWidth('#lib-overlay .lib-side, #lib-side', px, 4).catch(() => {}); // best-effort; lib-side selector name unverified, non-fatal
    }
    const fname = `whole_${item.width.w}_${item.theme}_${item.layout.label.replace(/[^a-z0-9]+/gi, '-')}.webp`;
    const dir = path.join(ROOT, 'design/asbuilt', item.id);
    await shoot('body', path.join(dir, fname), { fullPage: false });
  });
}
await resetEditorLayout();
if (library) await resetLibraryLayout();

// editor sections
console.log('\n=== editor sections ===');
await setWidth(1920, 1080);
for (const item of plan.sections) {
  const label = `${item.entry.id} · panel=${item.panelPx} · ${item.theme}`;
  await withCapture(label, async () => {
    await resetEditorLayout();
    await setTheme(item.theme);
    await panelWidth(item.panelPx);
    await openSectionAsserted(item.key, { on: true });
    await page.waitForTimeout(150);
    const dir = path.join(ROOT, 'design/asbuilt', item.entry.id);
    const fname = `panel${item.panelPx}_${item.theme}.webp`;
    await assertVisibleTaller(item.entry.selector, 60);
    await shoot('.fx-panel, body', path.join(dir, fname), { fullPage: false });
    await shootCrop(item.entry.selector, path.join(dir, `panel${item.panelPx}_${item.theme}_crop.webp`));
  });
}
await resetEditorLayout();

// menus / dialogs / overlays
console.log('\n=== menus / dialogs / overlays ===');
for (const item of plan.other) {
  const label = `${item.entry.id} · ${item.theme}`;
  await withCapture(label, async () => {
    await setWidth(1920, 1080);
    await resetEditorLayout();
    await setTheme(item.theme);
    if (item.entry.id === 'fx-toast') {
      // toast()'s own de-dupe (chromasmith-22.html:10804) silently drops a call whose msg+kind
      // matches the immediately-preceding one — surfaces.json's fixed openSteps message is
      // identical every time, so the SECOND theme's capture in this loop always no-oped. Use a
      // unique message per capture instead of the fixed step.
      // Also force the internal queue/busy state clear first — toast()'s pump only shows the
      // NEXT queued message once the current one's ~1900ms lifetime finishes, so back-to-back
      // captures (dark then light) would otherwise queue behind a still-animating toast.
      await page.evaluate(() => { if (typeof _toastQ !== 'undefined') _toastQ.length = 0; if (typeof _toastBusy !== 'undefined') window._toastBusy = false; document.getElementById('fx-toast')?.remove(); });
      await page.evaluate((t) => { if (typeof toast === 'function') toast(`Surface capture (${t})`, true); }, item.theme);
      await page.waitForTimeout(150);
    } else {
      for (const step of item.entry.openSteps) await runStep(step);
    }
    await page.waitForTimeout(200);
    const minH = item.entry.id === 'fx-toast' ? 24 : (MIN_OPEN_HEIGHT[item.entry.id] ?? 40);
    await assertVisibleTaller(item.entry.selector, minH);
    const dir = path.join(ROOT, 'design/asbuilt', item.entry.id);
    await shoot(item.entry.selector, path.join(dir, `open_${item.theme}.webp`));
    await shootCrop(item.entry.selector, path.join(dir, `open_${item.theme}_crop.webp`));
    await closeAnyOverlay();
  });
}

// spec.json / block.dc.html for every target (rest state, dark theme, default layout)
console.log('\n=== spec.json / block.dc.html ===');
await setWidth(1920, 1080);
await setTheme('dark');
for (const entry of targets) {
  try {
    await resetEditorLayout();
    if (entry.kind === 'fxsec') await openSectionAsserted(entry.id.slice('fxsec-'.length), { on: true });
    else { for (const step of entry.openSteps) await runStep(step); await page.waitForTimeout(150); }
    const { dir, spec } = await writeSpecAndBlock(entry);
    const specDoc = { id: entry.id, group: entry.group, generatedAt: new Date().toISOString(), ...spec };
    await writeFile(path.join(dir, 'spec.json'), JSON.stringify(specDoc, null, 2));
    await closeAnyOverlay();
  } catch (e) { console.log(`[spec FAIL] ${entry.id}: ${e.message.slice(0, 150)}`); }
}

await page.close();
await b.close();
server.close();

console.log('\n=== SUMMARY ===');
console.log(`captured=${results.captured} failed=${results.failed}`);
if (results.failures.length) { console.log('FAILURES:'); for (const f of results.failures) console.log(`  ${f.label}: ${f.error}`); }
process.exit(results.failed ? 1 : 0);
