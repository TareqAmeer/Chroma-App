#!/usr/bin/env node
// Audit: backing-store px vs displayed device px of the Editor preview across states (fit, mid-drag settle,
// zoom, large window). Ratio < 1 means the compositor upscales the canvas = soft preview.
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 792 }, deviceScaleFactor: 2 });
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FX !== 'undefined' && FX.ok, null, { timeout: 30000 });
  const r = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 6000; c.height = 4000;
    const g = c.getContext('2d'); for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${i * 7 % 360},50%,${30 + i % 40}%)`; g.fillRect((i * 97) % 6000, (i * 53) % 4000, 120, 90); }
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await loadFXImages([new File([blob], 'sharp.png', { type: 'image/png' })]);
    await new Promise(res => { const t = Date.now(); const p = () => fxImages.length || Date.now() - t > 30000 ? res() : setTimeout(p, 20); p(); });
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    await sleep(600);
    const out = {};
    const dev = () => { const b = FX.cv.getBoundingClientRect(); return +(FX.cv.width / (b.width * devicePixelRatio)).toFixed(3); };
    _resetZoom(false); renderPreview(); await sleep(500);
    out.fit = dev();
    out.fitSize = [FX.cv.width, FX.cv.height, Math.round(FX.cv.getBoundingClientRect().width)];
    // zoom 100% in default (not Full res) mode
    fxZoom = _fxPctToZoom(100); _applyZoom(false); renderPreview(); await sleep(1500);
    out.zoom100 = dev(); out.zoom100Size = [FX.cv.width, FX.cv.height, Math.round(FX.cv.getBoundingClientRect().width)];
    out.zoomInfo = document.getElementById('fx-info').textContent;
    // framed/matted composite zoomed 200%, Full res off: whole-frame path, density vs displayed device px
    _resetZoom(false); enableAll(); await sleep(2500);
    fxZoom = _fxPctToZoom(200); _applyZoom(false); renderPreview(); await sleep(2500);
    { const bd = document.getElementById('fx-canvas-bd'); const on = bd && bd.style.display !== 'none';
      const el = on ? bd : FX.cv; const b = el.getBoundingClientRect(); out.framed200 = +(el.width / (b.width * devicePixelRatio)).toFixed(3); out.framedBd = on; out.framedInfo = document.getElementById('fx-info').textContent; }
    return out;
  });
  console.log(JSON.stringify(r));
  const assert = (await import('node:assert/strict')).default;
  assert.ok(r.fit >= 1, `Fit backing must be >=1 px per device px (got ${r.fit})`);
  assert.ok(r.zoom100 >= 0.99, `zoomed 100% (Full res OFF) must be native detail, got ${r.zoom100} backing px per device px = upscaled/soft`);
  assert.ok(r.framed200 >= 0.49, `framed/matted preview at 200% (Full res OFF) must be source-native (0.5 backing px per device px at 200%; was 0.25 = 4x upscaled), got ${r.framed200}`);
  ok = true; console.log('PASS preview px density');
} finally { await browser.close(); server.close(); if (!ok) process.exitCode = 1; }
