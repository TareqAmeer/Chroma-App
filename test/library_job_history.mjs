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
  const result = vm.runInNewContext(`(() => { ${helpers}\nreturn { activityIdentity, activityTerminalPatch, activityHistory, recordActivityHistory, persistActiveActivity, clearActiveActivity, normalizeCatalogRecovery, catalogRootIdentity, catalogRecoveryExecutionPlan, catalogRecoveryForRetry, runCatalogPhasePlan, catalogBackgroundStartupActions, catalogPhaseNames }; })()`, { localStorage: storage, Date });
  return { ...result, persisted: () => JSON.parse(values.get('chromasmith-job-history-v1')), active: () => JSON.parse(values.get('chromasmith-active-jobs-v1')) };
}

test('same-kind jobs remain distinct when callers provide stable identities', () => {
  const history = createHistory();
  assert.equal(history.activityIdentity('export', { jobId: 'export-a' }), 'export-a');
  assert.equal(history.activityIdentity('export', { jobId: 'export-b' }), 'export-b');
  assert.equal(history.activityIdentity('export', {}), 'export');
});

test('catalog recovery stores a versioned phase plan and rejects incomplete source identity', () => {
  const history = createHistory();
  const generation = '1791668450123456789';
  const recovery = history.normalizeCatalogRecovery(JSON.parse(JSON.stringify({ version: 1, roots: [{ id: 2, added: '1791668450123456790', volume: 'uuid-b', path: '/Photos/B' }, { id: 1, added: generation, volume: 'uuid-a', path: '/Photos/A' }], requestedPhases: ['stack', 'hash', 'faces'], completedPhases: ['hash'] })));
  assert.deepEqual([...recovery.roots.map(root => [root.id, root.added, root.volume, root.path])], [[1, generation, 'uuid-a', '/Photos/A'], [2, '1791668450123456790', 'uuid-b', '/Photos/B']]);
  assert.deepEqual([...recovery.requestedPhases], ['stack', 'hash', 'faces']);
  assert.deepEqual([...recovery.completedPhases], ['hash']);
  assert.equal(history.normalizeCatalogRecovery({ version: 1, roots: [], requestedPhases: ['hash'], completedPhases: [] }), null);
  assert.equal(history.normalizeCatalogRecovery({ version: 1, roots: [{ id: 1, added: Number(generation), volume: 'uuid-a', path: '/Photos/A' }], requestedPhases: ['hash'], completedPhases: [] }), null, 'unsafe JSON numbers are rejected instead of rounded');
  assert.equal(history.normalizeCatalogRecovery({ version: 2, roots: [{ id: 1, added: '1', volume: 'uuid', path: '/Photos' }], requestedPhases: ['hash'], completedPhases: [] }), null);
  assert.deepEqual([...history.catalogRootIdentity([{ id: 2, added: '2', volume: 'uuid-b', path: '/Photos/B/' }, { id: 1, added: '1', volume: 'uuid-a', path: '/Photos/A' }, { id: 2, added: '2', volume: 'uuid-b', path: '/Photos/B' }]).map(root => [root.id, root.added, root.volume, root.path])], [[1, '1', 'uuid-a', '/Photos/A'], [2, '2', 'uuid-b', '/Photos/B']]);
  const removedAndReadded = history.catalogRootIdentity([{ id: 1, added: '1791668450999999999', volume: 'uuid-a', path: '/Photos/A' }]);
  assert.notDeepEqual([...removedAndReadded], [...recovery.roots.slice(0, 1)], 'same path and recycled root ID cannot match a new registration generation');
  history.persistActiveActivity({ jobId: 'index-a', kind: 'catalog', label: 'Indexing library', recovery });
  assert.deepEqual([...history.active()[0].recovery.roots.map(root => root.path)], ['/Photos/A', '/Photos/B']);
  assert.match(source, /JSON\.stringify\(current\) !== JSON\.stringify\(recovery\.roots\)/, 'resume must fail closed when registered roots changed');
  assert.match(source, /data-job-index-resume-id=/, 'saved recoverable jobs are resumed from the existing history panel');
});

