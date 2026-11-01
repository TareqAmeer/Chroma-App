#!/usr/bin/env node
// Deterministic unit checks for non-destructive AI-mask Feather / Edge raster derivation.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = await readFile(new URL('../chromasmith-22.html', import.meta.url), 'utf8');
const extract = (name, next) => {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = html.indexOf(`function ${next}(`, start + 1);
  assert.notEqual(end, -1, `missing following ${next}`);
  return html.slice(start, end);
};
const source = extract('_mskBoxExtrema', 'mskRefinementSet')
  + extract('mskRefinedPixels', 'mskRefinementSet');
const context = { Uint8ClampedArray, Float32Array, Int32Array, Math };
context.mskEnsureDims = () => {};
vm.createContext(context);
vm.runInContext(source, context);

const width = 17, height = 11;
const mask = new Uint8ClampedArray(width * height);
for (let y = 2; y < 9; y++) for (let x = 4; x < 12; x++) mask[y * width + x] = 255;
const model = { type: 'brush', origin: 'coat', ai: true, px: mask, mtW: width, mtH: height,
  refineFeather: 0, refineEdge: 0 };
const base = context.mskRefinedPixels(model);
assert.equal(base, mask, 'zero settings preserve the authored raster by reference');

model.refineEdge = 100;
const grown = context.mskRefinedPixels(model);
assert.ok(grown[(1 * width) + 3] > 0, 'positive Edge expands the mask');
assert.equal(model.px, mask, 'derivation never mutates the authored mask');

model.refineEdge = -100;
const shrunk = context.mskRefinedPixels(model);
assert.equal(shrunk[(2 * width) + 4], 0, 'negative Edge contracts the mask');

model.refineEdge = 0; model.refineFeather = 100;
const soft = context.mskRefinedPixels(model);
assert.ok(soft[(5 * width) + 3] > 0 && soft[(5 * width) + 3] < 255,
  'Feather creates partial edge coverage');
assert.equal(model.px, mask, 'Feather leaves the authored raster exact for reset');

model.refineFeather = 0;
assert.equal(context.mskRefinedPixels(model), mask, 'reset returns exact source bytes');
console.log('mask refinement math: 5 checks PASS');
