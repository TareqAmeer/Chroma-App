#!/usr/bin/env node
// Focused regression checks for the shared raster refinement path and its editor preference.
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

const store = new Map();
let rebuilds = 0;
const context = {
  Uint8ClampedArray, Float32Array, Int32Array, Math, fxState: { masks: [], adjustments: { exposure: 0.45 } }, mskSel: 0,
  localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
  mskRebuild: () => rebuilds++, _mskTexDirty: false,
  fxHistoryPush: () => { context.undoSnap = context._mskToSnap(context.fxState.masks[0]); }, fxUpdate: () => {},
  curItem: () => ({ img: { width: 12, height: 10 } }), fxWork: null, fxImg: null,
  mskTexDims: () => ({ w: 12, h: 10 }),
  mskSourceData: (w, h) => new Uint8Array(w * h * 4).fill(180),
  _smoothstepJS: (a, b, value) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); },
  _pxToB64: px => Array.from(px).join(','), _pxFromB64: value => Uint8ClampedArray.from(value.split(',').map(Number)),
  _mskMigrate: mask => { if (mask.pxb64) { mask.px = Uint8ClampedArray.from(mask.pxb64.split(',').map(Number)); delete mask.pxb64; } return mask; },
  _mskNewId: () => 'mask-id',
};
vm.createContext(context);
vm.runInContext(
  extract('mskIsAI', 'mskCaps') +
  extract('mskCompactLayoutGet', 'mskCompactLayoutToggle') +
  extract('mskCompactLayoutToggle', 'mskCaps') +
  extract('_mskBoxExtrema', 'mskRefinementSet') +
  extract('mskRefinedPixels', 'mskRefineEdges') +
  extract('mskRefinementSupported', 'mskRefineControls') +
  extract('mskRefinementSourceReset', 'mskRefineControls') +
  extract('mskGenerateSky', '_skySeedPoints') +
  extract('_mskToSnap', '_mskFromSnap') +
  extract('_mskFromSnap', '_mskCloneLive'),
  context,
);

const source = new Uint8ClampedArray(120).fill(255);
const sky = { type: 'brush', origin: 'sky', px: source, mtW: 12, mtH: 10, refineFeather: 72, refineEdge: -34,
  _refineCache: { src: source } };
assert.equal(context.mskRefinementSupported(sky), true, 'ready sky raster shares AI refinement capability');
assert.equal(context.mskRefinementSupported({ ...sky, origin: 'manual-teeth' }), false, 'manual brush stays outside AI refinement controls');
assert.equal(context.mskRefinementSupported({ type: 'none', origin: 'depth', px: source, mtW: 12, mtH: 10 }), false,
  'shapeless depth range does not expose ineffective raster controls');

context.mskRefinementSourceReset(sky);
assert.equal(sky.refineFeather, 0);
assert.equal(sky.refineEdge, 0);
assert.equal(sky.px, source, 'reset clears only derived settings and leaves the authored source recoverable');
assert.equal('_refineCache' in sky, false, 'reset invalidates the source identity cache');

sky.refineFeather = 80; sky.refineEdge = 50;
context.fxState.masks = [sky];
const adjustmentBefore = JSON.stringify(context.fxState.adjustments);
context.mskSkyRedetect(sky);
const undoSnap = context.undoSnap;
assert.equal(sky.refineFeather, 0, 'sky re-detection starts refinement at zero');
assert.equal(sky.refineEdge, 0, 'sky re-detection starts edge at zero');
assert.notEqual(sky.px, source, 'sky re-detection assigns a new source identity');
assert.equal(source[0], 255, 'sky generation does not mutate the prior source pixels');
assert.equal(undoSnap.refineFeather, 80, 'snapshot/undo retains the earlier Feather setting');
assert.equal(undoSnap.refineEdge, 50, 'snapshot/undo retains the earlier Edge setting');
const restored = context._mskFromSnap(undoSnap);
assert.equal(restored.refineFeather, 80, 'undo restores the prior Feather setting');
assert.equal(restored.refineEdge, 50, 'undo restores the prior Edge setting');
assert.equal(restored.px.length, source.length, 'undo snapshot restores the authored source raster');
assert.equal(restored.px[0], source[0], 'undo restores the exact pre-redetect pixels');

assert.equal(context.mskCompactLayoutGet(), false, 'standard layout is the default');
context.mskCompactLayoutToggle();
assert.equal(context.mskCompactLayoutGet(), true, 'compact preference persists outside photo adjustment state');
assert.equal(rebuilds, 1, 'layout toggle rebuilds the visible panel');
context.fxState.masks = [{ type: 'brush', origin: 'manual-teeth', name: 'second photo mask' }];
assert.equal(context.mskCompactLayoutGet(), true, 'switching to another photo mask set keeps the global layout preference');
context.mskCompactLayoutToggle();
assert.equal(context.mskCompactLayoutGet(), false, 'layout preference can return to standard');
assert.equal(rebuilds, 2);
context.localStorage.setItem = () => { throw new Error('storage unavailable'); };
context.mskCompactLayoutToggle();
assert.equal(context.mskCompactLayoutGet(), true, 'layout toggle still works when persistence is blocked');
assert.equal(rebuilds, 3);
assert.equal(JSON.stringify(context.fxState.adjustments), adjustmentBefore,
  'compact layout preference never changes per-photo adjustments');
assert.match(html, /msk-compact \.fx-row>\.fx-slider\{[^}]*min-height:28px/,
  'compact slider retains the 28px target floor');
assert.match(html, /@media\(max-width:420px\)\{\.msk-compact \.fx-row>\.fx-label\{flex-basis:100%/,
  'narrow viewport returns sliders to a stacked layout');
assert.doesNotMatch(html.match(/\.msk-compact[^}]+\}/g)?.join('') ?? '', /display\s*:\s*none/,
  'compact styling does not hide editable controls');
assert.match(html, /ctl\.classList\.toggle\('msk-compact',mskCompactLayoutGet\(\)\)/,
  'photo panel rebuild reads the independent UI preference');

console.log('mask refinement layout: 29 checks PASS');
