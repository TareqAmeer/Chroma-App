#!/usr/bin/env node
// WebKit "crisp view" hides the live canvases (opacity 0) under a 2D copy of the last frame. Turning All FX on added the
// border composite while that copy still held the OLD unbordered photo, so the desktop app showed the new border over the
// old photo with a black hole where the hidden live photo sat, for the whole settle render.
// Expect: right after every render, either the crisp copy is off or it was drawn for exactly the layers now on screen.
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
    document.querySelectorAll('.cs-modal,#cs-modal-ov,[class*=cs-modal]').forEach(e => e.remove());
    window.__fxCrispForce = 1;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const sig = () => ['fx-canvas-bd', 'fx-canvas', 'fx-canvas-bdfront'].map(id => { const e = document.getElementById(id); if (!e || e.style.display === 'none') return '-';
      const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(Math.round).join(',') + ',' + e.width + 'x' + e.height; }).join('|');
    let drawn = '';
    const cd = fxCrispDraw; window.fxCrispDraw = fxCrispDraw = function () { const x = cd.apply(this, arguments); drawn = sig(); return x; };
    renderPreview(); await sleep(300);
    const crispOnBefore = _fxCrispOn;
    const bad = []; let renders = 0;
    const rp = renderPreview;
    window.renderPreview = renderPreview = function () { const x = rp.apply(this, arguments); renders++;
      if (_fxCrispOn && sig() !== drawn) bad.push(sig()); return x; };
    enableAll(); await sleep(6000);
    const on = allFxIsOn(); enableAll(); await sleep(6000);
    return { crispOnBefore, on, renders, bad };
  });
  console.log(JSON.stringify(r));
  ok = r.crispOnBefore && r.on && r.renders >= 2 && r.bad.length === 0;
  console.log(ok ? 'PASS' : 'FAIL: crisp copy left stale over a changed layer set');
} finally { await browser.close(); server.close(); }
process.exit(ok ? 0 : 1);
