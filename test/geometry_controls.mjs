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
], executablePath: process.env.CHROME_PATH || (process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined) });
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
  // CHR-248: Aspect / X Offset / Y Offset — mapping, snapshot, and real GPU pixels through the
  // shared processToCanvas export path. Source: red ramps left->right, green ramps top->bottom.
  const geo = await page.evaluate(async () => {
    for (const id of ['sl-lens-asp', 'sl-lens-ox', 'sl-lens-oy']) {
      if (document.querySelectorAll(`#${id}`).length !== 1) throw new Error(`${id} must exist once`);
      if (!document.querySelector(`[data-fxsec="straighten"] #${id}`)) throw new Error(`${id} is outside Transform`);
    }
    const reset = () => { for (const id of ['sl-lens-pv','sl-lens-ph','sl-lens-rot','sl-lens-scale','sl-lens-asp','sl-lens-ox','sl-lens-oy']) document.getElementById(id).value = 0; };
    reset();
    document.getElementById('sl-lens-asp').value = 40;
    document.getElementById('sl-lens-ox').value = 40;
    document.getElementById('sl-lens-oy').value = -20;
    const snap = window.getUISnapshot(); reset(); window.applyUISnapshot(snap);
    const lens = window.getFXParams().lens;
    const W = 64, H = 48, src = document.createElement('canvas'); src.width = W; src.height = H;
    const cx = src.getContext('2d'), id = cx.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y*W+x)*4; id.data[i] = x*4; id.data[i+1] = y*5; id.data[i+2] = 128; id.data[i+3] = 255; }
    cx.putImageData(id, 0, 0);
    const R = new FXR(document.createElement('canvas'));
    const base = window.getFXParams();
    const run = async l => { const P = JSON.parse(JSON.stringify(base)); P.lens = Object.assign({dist:0,vig:0,ca:0,defringe:0,pv:0,ph:0,rot:0,scale:1}, l);
      const c = await window.processToCanvas(P, src, W, H, undefined, R); return c.getContext('2d').getImageData(0, 0, c.width, c.height).data; };
    const at = (d, x, y, ch) => d[(y*W+x)*4+ch];
    const b = await run({}), b2 = await run({}), z = await run({asp:0, ox:0, oy:0});
    let det = 0; for (let i = 0; i < b.length; i++) det = Math.max(det, Math.abs(b[i] - b2[i]));
    const ox = await run({ox:0.1}), oy = await run({oy:0.1}), asp = await run({asp:0.5});
        let diff = 0; for (let i = 0; i < b.length; i++) diff = Math.max(diff, Math.abs(b[i] - z[i]));
    return { lens, det, diff,
      rBase: at(b,48,24,0), rOx: at(ox,48,24,0),           // photo moved right -> pixel shows content from the left
      gBase: at(b,32,30,1), gOy: at(oy,32,30,1),           // +Y moved up -> content from lower down
      rAspBase: at(b,56,24,0), rAsp: at(asp,56,24,0), gAspBase: at(b,32,40,1), gAsp: at(asp,32,40,1) };
  });
  assert.equal(geo.lens.asp, 0.4); assert.equal(geo.lens.ox, 0.1); assert.equal(geo.lens.oy, -0.05);
  // Two identical baseline renders already differ by a few LSBs (render dither), so identity is
  // judged against that measured run-to-run noise rather than demanding byte equality.
  assert.ok(geo.diff <= Math.max(geo.det, 1), `zero Aspect/Offset matches the untransformed render (max diff ${geo.diff}, run-to-run noise ${geo.det})`);
  assert.ok(geo.rOx < geo.rBase - 10, `X offset shifts photo right (${geo.rBase} -> ${geo.rOx})`);
  assert.ok(geo.gOy > geo.gBase + 10, `Y offset (+UI) moves photo up (${geo.gBase} -> ${geo.gOy})`);
  assert.ok(geo.rAsp < geo.rAspBase - 10, `positive Aspect stretches horizontally (${geo.rAspBase} -> ${geo.rAsp})`);
  assert.ok(Math.abs(geo.gAsp - geo.gAspBase) <= 2, `positive Aspect leaves vertical untouched (${geo.gAspBase} -> ${geo.gAsp})`);
  console.log('PASS: Aspect / X Offset / Y Offset mapping, snapshot, identity, and GPU pixel direction', JSON.stringify(geo));
  console.log('PASS: Transform placement, snapshot round-trip, manual parameter mapping, and shared export recipe handoff');
} finally {
  await browser.close();
  server.close();
}
