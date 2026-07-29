#!/usr/bin/env node
// Verification probe on the real photo (__TM3390.jpg): does the skin-tone uniformity actually
// even out the pale-chest / tanned-face mismatch, and does the mask shape keep the dog out?
// Samples named points, renders with and without the mask, and writes the Selection map so the
// gate can be inspected visually.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.json': 'application/json', '.cube': 'text/plain' };

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
  && typeof window.loadFXImages === 'function' && typeof window.processToCanvas === 'function',
  null, { timeout: 30000 });

const jpg = (await readFile(path.join(ROOT, '__TM3390.jpg'))).toString('base64');
await page.evaluate(async (b64) => {
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  await window.loadFXImages([new File([arr], '__TM3390.jpg', { type: 'image/jpeg' })]);
}, jpg);
await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length > 0, null, { timeout: 60000 });

// Points in ORIGINAL 4000x6000 pixel coords.
const PTS = {
  'cheek (tanned)':  [1290, 3990],
  'neck':            [1440, 4560],
  'shoulder':        [ 660, 5100],
  'chest (pale)':    [1200, 5250],
  'chest lower':     [1500, 5600],
  'dog head (lit)':  [2370, 3600],
  'dog ear (lit)':   [2700, 3900],
  'dog body':        [2550, 4350],
  'dog fur shadow':  [2400, 3900],
  'sky':             [2700,  300],
  'lake water':      [3300, 3150],
  'grey rock':       [ 300, 3600],
};

