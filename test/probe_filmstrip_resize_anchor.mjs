// Probe: resizing the docked filmstrip must keep the same photo at the same viewport offset.
// Usage: node test/probe_filmstrip_resize_anchor.mjs [dist dir]  (run `npm run editor:gates` build first if dist is stale)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(process.argv[2] || 'desktop/dist');
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css' };
const srv = createServer(async (q, r) => { try { const p = decodeURIComponent(q.url.split('?')[0]); const b = await readFile(path.join(root, p === '/' ? 'index.html' : p)); r.setHeader('content-type', types[p.split('.').pop()] || 'application/octet-stream'); r.end(b); } catch { r.statusCode = 404; r.end(); } }).listen(0);
const br = await chromium.launch();
const pg = await br.newPage({ viewport: { width: 1440, height: 900 } });
pg.on('console', m => m.text().includes('DEBUG') && console.log(m.text()));
pg.on('pageerror', e => console.log('pageerror', e.message));
await pg.goto(`http://127.0.0.1:${srv.address().port}/index.html?libtest=1&deskx=1&libn=600`, { waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(1000);
await pg.evaluate(() => { if (window.chromasmithForceLibraryReady) chromasmithForceLibraryReady(); const o = document.getElementById('lib-overlay'); o.classList.add('on'); o.classList.remove('full'); document.body.classList.add('deskx'); });
await pg.waitForTimeout(1500);
// Synthetic thumbs never load here, so docked cards would sit at the 40px min-height; emulate loaded square thumbnails.
await pg.addStyleTag({ content: 'body.deskx #lib-overlay:not(.full) .lib-thumb-wrap{aspect-ratio:1 !important;height:auto !important}' });
const setW = w => pg.evaluate(w => { document.querySelector('.fx-layout').style.setProperty('--dock-w-user', w + 'px'); }, w);
// Anchor = the card at the top of the viewport (what the user is looking at first).
const anchor = () => pg.evaluate(() => {
  const g = document.getElementById('lib-grid'), s = g.parentElement, sr = s.getBoundingClientRect(), mid = sr.top;
  for (const c of g.querySelectorAll('.lib-card')) { const r = c.getBoundingClientRect(); if (r.bottom > mid) return { p: c.dataset.path, frac: (mid - r.top) / r.height, h: r.height, top: r.top - sr.top, sh: s.scrollHeight, st: s.scrollTop }; }
  return null;
});
const at = p => pg.evaluate(p => { const g = document.getElementById('lib-grid'), c = g.querySelector(`.lib-card[data-path="${CSS.escape(p)}"]`); if (!c) return null; const sr = g.parentElement.getBoundingClientRect(), r = c.getBoundingClientRect(); return { top: r.top - sr.top, h: r.height, mid: 0 }; }, p);
let fail = 0;
await setW(120); await pg.waitForTimeout(600);
const before0 = await pg.evaluate(() => window.__libState && __libState());
console.log('state', JSON.stringify(before0));
await pg.evaluate(() => { const s = document.getElementById('lib-grid').parentElement; s.scrollTop = (s.scrollHeight - s.clientHeight) * 0.4; });
await pg.waitForTimeout(600);
console.log('after scroll', JSON.stringify(await pg.evaluate(() => __libState())));
for (const w of [300, 420, 200, 90]) {
  const a = await anchor();
  if (!a) { console.log('FAIL no anchor', JSON.stringify(await pg.evaluate(() => { const s=document.getElementById('lib-grid').parentElement; const c=document.querySelector('#lib-grid .lib-card'); return {st:s.scrollTop, cs:document.querySelectorAll('#lib-grid .lib-card').length, r:c&&JSON.stringify(c.getBoundingClientRect()), sr:JSON.stringify(s.getBoundingClientRect())}; }))); fail++; break; }
  await setW(w); await pg.waitForTimeout(1800);
  const n = await at(a.p);
  const ok = n && Math.abs((n.mid - n.top) / n.h - a.frac) < 0.15 && n.top <= n.mid + 14 && n.top + n.h > n.mid;
  console.log(ok ? 'PASS' : 'FAIL', `w=${w}`, JSON.stringify({ before: a, after: n }));
  if (!ok) fail++;
}
await br.close(); srv.close();
process.exit(fail ? 1 : 0);
