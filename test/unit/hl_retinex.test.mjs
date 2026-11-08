// CHR-288 / CHR-289: pure cores for highlight reconstruction (hlReconstruct) and retinex-style
// dynamic-range compression (drcRetinex). Synthetic scenes with a known truth: single-, two- and
// all-channel clipping, coloured edges, gradients, noise, a halo-prone step and a tile-seam check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './extract.mjs';

const app = load(['hlClippedMask', 'hlPushPull', 'hlLabel', 'hlReconstruct', 'drcRetinexHalo', 'drcBoxMean', 'drcGuided', 'drcRetinexBase', 'drcRetinex', 'drcBuildMap', 'hlRGBA'],
  { Uint8Array, Error });

const CLIP = [1, 1, 1];
// Paint truth with a bright blob, then clip at CLIP to simulate the sensor.
function scene(w, h, colour, peak, bg = [0.3, 0.2, 0.1]) {
  const truth = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - w / 2, y - h / 2) / (w / 2), s = Math.max(0, 1 - d) * peak;
    for (let c = 0; c < 3; c++) truth[3 * (y * w + x) + c] = bg[c] * (1 - Math.min(1, s)) + colour[c] * s;
  }
  const clipped = truth.map((v, i) => Math.min(v, CLIP[i % 3]));
  return { truth, clipped };
}
const maxRelErr = (a, b, mask) => { let e = 0; for (let i = 0; i < a.length; i++) if (mask(i)) e = Math.max(e, Math.abs(a[i] - b[i]) / b[i]); return e; };

test('every mode is identity (same array) when nothing clips', () => {
  const rgb = new Float32Array([0.1, 0.2, 0.3, 0.5, 0.4, 0.2]);
  for (const m of ['clip', '', 'blend', 'propagate', 'opposed']) assert.equal(app.hlReconstruct(rgb, 2, 1, CLIP, m), rgb);
});

test('single channel clipped, uniform hue: propagate recovers truth, opposed estimates it', () => {
  // Constant chromaticity (2:1:0.5) whose brightness ramps past R's clip only (up to ~1.8x clip).
  const w = 40, h = 40, { truth, clipped } = scene(w, h, [2, 1, 0.5], 0.9, [2 * 0.2, 0.2, 0.1]);
  const isR = (i) => i % 3 === 0 && clipped[i] >= 0.995;
  assert.ok([...clipped].some((v, i) => isR(i)), 'scene must clip R');
  for (const m of ['propagate', 'opposed']) {
    const out = app.hlReconstruct(clipped, w, h, CLIP, m);
    // propagate carries the ratio itself: exact for a constant hue. opposed adds ONE cube-root
    // chroma offset measured at the clip border, so it under-reads as brightness rises above the
    // border (cbrt(1.8) ~ 1.22): measured 17.3% at the peak here — bound 20%, never above truth.
    const tol = m === 'propagate' ? 0.02 : 0.2;
    assert.ok(maxRelErr(out, truth, isR) < tol, `${m}: R within ${tol * 100}% of truth`);
    for (let i = 0; i < out.length; i++) {
      if (!isR(i)) assert.equal(out[i], clipped[i]);
      else assert.ok(out[i] >= clipped[i] && out[i] <= truth[i] * 1.001);
    }
  }
});

test('two channels clipped: propagate recovers both from the one survivor', () => {
  const w = 40, h = 40, { truth, clipped } = scene(w, h, [3, 2, 0.5], 0.6, [3 * 0.1, 2 * 0.1, 0.05]);
  const both = (i) => { const p = i - (i % 3); return clipped[p] >= 0.995 && clipped[p + 1] >= 0.995 && i % 3 < 2; };
  assert.ok([...clipped].some((_, i) => both(i)), 'scene must clip R and G together');
  const out = app.hlReconstruct(clipped, w, h, CLIP, 'propagate');
  assert.ok(maxRelErr(out, truth, both) < 0.02);
});

test('all channels clipped: blend goes neutral, propagate keeps the surround hue and never darkens', () => {
  const w = 30, h = 30, { clipped } = scene(w, h, [3, 2.6, 2.2], 2, [0.3, 0.26, 0.22]);
  const c0 = 3 * (15 * w + 15);
  assert.deepEqual([...clipped.slice(c0, c0 + 3)], [1, 1, 1]);
  const b = app.hlReconstruct(clipped, w, h, CLIP, 'blend');
  assert.equal(b[c0], b[c0 + 1]); assert.equal(b[c0 + 1], b[c0 + 2]);
  const p = app.hlReconstruct(clipped, w, h, CLIP, 'propagate');
  for (let i = 0; i < p.length; i++) assert.ok(p[i] >= clipped[i]);
  assert.ok(p[c0] > p[c0 + 1] && p[c0 + 1] > p[c0 + 2], 'warm surround hue propagated in');
});