const result = await page.evaluate(async (PTS) => {
  const it = fxImages[0];
  const src = it.img;
  const W = src.naturalWidth, H = src.naturalHeight;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  cv.getContext('2d').drawImage(src, 0, 0);
  const ctx = cv.getContext('2d');
  const sample = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };

  const srcPts = {};
  for (const [n, [x, y]] of Object.entries(PTS)) {
    const rgb = sample(x, y);
    const [h, s, v] = r2hsv(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    srcPts[n] = { rgb, h: +h.toFixed(4), s: +s.toFixed(4), v: +v.toFixed(4) };
  }

  // Gate centred on the CHEEK (what the eyedropper would do), target = MST 6 with some tan.
  const cheek = srcPts['cheek (tanned)'];
  const mkMask = (over) => Object.assign({
    type: 'radial', origin: 'skin',
    cx: 0.5, cy: 0.5, rx: 0.42, ry: 0.52, rot: 0, feather: 0.8, invert: false,
    lumLo: 0, lumHi: 1, exp: 0, con: 0, temp: 0, tint: 0, sat: 0, hue: 0, hi: 0, sh: 0,
    subtract: false, colHue: 0, colAmt: 0, colSat: 0.65,
    crOn: true, crH: cheek.h, crS: cheek.s, crV: cheek.v, crRange: 40,
    uH: 60, uS: 45, uL: 35, preserve: 70,
    tgtMode: 'swatch', tgtHex: '#a07e56', tanDepth: 35, tanWarm: 45, srcV: null,
  }, over || {});

  // Gate weight, replicating colRangeWeight() exactly (JS mirror used by mskMeasureSrcV).
  const gateOf = (m, p) => {
    const R = m.crRange / 100, hHalf = 0.02 + R * 0.14, sHalf = 0.10 + R * 0.45;
    let dh = Math.abs(p.h - m.crH); if (dh > 0.5) dh = 1 - dh;
    const wh = Math.max(0, 1 - Math.pow(dh / hHalf, 2));
    const ws = Math.max(0, 1 - Math.pow((p.s - m.crS) / sHalf, 2));
    return +(wh * ws).toFixed(4);
  };
  // Shape weight for the default Skin radial, in the same y-flipped uv the shader uses.
  const shapeOf = (m, x, y) => {
    const u = x / W, v = 1 - y / H;
    const t = Math.hypot((u - m.cx) / m.rx, (v - m.cy) / m.ry);
    const f = Math.min(Math.max(m.feather, 0.02), 1.0);
    const e0 = Math.max(1 - 2 * f, 0), e1 = 1;
    let ss = (t - e0) / (e1 - e0); ss = Math.min(Math.max(ss, 0), 1);
    return +(1 - (ss * ss * (3 - 2 * ss))).toFixed(4);
  };

  // m0 = the out-of-the-box "+ Skin" default. mFit = the same mask dragged/resized over the man,
  // which is what a user does in about two seconds once the shape is visible on the photo.
  const m0 = mkMask();
  const mFit = mkMask({ cx: 0.319, cy: 0.25, rx: 0.30, ry: 0.34 });
  const weights = {}, weightsFit = {};
  for (const [n, [x, y]] of Object.entries(PTS)) {
    const g = gateOf(m0, srcPts[n]);
    weights[n] = { gate: g, shape: shapeOf(m0, x, y), effective: +(g * shapeOf(m0, x, y)).toFixed(4) };
    weightsFit[n] = { gate: g, shape: shapeOf(mFit, x, y), effective: +(g * shapeOf(mFit, x, y)).toFixed(4) };
  }

  const renderWith = async (masks) => {
    window.__reseed && window.__reseed();
    window.applyUISnapshot({ sliders: {}, toggles: { local: !!masks }, selects: { 'sel-lut': '', 'sel-print': '' }, colors: {}, masks: masks || [] });
    if (window.fxUpdate) window.fxUpdate();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    fxState.artSeed = 7.7;
    const P = window.getFXParams();
    const s2 = window.geomCanvas ? window.geomCanvas(it) : it.img;
    return await window.processToCanvas(P, s2, s2.naturalWidth || s2.width, s2.naturalHeight || s2.height);
  };

  const cvOff = await renderWith(null);
  const offData = {};
  for (const [n, [x, y]] of Object.entries(PTS)) {
    const d = cvOff.getContext('2d').getImageData(x, y, 1, 1).data;
    offData[n] = [d[0], d[1], d[2]];
  }
  const measure = async (m) => {
    const cv2 = await renderWith([m]);
    const c2 = cv2.getContext('2d');
    const out = {};
    for (const [n, [x, y]] of Object.entries(PTS)) {
      const d1 = c2.getImageData(x, y, 1, 1).data;
      const b = offData[n], a = [d1[0], d1[1], d1[2]];
      const hb = r2hsv(b[0] / 255, b[1] / 255, b[2] / 255), ha = r2hsv(a[0] / 255, a[1] / 255, a[2] / 255);
      out[n] = { before: b, after: a,
        hb: +hb[0].toFixed(4), sb: +hb[1].toFixed(4), vb: +hb[2].toFixed(4),
        ha: +ha[0].toFixed(4), sa: +ha[1].toFixed(4), va: +ha[2].toFixed(4),
        dE: +Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]).toFixed(1) };
    }
    return out;
  };
  const after = await measure(m0);
  const afterFit = await measure(mFit);
  // Wider Range + softer/larger shape => the weight is nearly UNIFORM across the skin, which is
  // what lets the contraction actually dominate (see the analysis in the report).
  const mWide = mkMask({ cx: 0.319, cy: 0.22, rx: 0.40, ry: 0.42, feather: 1.0, crRange: 70 });
  const afterWide = await measure(mWide);
  const wWide = {};
  for (const [n, [x, y]] of Object.entries(PTS)) {
    const g = gateOf(mWide, srcPts[n]), sh = shapeOf(mWide, x, y);
    wWide[n] = { gate: g, shape: sh, effective: +(g * sh).toFixed(4) };
  }

  // Selection map, downscaled for a viewable PNG.
  const selCv = document.createElement('canvas');
  const SW = 700, SH = Math.round(SW * H / W);
  selCv.width = SW; selCv.height = SH;
  FX.render(window.getFXParams(), SW, SH, { glowScale: 1, showSel: 0 });
  selCv.getContext('2d').drawImage(FX.cv, 0, 0, SW, SH);
  const selPng = selCv.toDataURL('image/png').split(',')[1];

  return { W, H, srcPts, mask: m0, weights, weightsFit, wWide, after, afterFit, afterWide, selPng };
}, PTS);

