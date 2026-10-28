// Lightroom-style radial/linear canvas drags: deltas from the grab, screen-space rotation and circles.
import { load } from './extract.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
const { _mskShapeDrag: drag } = load(['_mskShapeDrag']);
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, a + ' vs ' + b);
const R = { cx: .5, cy: .5, rx: .2, ry: .1, rot: 0 }, Lm = { x0: .5, y0: .3, x1: .5, y1: .7 };
test('radial move is a delta, not a jump to the pointer', () => {
  const r = drag('radial', { which: 'move', px: .55, py: .5, m0: R }, .65, .6, 1000, 500);
  near(r.cx, .6); near(r.cy, .6);
});
test('radial draw with Shift is a circle on screen', () => {
  const r = drag('radial', { which: 'draw', px: .5, py: .5, m0: R }, .6, .55, 1000, 500, true);
  near(r.rx * 1000, r.ry * 500);
});
test('radial rotate follows the pointer angle in screen pixels', () => {
  const r = drag('radial', { which: 'rot', px: .7, py: .5, m0: R }, .5, .9, 1000, 500); // right -> straight down
  near(r.rot, Math.PI / 2);
});
test('radial Shift resize keeps the aspect', () => {
  const r = drag('radial', { which: 'rx', px: .7, py: .5, m0: R }, .8, .5, 1000, 500, true);
  near(r.rx, .3); near(r.ry, .15);
});
test('feather handle maps the inner ring to the feather value', () => {
  // from feather .5 (ft 0), dragging outward by half the radius -> ft .5 -> feather .25
  near(drag('radial', { which: 'f', px: .6, py: .5, m0: { ...R, feather: .5 } }, .7, .5, 1000, 500).feather, .25);
});
test('linear edge drag changes width only, never crossing', () => {
  const r = drag('linear', { which: 'p1', px: .5, py: .7, m0: Lm }, .62, .9, 1000, 500);
  near(r.x1, .5); near(r.y1, .9);
  const c = drag('linear', { which: 'p1', px: .5, py: .7, m0: Lm }, .5, .1, 1000, 500);
  assert.ok(c.y1 > Lm.y0);
});
test('linear rotate keeps the centre and on-screen length', () => {
  const r = drag('linear', { which: 'lrot', px: .5, py: .9, m0: Lm }, .3, .5, 1000, 500); // quarter turn
  near((r.x0 + r.x1) / 2, .5); near((r.y0 + r.y1) / 2, .5);
  near(Math.hypot((r.x1 - r.x0) * 1000, (r.y1 - r.y0) * 500), .4 * 500);
});
test('linear move shifts both edges', () => {
  const r = drag('linear', { which: 'lmove', px: .5, py: .5, m0: Lm }, .6, .5, 1000, 500);
  near(r.x0, .6); near(r.x1, .6); near(r.y0, .3);
});
