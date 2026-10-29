// Detection chip list, Otsu, speck/hole clean-up, sky clean-up, guided upsampling and matte-in-band.
import { load } from './extract.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
const S = load(['MSK_COCO', 'MSK_ANIMALS', 'mskDetGroup', 'mskDetName', 'mskSceneList', 'mskOtsu', 'mskComponents', 'mskCleanSpecks',
  'mskSkyCleanup', '_boxFilterMean', '_guidedFilter', '_samDilateBinary', '_mskBilinear', 'mskGuidedUpsample', 'mskMatteInBand', 'mskDetectRematch']);
const D = (label, score, x0, y0, x1, y1) => ({ label, score, x0, y0, x1, y1 });

test('every COCO class gets a readable name and a group', () => {
  assert.equal(S.MSK_COCO.length, 80);
  for (const l of S.MSK_COCO) { assert.match(S.mskDetName(l), /^[A-Z]/); assert.ok(['people', 'animals', 'objects'].includes(S.mskDetGroup(l))); }
  assert.equal(S.mskDetName('potted plant'), 'Plant'); assert.equal(S.mskDetName(undefined), 'Object');
  assert.equal(S.mskDetGroup('dog'), 'animals'); assert.equal(S.mskDetGroup('bench'), 'objects');
});
test('scene list: groups, numbering, thresholds, size floor, duplicates', () => {
  const L = S.mskSceneList([
    D('dog', 0.9, 0.5, 0.2, 0.8, 0.9), D('cat', 0.6, 0.51, 0.21, 0.79, 0.88),   // same animal, two labels
    D('dog', 0.85, 0.5, 0.2, 0.7, 0.5),                                          // head box inside the body box
    D('person', 0.5, 0.1, 0.1, 0.3, 0.9), D('person', 0.47, 0.6, 0.1, 0.7, 0.9),
    D('bench', 0.7, 0.0, 0.6, 1.0, 0.8), D('cup', 0.9, 0.1, 0.1, 0.12, 0.12),  // cup below the size floor
    D('chair', 0.5, 0.3, 0.3, 0.6, 0.6),                                          // below the object threshold
  ]);
  assert.equal(JSON.stringify(L.map(c => c.label)), JSON.stringify(['Person 1', 'Person 2', 'Dog', 'Bench']));
  assert.equal(JSON.stringify(L.map(c => c.group)), JSON.stringify(['people', 'people', 'animals', 'objects']));
  assert.equal(new Set(L.map(c => c.id)).size, L.length);
});
test('scene list keeps the most confident when capped', () => {
  const many = Array.from({ length: 20 }, (_, i) => D('car', 0.6 + i / 100, i * 0.05, 0.1, i * 0.05 + 0.04, 0.3));
  const L = S.mskSceneList(many, { cap: 5 });
  assert.equal(L.length, 5); assert.ok(L.every(c => c.score >= 0.75));
});
test('Otsu splits a bimodal histogram between the modes', () => {
  const h = new Array(256).fill(0); for (let i = 40; i < 60; i++) h[i] = 100; for (let i = 190; i < 210; i++) h[i] = 50;
  const t = S.mskOtsu(h); assert.ok(t >= 59 && t < 190, String(t));
});
test('speck removal and pinhole filling', () => {
  const w = 100, h = 100, px = new Uint8ClampedArray(w * h);
  for (let y = 20; y < 80; y++) for (let x = 20; x < 80; x++) px[y * w + x] = 255;
  px[50 * w + 50] = 0;               // pinhole inside
  px[5 * w + 5] = 255;               // lone speck
  S.mskCleanSpecks(px, w, h, 0.0005, 0.0005);
  assert.equal(px[50 * w + 50], 255); assert.equal(px[5 * w + 5], 0); assert.equal(px[30 * w + 30], 255);
});
test('speck removal keeps a tiny selection when it is the only piece', () => {
  const w = 100, h = 100, px = new Uint8ClampedArray(w * h); px[50 * w + 50] = 255;
  S.mskCleanSpecks(px, w, h, 0.01, 0); assert.equal(px[50 * w + 50], 255);
});
test('sky clean-up drops a small low reflection but keeps the main sky', () => {
  const w = 100, h = 100, px = new Uint8ClampedArray(w * h);
  for (let y = 0; y < 40; y++) for (let x = 0; x < w; x++) px[y * w + x] = 255;      // sky
  for (let y = 80; y < 84; y++) for (let x = 40; x < 50; x++) px[y * w + x] = 255;   // puddle
  for (let y = 10; y < 12; y++) for (let x = 10; x < 12; x++) px[y * w + x] = 0;     // hole in sky
  S.mskSkyCleanup(px, w, h);
  assert.equal(px[82 * w + 45], 0); assert.equal(px[11 * w + 11], 255); assert.equal(px[20 * w + 50], 255);
});
test('guided upsample puts a low-res edge back on the photo edge (>=8x less error than bilinear)', () => {
  const sw = 16, sh = 16, W = 128, H = 128, k = 8, truth = new Float32Array(W * H), rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const on = x < 50 + 0.3 * y; truth[y * W + x] = on ? 1 : 0; const v = on ? 200 : 40; rgba.set([v, v, v, 255], (y * W + x) * 4); }
  const src = new Uint8ClampedArray(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { let s = 0; for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) s += truth[(y * k + j) * W + x * k + i]; src[y * sw + x] = s / (k * k) * 255; }
  const err = o => { let e = 0; for (let i = 0; i < W * H; i++) e += Math.abs(o[i] / 255 - truth[i]); return e / (W * H); };
  const bil = err(S.mskGuidedUpsample(src, sw, sh, W, H, null)), gu = err(S.mskGuidedUpsample(src, sw, sh, W, H, rgba));
  assert.ok(gu * 8 < bil, gu + ' vs ' + bil);
});
test('matte replaces only the edge band', () => {
  const w = 40, h = 40, sam = new Uint8ClampedArray(w * h), matte = new Uint8ClampedArray(w * h).fill(100);
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) sam[y * w + x] = 255;
  assert.equal(S.mskMatteInBand(sam, new Uint8ClampedArray(w * h), w, h, 2), null, 'a matte of something else is ignored');
  for (let i = 0; i < w * h; i++) if (sam[i]) matte[i] = 255;
  const o = S.mskMatteInBand(sam, matte, w, h, 2);
  assert.equal(o[20 * w + 20], 255); assert.equal(o[2 * w + 2], 0); assert.equal(o[20 * w + 10], 255); assert.equal(o[20 * w + 8], 100);
});

