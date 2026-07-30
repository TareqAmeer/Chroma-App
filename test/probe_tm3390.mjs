#!/usr/bin/env node
// Acceptance probe on the real photo (__TM3390.jpg) for the Skin Tone tool.
//
// Two questions, both measured rather than eyeballed:
//   1. SELECTED — does every kind of skin in the frame get a high, and roughly EQUAL, gate weight?
//      Equal matters as much as high: each pixel moves by w*u*(target-x), so a weakly-selected
//      patch barely moves, and if it is the patch furthest from the target the spread gets WORSE.
//   2. MATCHING — does the spread of hue/saturation/value ACROSS the skin points shrink?
// Also checks the dog, sky, water and rock stay out, and writes the Selection map as a PNG.
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

// ORIGINAL 4000x6000 pixel coords. SKIN[] are the points that must all end up matching.
// LIT skin — the set that must end up matching. "Even tan" is a question about lit skin: shadowed
// skin is *supposed* to stay darker, and forcing it to match in brightness is exactly the
// form-destroying flattening that Preserve modeling exists to avoid. So shadow points below are
// checked for SELECTION coverage but excluded from the tone-matching verdict.
const SKIN_LIT = {
  'cheek':        [1290, 3990],
  'shoulder L':   [ 660, 5100],
  'chest upper':  [1200, 5250],
  'chest lower':  [1500, 5600],
};
const SKIN_SHADOW = {
  'jaw/neck':     [1440, 4560],
  'chest side':   [ 900, 5750],
};
const SKIN = { ...SKIN_LIT, ...SKIN_SHADOW };
const OTHER = {
  'dog head':     [2370, 3600],
  'dog ear':      [2700, 3900],
  'dog body':     [2550, 4350],
  'sky':          [2700,  300],
  'lake water':   [3300, 3150],
  'grey rock':    [ 300, 3600],
};
// Which skin points to use as eyedropper samples (the gesture: click the cheek, shift-click a
// shaded patch and a pale/pinker patch).
const PICK_FROM = ['cheek', 'jaw/neck', 'chest lower'];

