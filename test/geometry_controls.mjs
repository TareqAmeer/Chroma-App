#!/usr/bin/env node
// Focused contract for the manual perspective controls: Transform panel placement,
// snapshot persistence, parameter mapping, and the existing shared still-export renderer.
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
], executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('[console.error]', m.text()); });
  page.on('response', r => { if (r.status() >= 400) console.error('[http]', r.status(), r.url()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.getFXParams === 'function'
    && typeof window.processToCanvas === 'function'
    && typeof window.getUISnapshot === 'function'
    && typeof window.applyUISnapshot === 'function', null, { timeout: 10000 });

  const mapped = await page.evaluate(async () => {
    const ids = ['sl-lens-pv', 'sl-lens-ph', 'sl-lens-rot', 'sl-lens-scale'];
    const section = document.querySelector('[data-fxsec="straighten"]');
    const title = section?.querySelector('.fx-ctrl-title')?.textContent.trim();
    if (!section || !title?.startsWith('Transform')) {
      throw new Error(`Manual geometry controls are not under the Transform panel (title: ${title || 'missing'})`);
    }
    for (const id of ids) {
      if (document.querySelectorAll(`#${id}`).length !== 1) throw new Error(`${id} must exist once`);
      if (!section.querySelector(`#${id}`)) throw new Error(`${id} is outside Transform`);
      if (document.querySelector(`[data-fxsec="lens"] #${id}`)) throw new Error(`${id} remains under Lens Correction`);
    }

    const values = { 'sl-lens-pv': 50, 'sl-lens-ph': -25, 'sl-lens-rot': 15, 'sl-lens-scale': 20 };
    for (const [id, value] of Object.entries(values)) document.getElementById(id).value = value;
    const snapshot = window.getUISnapshot();
    for (const id of Object.keys(values)) document.getElementById(id).value = 0;
    window.applyUISnapshot(snapshot);
    const lens = window.getFXParams().lens;
    const src = document.createElement('canvas'); src.width = 32; src.height = 24;
    let forwarded = null;
    const renderer = {
      _maskReferenceSize: null,
      setImage(image) { this.image = image; },
      render(P, w, h) { forwarded = { lens: P.lens, w, h }; },
      getPixels() {
        const px = new Uint8ClampedArray(src.width * src.height * 4);
        for (let i = 0; i < px.length; i += 4) { px[i] = 80; px[i + 1] = 100; px[i + 2] = 120; px[i + 3] = 255; }
        return { px, w: src.width, h: src.height };
      },
    };
    const output = await window.processToCanvas(window.getFXParams(), src, src.width, src.height, undefined, renderer);
    const pixels = [...output.getContext('2d').getImageData(0, 0, output.width, output.height).data];
    return { lens, forwarded, snapshot, snapshotKeys: Object.keys(snapshot), size: [output.width, output.height], nonZero: pixels.filter(v => v !== 0).length, alpha: pixels.filter((_, i) => i % 4 === 3 && pixels[i] !== 0).length };
  });

  assert.equal(mapped.lens.pv, 0.2);
  assert.equal(mapped.lens.ph, -0.1);
  assert.ok(Math.abs(mapped.lens.rot - (15 * Math.PI / 1800)) < 1e-12);
  assert.ok(Math.abs(mapped.lens.scale - (1 / 1.2)) < 1e-12);
  assert.deepEqual(mapped.forwarded, { lens: mapped.lens, w: 32, h: 24 }, 'shared export route forwards geometry recipe to renderer');
  assert.ok(mapped.snapshotKeys.length > 0, 'snapshot was captured');
  assert.ok(mapped.size[0] > 1 && mapped.size[1] > 1, 'shared processToCanvas path returns a usable canvas');
  assert.ok(mapped.nonZero > 0 && mapped.alpha === 32 * 24, `export render contains image pixels (${mapped.nonZero} nonzero channels, ${mapped.alpha} opaque pixels)`);
  console.log('PASS: Transform placement, snapshot round-trip, manual parameter mapping, and shared export recipe handoff');
} finally {
  await browser.close();
  server.close();
}
