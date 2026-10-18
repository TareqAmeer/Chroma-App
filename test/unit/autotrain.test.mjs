// Unit tests for tools/autotrain (Lightroom-Auto learning pipeline plumbing). Run: node --test test/unit/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXmpLabels, readBmp, writeBmp, features, fitRidge, predictRidge, FEATURE_NAMES } from '../../tools/autotrain/lib.mjs';

test('XMP: attribute and element forms parse, exposure is scaled to slider units', () => {
  const a = parseXmpLabels('<rdf:Description crs:Exposure2012="+0.50" crs:Contrast2012="12" crs:Highlights2012="-40"/>');
  assert.equal(a.exp, 10); assert.equal(a.con, 12); assert.equal(a.hi, -40); assert.equal(a.sh, 0);
  const b = parseXmpLabels('<crs:Shadows2012>+35</crs:Shadows2012><crs:Exposure2012>-1.25</crs:Exposure2012>');
  assert.equal(b.sh, 35); assert.equal(b.exp, -25);
});

test('XMP without any tone setting is rejected, never learned as zeros', () => {
  assert.equal(parseXmpLabels('<rdf:Description crs:Rating="3" crs:Temperature="5200"/>'), null);
});

test('BMP round trip keeps pixels (incl. row padding)', () => {
  const w = 5, h = 3, rgb = Uint8Array.from({ length: w * h * 3 }, (_, i) => (i * 37) % 256);
  const back = readBmp(writeBmp(w, h, rgb));
  assert.deepEqual([back.w, back.h], [w, h]); assert.deepEqual([...back.rgb], [...rgb]);
});

test('features: right length and sane ordering for a ramp', () => {
  const w = 64, h = 4, rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgb.fill(Math.round(255 * x / (w - 1)), (y * w + x) * 3, (y * w + x) * 3 + 3);
  const f = features({ w, h, rgb });
  assert.equal(f.length, FEATURE_NAMES.length);
  assert.ok(f[0] < f[3] && f[3] < f[6], 'p1 < p50 < p99');
});

test('ridge recovers a known linear map and ignores a constant feature', () => {
  const X = [], Y = [];
  for (let i = 0; i < 200; i++) { const a = Math.sin(i), b = Math.cos(i * 1.7); X.push([a, b, 5]); Y.push([3 * a - 2 * b + 1, -a + 0.5]); }
  const m = fitRidge(X, Y, 1e-3);
  const p = predictRidge(m, [0.4, -0.3, 5]);
  assert.ok(Math.abs(p[0] - (3 * 0.4 + 2 * 0.3 + 1)) < 0.05, `p0 ${p[0]}`);
  assert.ok(Math.abs(p[1] - (-0.4 + 0.5)) < 0.05, `p1 ${p[1]}`);
});
