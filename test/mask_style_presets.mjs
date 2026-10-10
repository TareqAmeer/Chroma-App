// CHR-247: mask-preset preparation reuses the existing Style recipe mask group.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../chromasmith-22.html', import.meta.url), 'utf8');
const planStart = html.indexOf('function _mskCompositionPlan(');
const planEnd = html.indexOf('\n// ── A18:', planStart);
const helperStart = html.indexOf('async function _stylePrepareMaskPreset(');
const helperEnd = html.indexOf('\nfunction _styleRecipeKeys(', helperStart);
assert(planStart >= 0 && planEnd > planStart && helperStart >= 0 && helperEnd > helperStart);
const helpers = new Function(`${html.slice(planStart, planEnd)}\n${html.slice(helperStart, helperEnd)}\nreturn {prepare:_stylePrepareMaskPreset,plan:_mskCompositionPlan};`)();
const prepare = helpers.prepare;

const clone = value => structuredClone(value);
const plan = masks => helpers.plan(masks);
const baseDeps = overrides => {
  const targetItem = { id: 'target' };
  return ({
  clone,
  newId: (() => { let i = 0; return () => `fresh-${++i}`; })(),
  compositionPlan: plan,
  isUnsupported: m => m.origin === 'skin' || (m.origin === 'ai' && !m.aiPoints?.length),
  needsReevaluation: m => m.origin === 'sky' || (m.origin === 'ai' && !!m.aiPoints?.length),
  clearSourceRaster: m => { m.px = new Uint8ClampedArray(0); m.mtW = 0; m.mtH = 0; },
  reevaluate: async m => { m.px = new Uint8ClampedArray([90, 180]); m.mtW = 2; m.mtH = 1; return { ok: true }; },
  target: { item: targetItem },
  current: () => targetItem,
  depthAvailable: () => true,
  sourceSignature: () => 'same',
  targetSignature: 'same',
  ...overrides,
  });
};

test('append remaps every incoming ID and internal operand while preserving target masks', async () => {
  const source = [{ id: 'shape', type: 'radial' }, { id: 'subtract', type: 'radial', composeOp: 'subtract', compositionMigrated: true, operandId: 'shape' }];
  const target = [{ id: 'fresh-1', type: 'linear' }];
  const before = clone(source);
  const result = await prepare(source, target, { mode: 'append', includeSavedPixels: false }, baseDeps());
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.masks.map(m => m.id), ['fresh-1', 'fresh-2', 'fresh-3']);
  assert.equal(result.masks[2].operandId, result.masks[1].id);
  assert.deepEqual(result.masks[0], target[0]);
  assert.deepEqual(source, before, 'preparation does not mutate the saved preset');
  assert.equal(plan(result.masks).valid.every(Boolean), true);
});

test('mask presets preserve signed local Whites, Blacks, Dehaze and Vibrance scalars', async () => {
  const source = [{ id: 'tonal', type: 'radial', wh: 0.65, bl: -0.45, dehaze: 0.37, vibrance: -0.28 }];
  const result = await prepare(source, [], { mode: 'replace', includeSavedPixels: false }, baseDeps());
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.masks[0].wh, 0.65);
  assert.equal(result.masks[0].bl, -0.45);
  assert.equal(result.masks[0].dehaze, 0.37);
  assert.equal(result.masks[0].vibrance, -0.28);
});

test('generated IDs are unique even when an ID source repeats a fresh value', async () => {
  const ids = ['generated-a', 'generated-a', 'generated-b'];
  const result = await prepare([{ id: 'a', type: 'radial' }, { id: 'b', type: 'linear' }], [], { mode: 'replace', includeSavedPixels: false }, baseDeps({ newId: () => ids.shift() || `fallback-${ids.length}` }));
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.masks.map(m => m.id), ['generated-a', 'generated-b']);
});