test('blend removes the clipped-channel cast (R clipped, G/B not) and leaves dim pixels alone', () => {
  const rgb = new Float32Array([1, 0.9, 0.95, 0.2, 0.1, 0.1]);
  const out = app.hlReconstruct(rgb, 2, 1, CLIP, 'blend');
  assert.deepEqual([...out.slice(0, 3)], [1, 1, 1]);
  assert.deepEqual([...out.slice(3)], [...rgb.slice(3)]);
});

test('coloured edge: a clipped spot inside the red half takes red, not the blue neighbour', () => {
  const w = 40, h = 20, rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 3 * (y * w + x), red = x < w / 2;
    const s = Math.hypot(x - 8, y - 10) < 4 ? 3 : 0.4;
    const col = red ? [1, 0.3, 0.2] : [0.2, 0.3, 1];
    for (let c = 0; c < 3; c++) rgb[i + c] = Math.min(1, col[c] * s);
  }
  const out = app.hlReconstruct(rgb, w, h, CLIP, 'propagate');
  const i = 3 * (10 * w + 8);
  assert.ok(out[i] > 3 * out[i + 2], 'clipped spot stays red');
});

test('propagate fills a clipped region far wider than the old 64-pass reach', () => {
  // 300x40 strip, all channels clipped except a 4px warm border: the old Jacobi fill stopped
  // 64px in and left the middle neutral; the pyramid reaches every pixel in one pass.
  const w = 300, h = 40, rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 3 * (y * w + x), edge = x < 4 || x >= w - 4;
    rgb.set(edge ? [0.9, 0.6, 0.3] : [1, 1, 1], i);
  }
  const out = app.hlReconstruct(rgb, w, h, CLIP, 'propagate'), c = 3 * (20 * w + 150);
  assert.ok(out[c] > out[c + 1] && out[c + 1] > out[c + 2], 'centre took the warm border hue');
});

test('pushPull: known pixels untouched, holes take the nearby value', () => {
  const w = 9, h = 5, K = new Float32Array(3 * w * h), known = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < 2 || x > 6) { known[y * w + x] = 1; K.set(x < 2 ? [2, 1, 0] : [0, 1, 2], 3 * (y * w + x)); }
  const before = K.slice();
  app.hlPushPull(K, known, w, h);
  for (let i = 0; i < w * h; i++) assert.equal(known[i], 1);
  for (let y = 0; y < h; y++) { for (const x of [0, 1, 7, 8]) assert.equal(K[3 * (y * w + x)], before[3 * (y * w + x)]);
    assert.ok(K[3 * (y * w + 2)] > K[3 * (y * w + 6)], 'left hole leans left colour'); }
});

test('opposed: two clipped lights of different colour each get their own chroma', () => {
  // Left light pale (R just over clip, G/B high), right light deep red (G/B low). One global chroma
  // (the old behaviour) took the deep red's offset into the pale light: 53.9% mean R error there.
  // Per region: 2.6% / 7.3%.
  const w = 80, h = 30, rgb = new Float32Array(w * h * 3), truth = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const left = x < 40, cx = left ? 20 : 60, col = left ? [1.3, 0.9, 0.7] : [1.3, 0.25, 0.1];
    const s = Math.max(0.5, 1 - Math.hypot(x - cx, y - 15) / 20);
    for (let c = 0; c < 3; c++) { truth[3 * (y * w + x) + c] = col[c] * s; rgb[3 * (y * w + x) + c] = Math.min(1, col[c] * s); }
  }
  const out = app.hlReconstruct(rgb, w, h, CLIP, 'opposed');
  const err = (x0, x1) => { let e = 0, n = 0; for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) { const i = 3 * (y * w + x); if (rgb[i] >= 0.995) { e += Math.abs(out[i] - truth[i]) / truth[i]; n++; } } return e / n; };
  assert.ok(err(0, 40) < 0.05 && err(40, 80) < 0.1, `per-region errors ${err(0, 40).toFixed(3)} / ${err(40, 80).toFixed(3)}`);
});

