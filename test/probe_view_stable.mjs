#!/usr/bin/env node
// Regression: the photo must not move on re-render/toggles/app switch (blur/focus/visibility/resize), incl. the
// full-res visible-crop render (fxZoom>1), where #fx-canvas is shrunk+translated to the visible crop.
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 792 } }); page.on('console', m => { if (m.text().startsWith('BASE')) console.log(m.text()); });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FX !== 'undefined' && FX.ok, null, { timeout: 30000 });
  const res = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
    const g = c.getContext('2d'); g.fillStyle = '#222'; g.fillRect(0, 0, 3000, 2000); g.fillStyle = '#fff'; g.fillRect(1200, 800, 600, 400);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await loadFXImages([new File([blob], 'a.png', { type: 'image/png' })]);
    await new Promise(res => { const t = Date.now(); const p = () => fxImages.length || Date.now() - t > 30000 ? res() : setTimeout(p, 20); p(); });
    fxFullResPreview = true; await sleep(800);
    const rect = () => { const r = fxPhotoClientRect(); return [r.left, r.top, r.width, r.height].map(v => Math.round(v * 10) / 10); };
    const out = [];
    for (const [pct, px, py] of [[null, 0, 0], [200, -300, -150]]) {
      if (pct == null) _resetZoom(false); else { fxZoom = _fxPctToZoom(pct); fxPanX = px; fxPanY = py; _applyZoom(false); }
      renderPreview(); await sleep(1500);
      const base = rect(); { const zw = document.getElementById('fx-zoom-wrap'); console.log('BASE', _fxCropShown, zw.style.width, zw.offsetWidth, FX.cv.style.width, FX.cv.offsetWidth, fxPanX, fxZoom, zw.style.transform); } const steps = [];
      const step = async (name, fn) => { fn(); await sleep(900); const r = rect(); const zw = document.getElementById('fx-zoom-wrap'); r.push(_fxCropShown, zw.style.width, zw.offsetWidth, FX.cv.style.width, FX.cv.offsetWidth, fxPanX, fxZoom.toFixed(3), zw.style.transform); steps.push({ name, d: Math.max(...r.slice(0,4).map((v, i) => Math.abs(v - base[i]))), r }); };
      await step('sharpen-preview', () => { fxSharpMaskPreview(true); });
      await step('sharpen-off', () => { fxSharpMaskPreview(false); });
      await step('fxUpdate', () => fxUpdate());
      await step('blur', () => window.dispatchEvent(new Event('blur')));
      await step('vis', () => document.dispatchEvent(new Event('visibilitychange')));
      await step('focus', () => window.dispatchEvent(new Event('focus')));
      await step('resize', () => window.dispatchEvent(new Event('resize')));
      out.push({ pct, base, steps });
    }
    return out;
  });
  let bad = 0;
  for (const r of res) for (const s of r.steps) { const f = s.d > 1; if (f) bad++; console.log(f ? 'FAIL' : 'ok  ', r.pct, s.name, s.d, JSON.stringify(r.base), JSON.stringify(s.r)); }
  ok = bad === 0; console.log(ok ? 'PASS view stable' : 'FAIL view moved');
} finally { await browser.close(); server.close(); if (!ok) process.exitCode = 1; }
