// Redesign phase 0: the full UI inventory, scanned from the running app rather than typed by hand.
// Walks every page, every Editor section, every mask type, the Library and the catalog (the same
// boot as test/component_runtime_check.mjs), then reports:
//   1. the 13 registered component families and their live counts,
//   2. every OTHER visible interactive/visual control, clustered by tag + class signature — the
//      special controls (wheels, curves, crop handles, thumbnails, resizers ...) no family covers,
//   3. the as-built surfaces (design/asbuilt/) and whether each was reachable in this walk.
// Writes design/prototypes/swiss-kinetic/inventory.json + inventory.md.
// Usage: node scripts/build-desktop.mjs && node scripts/redesign-inventory.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS } from '../test/wireframe_diff_lib.mjs';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'design/prototypes/swiss-kinetic');
const server = createServer(async (req, res) => {
  try { const u = decodeURIComponent(req.url.split('?')[0]); const d = await readFile(path.join(ROOT, u.slice(1))); res.writeHead(200, { 'Content-Type': u.endsWith('.html') ? 'text/html' : u.endsWith('.js') ? 'text/javascript' : u.endsWith('.css') ? 'text/css' : 'application/octet-stream' }); res.end(d); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}/desktop/dist/index.html`;
const browser = await chromium.launch({ args: DETERMINISTIC_LAUNCH_ARGS });

const FAMILIES = [
  ['section-card','.fx-ctrl'],['control-row','.fx-row'],['toggle','.fx-toggle,.opt-toggle'],
  ['slider','input[type=range],.fx-slider'],['select','select,.fx-select'],['segmented-control','.seg,.lib-seg'],
  ['button','button,.btn,.lib-btn'],['icon-button','.btn-icon,.lib-btn-icon,.lib-iconchip'],
  ['chip','.lib-chip'],['info-button','.fx-info-i'],['search-input','.lib-search-wrap'],
  ['menu','.lib-menu,.fx-settings-menu,.fx-bgmenu']
];
const SURFACES = (await readdir(path.join(ROOT, 'design/asbuilt'), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);

const SCAN = `([state, families, surfaces]) => {
  const vis = (el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0; };
  const famSel = families.map((f) => f[1]).join(',');
  const fam = {}; for (const [f, s] of families) fam[f] = [...document.querySelectorAll(s)].filter(vis).length;
  const CUR = /^(pointer|grab|grabbing|col-resize|row-resize|ew-resize|ns-resize|move|crosshair|nwse-resize|nesw-resize|e-resize|w-resize|n-resize|s-resize)$/;
  const other = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.matches(famSel) || el.closest(famSel.split(',').filter(s=>!/fx-ctrl|fx-row|menu/.test(s)).join(','))) continue;
    const tag = el.tagName.toLowerCase();
    if (/^(script|style|svg|path|g|use|circle|rect|line|polyline|polygon|defs|option|br|b|i|em|strong|span|label)$/.test(tag) && !el.getAttribute('onclick')) continue;
    const cs = getComputedStyle(el);
    const interactive = /^(input|textarea|canvas|video|img|a)$/.test(tag) || el.hasAttribute('onclick') || el.hasAttribute('draggable') || el.isContentEditable
      || /^(slider|tab|button|menuitem|checkbox|radio|switch|option|separator|listbox|gridcell)$/.test(el.getAttribute('role') || '')
      || (CUR.test(cs.cursor) && el.parentElement && getComputedStyle(el.parentElement).cursor !== cs.cursor);
    if (!interactive || !vis(el)) continue;
    const cls = [...el.classList].filter((c) => !/^(on|active|sel|selected|hover|dis|disabled|open|show|hidden|full|loaded|hot|is-cat-hover)$/.test(c)).sort().slice(0, 3).join('.');
    const sig = tag + (el.getAttribute('type') ? '[' + el.getAttribute('type') + ']' : '') + (cls ? '.' + cls : el.id ? '#' + el.id : '');
    const host = el.closest('[id]');
    other.push({ sig, cursor: cs.cursor, role: el.getAttribute('role') || '', host: host ? host.id : '', label: (el.getAttribute('aria-label') || el.title || el.alt || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60) });
  }
  const surf = surfaces.filter((id) => { const el = document.getElementById(id) || document.querySelector('.' + CSS.escape(id)) || document.querySelector('[data-fxsec="' + id.replace(/^fxsec-/, '') + '"]'); return el && vis(el); });
  return { state, fam, other, surf };
}`;
const results = [];
async function scan(page, state) { results.push(await page.evaluate(`(${SCAN})(${JSON.stringify([state, FAMILIES, SURFACES])})`)); }
async function boot(query = '?libtest=1&deskx=1', viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport, ...DETERMINISTIC_CONTEXT_OPTIONS });
  await page.goto(base + query, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => { document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); }); if (typeof applyFxLayout === 'function') applyFxLayout(); });
  await page.keyboard.press('Escape');
  return page;
}

const page = await boot();
const fixture = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
await page.evaluate(async (b64) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); await loadFXImages([new File([bytes], 'portrait.png', { type: 'image/png' })]); }, fixture);
for (const tab of ['fx', 'match', 'copy', 'collage', 'guide']) { await page.evaluate((x) => switchTab(x), tab); await page.waitForTimeout(80); await scan(page, `page:${tab}`); }
await page.evaluate(() => switchTab('fx'));
const sections = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-fxsec]')].map((e) => e.dataset.fxsec))]);
for (const s of sections) { try { await page.evaluate((x) => fxSection(x, true), s); await page.waitForTimeout(60); await scan(page, `editor:${s}`); } catch { /* section not openable in this build */ } }
await page.evaluate(() => {
  fxSection('local', true); fxUpdate = () => {};
  const core = window.__TAURI__ && window.__TAURI__.core;
  if (core && !core.__invWrapped) { const real = core.invoke.bind(core); core.invoke = (cmd, args) => /^(sam_|sam2_|depth_|faceparse_)/.test(cmd) ? Promise.reject(new Error('offline')) : real(cmd, args); core.__invWrapped = true; }
});
for (const type of ['radial', 'linear', 'brush', 'sky', 'skin', 'coat', 'ai', 'color', 'lum', 'depth']) {
  try { await page.evaluate((t) => { fxState.masks = []; mskSel = 0; if (t === 'depth' && curItem()?.img) curItem().img._depthMapAttempted = true; mskAdd(t); }, type); await scan(page, `editor:masks-${type}`); } catch {}
}
await page.evaluate(() => { if (window.chromasmithForceLibraryReady) chromasmithForceLibraryReady(); document.getElementById('lib-overlay')?.classList.add('on', 'full'); });
await page.waitForTimeout(200); await scan(page, 'library:full');
await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => { document.getElementById('lib-overlay')?.classList.remove('full'); if (typeof applyFxLayout === 'function') applyFxLayout(); }); await page.waitForTimeout(100); await scan(page, 'mobile');
await page.close();
const catalog = await boot('?catalog=1&libtest=1&deskx=1'); await scan(catalog, 'catalog'); await catalog.close();
await browser.close(); server.close();

// ---- aggregate ----
const famMax = {}; for (const r of results) for (const [f, n] of Object.entries(r.fam)) famMax[f] = Math.max(famMax[f] || 0, n);
const clusters = new Map();
for (const r of results) for (const o of r.other) {
  const c = clusters.get(o.sig) || { sig: o.sig, count: 0, states: new Set(), hosts: new Set(), labels: new Set(), cursor: o.cursor, role: o.role };
  c.count++; c.states.add(r.state); if (o.host) c.hosts.add(o.host); if (o.label) c.labels.add(o.label); clusters.set(o.sig, c);
}
const special = [...clusters.values()].map((c) => ({ sig: c.sig, seen: c.count, states: [...c.states].length, cursor: c.cursor, role: c.role, hosts: [...c.hosts].slice(0, 4), examples: [...c.labels].slice(0, 3) })).sort((a, b) => b.states - a.states || b.seen - a.seen);
const reached = new Set(results.flatMap((r) => r.surf));
const surfaces = SURFACES.map((id) => ({ id, reachedInWalk: reached.has(id) }));
const registry = JSON.parse(await readFile(path.join(ROOT, 'design/components.json'), 'utf8'));
const doc = { generatedAt: new Date().toISOString(), states: results.map((r) => r.state), families: famMax, registryUnlocated: { dynamic: registry.coverage?.dynamicInstances || [], withoutStableSelector: registry.coverage?.withoutStableSelector || [] }, special, surfaces };
await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, 'inventory.json'), JSON.stringify(doc, null, 2) + '\n');


// User decisions (2026-09-23). 'new' = own design pass in the playground; 'restyle-neutral' = square
// + new tokens but kept quiet over the photo; everything else defaults to 'restyle' (tokens only).
const NEW = /lib-card|lib-grid|filmstrip|thumbstrip|lib-side|lib-coll(-row|-heading|ections)|lib-tree|lib-folders|lib-top|fx-deskbar|window|wordmark|splash/;
const NEUTRAL = /cv-curve|cv-wheel|msk-paint|fx-crop-overlay|fx-split-line|fx-hist|fx-mask-overlay|fx-guides-overlay|fx-canvas|fx-zoom-wrap|Histogram/;
const decide = (key) => NEUTRAL.test(key) ? 'restyle-neutral' : NEW.test(key) ? 'new' : 'restyle';
const md = [];
md.push('# Swiss Kinetic redesign — UI inventory', '', `Generated by \`node scripts/redesign-inventory.mjs\` from a live walk of ${results.length} app states. Do not hand-edit the lists; re-run the scan. Decisions follow the rules in the script (user, 2026-09-23); override by editing those rules, not the table. Values: \`new\` (new design), \`restyle\` (tokens only) or \`leave\`.`, '');
md.push('## 1. Component families (registry)', '', '| Family | Max visible in one state | Decision |', '|---|---|---|');
for (const [f] of FAMILIES) md.push(`| ${f} | ${famMax[f] || 0} | new |`);
md.push(`| icon (glyphs) | ${registry.families?.icon ?? '?'} in source | restyle |`);
md.push('', `Registry instances it can't locate by source: ${doc.registryUnlocated.dynamic.length} dynamic + ${doc.registryUnlocated.withoutStableSelector.length} without a stable selector. They're listed in inventory.json and get styled with their family.`, '');
md.push('## 2. Special controls outside the families', '', '| Control (tag.class) | States seen in | Cursor | Where | Example | Decision |', '|---|---|---|---|---|---|');
for (const s of special) md.push(`| \`${s.sig}\` | ${s.states} | ${s.cursor} | ${s.hosts.join(', ')} | ${s.examples.join(' / ').replace(/\|/g, '/')} | ${decide(s.sig + ' ' + s.hosts.join(' '))} |`);
md.push('', '## 3. Surfaces (screens, panels, pop-ups)', '', 'Unreached ones are modals/menus/overlays that only open on a user action; each still gets a look once the new parts land.', '', '| Surface | Reached in walk | Decision |', '|---|---|---|');
for (const s of surfaces) md.push(`| ${s.id} | ${s.reachedInWalk ? 'yes' : 'no'} | ${decide(s.id)} |`);
// Parts no DOM walk can see as a 'control': global styling rules and native chrome. Counted from source.
const src = (await readFile(path.join(ROOT, 'chromasmith-22.html'), 'utf8')) + (await readFile(path.join(ROOT, 'desktop/library-ui.js'), 'utf8'));
const cnt = (re) => (src.match(re) || []).length;
md.push('', '## 4. Global parts no scan can click', '', 'Styled by global rules, not by a component. Counts are rule/attribute occurrences in source.', '', '| Part | Source count | Decision |', '|---|---|---|');
for (const [name, re] of [['Scrollbars', /::-webkit-scrollbar/g], ['Focus ring (:focus-visible)', /:focus-visible/g], ['Tooltips (title=)', /\btitle="/g], ['Text selection (::selection)', /::selection/g], ['Progress bars / spinners', /progress|spin\b|@keyframes \w*spin/gi], ['Toasts', /fx-toast|lib-toast/g], ['Star / flag / reject markers', /lib-flag|lib-star|rating/g], ['Histogram', /fx-hist/g]]) md.push(`| ${name} | ${cnt(re)} | ${decide(name)} |`);
md.push('| Window buttons (native, to become custom squares) | Tauri config | new |', '| Wordmark CHRO-MA-SMITH | new | new |', '| Splash / loading screen | 1 surface | new |');
await writeFile(path.join(OUT_DIR, 'inventory.md'), md.join('\n') + '\n');
console.log(`inventory: ${results.length} states, ${FAMILIES.length} families, ${special.length} special-control clusters, ${surfaces.length} surfaces (${surfaces.filter((s) => s.reachedInWalk).length} reached)`);
