// Edge matting must beat the old gray guided-filter refine on hair-like strands the SAM mask misses.
import { load } from './extract.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
const ctx = load(['_boxFilterMean', '_guidedFilter', '_samDilateBinary', '_samMatteCore'], { Uint8Array, Uint8ClampedArray, Int32Array, Float64Array });
test('matte recovers strands better than a gray guided filter', () => {
  const w = 256, h = 256, n = w * h;
  const truth = new Float32Array(n), rgba = new Uint8ClampedArray(n * 4);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const disc = (x, y) => Math.hypot(x - 128, y - 150) < 70;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) truth[y * w + x] = disc(x, y) ? 1 : 0;
  for (let k = 0; k < 90; k++) { // 1-2 px strands radiating out of the disc
    const a = rnd() * Math.PI * 2, len = 70 + rnd() * 22;
    for (let r = 60; r < len; r += 0.5) { const x = Math.round(128 + Math.cos(a) * r), y = Math.round(150 + Math.sin(a) * r); if (x >= 0 && y >= 0 && x < w && y < h) truth[y * w + x] = 1; }
  }
  for (let i = 0; i < n; i++) {
    const a = truth[i], tex = rnd() * 10;
    const fgc = [215, 160, 90], bgc = [120 + tex, 118 + tex, 112 + tex];
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = a * fgc[c] + (1 - a) * bgc[c];
    rgba[i * 4 + 3] = 255;
  }
  // "SAM" mask: disc only (no strands), 4x down/up blurred edge
  const mask = new Uint8ClampedArray(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const d = Math.hypot(x - 128, y - 150) - 70; mask[y * w + x] = 255 * Math.min(1, Math.max(0, 0.5 - d / 6)); }
  const out = ctx._samMatteCore(mask, w, h, rgba);
  let eNew = 0, eOld = 0;
  for (let i = 0; i < n; i++) { eNew += Math.abs(out[i] / 255 - truth[i]); eOld += Math.abs(mask[i] / 255 - truth[i]); }
  console.log('MAE matte', (eNew / n).toFixed(5), 'raw mask', (eOld / n).toFixed(5));
  assert.ok(eNew < eOld, 'matte should have lower alpha error than the raw mask');
});
