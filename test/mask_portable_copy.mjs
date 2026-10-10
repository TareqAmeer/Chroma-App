// CHR-247: fault-injection coverage for the per-photo semantic mask-copy coordinator.
// This extracts the production coordinator from the single-file editor and supplies deterministic
// photo/model/save fakes; no model weights or browser GPU are required.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = await readFile(path.join(here, '..', 'chromasmith-22.html'), 'utf8');
const library = await readFile(path.join(here, '..', 'desktop', 'library-ui.js'), 'utf8');
const start = html.indexOf('async function _mskPortableCopyProcess(');
const end = html.indexOf('\nfunction _mskPortablePublish(', start);
assert(start >= 0 && end > start, 'production portable-copy coordinator is present');
const runPortableCopy = new Function(`${html.slice(start, end)}\nreturn _mskPortableCopyProcess;`)();
const undoStart = html.indexOf('async function _mskPortableUndoProcess(');
const undoEnd = html.indexOf('\nfunction _mskPortablePublish(', undoStart);
assert(undoStart >= 0 && undoEnd > undoStart, 'production portable-undo coordinator is present');
const runPortableUndo = new Function(`${html.slice(undoStart, undoEnd)}\nreturn _mskPortableUndoProcess;`)();

const mask = (id, origin = 'paint', px = [10, 20]) => ({ id, origin, aiPoints: origin === 'ai' ? [{ nx: 0.3, ny: 0.4, positive: true }] : [], px, mtW: px.length, mtH: 1 });
function fixture({ count = 2, unsupported = false } = {}) {
  const current = { name: 'source' };
  const source = [Object.assign(mask('stable-prompt', 'ai'), { refineFeather: 18, refineEdge: -12 }), mask('painted', 'paint')];
  if (unsupported) source.push({ ...mask('face-skin', 'skin'), name: 'face-skin', ai: true, aiPoints: [] });
  const targets = Array.from({ length: count }, (_, i) => ({ item: { name: `target-${i + 1}`, masks: [{ id: `old-${i + 1}` }] }, index: i + 1 }));
  let active = current, cancel = false, expected = current;
  const deps = {
    cancelled: () => cancel || active !== expected,
    current: () => active,
    signature: item => JSON.stringify(item.masks),
    clone: value => structuredClone(value),
    isUnsupported: m => m.origin === 'skin',
    needsReevaluation: m => m.origin === 'ai' || m.origin === 'sky',
    clearSourceRaster: m => { m.px = new Uint8Array(0); m.mtW = 0; m.mtH = 0; },
    select: async target => { active = expected = target.item; },
    progress: () => {},
    reevaluate: async candidate => {
      assert.equal(candidate.px.length, 0, 'source raster is removed before model work');
      candidate.px = new Uint8Array([200, 210]); candidate.mtW = 2; candidate.mtH = 1;
      return { ok: true };
    },
    commit: async (target, masks) => { target.item.masks = masks; },
  };
  return { source, targets, current, deps, setCancel: value => { cancel = value; }, setActive: value => { active = value; }, active: () => active };
}

test('commits a target only after reevaluation, preserving source IDs and manual rasters', async () => {
  const f = fixture();
  const sourceRaster = [...f.source[0].px];
  const results = await runPortableCopy(f.source, f.targets, f.deps);
  assert.equal(results[0].status, 'applied');
  assert.deepEqual(f.targets[0].item.masks.map(m => m.id), ['stable-prompt', 'painted']);
  assert.deepEqual([...f.targets[0].item.masks[0].px], [200, 210]);
  assert.deepEqual([...f.targets[0].item.masks[1].px], [10, 20]);
  assert.deepEqual([...f.source[0].px], sourceRaster);
  assert.equal(f.targets[0].item.masks[0].refineFeather, 18);
  assert.equal(f.targets[0].item.masks[0].refineEdge, -12);
});

test('unsupported AI intent skips the whole target without replacing existing masks', async () => {
  const f = fixture({ unsupported: true });
  const before = structuredClone(f.targets[0].item.masks);
  const results = await runPortableCopy(f.source, f.targets, f.deps);
  assert.equal(results[0].status, 'skipped');
  assert.match(results[0].message, /face-skin/);
  assert.deepEqual(f.targets[0].item.masks, before);
});

