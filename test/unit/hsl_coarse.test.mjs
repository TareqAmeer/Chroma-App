// E2: coarse (even-node) HSL cube expanded by hslExpandCoarse must keep every even node exact and stay close to the full bake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './extract.mjs';

const c = load(['r2hsv', 'hsv2r', 'applyHSL', 'pcWeight', 'applyPointColors', 'hslExpandCoarse', 'bakeHslCube']);
const S = 33, S2 = S * S;
const hA = { Red: 20, Green: -15 }, sA = { Red: 30, Blue: -25 }, lA = { Yellow: 40 };
const ev = (r, g, b) => c.applyHSL(r / 32, g / 32, b / 32, hA, sA, lA).map(v => v * 255 + .5 | 0);

test('even nodes exact, odd nodes within a few levels of the full bake', () => {
  const full = new Uint8Array(S * S * S * 3), co = new Uint8Array(S * S * S * 3);
  let maxOdd = 0;
  for (let b = 0; b < S; b++) for (let g = 0; g < S; g++) for (let r = 0; r < S; r++) {
    const o = (b * S2 + g * S + r) * 3, v = ev(r, g, b);
    full.set(v, o);
    if (!(r & 1) && !(g & 1) && !(b & 1)) co.set(v, o);
  }
  c.hslExpandCoarse(co, S);
  for (let i = 0; i < full.length; i++) {
    const n = (i / 3 | 0), r = n % S, g = (n / S | 0) % S, b = n / S2 | 0;
    const d = Math.abs(full[i] - co[i]);
    if (!(r & 1) && !(g & 1) && !(b & 1)) assert.equal(d, 0); else maxOdd = Math.max(maxOdd, d);
  }
  assert.ok(maxOdd <= 40, 'max odd-node error ' + maxOdd);
});

test('bakeHslCube step 1 is byte-identical to the reference full loop (with point colours)', () => {
  const pts = [{ h: 0.1, s: 0.6, range: 40, hue: 30, sat: 20, lum: -10 }];
  const ref = new Uint8Array(S * S * S * 3);
  for (let b = 0; b < S; b++) for (let g = 0; g < S; g++) for (let r = 0; r < S; r++) {
    let [R, G, B] = c.applyHSL(r / 32, g / 32, b / 32, hA, sA, lA);
    [R, G, B] = c.applyPointColors(R, G, B, pts);
    const o = (b * S2 + g * S + r) * 3; ref[o] = R * 255 + .5 | 0; ref[o + 1] = G * 255 + .5 | 0; ref[o + 2] = B * 255 + .5 | 0;
  }
  assert.deepEqual(Buffer.from(c.bakeHslCube(hA, sA, lA, pts, S, 1)), Buffer.from(ref));
});
