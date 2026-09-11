#!/usr/bin/env node
// Surface coverage: every major REGION of the app must have its own entry in design/surfaces.json.
//
// Added 2026-09-11. The S5 inventory listed pages, panel sections, menus and dialogs, but not the
// app's chrome — Editor top bar, tool rail, docked filmstrip, Library top bar/sidebar, status
// bars — so the review page (S7) had nowhere to show them and a clipped tool rail went unseen.
// The hole was structural: "panel-fx" (the whole Editor page) CONTAINS the rail, so anything that
// asked "is this element inside a listed surface?" said yes for everything. This check only
// counts a region as covered when a surface's `selector` resolves to THAT element (or its
// `covers` list names the region's id) — containment by a bigger surface does not count.
//
// A "region" = a visible element with an id, at least 1% of the viewport, that is either a direct
// child of a top-level layout container (body, main, .fx-layout, #lib-overlay) or named/tagged as
// chrome (bar, rail, top, bottom, status, side, strip, dock, panel, nav, header, aside, footer).
// Scanned in the three real layouts: Editor with a photo + docked filmstrip, Library full view,
// and phone width.
//
//   node test/surface_coverage_check.mjs          # PASS/FAIL, exit 1 on any uncovered region
//   node test/surface_coverage_check.mjs --json
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS, settleForCapture } from './wireframe_diff_lib.mjs';

const ROOT = process.cwd();
const surfaces = JSON.parse(await readFile(path.join(ROOT, 'design/surfaces.json'), 'utf8')).surfaces;

const server = createServer(async (req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const d = await readFile(path.join(ROOT, u.slice(1)));
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm' };
    res.writeHead(200, { 'Content-Type': types[path.extname(u)] || 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));

const REGION_FN = `(surfaces) => {
  const RE = /(bar|rail|top|bottom|status|side|strip|dock|panel|nav|grid|main)/i;
  // Structural, not just by name: any id'd direct child of a top-level layout container is a region
  // too — a name-only rule is exactly how #lib-bottom (the Library status bar) would slip through.
  const LAYOUT_PARENTS = new Set([document.body, document.querySelector('main'), document.querySelector('.fx-layout'), document.getElementById('lib-overlay')].filter(Boolean));
  const minArea = innerWidth * innerHeight * 0.01;
  const exact = new Set(), coversIds = new Set();
  for (const s of surfaces) {
    for (const id of (s.covers || [])) coversIds.add(id);
    if (!s.selector) continue;
    try { document.querySelectorAll(s.selector).forEach((el) => exact.add(el)); } catch {}
  }
  const out = [];
  for (const el of document.querySelectorAll('[id]')) {
    if (!(RE.test(el.id) || LAYOUT_PARENTS.has(el.parentElement) || /^(HEADER|NAV|ASIDE|FOOTER)$/.test(el.tagName))) continue;
    if (/resizer|btn|-ic$|-lb$|-v$/.test(el.id)) continue; // handles and controls, not regions
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const b = el.getBoundingClientRect();
    if (b.width * b.height < minArea) continue;
    // A region nested inside another region of the same kind is part of it (e.g. a toolbar row
    // inside the top bar); report the outermost only.
    let p = el.parentElement, nested = false;
    while (p) { if (p.id && RE.test(p.id) && p.getBoundingClientRect().width * p.getBoundingClientRect().height >= minArea && !/^panel-/.test(p.id)) { nested = true; break; } p = p.parentElement; }
    if (nested) continue;
    out.push({ id: el.id, w: Math.round(b.width), h: Math.round(b.height), covered: exact.has(el) || coversIds.has(el.id) });
  }
  return out;
}`;

const b = await chromium.launch({ args: DETERMINISTIC_LAUNCH_ARGS });
const page = await b.newPage({ ...DETERMINISTIC_CONTEXT_OPTIONS });
await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelectorAll('button').forEach((x) => { if (x.textContent.trim() === 'Got it') x.click(); }));
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

const regions = new Map();
const scan = async (layout) => {
  for (const r of await page.evaluate(`(${REGION_FN})(${JSON.stringify(surfaces)})`)) {
    const prev = regions.get(r.id);
    if (!prev) regions.set(r.id, { ...r, layouts: [layout] });
    else { prev.layouts.push(layout); prev.covered = prev.covered || r.covered; }
  }
};

// Editor with a photo loaded (which docks the Library filmstrip).
const fixtureB64 = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
await page.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (typeof window.loadFXImages === 'function') await window.loadFXImages([new File([bytes], 'portrait.png', { type: 'image/png' })]);
}, fixtureB64);
await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages && fxImages.length > 0, { timeout: 10000 }).catch(() => {});
await settleForCapture(page);
await scan('editor');
// Library full view.
await page.evaluate(() => document.getElementById('lib-overlay')?.classList.add('full'));
await page.waitForTimeout(400);
await scan('library');
await page.evaluate(() => document.getElementById('lib-overlay')?.classList.remove('full'));
// Phone width.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await scan('phone');

