// CHR-277: selective style fields, legacy style manifests, and strength behavior.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../chromasmith-22.html', import.meta.url), 'utf8');
const categories = html.slice(html.indexOf('const PASTE_CATEGORIES=['), html.indexOf('function _fxFieldLabel('));
const blendStart = html.indexOf('function _styleBlendTree(');
const blendEnd = html.indexOf('\nfunction presetStrength(', blendStart);
const context = { window: {}, _fxFieldLabel: id => id, _clone: value => JSON.parse(JSON.stringify(value)) };
vm.createContext(context);
vm.runInContext(`${categories}\n${html.slice(blendStart, blendEnd)}\nthis.api={PASTE_CATEGORIES,_pasteAllFieldKeys,_pasteExpandKeys,pasteEditSelectiveApply,_styleBlendSnapshot};`, context);
const api = context.api;
const clone = value => JSON.parse(JSON.stringify(value));

assert.ok(api._pasteAllFieldKeys().includes('extra:rawNr'), 'RAW decode fields are selectable');
assert.ok(api._pasteAllFieldKeys().includes('extra:curveMode'), 'curve mode is selectable');

const base = { sliders: { 'adj-exp': '0', 'adj-con': '4', 'grain-a': '8' }, toggles: { adjust: false }, selects: { 'sel-lut': 'old' }, colors: { 'cl-b1': '#111111' }, curves: { m: [[0, 0]] }, rawNr: 'fast', masks: [{ name: 'local', px: [1, 2] }], canvas: { ar: 1 }, rating: 4 };
const source = { sliders: { 'adj-exp': '80', 'adj-con': '20', 'grain-a': '99' }, toggles: { adjust: true }, selects: { 'sel-lut': 'new' }, colors: { 'cl-b1': '#ffffff' }, curves: { m: [[0, 1]] }, rawNr: 'high', masks: [{ name: 'source', px: [8] }], canvas: { ar: 2 }, rating: 1 };
const untouched = value => JSON.stringify([value.sliders['adj-con'], value.sliders['grain-a'], value.selects, value.colors, value.curves, value.rawNr, value.masks, value.canvas, value.rating]);
const before = untouched(base);
const merged = api.pasteEditSelectiveApply(base, source, ['slider:adj-exp']);
assert.equal(merged.sliders['adj-exp'], '80');
assert.equal(untouched(merged), before, 'unchecked settings and unrelated target metadata stay byte-identical');

const legacy = api._pasteExpandKeys(['adjust', 'lut']);
assert.ok(legacy.includes('slider:adj-exp'));
assert.ok(legacy.includes('select:sel-lut'));
assert.ok(!legacy.includes('extra:geom'));

const pre = { sliders: { 'adj-exp': '0' }, toggles: { adjust: false }, rawNrHighStrength: 10, curves: { m: [[0, 0], [1, 1]] }, masks: [{ id: 'preserve' }] };
const post = { sliders: { 'adj-exp': '100' }, toggles: { adjust: true }, rawNrHighStrength: 90, rawNr: 'high', curves: { m: [[0, 1], [1, 0]] }, masks: [{ id: 'other' }] };
const keys = ['slider:adj-exp', 'toggle:adjust', 'extra:rawNrHighStrength', 'extra:rawNr', 'extra:curves'];
assert.deepEqual(clone(api._styleBlendSnapshot(pre, post, keys, 0)), pre, '0% exactly restores the original snapshot');
const half = api._styleBlendSnapshot(pre, post, keys, 50);
assert.equal(half.sliders['adj-exp'], '50');
assert.equal(half.rawNrHighStrength, 50);
assert.equal(half.toggles.adjust, true, 'discrete switches take effect above 0%');
assert.equal(half.rawNr, 'high');
assert.equal(half.curves.m[0][1], 0.5);
assert.deepEqual(clone(half.masks), pre.masks, 'unselected mask data remains unchanged');
assert.deepEqual(clone(api._styleBlendSnapshot(pre, post, keys, 100).sliders), post.sliders);

console.log('PASS: selective style fields, legacy manifests, exclusions, and 0/50/100 strength behavior.');
