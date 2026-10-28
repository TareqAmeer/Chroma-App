// Sky edge clean-up must pull a coarse, stair-stepped sky prior onto the real skyline in the photo.
import { load } from './extract.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
const ctx = load(['_boxFilterMean', '_guidedFilter', '_samDilateBinary', '_samMatteCore', '_skyMatte', '_skyResample'], { Uint8Array, Uint8ClampedArray, Int32Array, Float64Array });
test('sky matte follows a jagged skyline better than a blocky coarse prior', () => {
  const w = 320, h = 240, n = w * h;
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const line = new Float32Array(w);
  for (let x = 0; x < w; x++) line[x] = 110 + 25 * Math.sin(x / 17) + (x % 40 < 12 ? -30 : 0); // rooftops + chimneys
  const truth = new Float32Array(n), rgba = new Uint8ClampedArray(n * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, sky = y < line[x] ? 1 : 0, t = rnd() * 8;
    truth[i] = sky;
    const skyC = [150 + y * 0.3, 175 + y * 0.2, 230], gnd = [170 + t, 120 + t, 90 + t]; // pale-to-blue sky over warm buildings
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = sky ? skyC[c] : gnd[c];
    rgba[i * 4 + 3] = 255;
  }
  // Coarse prior: model-like 16 px blocks, shifted 3 px down (a typical boundary error).
  const B = 16, prior = new Uint8ClampedArray(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const bx = Math.floor(x / B) * B + B / 2, by = Math.floor(y / B) * B + B / 2;
    prior[y * w + x] = by - 3 < line[Math.min(w - 1, bx)] ? 255 : 0;
  }
  const out = ctx._skyMatte(prior, w, h, rgba, 0.025);
  let eNew = 0, eOld = 0;
  for (let i = 0; i < n; i++) { eNew += Math.abs(out[i] / 255 - truth[i]); eOld += Math.abs(prior[i] / 255 - truth[i]); }
  console.log('sky MAE matte', (eNew / n).toFixed(5), 'coarse prior', (eOld / n).toFixed(5));
  assert.ok(eNew < eOld * 0.4, 'matte should cut the edge error by more than half');
});
test('sky resample is bilinear, not blocky', () => {
  const out = ctx._skyResample(new Uint8ClampedArray([0, 255]), 2, 1, 8, 1);
  assert.deepEqual(Array.from(out), [0, 0, 32, 96, 159, 223, 255, 255]);
});
