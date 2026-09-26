#!/usr/bin/env node
// Render the temporary canal photograph through Chromasmith's real export pipeline.
// Run from the repository root: node site/render-story-photo.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'design/prototypes/swiss-kinetic/photos/canal.webp');
const out = path.join(root, 'site/assets/story');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.cube': 'text/plain', '.json': 'application/json', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filepath = path.resolve(root, '.' + pathname);
    if (!filepath.startsWith(root + path.sep)) throw new Error('Outside root');
    const data = await readFile(filepath);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.writeHead(200, { 'Content-Type': mime[path.extname(filepath)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader',
  '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
try {
  await mkdir(out, { recursive: true });
  const original = await readFile(source);
  await writeFile(path.join(out, 'original.webp'), original);
  const page = await browser.newPage();
  await page.addInitScript(() => {
    let seed = 0xC0FFEE;
    window.__reseed = () => { seed = 0xC0FFEE; };
    Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`);
  await page.waitForFunction(() => typeof window.getUISnapshot === 'function'
    && typeof window.loadFXImages === 'function' && typeof window.applyUISnapshot === 'function'
    && typeof window.processToCanvas === 'function' && typeof window.getFXParams === 'function');
  await page.evaluate(async b64 => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    await window.loadFXImages([new File([png], 'canal.png', { type: 'image/png' })]);
  }, original.toString('base64'));
  await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length > 0);
  const recipes = [
    ['studio', { sliders: {}, toggles: {}, selects: { 'sel-lut': 'p:classic_neg', 'sel-print': '' }, colors: {} }],
    ['film', { sliders: { 'grain-a': '8', 'grain-sz': '30', 'hal-a': '24', 'hal-r': '20', 'hal-p': '48' },
      toggles: { grain: true, hal: true },
      selects: { 'sel-lut': 'p:classic_neg', 'sel-print': '', 'sel-grain-fmt': '35mm' }, colors: {} }],
  ];
  for (const [name, recipe] of recipes) {
    const dataUrl = await page.evaluate(async snap => {
      window.applyUISnapshot(snap);
      if (typeof window.fxUpdate === 'function') window.fxUpdate();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const until = Date.now() + 5000;
      while (!fxState.lut && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 30));
      if (!fxState.lut) throw new Error('Classic Neg LUT did not load');
      const item = typeof curItem === 'function' ? curItem() : fxImages[fxCurIdx || 0];
      fxState.artSeed = 7.7;
      window.__reseed();
      const params = window.getFXParams(item.adjustOverride || undefined);
      const src = window.geomCanvas ? window.geomCanvas(item) : item.img;
      let canvas;
      let valid = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        canvas = await window.processToCanvas(params, src,
          src.naturalWidth || src.width, src.naturalHeight || src.height);
        const probe = document.createElement('canvas');
        probe.width = 16; probe.height = 16;
        const probeContext = probe.getContext('2d');
        probeContext.drawImage(canvas, 0, 0, 16, 16);
        const sample = probeContext.getImageData(0, 0, 16, 16).data;
        valid = sample.some((value, index) => index % 4 === 3 && value);
        if (valid) break;
        await new Promise(resolve => setTimeout(resolve, 120));
      }
      if (!valid) throw new Error('Blank render after five attempts');
      return canvas.toDataURL('image/webp', .89);
    }, recipe);
    await writeFile(path.join(out, `${name}.webp`), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`${name}.webp rendered through Chromasmith`);
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