test('fresh indexing executes the complete phase order; explicit retry runs supported pending phases only', async () => {
  const history = createHistory();
  const recovery = history.normalizeCatalogRecovery({ version: 1, roots: [{ id: 1, added: '1791668450123456789', volume: 'uuid', path: '/Photos' }], requestedPhases: ['stack', 'thumbnails', 'focus', 'hash', 'faces', 'embed', 'cluster', 'clip', 'autotag', 'pets'], completedPhases: ['hash', 'faces'] });
  assert.deepEqual([...history.catalogRecoveryExecutionPlan(false, recovery)], ['stack', 'thumbnails', 'focus', 'hash', 'faces', 'embed', 'cluster', 'clip', 'autotag', 'pets']);
  assert.deepEqual([...history.catalogRecoveryExecutionPlan(true, recovery)], ['hash', 'faces', 'embed', 'clip', 'pets'], 'native markers are rechecked even for phases marked complete so changed sources are detected');
  const retryRecovery = history.catalogRecoveryForRetry(recovery);
  assert.deepEqual([...retryRecovery.completedPhases], [], 'historical completion hints cannot make a capped stale retry appear exhausted');
  const calls = [];
  const handlers = Object.fromEntries(history.catalogRecoveryExecutionPlan(false, recovery).map(phase => [phase, async () => calls.push(phase)]));
  await history.runCatalogPhasePlan(history.catalogRecoveryExecutionPlan(false, recovery), handlers, async () => true, () => {}, () => {});
  assert.deepEqual(calls, ['stack', 'thumbnails', 'focus', 'hash', 'faces', 'embed', 'cluster', 'clip', 'autotag', 'pets']);
  const retryCalls = [];
  const retryHandlers = Object.fromEntries(history.catalogRecoveryExecutionPlan(true, retryRecovery).map(phase => [phase, async () => { retryCalls.push(phase); return phase !== 'pets'; }]));
  const completed = [];
  await history.runCatalogPhasePlan(history.catalogRecoveryExecutionPlan(true, retryRecovery), retryHandlers, async () => true, () => {}, (phase, exhausted) => { if (exhausted === true) completed.push(phase); });
  assert.deepEqual(retryCalls, ['hash', 'faces', 'embed', 'clip', 'pets']);
  assert.deepEqual(completed, ['hash', 'faces', 'embed', 'clip'], 'batch-capped pets remains pending until an explicit exhausted result');
  assert.match(source, /const unsupported = isRecoveryRun \? _catalogActiveRecovery\.requestedPhases\.filter/);
  assert.match(source, /_catalogRecoveryChecking/);
});

test('phase orchestration stops on cancellation or failed source revalidation before dispatch', async () => {
  const history = createHistory();
  const calls = [];
  const phases = ['hash', 'faces', 'embed'];
  const handlers = Object.fromEntries(phases.map(phase => [phase, async () => { calls.push(phase); }]));
  await history.runCatalogPhasePlan(phases, handlers, async phase => phase !== 'faces', () => {}, () => {});
  assert.deepEqual(calls, ['hash'], 'cancellation between phases leaves later phases undispatched');
  calls.length = 0;
  await history.runCatalogPhasePlan(phases, handlers, async () => false, () => {}, () => {});
  assert.deepEqual(calls, [], 'root identity mismatch before the first phase prevents all dispatch');
});

test('paused normal startup still schedules stored-vector backfill without starting heavy phases', () => {
  const history = createHistory();
  assert.deepEqual({ ...history.catalogBackgroundStartupActions(false, true, false) }, { backfill: true, startHeavy: false });
  assert.deepEqual({ ...history.catalogBackgroundStartupActions(false, false, true) }, { backfill: true, startHeavy: false });
  assert.deepEqual({ ...history.catalogBackgroundStartupActions(true, true, false) }, { backfill: false, startHeavy: false }, 'explicit recovery does not run an unrelated backfill');
  assert.match(source, /if \(startup\.backfill\) catalogAutoTagBackfill\(\)/);
  assert.match(source, /!startup\.startHeavy/);
});