test('capacity refusal is atomic and does not run semantic inference', async () => {
  let inference = 0;
  const source = [{ id: 'a', type: 'radial' }, { id: 'b', type: 'linear' }];
  const target = Array.from({ length: 7 }, (_, i) => ({ id: `target-${i}`, type: 'radial' }));
  const result = await prepare(source, target, { mode: 'append', includeSavedPixels: false }, baseDeps({ reevaluate: async () => { inference++; return { ok: true }; } }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /8-mask limit/);
  assert.equal(inference, 0);
  assert.equal(target.length, 7);
});

test('Replace starts from an empty target while Append keeps existing target masks', async () => {
  const source = [{ id: 'incoming', type: 'radial' }], target = [{ id: 'existing', type: 'linear' }];
  const append = await prepare(source, target, { mode: 'append', includeSavedPixels: false }, baseDeps());
  const replace = await prepare(source, target, { mode: 'replace', includeSavedPixels: false }, baseDeps());
  assert.equal(append.ok, true);assert.equal(replace.ok, true);
  assert.equal(append.masks.length, 2);assert.equal(append.masks[0].id, 'existing');
  assert.equal(replace.masks.length, 1);assert.ok(!replace.masks.some(m => m.id === 'existing'));
});

test('saved Brush pixels require the explicit option; included pixels are copied structurally', async () => {
  const source = [{ id: 'brush', type: 'brush', origin: 'paint', px: new Uint8ClampedArray([20, 40]), mtW: 2, mtH: 1 }];
  const omitted = await prepare(source, [], { mode: 'replace', includeSavedPixels: false }, baseDeps());
  assert.equal(omitted.ok, false);
  assert.match(omitted.reason, /Include saved Brush pixels/);
  const included = await prepare(source, [], { mode: 'replace', includeSavedPixels: true }, baseDeps());
  assert.equal(included.ok, true, included.reason);
  assert.deepEqual([...included.masks[0].px], [20, 40]);
});

test('a dependent mask cannot be partially applied when its Brush operand was omitted', async () => {
  const source = [
    { id: 'brush', type: 'brush', origin: 'paint', px: new Uint8ClampedArray([1]) },
    { id: 'subtract', type: 'radial', composeOp: 'subtract', compositionMigrated: true, operandId: 'brush' },
  ];
  const result = await prepare(source, [], { mode: 'replace', includeSavedPixels: false }, baseDeps());
  assert.equal(result.ok, false);
  assert.match(result.reason, /omitted or missing mask/);
});

test('unsupported AI group, invalid composition and active-photo changes fail closed', async t => {
  await t.test('unsupported AI intent', async () => {
    const result = await prepare([{ id: 'face', origin: 'skin', ai: true }], [], { mode: 'replace', includeSavedPixels: false }, baseDeps());
    assert.equal(result.ok, false); assert.match(result.reason, /unsupported AI intent/);
  });
  await t.test('missing composition operand', async () => {
    const result = await prepare([{ id: 'bad', type: 'radial', composeOp: 'subtract', compositionMigrated: true, operandId: 'gone' }], [], { mode: 'replace', includeSavedPixels: true }, baseDeps());
    assert.equal(result.ok, false); assert.match(result.reason, /missing mask/);
  });
  await t.test('photo switches during re-evaluation', async () => {
    const result = await prepare([{ id: 'sky', origin: 'sky', type: 'brush', px: new Uint8ClampedArray([5]), refineFeather: 12, refineEdge: -8 }], [], { mode: 'replace', includeSavedPixels: false }, baseDeps({ current: () => ({ id: 'other' }) }));
    assert.equal(result.ok, false); assert.match(result.reason, /active photo changed/);
  });
  await t.test('photo-dependent depth range requires target depth data', async () => {
    const result = await prepare([{ id: 'depth', origin: 'depth', type: 'none', depOn: true, depLo: .2, depHi: .8 }], [], { mode: 'replace', includeSavedPixels: false }, baseDeps({ depthAvailable: () => false }));
    assert.equal(result.ok, false); assert.match(result.reason, /no valid depth map/);
  });
});

test('prompted AI and sky pixels are regenerated on a detached candidate with refinement retained', async () => {
  const source = [{ id: 'sky', origin: 'sky', type: 'brush', px: new Uint8ClampedArray([5]), refineFeather: 14, refineEdge: -9 }];
  let candidateSeen;
  const result = await prepare(source, [], { mode: 'replace', includeSavedPixels: false }, baseDeps({ reevaluate: async m => { candidateSeen = m; assert.equal(m.px.length, 0); m.px = new Uint8ClampedArray([100, 200]); return { ok: true }; } }));
  assert.equal(result.ok, true, result.reason);
  assert.equal(candidateSeen.refineFeather, 14);
  assert.equal(candidateSeen.refineEdge, -9);
  assert.deepEqual([...result.masks[0].px], [100, 200]);
  assert.deepEqual([...source[0].px], [5]);
});

console.log('Mask preset preparation checks passed.');