test('unknown mode throws', () => {
  assert.throws(() => app.hlReconstruct(new Float32Array([1, 1, 1]), 1, 1, CLIP, 'nope'));
});

// ── drcRetinex ──
const lumOf = (f, w, h) => { const Y = new Float32Array(w * h); for (let i = 0; i < Y.length; i++) Y[i] = f(i % w, Math.floor(i / w)); return Y; };
const S = [2, 6];

test('zero strengths: null (no work); constant image at its anchor: unit gain', () => {
  const Y = lumOf(() => 0.18, 16, 16);
  assert.equal(app.drcRetinex(Y, 16, 16, { shadows: 0, highlights: 0, anchor: 0.18 }), null);
  const g = app.drcRetinex(Y, 16, 16, { shadows: 1, highlights: 1, anchor: 0.18 + 1e-4, sigmas: S });
  for (const v of g) assert.ok(Math.abs(v - 1) < 1e-4);
});

test('anchor is required (no per-tile global statistics)', () => {
  assert.throws(() => app.drcRetinex(lumOf(() => 0.2, 4, 4), 4, 4, { shadows: 0.5 }));
});

test('gradient: output stays monotonic, shadows lift and highlights pull in', () => {
  const w = 64, h = 4, Y = lumOf((x) => 0.01 * Math.pow(100, x / (w - 1)), w, h);
  const g = app.drcRetinex(Y, w, h, { shadows: 0.5, highlights: 0.5, anchor: 0.1, sigmas: S });
  const row = Array.from({ length: w }, (_, x) => Y[w + x] * g[w + x]);
  for (let x = 1; x < w; x++) assert.ok(row[x] > row[x - 1], 'monotonic at ' + x);
  assert.ok(g[w] > 1.5 && g[2 * w - 1] < 0.7);
});

test('gain respects maxGain and is smooth on noise', () => {
  const w = 48, h = 48; let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const Y = lumOf(() => 0.001 + 0.02 * rnd(), w, h);
  const g = app.drcRetinex(Y, w, h, { shadows: 1, highlights: 1, anchor: 0.5, sigmas: S, maxGain: 4 });
  let mn = Infinity, mx = 0; for (const v of g) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  assert.ok(mx <= 4 + 1e-5 && mn >= 1 / 4 - 1e-6);
  // Noise rides through as a ratio: the gain is a low-pass field, so its spread is tiny vs the input's.
  const sd = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) / m; };
  assert.ok(sd([...g]) < 0.1 * sd([...Y]));
});

test('halo-prone step edge: gain changes only within the halo radius of the edge', () => {
  const w = 80, h = 8, Y = lumOf((x) => (x < 40 ? 0.02 : 0.8), w, h);
  const g = app.drcRetinex(Y, w, h, { shadows: 0.6, highlights: 0.6, anchor: 0.13, sigmas: S });
  const R = app.drcRetinexHalo(S);
  assert.equal(R, 12); // guided filter: two box stages of radius round(sigma) -> 2 * 6
  for (let x = 0; x < 40 - R; x++) assert.ok(Math.abs(g[4 * w + x] - g[4 * w]) < 1e-6, 'flat left of halo');
  for (let x = 40 + R; x < w; x++) assert.ok(Math.abs(g[4 * w + x] - g[5 * w - 1]) < 1e-6, 'flat right of halo');
});

test('strong step edge: guided base keeps the gain flat up to the edge (no MSR halo)', () => {
  // Gaussian surrounds (the previous core) lost 83% of the dark-side lift next to this edge and
  // overshot the bright side by 45%; the guided base layer: ~2% each.
  const w = 400, h = 8, Y = lumOf((x) => (x < 200 ? 0.02 : 0.8), w, h);
  const g = app.drcRetinex(Y, w, h, { shadows: 0.6, highlights: 0.6, anchor: 0.13, sigmas: [4, 12, 40] });
  const row = (x) => g[4 * w + x], dk = row(0), br = row(w - 1);
  let dmin = Infinity, bmax = 0;
  for (let x = 150; x < 200; x++) dmin = Math.min(dmin, row(x));
  for (let x = 200; x < 250; x++) bmax = Math.max(bmax, row(x));
  assert.ok(1 - dmin / dk < 0.05, `dark-side halo ${((1 - dmin / dk) * 100).toFixed(1)}%`);
  assert.ok(bmax / br - 1 < 0.05, `bright-side halo ${((bmax / br - 1) * 100).toFixed(1)}%`);
});

