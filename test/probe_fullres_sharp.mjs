#!/usr/bin/env node
// Regression: Full res must show 1:1 device pixels at 100% (no bilinear upscale of a capped crop),
// Fit must be a modest (<=2.5x) downscale, an idle Fit view must not re-render in a loop, and the
// editor <main> must not be programmatically scrollable (app-switch focus restore moved the image).
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 792 }, deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FX !== 'undefined' && FX.ok, null, { timeout: 30000 });
  const r = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
    const g = c.getContext('2d'); for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${i * 7 % 360},50%,${30 + i % 40}%)`; g.fillRect((i * 97) % 3000, (i * 53) % 2000, 120, 90); }
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await loadFXImages([new File([blob], 'sharp.png', { type: 'image/png' })]);
    await new Promise(res => { const t = Date.now(); const p = () => fxImages.length || Date.now() - t > 30000 ? res() : setTimeout(p, 20); p(); });
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    fxFullResPreview = true; await sleep(600);
    const out = {};
    const dev = () => { const b = FX.cv.getBoundingClientRect(); return { dw: b.width * devicePixelRatio, bw: FX.cv.width }; };
    _resetZoom(false); renderPreview(); await sleep(500);
    const fit = dev(); out.fitRatio = fit.bw / fit.dw;                // backing px per displayed device px
    let n = 0; const rp = window.renderPreview; window.renderPreview = function () { n++; return rp.apply(this, arguments); };
    await sleep(1500); out.idleRenders = n; window.renderPreview = rp;
    fxZoom = _fxPctToZoom(100); _applyZoom(false); renderPreview(); await sleep(1200);
    const z = dev(); out.zoomRatio = z.bw / z.dw; out.pct = document.getElementById('fx-zoom-pct').textContent;
    const m = document.querySelector('main'); m.scrollTop = 16; await sleep(100); out.mainScroll = m.scrollTop;
    return out;
  });
  console.log(JSON.stringify(r));
  assert.ok(r.zoomRatio >= 0.99, `100% must be >=1 backing px per device px (got ${r.zoomRatio.toFixed(3)}: upscaled = blurry)`);
  assert.ok(r.fitRatio >= 1 && r.fitRatio <= 2.6, `Fit must be a modest downscale (got ${r.fitRatio.toFixed(2)}x)`);
  assert.ok(r.idleRenders <= 1, `idle Fit view re-rendered ${r.idleRenders}x in 1.5s (render loop)`);
  assert.equal(r.mainScroll, 0, 'main must not be scrollable');
  assert.deepEqual(errors, []);
  ok = true; console.log('PASS full-res sharpness + stable view');
} finally { await browser.close(); server.close(); if (!ok) process.exitCode = 1; }