const out = await page.evaluate(async ({ SKIN, OTHER, PICK_FROM }) => {
  const ALL = { ...SKIN, ...OTHER };
  const it = fxImages[0], src = it.img;
  const W = src.naturalWidth, H = src.naturalHeight;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'); ctx.drawImage(src, 0, 0);
  // ONE getImageData for the whole frame. Per-pixel getImageData calls are ~4 orders of magnitude
  // slower and made this probe take longer than the render it was measuring.
  const full = ctx.getImageData(0, 0, W, H).data;
  const at = (x, y) => { const i = (y * W + x) * 4; return [full[i], full[i + 1], full[i + 2]]; };
  const srcHsv = {};
  for (const [n, [x, y]] of Object.entries(ALL)) {
    const rgb = at(x, y);
    const [h, s, v] = rgb2oklch(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    srcHsv[n] = { rgb, h, s, v };
  }

  const mkMask = (over) => Object.assign({
    type: 'radial', origin: 'skin',
    cx: 0.319, cy: 0.22, rx: 0.42, ry: 0.46, rot: 0, feather: 1, invert: false,
    lumLo: 0, lumHi: 1, exp: 0, con: 0, temp: 0, tint: 0, sat: 0, hue: 0, hi: 0, sh: 0,
    subtract: false, colHue: 0, colAmt: 0, colSat: 0.65,
    crOn: true, crSamples: [], crRange: 55,
    uH: 75, uS: 65, uL: 40, preserve: 70,
    tgtMode: 'swatch', tgtHex: '#a07e56', tanDepth: 30, tanWarm: 40, srcV: null,
  }, over || {});

  const shapeOf = (m, x, y) => {
    if (m._flatShape) return 1;   // reference: what a painted brush mask gives (flat 1.0 inside)
    const u = x / W, v = 1 - y / H;
    const t = Math.hypot((u - m.cx) / m.rx, (v - m.cy) / m.ry);
    const f = Math.min(Math.max(m.feather, 0.02), 1.0);
    const e0 = Math.max(1 - 2 * f, 0);
    let ss = (t - e0) / (1 - e0); ss = Math.min(Math.max(ss, 0), 1);
    return 1 - (ss * ss * (3 - 2 * ss));
  };

  // Render at 1/DIV resolution. The colour gate, the uniformity contraction and the analytic mask
  // shape are all per-pixel functions of GLOBAL uv, so they are scale-invariant — a quarter-size
  // render reports the same converged tones while being ~16x cheaper. (Full res took >10 min for
  // this sweep under software GL, mostly in the 96MB getImageData per variant.)
  const DIV = 4, RW = Math.round(W / DIV), RH = Math.round(H / DIV);
  const render = async (m) => {
    window.__reseed && window.__reseed();
    window.applyUISnapshot({ sliders: {}, toggles: { local: !!m },
      selects: { 'sel-lut': '', 'sel-print': '' }, colors: {}, masks: m ? [m] : [] });
    if (window.fxUpdate) window.fxUpdate();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    fxState.artSeed = 7.7;
    FX.render(window.getFXParams(), RW, RH, { glowScale: 1, showSel: -1 });
    const c = document.createElement('canvas'); c.width = RW; c.height = RH;
    c.getContext('2d').drawImage(FX.cv, 0, 0);
    return c;
  };

  const readAll = (canvas) => {
    const c = canvas.getContext('2d'), o = {};
    const cw = canvas.width, ch = canvas.height;
    const dat = c.getImageData(0, 0, cw, ch).data;
    // Average a small block, like the app's own 5x5 eyedropper. A single pixel at reduced render
    // scale lands unpredictably on nearby detail (hair, the necklace) and produced wild hue
    // outliers that swamped the spread metric.
    const K = 5, half = (K - 1) >> 1;
    for (const [n, [x0, y0]] of Object.entries(ALL)) {
      const cx = Math.round(x0 * cw / W), cy = Math.round(y0 * ch / H);
      let r = 0, g = 0, b = 0, cnt = 0;
      for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) {
        const x = Math.min(cw - 1, Math.max(0, cx + dx)), y = Math.min(ch - 1, Math.max(0, cy + dy));
        const i = (y * cw + x) * 4;
        r += dat[i]; g += dat[i + 1]; b += dat[i + 2]; cnt++;
      }
      const rgb = [Math.round(r / cnt), Math.round(g / cnt), Math.round(b / cnt)];
      const [h, s, v] = rgb2oklch(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
      o[n] = { rgb, h, s, v };
    }
    return o;
  };

  const before = readAll(await render(null));

  // Variants: 1 sample (the old behaviour) vs the full multi-sample locus.
  const variants = {};
  const P3 = PICK_FROM.map(n => ({ h: srcHsv[n].h, s: srcHsv[n].s, v: srcHsv[n].v }));
  const cases = [
    ['1 sample (cheek only)', { crSamples: [{ h: srcHsv.cheek.h, s: srcHsv.cheek.s, v: srcHsv.cheek.v }] }],
    ['2 samples', { crSamples: ['cheek', 'chest lower'].map(n => ({ h: srcHsv[n].h, s: srcHsv[n].s, v: srcHsv[n].v })) }],
    ['3 samples, feather 1.0', { crSamples: P3 }],
    ['3 samples, feather 0.5', { crSamples: P3, feather: 0.5 }],
    ['3 samples, feather 0.3', { crSamples: P3, feather: 0.3 }],
    ['3 samples, feather 0.15', { crSamples: P3, feather: 0.15 }],
    ['3 samples, BRUSH (flat shape)', { crSamples: P3, _flatShape: true }],
    // Ceiling checks: how close can the CURRENT per-pixel operator get before a
    // frequency-separated lightness pass (ROADMAP 7) is actually required?
    ['MAX h/s, feather 0.3', { crSamples: P3, feather: 0.3, uH: 100, uS: 100, uL: 40 }],
    ['MAX all, preserve 70', { crSamples: P3, feather: 0.3, uH: 100, uS: 100, uL: 100 }],
    ['MAX all, preserve 30', { crSamples: P3, feather: 0.3, uH: 100, uS: 100, uL: 100, preserve: 30 }],
    ['MAX all, preserve 0', { crSamples: P3, feather: 0.3, uH: 100, uS: 100, uL: 100, preserve: 0 }],
  ];
  for (const [label, over] of cases) {
    const m = mkMask(over);
    // A huge, hard-edged ellipse is flat 1.0 everywhere in frame — the same weight field a fully
    // painted brush mask gives, so the shader render matches shapeOf's flat 1.0.
    if (m._flatShape) { m.rx = 9; m.ry = 9; m.feather = 0.02; }
    // srcV as the app measures it: weighted mean V of gate-passing pixels.
    let acc = 0, wsum = 0;
    const step = 16;
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
      const d = at(x, y);
      const [h, s, v] = rgb2oklch(d[0] / 255, d[1] / 255, d[2] / 255);
      const w = crWeightJS(h, s, m.crSamples, m.crRange) * shapeOf(m, x, y);
      if (w > 0) { acc += w * v; wsum += w; }
    }
    m.srcV = wsum > 1e-6 ? acc / wsum : null;
    const weights = {};
    for (const [n, [x, y]] of Object.entries(ALL)) {
      const g = crWeightJS(srcHsv[n].h, srcHsv[n].s, m.crSamples, m.crRange);
      const sh = shapeOf(m, x, y);
      weights[n] = { gate: +g.toFixed(3), shape: +sh.toFixed(3), eff: +(g * sh).toFixed(3) };
    }
    variants[label] = { weights, after: readAll(await render(m)), srcV: m.srcV, mask: m };
  }

  // Selection map for the 3-sample variant (the last one rendered).
  const selCv = document.createElement('canvas');
  const SW = 700, SH = Math.round(SW * H / W);
  selCv.width = SW; selCv.height = SH;
  FX.render(window.getFXParams(), SW, SH, { glowScale: 1, showSel: 0 });
  selCv.getContext('2d').drawImage(FX.cv, 0, 0, SW, SH);

  return { W, H, srcHsv, before, variants, selPng: selCv.toDataURL('image/png').split(',')[1] };
}, { SKIN, OTHER, PICK_FROM });

