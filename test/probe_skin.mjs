#!/usr/bin/env node
// Ad-hoc probe: load the real app, apply the skin_uniformity recipe, and dump what the shader
// actually receives (mskSkinTarget's resolved target, srcV, the gate weight for chosen pixels).
// Used to verify the uniformity math against measured pixels rather than by hand-algebra.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.cube': 'text/plain' };

const server = await new Promise((resolve) => {
  const s = createServer(async (req, res) => {
    try {
      const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      const data = await readFile(p);
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  s.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader',
  '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('pageerror', e => console.error('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.error('[console.error]', m.text()); });

await page.goto(`${base}/chromasmith-22.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.applyUISnapshot === 'function'
  && typeof window.loadFXImages === 'function' && typeof window.getFXParams === 'function',
  null, { timeout: 30000 });

const fixture = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
await page.evaluate(async (b64) => {
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  await window.loadFXImages([new File([arr], 'portrait.png', { type: 'image/png' })]);
}, fixture);
await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length > 0, null, { timeout: 15000 });

const recipe = JSON.parse(await readFile(path.join(ROOT, 'test/recipes/skin_uniformity.json'), 'utf8'));
delete recipe._desc;

const out = await page.evaluate(async (snap) => {
  window.applyUISnapshot(snap);
  if (window.fxUpdate) window.fxUpdate();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const m = fxState.masks[0];
  const tgt = mskSkinTarget(m);
  // Replicate colRangeWeight() exactly for a few probe pixels, straight off the fixture.
  const src = fxImages[0].img;
  const c = document.createElement('canvas'); c.width = src.naturalWidth; c.height = src.naturalHeight;
  c.getContext('2d').drawImage(src, 0, 0);
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const R = (m.crRange != null ? m.crRange : 35) / 100;
  const hHalf = 0.02 + R * 0.14, sHalf = 0.10 + R * 0.45;
  const probe = { 'field(tanned)': [30, 30], 'disc(pale)': [256, 140], 'dot(dark)': [256, 192] };
  const gates = {};
  for (const [name, [x, y]] of Object.entries(probe)) {
    const i = (y * c.width + x) * 4;
    const [h, s, v] = r2hsv(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
    let dh = Math.abs(h - (m.crH || 0)); if (dh > 0.5) dh = 1 - dh;
    const wh = Math.max(0, 1 - Math.pow(dh / hHalf, 2));
    const ws = Math.max(0, 1 - Math.pow((s - (m.crS || 0)) / sHalf, 2));
    gates[name] = { rgb: [d[i], d[i + 1], d[i + 2]], h: +h.toFixed(4), s: +s.toFixed(4), v: +v.toFixed(4),
      wh: +wh.toFixed(4), ws: +ws.toFixed(4), gate: +(wh * ws).toFixed(4) };
  }
  return {
    maskFields: { crOn: m.crOn, crH: m.crH, crS: m.crS, crV: m.crV, crRange: m.crRange,
      uH: m.uH, uS: m.uS, uL: m.uL, preserve: m.preserve, tgtMode: m.tgtMode, tgtHex: m.tgtHex,
      tanDepth: m.tanDepth, tanWarm: m.tanWarm, srcV: m.srcV, rx: m.rx, ry: m.ry, feather: m.feather },
    resolvedTarget: { h: +tgt.h.toFixed(4), s: +tgt.s.toFixed(4), v: +tgt.v.toFixed(4) },
    paramsMaskCount: (window.getFXParams().masks || []).length,
    paramsMask0: JSON.parse(JSON.stringify((window.getFXParams().masks || [])[0] || null)),
    gates,
  };
}, recipe);

console.log(JSON.stringify(out, null, 2));

// ── Controlled sweep: isolate ONE uniformity channel at a time and read the tanned-field
// pixel, so w and each target component can be solved for independently.
const sweep = await page.evaluate(async (baseSnap) => {
  const base = JSON.parse(JSON.stringify(baseSnap));
  const variants = {
    'off  (all u=0)':            { uH: 0,   uS: 0, uL: 0,   preserve: 70,  tanDepth: 0, tanWarm: 0 },
    'hue  only u=100':           { uH: 100, uS: 0, uL: 0,   preserve: 70,  tanDepth: 0, tanWarm: 0 },
    'sat  only u=100':           { uH: 0,   uS: 100, uL: 0, preserve: 70,  tanDepth: 0, tanWarm: 0 },
    'lum  only u=100 presv=0':   { uH: 0,   uS: 0, uL: 100, preserve: 0,   tanDepth: 0, tanWarm: 0 },
    'lum  only u=100 presv=100': { uH: 0,   uS: 0, uL: 100, preserve: 100, tanDepth: 0, tanWarm: 0 },
    'lum  only u=50  presv=0':   { uH: 0,   uS: 0, uL: 50,  preserve: 0,   tanDepth: 0, tanWarm: 0 },
    'COMBINED (as recipe)':      {},
  };
  const res = {};
  for (const [label, over] of Object.entries(variants)) {
    const snap = JSON.parse(JSON.stringify(base));
    Object.assign(snap.masks[0], over);
    window.__reseed && window.__reseed();
    window.applyUISnapshot(snap);
    if (window.fxUpdate) window.fxUpdate();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const it = typeof curItem === 'function' ? curItem() : fxImages[0];
    const P = window.getFXParams();
    const src = window.geomCanvas ? window.geomCanvas(it) : it.img;
    const iw = src.naturalWidth || src.width, ih = src.naturalHeight || src.height;
    const cv = await window.processToCanvas(P, src, iw, ih);
    const d = cv.getContext('2d').getImageData(30, 30, 1, 1).data;
    const [h, s, v] = r2hsv(d[0] / 255, d[1] / 255, d[2] / 255);
    res[label] = { rgb: [d[0], d[1], d[2]], h: +h.toFixed(4), s: +s.toFixed(4), v: +v.toFixed(4) };
  }
  return res;
}, recipe);

console.log('\n── field(tanned) pixel under isolated uniformity channels ──');
for (const [k, r] of Object.entries(sweep)) {
  console.log(`${k.padEnd(28)} rgb=${String(r.rgb).padEnd(16)} h=${r.h}  s=${r.s}  v=${r.v}`);
}

await browser.close();
server.close();
