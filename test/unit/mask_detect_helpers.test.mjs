// Detection chip list, Otsu, speck/hole clean-up, sky clean-up, guided upsampling and matte-in-band.
import { load } from './extract.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
const S = load(['MSK_COCO', 'MSK_ANIMALS', 'mskDetGroup', 'mskDetName', 'mskSceneList', 'mskOtsu', 'mskComponents', 'mskCleanSpecks',
  'mskSkyCleanup', '_boxFilterMean', '_guidedFilter', '_samDilateBinary', '_mskBilinear', '_mskGuideCache', 'mskGuidedUpsample', 'mskMatteInBand', 'mskDetectRematch', 'mskBoxSharpness', 'mskFocusPick', 'mskClipToBox']);
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

test('Auto Subject keeps the in-focus subject over a bigger blurry one', () => {
  const w = 64, h = 32, d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, v = x < 32 ? 128 + 2 * Math.sin(x / 6) : ((x + y) % 2 ? 230 : 20); d[i] = d[i + 1] = d[i + 2] = v; }
  const blurry = { box: { x0: 0.02, y0: 0.02, x1: 0.5, y1: 0.98 } }, sharp = { box: { x0: 0.6, y0: 0.3, x1: 0.8, y1: 0.7 } };
  const s = [S.mskBoxSharpness(d, w, h, blurry.box), S.mskBoxSharpness(d, w, h, sharp.box)];
  assert.ok(s[1] > s[0] * 10, JSON.stringify(s));
  assert.deepEqual(S.mskFocusPick([blurry, sharp], s), [sharp], 'small sharp dog wins over big blurry one');
  assert.deepEqual(S.mskFocusPick([blurry, sharp], null), [blurry], 'no focus data: size rule (sharp box is under a quarter the size)');
  assert.deepEqual(S.mskFocusPick([blurry, sharp], [10, 9]).length, 1, 'both in focus: size rule picks among them');
});

test('box clip keeps the subject and a margin, drops spill far outside', () => {
  const w = 100, h = 100, px = new Uint8ClampedArray(w * h).fill(255);
  S.mskClipToBox(px, w, h, { x0: 0.4, y0: 0.4, x1: 0.6, y1: 0.6 });
  assert.equal(px[50 * w + 50], 255); assert.equal(px[50 * w + 37], 255); // inside the 12%/2% margin
  assert.equal(px[50 * w + 30], 0); assert.equal(px[10 * w + 50], 0); assert.equal(px[0], 0);
});
test('guided upsample: shared guide terms give the same result on reuse and per grid', () => {
  const sw = 32, sh = 24, W = 128, H = 96, rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const j = (y * W + x) * 4, v = x + y * 0.7 > 70 ? 230 : 30; rgba[j] = rgba[j + 1] = rgba[j + 2] = v; rgba[j + 3] = 255; }
  const a = new Uint8ClampedArray(sw * sh), b = new Uint8ClampedArray(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { a[y * sw + x] = x * 4 + y * 2.8 > 70 ? 255 : 0; b[y * sw + x] = x > 16 ? 255 : 0; }
  const a1 = S.mskGuidedUpsample(a, sw, sh, W, H, rgba), b1 = S.mskGuidedUpsample(b, sw, sh, W, H, rgba), a2 = S.mskGuidedUpsample(a, sw, sh, W, H, rgba);
  assert.deepEqual(a1, a2);
  const fresh = S.mskGuidedUpsample(b, sw, sh, W, H, Uint8ClampedArray.from(rgba)); assert.deepEqual(b1, fresh);
  const c1 = S.mskGuidedUpsample(a, 16, 12, W, H, rgba); assert.equal(c1.length, W * H); // a different grid rebuilds the terms
});
test('Auto Subject drops subjects cut off at the top/left/right when one sits fully in frame', () => {
  const C = (label, x0, y0, x1, y1) => ({ label, box: { x0, y0, x1, y1 } });
  // October 6712: legs at the top edge, a dog cut at the left, the sharp dog fully inside
  const live = [C('Person 1', 0.08, 0, 0.25, 0.35), C('Dog 1', 0, 0.57, 0.24, 0.99), C('Dog 2', 0.41, 0.36, 0.54, 0.66)];
  assert.deepEqual(S.mskFocusPick(live, [1.15, 1.31, 1.47]).map(c => c.label), ['Dog 2']);
  // 6879: a close dog cropped at the bottom stays
  const close = [C('Dog 1', 0.07, 0.32, 0.47, 1), C('Dog 2', 0.56, 0.22, 0.85, 0.96)];
  assert.deepEqual(S.mskFocusPick(close, [0.55, 0.74]).map(c => c.label).sort(), ['Dog 1', 'Dog 2']);
  // everything cut: keep them rather than return nothing
  assert.equal(S.mskFocusPick([C('Person', 0, 0, 0.5, 1)], null).length, 1);
});
test('Auto Subject keeps a second subject beside the sharpest one', () => {
  const C = (label, x0, y0, x1, y1) => ({ label, kind: label.split(' ')[0].toLowerCase(), box: { x0, y0, x1, y1 } });
  // October 6650: two dogs running side by side, people at the right edge
  const run = [C('Person 1', 0.86, 0.42, 0.95, 0.69), C('Person 2', 0.9, 0.4, 1, 0.7), C('Dog 1', 0.44, 0.59, 0.52, 0.71), C('Dog 2', 0.53, 0.58, 0.64, 0.71)];
  assert.deepEqual(S.mskFocusPick(run, [0.72, 0.66, 2.15, 0.81]).map(c => c.label).sort(), ['Dog 1', 'Dog 2']);
  // 6657: a statue the same size but further back (feet 0.24 higher) stays out
  const st = [C('Dog 1', 0.15, 0.5, 0.52, 0.7), C('Dog 2', 0.34, 0.27, 0.73, 0.46)];
  assert.deepEqual(S.mskFocusPick(st, [0.85, 0.36]).map(c => c.label), ['Dog 1']);
});
