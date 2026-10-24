#!/usr/bin/env node
// A lost pointerup (released outside the window / swallowed by a context menu) left _fxPreviewInteracting stuck true,
// pinning the preview to the blurry screen-res draft (glowScale 2 halation, no full-res crop) until the next slider drag.
// Expect: after a pointerdown on the photo whose pointerup never arrives, the preview settles back to "Full res".
const { chromium, webkit } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = createServer(async (req, res) => {
  try {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname));
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await (process.env.WK ? webkit : chromium).launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
let ok = false;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 792 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FX !== 'undefined' && FX.ok, null, { timeout: 30000 });
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
    const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 3000, 2000); gr.addColorStop(0, '#236'); gr.addColorStop(1, '#c84'); g.fillStyle = gr; g.fillRect(0, 0, 3000, 2000); g.fillStyle='#000'; for(let x=0;x<3000;x+=8)g.fillRect(x,0,2,2000); g.fillStyle='#fff'; g.font='bold 300px sans-serif'; g.fillText('SHARP',900,1100);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await loadFXImages([new File([blob], 'a.png', { type: 'image/png' })]);
    await new Promise(res => { const t = Date.now(); const p = () => fxImages.length || Date.now() - t > 30000 ? res() : setTimeout(p, 20); p(); });
  });
  await page.waitForTimeout(800);
  
  const r = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const state = () => { const P = getFXParams(); return {
      exp: document.getElementById('sl-adj-exp').value, selLut: document.getElementById('sel-lut').value, stateLut: !!fxState.lut, lutP: !!(P.lut), mix: document.getElementById('sl-lut-mix').value,
      mixRow: document.getElementById('row-lut-mix').style.display, selPrint: (document.getElementById('sel-print') || {}).value,
      grain: !!(P.grain && P.grain.enabled), hal: !!(P.halation && P.halation.enabled), bloom: !!(P.bloom && P.bloom.enabled), borders: !!P.bordersEnabled,
      allFxBtn: !!document.querySelector('.js-allfx.on,.js-allfx.active,.js-allfx[aria-pressed=true]'), delDis: document.getElementById('btn-lut-del').disabled,
      selCells: [...document.querySelectorAll('#fx-looks .look-cell.sel')].map(c => c.title).join('|'), chipOn: [...document.querySelectorAll('.chips .on,.fx-chips .on,[id$=-chips] .on')].map(c => c.textContent).join('|'), caption: (document.getElementById('fx-mcap') || {}).textContent || '' }; };
    const out = { before: state() };
    const key = Object.keys(LUT_META)[0]; const sel = document.getElementById('sel-lut');
    if (![...sel.options].some(o => o.value === 'p:' + key)) { const o = document.createElement('option'); o.value = 'p:' + key; sel.appendChild(o); }
    buildLookGallery(); await sleep(500); const cells = [...document.querySelectorAll('#fx-looks .look-cell')]; const cell = cells[3] || cells[1]; out.pick = cell && cell.title; fxPickLookCell(cell, cell._lookJob.val); await sleep(500); const mx = document.getElementById('sl-lut-mix'); mx.value = 40; mx.dispatchEvent(new Event('input', { bubbles: true }));
    enableAll(); await sleep(300); for (let i = 1; i <= 26; i++) { const e = document.getElementById('sl-adj-exp'); e.value = i; e.dispatchEvent(new Event('input', { bubbles: true })); fxHistoryPush(); } await sleep(300); out.edited = state();
    await fxResetAll(); await sleep(800); out.after = state();
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  const a = r.after, b = r.before; // after 26 edits (history cap is 20) Reset must still return to the untouched original, not the oldest kept step
  delete a.caption; delete b.caption;
  ok = JSON.stringify(a) === JSON.stringify(b);
  console.log(ok ? 'PASS' : 'FAIL: Reset left the look/FX state different from the untouched original');
} finally { await browser.close(); server.close(); }
process.exit(ok ? 0 : 1);
