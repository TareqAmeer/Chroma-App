#!/usr/bin/env node
// Regression: switching apps (window blur/focus/visibilitychange) must not re-render the photo. In WKWebView
// every blur ran fxSharpMaskPreview(false) -> fxScheduleRender -> a draft render then a settle render, whose
// differently-sized backing store moved the (zoomed) photo by a few px each app switch.
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
    let n = 0; const orig = FX.render.bind(FX); FX.render = function (...a) { if (!(a[3] && a[3].outFb)) n++; return orig(...a); }; // offscreen underlay builds (outFb) never touch the view
    const out = {};
    for (const [name, z] of [['fit', null], ['zoomed', 200]]) {
      fxFullResPreview = true; if (z) { fxZoom = _fxPctToZoom(z); fxPanX = -200; fxPanY = -100; } else { fxZoom = FX_FIT; fxPanX = fxPanY = 0; }
      _applyZoom(false); renderPreview(); await sleep(1500);
      n = 0;
      window.dispatchEvent(new Event('blur')); document.dispatchEvent(new Event('visibilitychange'));
      await sleep(300); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'));
      await sleep(1200); out[name] = n;
    }
    return out;
  });
  console.log(JSON.stringify(res));
  ok = res.fit === 0 && res.zoomed === 0;
  console.log(ok ? 'PASS app switch does not re-render' : 'FAIL app switch re-rendered the photo');
} finally { await browser.close(); server.close(); if (!ok) process.exitCode = 1; }
