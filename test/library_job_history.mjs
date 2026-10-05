import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../desktop/library-ui.js', import.meta.url), 'utf8');
const editor = await readFile(new URL('../chromasmith-22.html', import.meta.url), 'utf8');
const helpers = source.split('// BEGIN LIBRARY_JOB_HISTORY_HELPERS')[1]?.split('// END LIBRARY_JOB_HISTORY_HELPERS')[0];
assert.ok(helpers, 'production library job history helpers must have extraction markers');

function createHistory(seed = '[]', activeSeed = '[]') {
  const values = new Map([['chromasmith-job-history-v1', seed], ['chromasmith-active-jobs-v1', activeSeed]]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const result = vm.runInNewContext(`(() => { ${helpers}\nreturn { activityIdentity, activityTerminalPatch, activityHistory, recordActivityHistory, persistActiveActivity, clearActiveActivity }; })()`, { localStorage: storage, Date });
  return { ...result, persisted: () => JSON.parse(values.get('chromasmith-job-history-v1')), active: () => JSON.parse(values.get('chromasmith-active-jobs-v1')) };
}

test('same-kind jobs remain distinct when callers provide stable identities', () => {
  const history = createHistory();
  assert.equal(history.activityIdentity('export', { jobId: 'export-a' }), 'export-a');
  assert.equal(history.activityIdentity('export', { jobId: 'export-b' }), 'export-b');
  assert.equal(history.activityIdentity('export', {}), 'export');
});

test('confirmed failures and cancellations become terminal outcomes; a stall is not a failure', () => {
  const history = createHistory();
  assert.deepEqual({ ...history.activityTerminalPatch({ stage: 'failed' }) }, { outcome: 'failed', stage: 'done' });
  assert.deepEqual({ ...history.activityTerminalPatch({ stage: 'cancelled' }) }, { outcome: 'interrupted', stage: 'done' });
  assert.deepEqual({ ...history.activityTerminalPatch({ stage: 'working' }) }, { stage: 'working' });
  assert.equal(history.activityTerminalPatch({ stage: 'working' }).outcome, undefined);
});

test('history persists, deduplicates job IDs, classifies partial failures, and caps retention', () => {
  const history = createHistory();
  history.recordActivityHistory({ kind: 'recipe-batch-1', jobId: 'batch-1', label: 'Recipe batch', stage: 'done', failed: ['a.jpg: conflict'], done: 4, total: 5 });
  history.recordActivityHistory({ kind: 'catalog', jobId: 'scan-1', label: 'Library scan', stage: 'done', outcome: 'interrupted', done: 2, total: 9 });
  history.recordActivityHistory({ kind: 'export', jobId: 'export-1', label: 'Export', stage: 'done', outcome: 'partial', failedCount: 1, done: 4, total: 5 });
  assert.equal(history.activityHistory[0].status, 'Partial');
  assert.equal(history.activityHistory[0].failedCount, 1);
  assert.equal(history.activityHistory[1].status, 'Interrupted');
  assert.equal(history.activityHistory[2].status, 'Failed');
  assert.equal(history.activityHistory[2].failedCount, 1);
  history.recordActivityHistory({ kind: 'catalog', jobId: 'scan-1', label: 'Library scan', stage: 'done', done: 3, total: 9 });
  assert.equal(history.activityHistory.filter(row => row.id === 'scan-1').length, 1);
  assert.equal(history.persisted().length, 3);
  for (let index = 0; index < 45; index++) history.recordActivityHistory({ kind: 'job', jobId: `job-${index}`, stage: 'done' });
  assert.equal(history.activityHistory.length, 40);
  assert.equal(history.persisted().length, 40);
});

test('renderer restart moves generic active snapshots to interrupted history without resume claims', () => {
  const history = createHistory('[]', JSON.stringify([{ id: 'export-7', kind: 'export', label: 'Exporting', done: 2, total: 5, lastProgressAt: 123 }]));
  assert.equal(history.persisted()[0].id, 'export-7');
  assert.equal(history.persisted()[0].status, 'Interrupted');
  assert.match(history.persisted()[0].detail, /recovery depends on this job type/);
  assert.deepEqual(history.active(), []);
  history.persistActiveActivity({ kind: 'export', jobId: 'export-8', label: 'Another export', done: 1, total: 3 });
  assert.equal(history.active()[0].id, 'export-8');
  history.persistActiveActivity({ kind: 'recipe-batch-8', jobId: 'batch-8', batchId: 8, label: 'Recipe batch', done: 2, total: 3 });
  assert.equal(history.active().some(row => row.id === 'batch-8'), false, 'recipe-batch has SQLite recovery');
  history.clearActiveActivity({ jobId: 'export-8' });
  assert.equal(history.active().some(row => row.id === 'export-8'), false);
});

test('history view remains mounted without a current activity and stalled copy avoids claiming failure', () => {
  assert.match(source, /if \(!activity\.visible\) \{ el\.innerHTML = renderActivityHistory\(\)/);
  assert.match(source, /No recent progress\. This is a warning, not a confirmed failure\./);
  assert.match(source, /data-job-history-id=/);
  assert.match(source, /invoke\('ingest_copy', \{ jobId: ingestJobId, files, options: opts \}\)/);
  assert.match(source, /invoke\('ingest_cancel', \{ jobId: ingestJobId \}\)/);
  assert.match(source, /completed files remain in the destination/);
  assert.match(editor, /outcome:activityOutcome/);
  assert.match(editor, /outcome:cancelled\|\|fxExportCancel\?'interrupted':videoExportFailed\?'failed':'completed'/);
});
