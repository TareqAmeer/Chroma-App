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
// Usage:
//   node test/surface_capture.mjs --group=A
//   node test/surface_capture.mjs --group=A --id=fxsec-looks   # one surface, debugging
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS, settleForCapture } from './wireframe_diff_lib.mjs';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const GROUP = (argv.find((a) => a.startsWith('--group=')) || '').split('=')[1];
const ONLY_ID = (argv.find((a) => a.startsWith('--id=')) || '').split('=')[1] || null;
if (!GROUP) { console.error('usage: node test/surface_capture.mjs --group=A [--id=...]'); process.exit(1); }

const surfacesDoc = JSON.parse(await readFile(path.join(ROOT, 'design/surfaces.json'), 'utf8'));
const targets = surfacesDoc.surfaces.filter((s) => s.group === GROUP && (!ONLY_ID || s.id === ONLY_ID));
if (!targets.length) { console.error(`no surfaces with group=${GROUP}`); process.exit(1); }

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
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.otf': 'font/otf', '.wasm': 'application/wasm' };
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
}

await page.close();
await b.close();
server.close();

console.log('\n=== SUMMARY ===');
for (const r of report) {
  console.log(`${r.id}: written=${r.statesWritten ? r.statesWritten.length : 0} missing=${r.statesMissing ? r.statesMissing.join('|') : '-'}${r.specError ? ' specError=' + r.specError : ''}`);
}
const totalMissing = report.reduce((n, r) => n + (r.statesMissing ? r.statesMissing.length : 0), 0);
console.log(`\n${report.length} surfaces, ${totalMissing} missing states total`);