test('recovery phase details use friendly names and saved detail is rendered in history', () => {
  const history = createHistory();
  assert.equal(history.catalogPhaseNames(['stack', 'embed', 'autotag']), 'photo grouping, face embeddings, automatic tags');
  history.recordActivityHistory({ jobId: 'partial', kind: 'catalog', label: 'Indexing library', stage: 'done', outcome: 'partial', current: 'A normal library scan is still needed for photo grouping' });
  assert.equal(history.persisted()[0].detail, 'A normal library scan is still needed for photo grouping');
  assert.match(source, /row\.detail \? `<div class="lib-act-history-detail"/);
});

test('confirmed failures and cancellations become terminal outcomes; a stall is not a failure', () => {
  const history = createHistory();
  assert.deepEqual({ ...history.activityTerminalPatch({ stage: 'failed' }) }, { outcome: 'failed', stage: 'done' });
  assert.deepEqual({ ...history.activityTerminalPatch({ stage: 'cancelled' }) }, { outcome: 'cancelled', stage: 'done' });
  assert.deepEqual({ ...history.activityTerminalPatch({ stage: 'working' }) }, { stage: 'working' });
  assert.equal(history.activityTerminalPatch({ stage: 'working' }).outcome, undefined);
  history.recordActivityHistory({jobId:'cancel-test',kind:'export',stage:'done',outcome:'cancelled'});
  assert.equal(history.persisted()[0].status,'Cancelled');
});

test('history persists, deduplicates job IDs, classifies partial failures, and caps retention', () => {
  const history = createHistory();
  history.recordActivityHistory({ kind: 'recipe-batch-1', jobId: 'recipe-batch-1', batchId: 1, label: 'Recipe batch', stage: 'done', failed: ['a.jpg: conflict'], done: 4, total: 5 });
  history.recordActivityHistory({ kind: 'catalog', jobId: 'scan-1', label: 'Library scan', stage: 'done', outcome: 'interrupted', done: 2, total: 9 });
  history.recordActivityHistory({ kind: 'export', jobId: 'export-1', label: 'Export', stage: 'done', outcome: 'partial', failedCount: 1, done: 4, total: 5 });
  assert.equal(history.activityHistory[0].status, 'Partial');
  assert.equal(history.activityHistory[0].failedCount, 1);
  assert.deepEqual([...history.activityHistory[2].failedItems], ['a.jpg: conflict']);
  assert.equal(history.activityHistory[2].batchId, 1, 'retry must retain the numeric durable recipe batch ID');
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
  assert.match(source, /Failed items/);
  assert.match(source, /data-job-batch-results-id=/);
  assert.match(source, /recipeBatchResults\(row\.batchId\)/);
  assert.match(source, /invoke\('ingest_copy', \{ jobId: ingestJobId, files, options: opts \}\)/);
  assert.match(source, /invoke\('ingest_cancel', \{ jobId: ingestJobId \}\)/);
  assert.match(source, /completed files remain in the destination/);
  assert.match(editor, /outcome:activityOutcome/);
  assert.match(editor, /outcome:cancelled\|\|fxExportCancel\?'cancelled':videoExportFailed\?'failed':'completed'/);
});

const progressHelpers = source.split('// BEGIN LIBRARY_JOB_PROGRESS_HELPERS')[1]?.split('// END LIBRARY_JOB_PROGRESS_HELPERS')[0];
const progress = vm.runInNewContext(`(() => { const ACTIVITY_STALL_MS=90000; ${progressHelpers}; return {activityNoRecentProgress,activityRecoveryCopy}; })()`);
test('each job ages independently and terminal jobs never trigger a warning', () => {
  assert.equal(progress.activityNoRecentProgress({stage:'working',lastProgressAt:1},100000),true);
  assert.equal(progress.activityNoRecentProgress({stage:'working',lastProgressAt:99000},100000),false);
  assert.equal(progress.activityNoRecentProgress({stage:'done',lastProgressAt:1},100000),false);
  const history=createHistory();
  history.persistActiveActivity({jobId:'old',kind:'export',stage:'working',lastProgressAt:17});
  assert.equal(history.active()[0].lastProgressAt,17);
  assert.equal(history.persisted().length,0);
});
test('cancellation guidance explains preservation and actual restart limits',()=>{
  assert.match(progress.activityRecoveryCopy({kind:'export'}),/Restart continuation is unavailable/);
  assert.match(progress.activityRecoveryCopy({kind:'import'}),/existing files are checked for duplicates/);
  assert.match(progress.activityRecoveryCopy({kind:'catalog'}),/Cancel preserves saved hashes/);
  assert.match(progress.activityRecoveryCopy({batchId:3}),/remaining eligible photos/);
});
