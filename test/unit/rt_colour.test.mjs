// CHR-291 / CHR-290: channel mixer, Lab adjustments and colour toning — recipe values to shader uniforms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './extract.mjs';

const rt = load(['ADJ_DEFAULTS', 'rtColourBlock', 'rtColourUniforms']);
const plain = o => JSON.parse(JSON.stringify(o));

test('a recipe without the new keys reads as the identity mixer and zero Lab/toning', () => {
  const b = plain(rt.rtColourBlock({ exp: 10 }));
  assert.deepEqual(b.mix, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assert.deepEqual(b.lab, { lightness: 0, contrast: 0, chroma: 0 });
  assert.deepEqual(b.tone, { sa: 0, sb: 0, ha: 0, hb: 0 });
});

test('default and disabled settings switch every stage off', () => {
  const u = rt.rtColourUniforms(rt.rtColourBlock({}), true);
  assert.equal(u.rtMixOn, 0); assert.equal(u.rtLabOn, 0);
  const moved = rt.rtColourBlock({ 'mix-rg': 20, 'lab-chroma': -50 });
  const off = rt.rtColourUniforms(moved, false);
  assert.equal(off.rtMixOn, 0); assert.equal(off.rtLabOn, 0);
  assert.equal(rt.rtColourUniforms(undefined, true).rtMixOn, 0);
});

test('mixer rows are output channels in percent of each input', () => {
  const u = plain(rt.rtColourUniforms(rt.rtColourBlock({ 'mix-rr': 80, 'mix-rg': 20, 'mix-bb': 150 }), true));
  assert.equal(u.rtMixOn, 1); assert.equal(u.rtLabOn, 0);
  assert.deepEqual(u.rtMixR, [0.8, 0.2, 0]);
  assert.deepEqual(u.rtMixG, [0, 1, 0]);
  assert.deepEqual(u.rtMixB, [0, 0, 1.5]);
});

test('any Lab or toning value turns the Lab stage on, scaled to -1..1', () => {
  const u = plain(rt.rtColourUniforms(rt.rtColourBlock({ 'lab-l': 25, 'tone-hb': -40 }), true));
  assert.equal(u.rtLabOn, 1); assert.equal(u.rtMixOn, 0);
  assert.deepEqual(u.rtLab, [0.25, 0, 0]);
  assert.deepEqual(u.rtToneS, [0, 0]); assert.deepEqual(u.rtToneH, [0, -0.4]);
});

test('non-numeric stored values fall back to the defaults', () => {
  const b = plain(rt.rtColourBlock({ 'mix-gg': 'x', 'lab-con': null }));
  assert.equal(b.mix[4], 1); assert.equal(b.lab.contrast, 0);
});
