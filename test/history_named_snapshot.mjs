// CHR-271 safe slice: named Versions are durable checkpoints; comparing one must not alter live edits.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../chromasmith-22.html', import.meta.url), 'utf8');
const start = html.indexOf('async function verCompare(i)');
const end = html.indexOf('\nfunction adjSyncScopeUI()', start);
assert(start >= 0 && end > start, 'saved-version compare action exists');

const savedRecipe = {
  sliders: { 'adj-exp': '0.35' },
  curves: { rgb: [[0, 0], [0.5, 0.62], [1, 1]] },
  crop: { x: 0.1, y: 0.12, w: 0.8, h: 0.76 },
  masks: [{ id: 'brush-1', pxb64: 'cHJlc2VydmVkLXJhc3Rlcg==', points: [[0.2, 0.4]] }],
};
const recipeB64 = btoa(unescape(encodeURIComponent(JSON.stringify(savedRecipe))));
const sourceChanges = [];
const liveRecipe = { sliders: { 'adj-exp': '-0.2' }, masks: [{ id: 'live-mask' }] };
const liveBefore = JSON.stringify(liveRecipe);
const context = {
  window: { chromasmithVersions: { get: async () => ({ versions: [{ name: 'Round one', recipe: recipeB64 }] }) } },
  fxPinned: null,
  liveRecipe,
  fxSetSplitSrc: src => sourceChanges.push(src),
  toast: () => {},
  atob,
  btoa,
  escape,
  unescape,
  decodeURIComponent,
  encodeURIComponent,
  JSON,
};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

await context.verCompare(0);
assert.equal(JSON.stringify(context.fxPinned), JSON.stringify(savedRecipe), 'the named checkpoint recipe is used intact');
assert.equal(context.fxPinned.masks[0].pxb64, savedRecipe.masks[0].pxb64, 'mask raster data survives pinning');
assert.deepEqual(sourceChanges, ['pin'], 'the existing split-compare pin source shows the checkpoint as Before');
assert.equal(JSON.stringify(context.liveRecipe), liveBefore, 'comparing leaves the current recipe untouched');
assert.notEqual(context.fxPinned, context.liveRecipe, 'saved checkpoint and current edit remain separate states');
assert.match(html, /Save a named version as a checkpoint, then keep editing; <b>Compare<\/b> shows that saved edit against the current one/,
  'Versions explains the safe checkpoint and compare workflow');
console.log('HISTORY NAMED SNAPSHOT: PASS');
