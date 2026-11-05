#!/usr/bin/env node
// CHR-203: each saved version in Versions & History gets a thumbnail rendered from ITS OWN recipe
// (two versions with different edits → different thumbnails), without touching the live edit.
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
  await page.addStyleTag({ content: '#cs-modal-ov{display:none!important}' }); // first-run guide modal
  await page.waitForFunction(() => typeof window.verRender === 'function' && typeof window.loadFXImages === 'function'
    && typeof FX !== 'undefined' && FX.ok, null, { timeout: 60000 });
  const r = await page.evaluate(async () => {
    const blob = await (await fetch('test/fixtures/portrait.png')).blob();
    await loadFXImages([new File([blob], 'portrait.png', { type: 'image/png' })]);
    await new Promise(r => setTimeout(r, 1000));
    // Two saved versions that differ only in exposure (dark vs bright), plus the current edit.
    const exp = document.getElementById('sl-adj-exp'), orig = exp.value;
    const enc = s => btoa(unescape(encodeURIComponent(JSON.stringify(s))));
    const withExp = v => { exp.value = v; const s = getUISnapshot(); s.toggles.adjust = true; return enc(s); };
    const dark = withExp(exp.min), bright = withExp(exp.max);
    exp.value = orig;
    const liveBefore = JSON.stringify(getUISnapshot()), histBefore = fxHistory.length;
    window.chromasmithVersions = { available: () => true,
      get: async () => ({ versions: [{ name: 'Dark', recipe: dark }, { name: 'Bright', recipe: bright }, { name: 'Now', recipe: enc(getUISnapshot()) }], active: 2 }) };
    fxSection('info');
    const t0 = performance.now();
    await verRender();
    const renderMs = performance.now() - t0; // the list itself must not wait for thumbnails
    const imgs = () => [...document.querySelectorAll('#ver-list img.ver-thumb[data-ver-i]')];
    while (imgs().some(i => !i.src) && performance.now() - t0 < 120000) await new Promise(r => setTimeout(r, 200));
    for (const i of imgs()) await i.decode();
    const mean = img => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4 * 3); };
    const out = { renderMs, n: imgs().length, srcs: imgs().map(i => i.src), means: imgs().map(mean),
      cur: !!document.querySelector('#ver-list img[data-ver-cur]'),
      liveSame: JSON.stringify(getUISnapshot()) === liveBefore, histSame: fxHistory.length === histBefore, expNow: exp.value, orig };
    // Cache: rendering the list again must reuse the same thumbnails, not re-render.
    await verRender();
    await new Promise(r => setTimeout(r, 50)); out.srcs2 = imgs().map(i => i.src);
    return out;
  });
  assert.equal(r.n, 2, 'both non-current saved versions get their own thumbnail');
  assert.ok(r.cur, 'the current row still shows the live canvas');
  assert.ok(r.renderMs < 2000, `verRender returns without waiting for thumbnails (${r.renderMs.toFixed(0)}ms)`);
  assert.ok(r.srcs.every(s => s.startsWith('blob:')), 'thumbnails were rendered');
  assert.notEqual(r.srcs[0], r.srcs[1]);
  assert.ok(r.means[1] - r.means[0] > 30, `Dark vs Bright thumbnails differ: means ${r.means.map(m => m.toFixed(1))}`);
  assert.ok(r.liveSame, 'the current edit is untouched');
  assert.ok(r.histSame, 'no history entries were added');
  assert.equal(r.expNow, r.orig, 'live exposure slider unchanged');
  assert.deepEqual(r.srcs2, r.srcs, 'second render reuses cached thumbnails');
  console.log(`PASS: per-version thumbnails (means ${r.means.map(m => m.toFixed(1)).join(' vs ')}), live edit untouched, cached`);
} finally {
  await browser.close();
  server.close();
}