test('inference failure preserves that target and allows later targets to succeed', async () => {
  const f = fixture({ count: 2 });
  const firstBefore = f.targets[0].item.masks;
  let calls = 0;
  f.deps.reevaluate = async candidate => {
    assert.equal(candidate.px.length, 0);
    if (++calls === 1) return { ok: false, error: 'mock SAM failure' };
    candidate.px = new Uint8Array([201]); return { ok: true };
  };
  const results = await runPortableCopy(f.source, f.targets, f.deps);
  assert.equal(results[0].status, 'failed');
  assert.equal(f.targets[0].item.masks, firstBefore);
  assert.equal(results[1].status, 'applied');
});

test('cancellation during model work does not commit the in-flight target', async () => {
  const f = fixture({ count: 2 });
  const before = f.targets.map(t => t.item.masks);
  f.deps.reevaluate = async candidate => { f.setCancel(true); candidate.px = new Uint8Array([255]); return { ok: true }; };
  const results = await runPortableCopy(f.source, f.targets, f.deps);
  assert.deepEqual(results.map(r => r.status), ['cancelled', 'cancelled']);
  assert.equal(f.targets[0].item.masks, before[0]);
  assert.equal(f.targets[1].item.masks, before[1]);
});

test('user navigation during inference cancels without forcing selection back', async () => {
  const f = fixture();
  const chosenByUser = { name: 'user-selected' };
  f.deps.reevaluate = async candidate => { f.setActive(chosenByUser); candidate.px = new Uint8Array([255]); return { ok: true }; };
  const results = await runPortableCopy(f.source, f.targets, f.deps);
  assert.equal(results[0].status, 'cancelled');
  assert.equal(f.active(), chosenByUser);
  assert.deepEqual(f.targets[0].item.masks, [{ id: 'old-1' }]);
});

test('concurrent target-mask edits are detected and preserved', async () => {
  const f = fixture();
  f.deps.reevaluate = async candidate => {
    f.targets[0].item.masks = [{ id: 'manual-edit-during-inference' }];
    candidate.px = new Uint8Array([255]); return { ok: true };
  };
  const results = await runPortableCopy(f.source, f.targets, f.deps);
  assert.equal(results[0].status, 'failed');
  assert.match(results[0].message, /changed during recomputation/);
  assert.deepEqual(f.targets[0].item.masks, [{ id: 'manual-edit-during-inference' }]);
});

test('a failed persistence commit can roll back the candidate atomically', async () => {
  const f = fixture();
  const before = f.targets[0].item.masks;
  f.deps.commit = async (target, masks) => {
    target.item.masks = masks;
    target.item.masks = before; // production commit mirrors this rollback if the sidecar write rejects
    throw new Error('mock sidecar write failure');
  };
  const results = await runPortableCopy(f.source, f.targets, f.deps);
  assert.equal(results[0].status, 'failed');
  assert.equal(f.targets[0].item.masks, before);
});

function undoFixture() {
  const itemA = { name: 'target-A', masks: [{ id: 'copied-A' }] };
  const itemB = { name: 'target-B', masks: [{ id: 'copied-B' }] };
  const currentAtUndo = { name: 'current-at-undo' };
  const entries = [itemA, itemB].map((item, index) => ({
    item, index: index + 1, before: [{ id: `original-${index + 1}` }],
    afterSignature: JSON.stringify(item.masks)
  }));
  let active = currentAtUndo, expected = currentAtUndo, focusRestored = null, cancel = false;
  const deps = {
    cancelled: () => cancel || active !== expected,
    current: () => active,
    signature: item => JSON.stringify(item.masks || []),
    select: async entry => { active = expected = entry.item; },
    restore: async entry => { entry.item.masks = structuredClone(entry.before); },
    canRestoreFocus: () => active === expected,
    restoreFocus: async target => { active = target.item; focusRestored = target; }
  };
  return { itemA, itemB, currentAtUndo, entries, deps, active: () => active, focusRestored: () => focusRestored, cancel: () => { cancel = true; } };
}