test('tile with drcRetinexHalo() halo reproduces the whole-image gain exactly (no seam)', () => {
  const w = 96, h = 64; let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const Y = lumOf((x, y) => 0.02 + 0.5 * (x / w) * (y / h) + 0.05 * rnd(), w, h);
  const o = { shadows: 0.4, highlights: 0.7, anchor: 0.12, sigmas: S };
  const full = app.drcRetinex(Y, w, h, o), R = app.drcRetinexHalo(S);
  // Tile = columns [40, 72) plus R halo each side (clamped to the image), all rows.
  const x0 = 40 - R, x1 = Math.min(w, 72 + R), tw = x1 - x0, T = new Float32Array(tw * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < tw; x++) T[y * tw + x] = Y[y * w + x0 + x];
  const gt = app.drcRetinex(T, tw, h, o);
  for (let y = 0; y < h; y++) for (let x = 40; x < 72; x++) assert.equal(gt[y * tw + x - x0], full[y * w + x]);
});

test('tile seam exact across a strong edge (guided base, multi-scale)', () => {
  const w = 120, h = 40, S2 = [2, 5, 9], Y = lumOf((x, y) => (x + 0.5 * y < 70 ? 0.015 : 0.9), w, h);
  const o = { shadows: 0.7, highlights: 0.5, anchor: 0.1, sigmas: S2 };
  const full = app.drcRetinex(Y, w, h, o), R = app.drcRetinexHalo(S2);
  const x0 = 50 - R, x1 = Math.min(w, 90 + R), tw = x1 - x0, T = new Float32Array(tw * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < tw; x++) T[y * tw + x] = Y[y * w + x0 + x];
  const gt = app.drcRetinex(T, tw, h, o);
  for (let y = 0; y < h; y++) for (let x = 50; x < 90; x++) assert.equal(gt[y * tw + x - x0], full[y * w + x]);
});

// ---- CHR-288/289 wiring cores (hlRGBA on 8-bit frames, drcBuildMap proxy map) ----
test('hlRGBA: a frame with no channel at 255 is returned unchanged (changed 0)', () => {
  const w = 16, h = 16, a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { a[4 * i] = 200; a[4 * i + 1] = 150; a[4 * i + 2] = 100; a[4 * i + 3] = 255; }
  const r = app.hlRGBA(a, w, h, 'propagate');
  assert.equal(r.changed, 0);
  assert.deepEqual(Array.from(r.data), Array.from(a));
});
test('hlRGBA: only the clipped region changes; alpha preserved; deterministic', () => {
  const w = 64, h = 64, a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { a[4 * i] = 190; a[4 * i + 1] = 160; a[4 * i + 2] = 110; a[4 * i + 3] = 255; }
  for (let y = 28; y < 36; y++) for (let x = 28; x < 36; x++) { const o = 4 * (y * w + x); a[o] = 255; a[o + 1] = 230; a[o + 2] = 255; }
  const r1 = app.hlRGBA(a, w, h, 'opposed'), r2 = app.hlRGBA(a, w, h, 'opposed');
  assert.ok(r1.changed > 0);
  assert.deepEqual(Array.from(r1.data), Array.from(r2.data));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = 4 * (y * w + x), inBlob = x >= 28 && x < 36 && y >= 28 && y < 36;
    assert.equal(r1.data[o + 3], 255);
    if (!inBlob) assert.ok(r1.data[o] === a[o] && r1.data[o + 1] === a[o + 1] && r1.data[o + 2] === a[o + 2]);
  }
});
test('drcBuildMap: flat image gives a ~zero map; map is bright-positive / dark-negative', () => {
  const w = 48, h = 32, a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { a[4 * i] = a[4 * i + 1] = a[4 * i + 2] = 120; a[4 * i + 3] = 255; }
  const flat = app.drcBuildMap(a, w, h);
  assert.ok(flat.data.every((v) => Math.abs(v) < 1e-3));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = 4 * (y * w + x), v = x < w / 2 ? 20 : 220; a[o] = a[o + 1] = a[o + 2] = v; }
  const m = app.drcBuildMap(a, w, h);
  assert.ok(m.data[5 * w + 3] < -0.5 && m.data[5 * w + w - 4] > 0.5);
});
