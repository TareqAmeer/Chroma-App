// CHR-259: Point Colour selection weight — legacy records unchanged, on/off, lightness band.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './extract.mjs';

const pc = load(['pcWeight']);
const pt = { h: 0.0, s: 0.6, range: 35, smoothness: 50 };

test('a record without lightness fields selects the same with or without the value argument', () => {
  for (const v of [0, 0.2, 0.5, 0.9, 1]) assert.equal(pc.pcWeight(0.0, 0.6, pt, v), pc.pcWeight(0.0, 0.6, pt));
  assert.ok(pc.pcWeight(0.0, 0.6, pt) > 0.9);
});

test('a switched-off range selects nothing', () => {
  assert.equal(pc.pcWeight(0.0, 0.6, { ...pt, enabled: false }, 0.5), 0);
  assert.ok(pc.pcWeight(0.0, 0.6, { ...pt, enabled: true }, 0.5) > 0.9);
});

test('the lightness band keeps the inside and drops the far outside', () => {
  const band = { ...pt, lumLo: 40, lumHi: 70 };
  assert.ok(pc.pcWeight(0.0, 0.6, band, 0.55) > 0.9, 'inside');
  assert.equal(pc.pcWeight(0.0, 0.6, band, 0.1), 0, 'far below');
  assert.equal(pc.pcWeight(0.0, 0.6, band, 0.95), 0, 'far above');
  const edge = pc.pcWeight(0.0, 0.6, band, 0.39);
  assert.ok(edge > 0 && edge < pc.pcWeight(0.0, 0.6, band, 0.55), 'soft just outside the lower edge');
});
