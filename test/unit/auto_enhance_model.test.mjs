// Learned hybrid (AUTO_MODEL embedded in chromasmith-22.html) — behaviour + fallback. Run: node --test test/unit/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './extract.mjs';

const NAMES = ['autoEnhanceRules', 'autoEnhanceFeatures', 'AUTO_FEATURE_NAMES', 'AUTO_MODEL', 'autoEnhanceParams'];
const ae = load(NAMES);
const img = (n, f) => { const d = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) { const [r, g, b] = f(i, n); d.set([r, g, b, 255], i * 4); } return d; };
const ramp = (lo, hi) => (i, n) => { const v = lo + (hi - lo) * (i / (n - 1)); return [v, v, v]; };
const N = 10000;

test('model is embedded and every output stays inside its clamp', () => {
  assert.ok(ae.AUTO_MODEL && ae.AUTO_MODEL.labels.length === 7, 'AUTO_MODEL present');
  for (const f of [ramp(0, 0), ramp(255, 255), ramp(0, 255), ramp(2, 70), ramp(150, 255), (i) => [i % 256, (i * 7) % 256, (i * 13) % 256]]) {
    const P = ae.autoEnhanceParams(img(N, f));
    for (const [k, v] of Object.entries(P)) assert.ok(Number.isFinite(v) && Math.abs(v) <= 100, `${k}=${v}`);
    assert.ok(P.hi <= 40 && P.sh >= -40, `hi ${P.hi} sh ${P.sh}`);
  }
});

test('dark photos get more exposure than bright ones', () => {
  assert.ok(ae.autoEnhanceParams(img(N, ramp(2, 70))).exp > ae.autoEnhanceParams(img(N, ramp(150, 255))).exp + 15);
});

test('Lightroom-style prior: highlights pulled down and shadows lifted on a normal photo', () => {
  const P = ae.autoEnhanceParams(img(N, ramp(8, 247)));
  assert.ok(P.hi < -10 && P.sh > 5, `hi ${P.hi} sh ${P.sh}`);
});

test('without a model autoEnhanceParams is exactly the rule engine', () => {
  const none = load(NAMES.filter(n => n !== 'AUTO_MODEL'), { AUTO_MODEL: null });
  const d = img(N, ramp(20, 200));
  assert.deepEqual(none.autoEnhanceParams(d), none.autoEnhanceRules(d));
});

test('a model that throws falls back to the rule engine', () => {
  const broken = load(NAMES.filter(n => n !== 'AUTO_MODEL'), { AUTO_MODEL: { labels: ['exp'], mu: [0], sd: [1], W: [] } });
  const d = img(N, ramp(20, 200));
  assert.deepEqual(broken.autoEnhanceParams(d), broken.autoEnhanceRules(d));
});

test('features are finite and fixed-length even for degenerate images', () => {
  for (const f of [ramp(0, 0), ramp(255, 255), ramp(128, 128)]) {
    const x = ae.autoEnhanceFeatures(img(N, f));
    assert.equal(x.length, ae.AUTO_FEATURE_NAMES.length); assert.ok(x.every(Number.isFinite));
  }
});