const skinNames = Object.keys(SKIN);
const litNames = Object.keys(SKIN_LIT);
// Circular spread for hue: the arc the values actually occupy = 1 - the largest empty gap.
const spread = (set, key, names) => {
  const vals = (names || litNames).map(n => set[n][key]);
  if (key !== 'h') return Math.max(...vals) - Math.min(...vals);
  const sorted = [...vals].sort((a, b) => a - b);
  let widestGap = 1 - sorted[sorted.length - 1] + sorted[0];
  for (let i = 1; i < sorted.length; i++) widestGap = Math.max(widestGap, sorted[i] - sorted[i - 1]);
  return 1 - widestGap;
};

console.log(`photo ${out.W}x${out.H}   skin points: ${skinNames.length}`);
console.log('\nsource tones:');
for (const n of skinNames) {
  const p = out.srcHsv[n];
  console.log(`  ${n.padEnd(13)} rgb=${String(p.rgb).padEnd(16)} h=${p.h.toFixed(4)} s=${p.s.toFixed(3)} v=${p.v.toFixed(3)}`);
}

for (const [label, V] of Object.entries(out.variants)) {
  console.log(`\n══ ${label} ══  (srcV=${V.srcV ? V.srcV.toFixed(3) : 'n/a'})`);
  console.log('  SELECTED — effective weight on each skin point (want HIGH and EQUAL):');
  const effs = skinNames.map(n => V.weights[n].eff);
  for (const n of skinNames) {
    const w = V.weights[n];
    const bar = '█'.repeat(Math.round(w.eff * 20)).padEnd(20, '·');
    console.log(`    ${n.padEnd(13)} ${bar} eff=${w.eff.toFixed(3)}  (gate ${w.gate.toFixed(3)} x shape ${w.shape.toFixed(3)})`);
  }
  console.log(`    -> min ${Math.min(...effs).toFixed(3)}  max ${Math.max(...effs).toFixed(3)}  `
    + `SPREAD ${(Math.max(...effs) - Math.min(...effs)).toFixed(3)}`);
  console.log('  EXCLUDED — must stay ~0:');
  for (const n of Object.keys(OTHER)) {
    const w = V.weights[n];
    console.log(`    ${n.padEnd(13)} eff=${w.eff.toFixed(3)}${w.eff > 0.05 ? '   <-- LEAK' : ''}`);
  }
  console.log(`  MATCHING — tone spread across the ${litNames.length} LIT skin points:`);
  for (const [k, lbl] of [['h', 'hue'], ['s', 'sat'], ['v', 'val']]) {
    const sb = spread(out.before, k), sa = spread(V.after, k);
    console.log(`    ${lbl}  ${sb.toFixed(4)} -> ${sa.toFixed(4)}   `
      + (sa < sb ? `CLOSED ${(100 * (1 - sa / sb)).toFixed(0)}%` : `WIDENED ${(100 * (sa / sb - 1)).toFixed(0)}%`));
  }
  console.log('    per-point lit tones after:');
  for (const n of litNames) {
    const a = V.after[n], b = out.before[n];
    console.log(`      ${n.padEnd(13)} h ${b.h.toFixed(4)}->${a.h.toFixed(4)}  `
      + `s ${b.s.toFixed(3)}->${a.s.toFixed(3)}  v ${b.v.toFixed(3)}->${a.v.toFixed(3)}`);
  }
}

await writeFile(path.join(ROOT, 'test/output/tm3390_selection.png'), Buffer.from(out.selPng, 'base64'));
console.log('\nwrote test/output/tm3390_selection.png');
await browser.close();
server.close();
