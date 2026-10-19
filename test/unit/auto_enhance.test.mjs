// Fast unit tests for Auto-enhance's pure analysis. Run: node --test test/unit/
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './extract.mjs';

const ae = load(['autoEnhanceRules','autoEnhanceFeatures','AUTO_FEATURE_NAMES','AUTO_MODEL','autoEnhanceParams']);
// Build an RGBA image from a per-pixel function (i, n) -> [r,g,b] in 0..255.
const img = (n, f) => { const d = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) { const [r, g, b] = f(i, n); d.set([r, g, b, 255], i * 4); } return d; };
const ramp = (lo, hi) => (i, n) => { const v = lo + (hi - lo) * (i / (n - 1)); return [v, v, v]; };
const N = 10000;

test('well-exposed full-range photo barely changes', () => {
  const P = ae.autoEnhanceRules(img(N, ramp(8, 247)));
  assert.ok(Math.abs(P.exp) <= 25, `exp ${P.exp}`);
  assert.ok(Math.abs(P.hi) <= 15 && P.sh <= 15,`hi ${P.hi} sh ${P.sh}`);
  assert.ok(Math.abs(P.temp) <= 5 && Math.abs(P.tint) <= 5, 'neutral grey stays neutral');
});

test('underexposed photo is brightened, overexposed photo is darkened', () => {
  const dark = ae.autoEnhanceRules(img(N, ramp(2, 70)));
  const bright = ae.autoEnhanceRules(img(N, ramp(150, 255)));
  assert.ok(dark.exp > 20, `dark exp ${dark.exp}`);
  assert.ok(bright.exp < -10, `bright exp ${bright.exp}`);
});

test('brightening never pushes the top of the histogram into clipping', () => {
  // dark frame with a small very bright patch (a lamp): exposure must stay conservative
  const P = ae.autoEnhanceRules(img(N, (i, n) => i > n * 0.99 ? [250, 250, 250] : [20, 20, 20]));
  assert.ok(P.exp < 40, `exp ${P.exp} would clip the lamp`);
});

test('blown sky pulls Highlights down; crushed shadows are lifted', () => {
  const sky = ae.autoEnhanceRules(img(N, (i, n) => i < n * 0.4 ? [255, 255, 255] : [110, 110, 110]));
  assert.ok(sky.hi <= -30, `hi ${sky.hi}`);
  const cave = ae.autoEnhanceRules(img(N, (i, n) => i < n * 0.4 ? [0, 0, 0] : [150, 150, 150]));
  assert.ok(cave.sh >= 20, `sh ${cave.sh}`);
});

test('low-contrast flat photo gains contrast, high-contrast loses a little', () => {
  assert.ok(ae.autoEnhanceRules(img(N, ramp(100, 150))).con > 10);
  assert.ok(ae.autoEnhanceRules(img(N, (i, n) => i % 2 ? [0, 0, 0] : [255, 255, 255])).con < 0);
});

test('white balance: corrects a neutral scene with a cast, leaves a single-colour scene alone', () => {
  const warm = ae.autoEnhanceRules(img(N, ramp(60, 190).constructor === Function ? (i, n) => { const v = 60 + 130 * (i / (n - 1)); return [Math.min(255, v * 1.15), v, v * 0.85]; } : null));
  assert.ok(warm.temp < -5, `warm cast -> cooler, got ${warm.temp}`);
  const forest = ae.autoEnhanceRules(img(N, () => [30, 160, 40])); // strongly saturated, no neutrals
  assert.equal(forest.temp, 0); assert.equal(forest.tint, 0);
});

test('all outputs stay inside slider range', () => {
  for (const f of [ramp(0, 0), ramp(255, 255), ramp(0, 255), (i) => [i % 256, (i * 7) % 256, (i * 13) % 256]]) {
    const P = ae.autoEnhanceRules(img(N, f));
    for (const [k, v] of Object.entries(P)) assert.ok(Number.isFinite(v) && Math.abs(v) <= 100, `${k}=${v}`);
  }
});