await b.close();
server.close();

// ── Static pass: containers that are HIDDEN at load (dialogs, overlays, menus, progress bars,
// empty states) never show up in the live scan above, so also read every container-like id out of
// the source. Added 2026-09-11: the live pass alone reported 11 gaps while ~40 openable surfaces
// (crop/mask overlays, histogram, history, export progress, Library info panel, compare view,
// every Library modal and empty state) had no entry either. A sub-part of a covered surface
// (e.g. #fx-deskbar-left inside the top bar) is covered by listing it in that surface's `covers`.
{
  const KW = /(overlay|modal|menu|popover|dialog|sheet|tooltip|panel|pane|bar|rail|strip|drawer|loupe|hist|compare|split|toast|banner|empty|hint|picker|timeline|progress|info|side|top|bottom|dock|nav|grid|history)/i;
  const SKIP = /(btn|-v$|-val$|slider|resizer|-ic$|-lb$|input|chk|-sel$|-label|-x$|-close$|-text$)/i;
  const covered = new Set();
  for (const s of surfaces) {
    covered.add(s.id);
    for (const m of String(s.selector || '').matchAll(/#([\w-]+)/g)) covered.add(m[1]);
    for (const c of s.covers || []) covered.add(c);
  }
  for (const [file, label] of [['chromasmith-22.html', 'app source'], ['desktop/library-ui.js', 'library source']]) {
    const src = await readFile(path.join(ROOT, file), 'utf8');
    for (const m of src.matchAll(/id=["'`]([\w-]+)["'`]|\.id\s*=\s*["']([\w-]+)["']/g)) {
      const id = m[1] || m[2];
      if (!KW.test(id) || SKIP.test(id) || covered.has(id) || regions.has(id)) continue;
      regions.set(id, { id, w: 0, h: 0, covered: false, layouts: [label + ' (hidden at load)'] });
    }
  }
}
// ── Integrity pass (added 2026-09-11): a clean result above can still hide surfaces two ways,
// and both happened. (1) `covers` — the gap-fill session listed the crop/mask/guides overlays,
// filmstrip, history list, sort/view menus and the empty Library as "parts" of big surfaces, so
// they counted as covered while never being captured open. A covered id is only a real sub-part
// if it is VISIBLE, inside its parent, when the parent is shown with its own openSteps; anything
// that has to be opened separately needs its own surface. (2) `unreachable` — 8 surfaces were
// given up on and silently passed. Both now fail here.
const integrity = [];
for (const s of surfaces) {
  if (s.opened !== true && s.id !== 'splash' && s.approvedBy !== 'user') {
    integrity.push({ id: s.id, kind: 'NOT_CAPTURED', detail: `marked unreachable: ${String(s.note || 'no reason').slice(0, 120)}` });
  }
}
{
  const b2 = await chromium.launch({ args: DETERMINISTIC_LAUNCH_ARGS });
  const pg = await b2.newPage({ ...DETERMINISTIC_CONTEXT_OPTIONS });
  const port = (await new Promise((r) => { const sv = createServer(async (req, res) => {
    try { const u = decodeURIComponent(req.url.split('?')[0]); const d = await readFile(path.join(ROOT, u.slice(1)));
      res.writeHead(200, { 'Content-Type': u.endsWith('.html') ? 'text/html' : u.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); res.end(d);
    } catch { res.writeHead(404); res.end(); } }).listen(0, '127.0.0.1', () => r(sv)); globalThis.__sv2 = sv; })).address().port;
  for (const s of surfaces.filter((x) => (x.covers || []).length && x.opened === true)) {
    await pg.setViewportSize({ width: 1440, height: 900 });
    await pg.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pg.waitForTimeout(1200);
    await pg.evaluate(() => document.querySelectorAll('button').forEach((x) => { if (x.textContent.trim() === 'Got it') x.click(); }));
    await pg.keyboard.press('Escape');
    await pg.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      if (typeof window.loadFXImages === 'function') await window.loadFXImages([new File([bytes], 'portrait.png', { type: 'image/png' })]);
    }, fixtureB64);
    await pg.waitForTimeout(600);
    for (const st of s.openSteps || []) {
      try {
        if (st.eval) await pg.evaluate(`void (${st.eval})`);
        else if (st.click) await pg.click(st.click, { timeout: 2000 });
        else if (st.wait) await pg.waitForTimeout(st.wait);
      } catch { /* a broken step shows up as the parent not being visible below */ }
    }
    await pg.waitForTimeout(300);
    const res = await pg.evaluate(({ sel, ids }) => {
      const vis = (el) => el && (!el.checkVisibility || el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) && el.getBoundingClientRect().width > 1 && el.getBoundingClientRect().height > 1;
      let parent = null; try { parent = document.querySelector(sel); } catch {}
      const pb = parent && parent.getBoundingClientRect();
      return ids.map((id) => {
        const el = document.getElementById(id);
        if (!el) return { id, why: 'not in the DOM when the parent is shown' };
        if (!vis(el)) return { id, why: 'hidden when the parent is shown — it opens separately' };
        const b = el.getBoundingClientRect();
        if (pb && (b.right < pb.left || b.left > pb.right || b.bottom < pb.top || b.top > pb.bottom)) return { id, why: 'visible but outside the parent' };
        return null;
      }).filter(Boolean);
    }, { sel: s.selector || '#' + s.id, ids: s.covers });
    for (const r of res) integrity.push({ id: r.id, kind: 'COVERS_HIDES_SURFACE', detail: `listed as part of "${s.id}" but ${r.why} — capture it: its own surface with openSteps, or a named state of "${s.id}" whose capture opens it` });
  }
  await b2.close(); globalThis.__sv2.close();
}
const all = [...regions.values()];
const missing = all.filter((r) => !r.covered);
const failCount = missing.length + integrity.length;
if (process.argv.includes('--json')) console.log(JSON.stringify({ regions: all, missing, integrity }, null, 2));
else {
  console.log(`surface_coverage_check: ${all.length} layout regions found, ${missing.length} with no design/surfaces.json entry of their own\n`);
  for (const r of missing) console.log(`  MISSING  #${r.id}  (${r.w}x${r.h}, seen in: ${r.layouts.join(', ')})`);
  if (integrity.length) {
    console.log(`\n${integrity.length} surface(s) counted as covered but never captured open:`);
    for (const f of integrity) console.log(`  ${f.kind.padEnd(21)} #${f.id}  ${f.detail}`);
  }
  console.log(failCount ? '\nRESULT: FAIL' : '\nRESULT: PASS');
}
process.exit(failCount ? 1 : 0);

