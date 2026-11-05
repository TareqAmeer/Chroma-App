#!/usr/bin/env node
// CHR-248: Upright Level / Vertical in the real app. The buttons must only set the existing
// Straighten / Vertical / Rotate controls, the REAL renderer's output must then have level /
// parallel lines (proves the fitted model and its sign match the lens shader), and one undo
// must restore the previous values.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.cube': 'text/plain' };
const server = createServer(async (req, res) => {
  try {
    const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, requested.replace(/^\/+/, ''));
    if (!file.startsWith(root)) throw new Error('path outside root');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch (error) {
    console.error('[server]', req.url, error.message);
    res.writeHead(404).end('not found');
  }
});

const listen = new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await listen;
const browser = await chromium.launch({ args: [
  '--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox',
  '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
], executablePath: process.env.CHROME_PATH || (process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined) });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('[console.error]', m.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.uprightVertical === 'function' && typeof window.loadFXImages === 'function'
    && typeof FX !== "undefined" && FX.ok, null, { timeout: 60000 });

  await page.addStyleTag({ content: '#cs-modal-ov{display:none!important}' }); // first-run guide modal
  // Draws segments on grey and loads it as the photo.
  const loadSynthetic = (kind, arg) => page.evaluate(async ([kind, arg]) => {
    const w = 900, h = kind === 'vert' ? 1200 : 600, c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.fillStyle = '#b4b4b4'; x.fillRect(0, 0, w, h); x.strokeStyle = '#202020'; x.lineWidth = 4;
    const line = (a, b, cc, d) => { x.beginPath(); x.moveTo(a, b); x.lineTo(cc, d); x.stroke(); };
    if (kind === 'vert') { // the shader's own output->source homography maps true verticals to keystoned ones
      const H = window._upH(arg, 0, 0), px = (cx, cy) => { const X = H[0] * cx + H[1] * cy, Y = H[3] * cx + H[4] * cy, W = H[6] * cx + H[7] * cy + 1; return [(X / W + 0.5) * w, (0.5 - Y / W) * h]; };
      for (const cx of [-0.3, -0.15, 0, 0.15, 0.3]) line(...px(cx, -0.38), ...px(cx, 0.38));
    } else {
      x.translate(w / 2, h / 2); x.rotate(arg * Math.PI / 180); x.translate(-w / 2, -h / 2);
      for (let xx = 150; xx <= 750; xx += 100) line(xx, 120, xx, 480);
      for (let yy = 150; yy <= 450; yy += 75) line(120, yy, 780, yy);
    }
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await window.loadFXImages([new File([blob], kind + '.png', { type: 'image/png' })]);
    await new Promise(r => setTimeout(r, 800));
  }, [kind, arg]);
  // Renders the CURRENT recipe through the real FX renderer and measures its lines.
  const measure = () => page.evaluate(() => {
    const work = window.geomCanvas(window.curItem()); FX.setImage(work);
    const w = Math.round(work.width / 2), h = Math.round(work.height / 2);
    FX.render(window.getFXParams(), w, h, { glowScale: window.fxGlowScale() });
    const { px } = FX.getPixels(), g = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) g[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
    const segs = window.upLineSegments(g, w, h).filter(s => s.len > 40
      && Math.min(s.x1, s.x2) > 8 && Math.max(s.x1, s.x2) < w - 8 && Math.min(s.y1, s.y2) > 8 && Math.max(s.y1, s.y2) < h - 8);
    return segs.map(s => window._upAxisDev(s));
  });
  const sliders = () => page.evaluate(() => ({ pv: +document.getElementById('sl-lens-pv').value, rot: +document.getElementById('sl-lens-rot').value,
    angle: (window.curGeom() || {}).angle || 0 }));
  const settle = () => page.waitForTimeout(900); // past the 400ms debounced history push

  // ── Vertical ──
  const openPanel = () => page.evaluate(() => { if (typeof fxSection === 'function') fxSection('straighten'); });
  await loadSynthetic('vert', 0.2);
  await settle();
  const vBefore = (await measure()).filter(d => d.axis === 'v').map(d => d.dev);
  assert.ok(vBefore.length >= 4 && Math.max(...vBefore) - Math.min(...vBefore) > 3, `verticals converge before: ${vBefore}`);
  await openPanel(); await page.click('#btn-upright-vertical');
  await settle();
  const sv = await sliders();
  assert.ok(Math.abs(sv.pv - 50) <= 4, `Vertical slider ~50 for pv 0.2, got ${sv.pv}`);
  const vAfter = (await measure()).filter(d => d.axis === 'v').map(d => d.dev);
  assert.ok(vAfter.length >= 4, 'verticals still detected after correction');
  assert.ok(Math.max(...vAfter.map(Math.abs)) < 0.8, `verticals upright in the real render: ${vAfter.map(v => v.toFixed(2))}`);
  await page.evaluate(() => window.fxUndo());
  await settle();
  const su = await sliders();
  assert.deepEqual([su.pv, su.rot], [0, 0], 'one undo restores Vertical and Rotate');

  // ── Level ──
  await loadSynthetic('grid', 4);
  await settle();
  const a0 = (await sliders()).angle;
  await openPanel(); await page.click('#btn-upright-level');
  await settle();
  const sl = await sliders();
  assert.ok(Math.abs(sl.angle - a0 + 4) <= 0.3, `Straighten set to undo +4 deg, got ${sl.angle}`);
  const lAfter = await measure();
  assert.ok(lAfter.length >= 6 && Math.max(...lAfter.map(d => Math.abs(d.dev))) < 0.6, `grid level in the real render: ${lAfter.map(d => d.dev.toFixed(2))}`);
  await page.evaluate(() => window.fxUndo());
  await settle();
  assert.equal((await sliders()).angle, a0, 'one undo restores Straighten');
  console.log('PASS: Upright Level/Vertical set the existing controls, the real render comes out level/upright, undo restores');
} finally {
  await browser.close();
  server.close();
}
