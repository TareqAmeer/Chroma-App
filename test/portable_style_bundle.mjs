import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../chromasmith-22.html', import.meta.url), 'utf8');
const start = source.indexOf('function _styleBundleCreate(');
const end = source.indexOf('function styleExportBundle()', start);
assert(start >= 0 && end > start, 'portable bundle helpers exist');
const pasteStart = source.indexOf('const PASTE_CATEGORIES=[');
const pasteEnd = source.indexOf('function _pasteAllFieldKeys()', pasteStart);
assert(pasteStart >= 0 && pasteEnd > pasteStart, 'style manifest exists');
const pasteNext = source.indexOf('function _pasteExpandKeys(', pasteEnd);
const pasteFinish = source.indexOf('\n}', pasteNext) + 2;
const context = {
  Date, JSON, Set, Map, Array, Object, Number, Error,
  _clone: value => structuredClone(value),
  _fxFieldLabel: value => value,
};
vm.createContext(context);
vm.runInContext(source.slice(pasteStart, pasteFinish) + '\nthis.__categories=PASTE_CATEGORIES.map(c=>c.key);', context);
vm.runInContext(source.slice(start, end), context);

const input = [
  { version: 2, name: 'Portrait/Warm', recipe: { sliders: { exposure: 0.4 }, selects: { 'sel-lut': 'cinema.cube' } }, keys: ['exposure'], created: 1234, favorite: true, metadata: { author: 'A' } },
  { version: 2, name: 'Landscape/Soft', recipe: { toggles: { grain: true } }, keys: ['grain'], created: 2345, favorite: false },
];
const bundle = context._styleBundleCreate(input, 9000);
assert.equal(bundle.format, 'chromasmith-style-bundle');
assert.equal(bundle.version, 1);
assert.equal(bundle.styles.length, 2);
const known = context._pasteAllFieldKeys();
const categories = context.__categories;
const plan = context._styleBundleInspect(bundle, [], known, context._pasteExpandKeys, categories);
assert.equal(plan.styles.length, 2);
assert.equal(plan.styles[0].name, 'Portrait/Warm');
assert.equal(plan.styles[0].favorite, true);
assert.equal(plan.styles[0].created, 1234);
assert.equal(plan.styles[0].metadata.author, 'A');
assert.equal(plan.styles[0].version, 2);
assert.equal(plan.lutReferences, 1);
const reexported = context._styleBundleCreate(plan.styles);
assert.equal(reexported.styles[0].metadata.favorite, true);
assert.equal(reexported.styles[0].metadata.created, 1234);
assert.equal(reexported.styles[0].metadata.sourceVersion, 2);
assert.equal(plan.styles[0].metadata.author, 'A');

const conflicts = context._styleBundleInspect(bundle, [{ name: 'Portrait/Warm' }], known, context._pasteExpandKeys, categories);
assert.equal(conflicts.styles[0].name, 'Portrait/Warm (imported)');
assert.deepEqual(Array.from(conflicts.duplicates, d => d.to), ['Portrait/Warm (imported)']);
const repeated = context._styleBundleInspect({ ...bundle, styles: [bundle.styles[0], bundle.styles[0]] }, [], known, context._pasteExpandKeys, categories);
assert.equal(repeated.styles[1].name, 'Portrait/Warm (imported)');

const unknownBundle = structuredClone(bundle);
unknownBundle.styles[0].keys.push('future-setting');
const unknownPlan = context._styleBundleInspect(unknownBundle, [], known, context._pasteExpandKeys, categories);
assert(unknownPlan.unsupported.some(item => item.keys.includes('future-setting')));
assert.throws(() => context._styleBundleInspect({ ...bundle, version: 2 }, [], known, context._pasteExpandKeys, []), /Unsupported/);
assert.throws(() => context._styleBundleInspect({ ...bundle, styles: [{ name: '', recipe: {} }] }, [], known, context._pasteExpandKeys, []), /invalid name/);
assert.throws(() => context._styleBundleCreate(Array(501).fill(input[0])), /500/);
assert.throws(() => context._styleBundleInspect({ ...bundle, styles: [{ ...bundle.styles[0], keys: ['x'.repeat(201)] }] }, [], known, context._pasteExpandKeys, []), /manifest/);

console.log('portable style bundle round-trip, conflict naming, metadata, unsupported settings, LUT refs, and invalid inputs passed');