test('undo restores the photo selected when Undo starts, not the original copy source', async () => {
  const f = undoFixture();
  const target = { item: f.currentAtUndo, index: 7, selection: 2 };
  const summary = await runPortableUndo(f.entries, target, f.deps);
  assert.deepEqual(summary.results.map(r => r.status), ['undone', 'undone']);
  assert.deepEqual(f.itemA.masks, [{ id: 'original-1' }]);
  assert.deepEqual(f.itemB.masks, [{ id: 'original-2' }]);
  assert.equal(f.focusRestored(), target);
  assert.equal(f.active(), f.currentAtUndo);
});

test('undo preserves a target changed after copy and retains only failed-save undo entries', async () => {
  const f = undoFixture();
  f.itemA.masks = [{ id: 'later-manual-edit' }];
  let saves = 0;
  f.deps.restore = async entry => {
    if (++saves === 1) throw new Error('disk unavailable');
    entry.item.masks = structuredClone(entry.before);
  };
  const target = { item: f.currentAtUndo, index: 7, selection: 1 };
  const summary = await runPortableUndo(f.entries, target, f.deps);
  assert.equal(summary.results[0].status, 'conflict');
  assert.deepEqual(f.itemA.masks, [{ id: 'later-manual-edit' }]);
  assert.equal(summary.results[1].status, 'failed');
  assert.deepEqual(summary.remaining.map(e => e.item.name), ['target-B']);
  assert.equal(f.focusRestored(), target);
});

test('undo stops after user navigation and does not steal focus back', async () => {
  const f = undoFixture();
  const userChoice = { name: 'user-choice' };
  f.deps.restore = async () => { f.deps.cancelled = () => true; f.active = () => userChoice; };
  f.deps.canRestoreFocus = () => false;
  const target = { item: f.currentAtUndo, index: 7, selection: 0 };
  const summary = await runPortableUndo(f.entries, target, f.deps);
  assert.equal(f.focusRestored(), null);
  assert.equal(summary.remaining.length, 1);
});

const mergeStart = library.indexOf('function mergePhotoMaskRecipeSnapshot(');
const mergeEnd = library.indexOf('\n  }', mergeStart) + 4;
assert(mergeStart >= 0 && mergeEnd > mergeStart, 'production target-recipe mask merge is present');
const mergePhotoMasks = new Function(`${library.slice(mergeStart, mergeEnd)}\nreturn mergePhotoMaskRecipeSnapshot;`)();

test('per-photo merge preserves all target recipe categories and explicitly supports empty masks', () => {
  const target = { sliders: { exposure: '8' }, geom: { crop: [0.1, 0.2] }, masks: [{ id: 'old' }], curves: [{ x: 1 }] };
  const merged = mergePhotoMasks(target, [{ id: 'new', pxb64: 'target-raster' }]);
  assert.deepEqual(merged.sliders, target.sliders);
  assert.deepEqual(merged.geom, target.geom);
  assert.deepEqual(merged.curves, target.curves);
  assert.deepEqual(merged.masks, [{ id: 'new', pxb64: 'target-raster' }]);
  assert.deepEqual(mergePhotoMasks(target, []).masks, []);
  assert.equal(mergePhotoMasks(null, []).masks.length, 0);
});

test('copy and undo persist against the old mask baseline before changing live editor state', () => {
  const copyStart = html.indexOf('commit:async(target,candidates)=>');
  const copyEnd = html.indexOf('\n      }', copyStart);
  const copyBody = html.slice(copyStart, copyEnd);
  assert(copyBody.indexOf('await _mskPersistPortableCurrent(candidates,before,target.item)') < copyBody.indexOf('target.item.masks=candidates'));
  assert(copyBody.indexOf('await _mskPersistPortableCurrent(candidates,before,target.item)') < copyBody.indexOf('fxUpdate()'));
  const undoStart = html.indexOf('restore:async entry=>{', html.indexOf('async function mskUndoPortableCopy'));
  const undoEnd = html.indexOf('\n      },', undoStart);
  const undoBody = html.slice(undoStart, undoEnd);
  assert(undoBody.indexOf('await _mskPersistPortableCurrent(restored,copied,entry.item)') < undoBody.indexOf('entry.item.masks=restored'));
  assert(undoBody.indexOf('await _mskPersistPortableCurrent(restored,copied,entry.item)') < undoBody.indexOf('fxUpdate()'));
});
