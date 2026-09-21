// Probe: #lib-batchbar must stay visible near the bottom of #lib-main's viewport while it scrolls.
// Usage: node test/probe_batchbar_sticky.mjs <dir containing index.html built from desktop/dist>
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(process.argv[2] || 'desktop/dist');
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css' };
const srv = createServer(async (q, r) => { try { const p = decodeURIComponent(q.url.split('?')[0]); const b = await readFile(path.join(root, p === '/' ? 'index.html' : p)); r.setHeader('content-type', types[p.split('.').pop()] || 'application/octet-stream'); r.end(b); } catch { r.statusCode = 404; r.end(); } }).listen(0);
const port = srv.address().port;
const br = await chromium.launch();
const pg = await br.newPage({ viewport: { width: 1440, height: 900 } });
pg.on('pageerror', e => console.log('pageerror', e.message));
await pg.goto(`http://127.0.0.1:${port}/index.html?libtest=1&libn=400`, { waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(1000);
await pg.evaluate(() => { if (window.chromasmithForceLibraryReady) chromasmithForceLibraryReady(); document.getElementById('lib-overlay')?.classList.add('on', 'full'); });
await pg.waitForTimeout(1500);
await pg.click('#lib-main', { position: { x: 20, y: 20 } }).catch(() => {});
await pg.keyboard.press('Control+A');
await pg.waitForTimeout(500);
const measure = () => pg.evaluate(() => {
  const m = document.getElementById('lib-main'), b = document.getElementById('lib-batchbar');
  if (!b) return { err: 'no bar' };
  const mr = m.getBoundingClientRect(), br = b.getBoundingClientRect();
  return { scroll: Math.round(m.scrollTop), max: m.scrollHeight - m.clientHeight, last: m.lastElementChild === b,
    inside: br.top >= mr.top && br.bottom <= mr.bottom + 1 && br.height > 0, gap: Math.round(mr.bottom - br.bottom) };
});
let fail = 0;
const check = (label, s) => { const ok = !s.err && s.inside && s.gap < 60 && s.last; console.log(ok ? 'PASS' : 'FAIL', label, JSON.stringify(s)); if (!ok) fail++; };
const pre = await measure();
if (pre.max < 1000) { console.log('FAIL not enough scroll', JSON.stringify(pre)); fail++; }
check('top', pre);
for (const f of [0.5, 1]) {
  await pg.evaluate(f => { const m = document.getElementById('lib-main'); m.scrollTop = (m.scrollHeight - m.clientHeight) * f; }, f);
  await pg.waitForTimeout(500);
  check('deep ' + f, await measure());
}
await pg.setViewportSize({ width: 1100, height: 700 }); await pg.waitForTimeout(600);
await pg.evaluate(() => { const m = document.getElementById('lib-main'); m.scrollTop = m.scrollHeight * 0.4; }); await pg.waitForTimeout(400);
check('after resize', await measure());
await pg.evaluate(() => { document.getElementById('lib-overlay').classList.remove('full'); document.body.classList.add('deskx'); });
await pg.keyboard.press('Control+A'); await pg.waitForTimeout(400);
const docked = await pg.evaluate(() => !document.getElementById('lib-batchbar'));
console.log(docked ? 'PASS' : 'FAIL', 'hidden in docked filmstrip'); if (!docked) fail++;
await br.close(); srv.close();
process.exit(fail ? 1 : 0);
