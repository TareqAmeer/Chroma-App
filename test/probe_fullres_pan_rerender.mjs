#!/usr/bin/env node
// Regression: Full res + zoomed in on a BORDERED photo renders the whole frame at full source size (~2s in the
// real app). A pan is pure CSS, so releasing a pan must not re-render it at all — it used to render TWICE
// (pointerup + the stale 90ms zoom-settle timer armed by the pan's own _applyZoom calls).
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
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
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
let ok = false;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 792 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FX !== 'undefined' && FX.ok, null, { timeout: 30000 });
  const res = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
    const g = c.getContext('2d'); g.fillStyle = '#226'; g.fillRect(0, 0, 3000, 2000); g.fillStyle = '#fff'; g.fillRect(1200, 800, 600, 400);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await loadFXImages([new File([blob], 'a.png', { type: 'image/png' })]);
    await new Promise(res => { const t = Date.now(); const p = () => fxImages.length || Date.now() - t > 30000 ? res() : setTimeout(p, 20); p(); });
    let n = 0; const orig = FX.render.bind(FX); FX.render = function (...a) { n++; return orig(...a); };
    const out = {};
    for (const bordered of [true, false]) {
      document.getElementById('tg-borders').classList.toggle('on', bordered);
      if (bordered) document.getElementById('sl-b1-t').value = 40;
      fxFullResPreview = true; fxZoom = _fxPctToZoom(200); fxPanX = 0; fxPanY = 0; _applyZoom(false); renderPreview(); await sleep(1500);
      const zw = document.getElementById('fx-zoom-wrap'), r = zw.getBoundingClientRect();
      const x = r.left + 400, y = r.top + 300, ev = (t, dx) => zw.dispatchEvent(new PointerEvent(t, { pointerId: 7, bubbles: true, clientX: x + dx, clientY: y + dx / 2, button: 0, pointerType: 'mouse' }));
      try { zw.setPointerCapture = () => {}; } catch {}
      ev('pointerdown', 0); for (let i = 1; i <= 20; i++) { ev('pointermove', i * 5); await sleep(16); }
      n = 0; ev('pointerup', 100); await sleep(1200);
      out[bordered ? 'bordered' : 'plain'] = { rendersAfterRelease: n, crop: _fxCropShown };
    }
    return out;
  });
  console.log(JSON.stringify(res));
  ok = res.bordered.rendersAfterRelease === 0;
  console.log(ok ? 'PASS no redundant full-frame render on pan release' : `FAIL bordered pan release rendered ${res.bordered.rendersAfterRelease}x (expected 0)`);
} finally { await browser.close(); server.close(); if (!ok) process.exitCode = 1; }
