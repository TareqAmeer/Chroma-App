import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../chromasmith-22.html', import.meta.url), 'utf8');
const mergeSource = html.slice(html.indexOf('const PASTE_CATEGORIES='), html.indexOf('// Shows the category picker', html.indexOf('const PASTE_CATEGORIES=')));
const merge = vm.runInNewContext(`${mergeSource}\nwindow.chromasmithMergeSelectiveRecipe;`, { window: {} });
const ui = await readFile(new URL('../desktop/library-ui.js', import.meta.url), 'utf8');
const helper = ui.split('// BEGIN RECIPE_BATCH_HELPER')[1]?.split('// END RECIPE_BATCH_HELPER')[0];
assert.ok(helper, 'production batch helper must have extraction markers');
const drain = vm.runInNewContext(`${helper}\nrecipeBatchDrain;`, { setTimeout: callback => queueMicrotask(callback) });
const clone = value => JSON.parse(JSON.stringify(value));

function journal(count) {
  return { id: 'batch-fixture', label: 'Paste', status: 'running', items: Array.from({ length: count }, (_, index) => ({ index, path: `photo-${index}.jpg`, recipe: { sliders: { 'adj-exp': index } }, status: 'pending', error: null })) };
}
function transport(batch, failures = new Set()) {
  let active = 0, maximum = 0;
  const calls = [];
  return {
    calls,
    get maximum() { return maximum; },
    async api(command, args) {
      assert.equal(args.id, batch.id);
      if (command === 'recipe_batch_get') return clone(batch);
      assert.equal(command, 'recipe_batch_apply_item');
      calls.push(args.index);
      active++; maximum = Math.max(maximum, active);
      await Promise.resolve();
      active--;
      const item = batch.items[args.index];
      assert.equal(item.status, 'pending', 'completed items must never be scheduled again');
      if (failures.has(args.index)) { item.status = 'failed'; item.error = 'write failed'; throw new Error(item.error); }
      item.status = 'applied';
      if (!batch.items.some(i => i.status === 'pending')) batch.status = 'completed';
      return clone(item);
    }
  };
}

test('selective paste preserves every excluded group for 5000 distinct targets', () => {
  const source = { sliders: { 'adj-exp': 2, 'grain-a': 99 }, toggles: { adjust: true, grain: false }, masks: [{ strength: 99 }], canvas: { border: 99 } };
  const sourceBytes = JSON.stringify(source);
  for (let index = 0; index < 5000; index++) {
    const base = { sliders: { 'adj-exp': index, 'grain-a': index / 10 }, toggles: { adjust: false, grain: index % 2 === 0 }, selects: { 'sel-grain-fmt': `${index}` }, masks: [{ strength: index }], canvas: { border: index }, crop: { x: index }, rating: index % 6 };
    const excluded = value => JSON.stringify([value.sliders['grain-a'], value.toggles.grain, value.selects, value.masks, value.canvas, value.crop, value.rating]);
    const before = excluded(base);
    const result = merge(base, source, ['adjust']);
    assert.equal(result.sliders['adj-exp'], 2);
    assert.equal(result.toggles.adjust, true);
    assert.equal(excluded(result), before, `excluded settings changed for target ${index}`);
  }
  assert.equal(JSON.stringify(source), sourceBytes);
});

test('5000 targets use one bounded worker and preserve target recipes', async () => {
  const batch = journal(5000);
  const tx = transport(batch);
  let updates = 0;
  const result = await drain(clone(batch), tx.api, () => { updates++; }, () => false);
  assert.equal(tx.maximum, 1);
  assert.equal(tx.calls.length, 5000);
  assert.equal(new Set(tx.calls).size, 5000);
  assert.equal(updates, 5000);
  assert.equal(result.items.filter(i => i.status === 'applied').length, 5000);
  result.items.forEach((item, index) => assert.equal(item.recipe.sliders['adj-exp'], index));
});

test('failed writes do not stop subsequent targets and retry schedules only failures', async () => {
  const batch = journal(6);
  const failures = new Set([1, 4]);
  const tx = transport(batch, failures);
  const first = await drain(clone(batch), tx.api, () => {}, () => false);
  assert.deepEqual(first.items.filter(i => i.status === 'failed').map(i => i.index), [1, 4]);
  assert.equal(first.items.filter(i => i.status === 'applied').length, 4);
  batch.items.filter(i => i.status === 'failed').forEach(i => { i.status = 'pending'; i.error = null; });
  batch.status = 'running'; failures.clear();
  await drain(clone(batch), tx.api, () => {}, () => false);
  assert.deepEqual(tx.calls, [0, 1, 2, 3, 4, 5, 1, 4]);
  assert.equal(batch.items.filter(i => i.status === 'applied').length, 6);
});

test('cancellation stops scheduling and a reopened journal resumes pending targets only', async () => {
  const batch = journal(8);
  const tx = transport(batch);
  let stop = false;
  await drain(clone(batch), tx.api, () => { if (tx.calls.length === 3) stop = true; }, () => stop);
  assert.deepEqual(tx.calls, [0, 1, 2]);
  const reopened = clone(batch);
  await drain(reopened, tx.api, () => {}, () => false);
  assert.deepEqual(tx.calls, [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('unreadable failure journal aborts rather than guessing progress', async () => {
  const batch = journal(2);
  const calls = [];
  await assert.rejects(drain(batch, async command => { calls.push(command); throw new Error('catalog unavailable'); }, () => {}, () => false), /catalog unavailable/);
  assert.deepEqual(calls, ['recipe_batch_apply_item', 'recipe_batch_get']);
});



test('an IPC error after a committed write uses the journal and never repeats that write', async () => {
  const batch = journal(3);
  const tx = transport(batch);
  let interrupted = false;
  const result = await drain(clone(batch), async (command, args) => {
    const response = await tx.api(command, args);
    if (command === 'recipe_batch_apply_item' && args.index === 0 && !interrupted) {
      interrupted = true;
      throw new Error('IPC response lost');
    }
    return response;
  }, () => {}, () => false);
  assert.deepEqual(tx.calls, [0, 1, 2]);
  assert.equal(result.items.filter(i => i.status === 'applied').length, 3);
});

test('a cancelled journal schedules no work', async () => {
  const batch = journal(2);
  batch.status = 'cancelled';
  const tx = transport(batch);
  await drain(clone(batch), tx.api, () => {}, () => false);
  assert.deepEqual(tx.calls, []);
});