console.log(`photo ${result.W}x${result.H}`);
console.log(`gate centred on cheek: h=${result.mask.crH.toFixed(4)} s=${result.mask.crS.toFixed(4)} range=${result.mask.crRange}`);
console.log('\n── colour gate (hue/sat only) + shape weight, DEFAULT vs FITTED mask ──');
console.log('point'.padEnd(17), 'src rgb'.padEnd(17), 'gate'.padEnd(7), 'shp(def)'.padEnd(9), 'eff(def)'.padEnd(9), 'shp(fit)'.padEnd(9), 'eff(fit)');
for (const n of Object.keys(result.weights)) {
  const w = result.weights[n], f = result.weightsFit[n];
  console.log(n.padEnd(17), String(result.srcPts[n].rgb).padEnd(17),
    String(w.gate).padEnd(7), String(w.shape).padEnd(9), String(w.effective).padEnd(9),
    String(f.shape).padEnd(9), f.effective);
}
const gap = (set, label) => {
  const c = set['cheek (tanned)'], p = set['chest (pale)'];
  console.log(`\n── cheek vs chest — ${label} ──`);
  for (const [lbl, kb, ka] of [['hue', 'hb', 'ha'], ['sat', 'sb', 'sa'], ['val', 'vb', 'va']]) {
    const gb = Math.abs(c[kb] - p[kb]), ga = Math.abs(c[ka] - p[ka]);
    const mc = Math.abs(c[ka] - c[kb]), mp = Math.abs(p[ka] - p[kb]);
    console.log(`${lbl}: gap ${gb.toFixed(4)} -> ${ga.toFixed(4)} `
      + `${ga < gb ? 'CLOSED ' + (100 * (1 - ga / gb)).toFixed(0) + '%' : 'WIDENED'}`.padEnd(18)
      + `| cheek moved ${mc.toFixed(4)}, chest moved ${mp.toFixed(4)}`
      + `  ${mp > mc ? '(pale moved MORE = contraction)' : '(tanned moved more)'}`);
  }
};
console.log('\n── pixel change, DEFAULT mask ──');
console.log('point'.padEnd(17), 'before'.padEnd(17), 'after(def)'.padEnd(17), 'dRGB'.padEnd(7), 'after(fit)'.padEnd(17), 'dRGB');
for (const n of Object.keys(result.after)) {
  const r = result.after[n], f = result.afterFit[n];
  console.log(n.padEnd(17), String(r.before).padEnd(17), String(r.after).padEnd(17),
    String(r.dE).padEnd(7), String(f.after).padEnd(17), f.dE);
}
gap(result.after, 'DEFAULT mask (centred in frame)');
gap(result.afterFit, 'FITTED mask (dragged over the man)');
gap(result.afterWide, 'FITTED + wide Range 70, feather 1 (uniform weight)');
console.log('\n── weights under the wide variant (want these NEAR-EQUAL across skin) ──');
for (const n of ['cheek (tanned)', 'neck', 'shoulder', 'chest (pale)', 'chest lower',
                 'dog head (lit)', 'dog ear (lit)', 'dog body', 'sky', 'lake water']) {
  const w = result.wWide[n];
  console.log(n.padEnd(17), 'gate', String(w.gate).padEnd(8), 'shape', String(w.shape).padEnd(8), 'eff', w.effective);
}
await writeFile(path.join(ROOT, 'test/output/tm3390_selection.png'), Buffer.from(result.selPng, 'base64'));
console.log('\nwrote test/output/tm3390_selection.png');
await browser.close();
server.close();
