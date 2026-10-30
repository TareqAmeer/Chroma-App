#!/usr/bin/env node
// Radial/Linear masks move on the canvas with real mouse drags: handles work right after Add (the
// draw-to-create layer sits under them), the body / gradient band moves the shape, a drag off the
// shape moves it while the photo fits the view, and only a zoomed-in view pans the photo.
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.join(ROOT, pathname === '/' ? 'chromasmith-22.html' : pathname.slice(1));
    const body = await readFile(file);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
let done = false;
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }), errors = [];
  page.on('console', msg => { if (msg.type() === 'error' && /GLSL compile error|LINK FAILED|SHADER_COMPILE/i.test(msg.text())) errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(`page error: ${err.message}`));
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FX !== 'undefined', null, { timeout: 30000 });
  const png = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
  await page.evaluate(async (b64) => {
    document.querySelector('[data-tour-action="close"]')?.click(); document.getElementById('cs-modal-ov')?.remove();
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    await loadFXImages([new File([bin], 'portrait.png', { type: 'image/png' })]);
    await new Promise(r => { const p = () => fxImages.length ? r() : setTimeout(p, 30); p(); });
    fxSection('local', true); const tg = document.getElementById('tg-local'); if (tg && !tg.classList.contains('on')) toggleFX('local');
  }, png);
  const st = () => page.evaluate(() => { const m = fxState.masks[mskSel]; return { m: { cx: m.cx, cy: m.cy, rx: m.rx, x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1 }, pan: [fxPanX, fxPanY] }; });
  const at = (sel) => page.evaluate((sel) => { const h = document.querySelector('#fx-mask-overlay ' + sel); if (!h) return null; const r = h.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
  const drag = async (pt, dx = 60, dy = 40) => { await page.mouse.move(pt[0], pt[1]); await page.mouse.down(); for (let i = 1; i <= 8; i++) { await page.mouse.move(pt[0] + dx * i / 8, pt[1] + dy * i / 8); await page.waitForTimeout(15); } await page.mouse.up(); await page.waitForTimeout(150); };
  const res = {};
  for (const kind of ['radial', 'linear']) {
    await page.evaluate((k) => { fxState.masks = []; mskSel = -1; _resetZoom(); mskAdd(k); }, kind);
    await page.waitForTimeout(300);
    const a0 = await st();
    // Right after Add: an edge handle still resizes (it used to redraw the whole shape).
    await drag(await at(kind === 'radial' ? 'circle[data-h="rx"]' : 'circle[data-h="p0"]'), 30, kind === 'radial' ? 0 : 30);
    const a1 = await st();
    res[kind + 'Handle'] = kind === 'radial' ? (a1.m.cx === a0.m.cx && a1.m.rx !== a0.m.rx) : (a1.m.x1 === a0.m.x1 && a1.m.y1 === a0.m.y1 && a1.m.y0 !== a0.m.y0);
    // Body (radial interior / linear band between the edges) moves the shape.
    const body = await at(kind === 'radial' ? 'circle[data-h="move"]' : 'circle[data-h="lmove"]');
    await drag([body[0] + 12, body[1] + 6]);
    const a2 = await st();
    res[kind + 'Body'] = (kind === 'radial' ? a2.m.cx > a1.m.cx : a2.m.x0 > a1.m.x0) && a2.pan[0] === 0 && a2.pan[1] === 0;
    // Off the shape, photo fits the view: the shape moves, the photo stays put.
    await page.evaluate(() => { _mskDrawFor = null; mskOverlaySync(); });
    const box = await page.evaluate(() => { const r = document.getElementById('fx-mask-overlay').getBoundingClientRect(); return [r.x + 12, r.y + 12]; });
    await drag(box, 30, 20);
    const a3 = await st();
    res[kind + 'OffShapeFit'] = (kind === 'radial' ? a3.m.cx > a2.m.cx : a3.m.x0 > a2.m.x0) && a3.pan[0] === 0 && a3.pan[1] === 0;
    // Zoomed in: a drag off the shape pans the photo and leaves the shape alone.
    await page.evaluate(() => { fxZoom = 3; _applyZoom(); mskOverlaySync(); });
    await page.waitForTimeout(200);
    const wrap = await page.evaluate(() => { const r = document.getElementById('fx-wrap').getBoundingClientRect(); return [r.x + 20, r.y + 20]; });
    await drag(wrap, 40, 30);
    const a4 = await st();
    res[kind + 'ZoomPan'] = (a4.pan[0] !== a3.pan[0] || a4.pan[1] !== a3.pan[1]) && JSON.stringify(a4.m) === JSON.stringify(a3.m);
  }
  // An armed eyedropper samples through the shape and its pin (they used to swallow the click).
  await page.evaluate(() => { fxState.masks = []; mskSel = -1; _resetZoom(); mskAdd('radial'); _mskDrawFor = null; mskOverlaySync(); mskCrEyedropper(true); });
  const centre = await at('circle[data-h="move"]');
  await page.mouse.click(centre[0], centre[1]); await page.waitForTimeout(250);
  res.eyedropperThroughShape = await page.evaluate(() => (fxState.masks[0].crSamples || []).length === 1);
  console.log(res);
  for (const [k, v] of Object.entries(res)) assert.equal(v, true, k);
  assert.deepEqual(errors, []);
  done = true; console.log('PASS mask shape drag: handles, body, off-shape move at fit, pan only when zoomed');
} finally { await browser.close(); server.close(); if (!done) process.exitCode = 1; }