test('detected-object masks re-match the same kind of thing on another photo', () => {
  const C = (kind, group, x0, y0, x1, y1) => ({ kind, group, box: { x0, y0, x1, y1 } });
  const list = [C('dog', 'animals', 0.1, 0.2, 0.3, 0.6), C('dog', 'animals', 0.6, 0.1, 0.95, 0.9), C('person', 'people', 0.4, 0, 0.6, 1), C('bench', 'objects', 0, 0.7, 1, 0.9)];
  const det = { kind: 'dog', group: 'animals' };
  assert.equal(S.mskDetectRematch(list, det, { x0: 0.12, y0: 0.25, x1: 0.32, y1: 0.6 }), list[0], 'the overlapping dog, not the bigger one');
  assert.equal(S.mskDetectRematch(list, det, { x0: 0.4, y0: 0.0, x1: 0.45, y1: 0.05 }), list[1], 'no overlap: the largest dog');
  assert.equal(S.mskDetectRematch([C('cat', 'animals', 0.2, 0.2, 0.5, 0.5)], det, { x0: 0.2, y0: 0.2, x1: 0.5, y1: 0.5 }).kind, 'cat', 'same group when the class is absent');
  assert.equal(S.mskDetectRematch([C('chair', 'objects', 0, 0, 1, 1)], { kind: 'bench', group: 'objects' }, { x0: 0, y0: 0, x1: 1, y1: 1 }), null, 'objects never swap class');
  assert.equal(S.mskDetectRematch([list[2]], det, list[0].box), null, 'no dog in the photo');
});
