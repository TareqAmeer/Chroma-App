import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../desktop/library-ui.js', import.meta.url), 'utf8');
const helpers = source.split('// BEGIN RAW_REVIEW_JOB_HELPERS')[1]?.split('// END RAW_REVIEW_JOB_HELPERS')[0];
assert.ok(helpers, 'production RAW review journal helpers must have extraction markers');

const settingsByPath = new Map([
  ['/raw/A.NEF', { recipeKey: 'recipe-a', rawNr: 'off', demosaicAlgo: 'ahd' }],
  ['/raw/B.NEF', { recipeKey: 'recipe-b', rawNr: 'high', demosaicAlgo: 'amaze' }],
  ['/raw/C.NEF', { recipeKey: 'recipe-c', rawNr: 'medium', demosaicAlgo: 'vng' }],
]);
function harness({ savedJob = null, recoveryJobs = [], deferred = false } = {}) {
  const calls = [], launches = [], cacheResults = new Map();
  const activity = new Map(), history = [], toasts = [];
  let releaseDecode;
  const invoke = async (command, args = {}) => {
    calls.push({ command, args: structuredClone(args) });
    if (command === 'raw_review_jobs_create') return { id: 41, label: args.label, items: args.items.map((x, index) => ({ ...x, index, status: 'pending' })) };
    if (command === 'raw_review_jobs_get') return structuredClone(savedJob);
    if (command === 'raw_review_jobs_resume') {
      const expected = args.expectedRecipeKeys;
      const items = structuredClone(savedJob.items).map(item => {
        const key = expected.find(x => x.index === item.index)?.recipeKey;
        if (key !== item.recipeKey) return { ...item, status: 'failed', error: 'RAW review settings changed' };
        if (cacheResults.get(item.path) === 'hit') return { ...item, status: 'completed' };
        return { ...item, status: 'pending' };
      });
      return { ...structuredClone(savedJob), status: 'running', items };
    }
    if (command === 'raw_review_jobs_list') return structuredClone(recoveryJobs);
    if (command === 'raw_review_jobs_interrupt' || command === 'raw_review_jobs_cancel' || command === 'raw_review_jobs_finish') return { id: args.id, status: command.endsWith('interrupt') ? 'interrupted' : command.endsWith('cancel') ? 'cancelled' : 'completed' };
    if (command === 'raw_review_jobs_checkpoint') return { id: args.id, index: args.index, status: args.status };
    throw new Error(`unexpected IPC: ${command}`);
  };
  const context = vm.createContext({
    LIBTEST: false, ACTIVITY_HISTORY_LIMIT: 80, RAW_EXT_RE: /\.(nef|rw2|dng)$/i,
    Date, JSON, Promise, Set, Map, Error, structuredClone,
    invoke,
    rawReviewQueue: [],
    rawCacheSettings: async path => structuredClone(settingsByPath.get(path)),
    queueRawReview: async (path, load, kind, ownerJobId) => {
      launches.push({ path, kind, ownerJobId });
      if (deferred && launches.length === 1) return new Promise((resolve, reject) => {
        const work = Promise.resolve().then(load);
        // Native decode has already been dispatched; cancellation must let it complete.
        releaseDecode = async () => { try { resolve(await work); } catch (e) { reject(e); } };
      });
      return load();
    },
    cacheOneRaw: async (path, mode, settings) => {
      assert.equal(mode, 'review');
      assert.deepEqual(JSON.parse(JSON.stringify(settings)), settingsByPath.get(path), `captured settings for ${path} are used unchanged`);
      return { path };
    },
    baseName: path => path.split(/[\\/]/).at(-1), humanizeErr: (_action, e) => String(e), toast: msg => toasts.push(msg),
    activityUpdate: (job, patch) => { activity.set(job, { ...activity.get(job), ...patch }); },
    clearActiveActivity() {}, recordActivityHistory: row => history.push(structuredClone(row)), renderActivity() {},
  });
  const boot = `let _rawReviewPrep=null; let _rawReviewRecovery=null; const LIBTEST=false;\n${helpers}\nglobalThis.api={prepareRawReviewPreviews,recoverRawReviewJobs};`;
  vm.runInContext(boot, context);
  return { api: context.api, calls, launches, activity, history, toasts, cacheResults, release: () => releaseDecode?.() };
}

test('new prep snapshots per-source settings, checkpoints completion, and cancellation preserves active decode', async () => {
  const h = harness({ deferred: true });
  const running = h.api.prepareRawReviewPreviews(['/raw/A.NEF', '/raw/B.NEF']);
  for (let i = 0; i < 30 && !h.calls.some(c => c.command === 'raw_review_jobs_create'); i++) await new Promise(r => setImmediate(r));
  const create = h.calls.find(c => c.command === 'raw_review_jobs_create');
  assert.deepEqual(create.args.items.map(x => [x.path, x.recipeKey, JSON.parse(x.settingsJson).rawNr]), [
    ['/raw/A.NEF', 'recipe-a', 'off'], ['/raw/B.NEF', 'recipe-b', 'high'],
  ]);
  for (let i = 0; i < 30 && !h.calls.some(c => c.command === 'raw_review_jobs_checkpoint' && c.args.status === 'working'); i++) await new Promise(r => setImmediate(r));
  const working = h.calls.find(c => c.command === 'raw_review_jobs_checkpoint' && c.args.status === 'working');
  assert.equal(working.args.index, 0);
  const cancel = h.activity.get('raw-review-prep')?.cancelFn;
  assert.equal(typeof cancel, 'function');
  cancel();
  await h.release();
  await running;
  assert.ok(h.calls.some(c => c.command === 'raw_review_jobs_checkpoint' && c.args.index === 0 && c.args.status === 'completed'), 'finished active decode is journaled as completed before cancellation');
  assert.ok(h.calls.some(c => c.command === 'raw_review_jobs_cancel' && c.args.id === 41));
  assert.equal(h.launches.length, 1, 'cancellation does not launch the next source');
});

test('restart records interrupted history; explicit resume revalidates settings and cached completions', async () => {
  const savedJob = { id: 7, label: 'prior prep', status: 'interrupted', items: [
    { index: 0, path: '/raw/A.NEF', recipeKey: 'recipe-a', settingsJson: JSON.stringify(settingsByPath.get('/raw/A.NEF')), status: 'pending' },
    { index: 1, path: '/raw/B.NEF', recipeKey: 'old-recipe', settingsJson: JSON.stringify({ recipeKey: 'old-recipe', rawNr: 'low' }), status: 'pending' },
    { index: 2, path: '/raw/C.NEF', recipeKey: 'recipe-c', settingsJson: JSON.stringify(settingsByPath.get('/raw/C.NEF')), status: 'pending' },
  ] };
  const h = harness({ savedJob, recoveryJobs: [{ id: 7, label: 'prior prep', status: 'running', completed: 1, total: 2, failed: 0, updatedAt: 123 }] });
  await h.api.recoverRawReviewJobs();
  assert.ok(h.calls.some(c => c.command === 'raw_review_jobs_interrupt' && c.args.id === 7));
  assert.equal(h.history[0].outcome, 'interrupted');
  h.calls.length = 0;
  h.launches.length = 0;
  // A matching cached proxy is skipped; a settings mismatch is rejected; an evicted match is retried.
  h.cacheResults.set('/raw/A.NEF', 'hit');
  const resume = h.api.prepareRawReviewPreviews([], 7);
  await resume;
  const request = h.calls.find(c => c.command === 'raw_review_jobs_resume');
  assert.deepEqual(request.args.expectedRecipeKeys, [{ index: 0, recipeKey: 'recipe-a' }, { index: 1, recipeKey: 'recipe-b' }, { index: 2, recipeKey: 'recipe-c' }]);
  assert.deepEqual(h.launches.map(x => x.path), ['/raw/C.NEF'], 'changed recipe is rejected and an evicted matching cache entry is prepared again');
  assert.ok(!h.calls.some(c => c.command === 'raw_review_jobs_checkpoint' && c.args.index === 0), 'verified cache hit is not redundantly decoded');
  assert.ok(h.calls.some(c => c.command === 'raw_review_jobs_checkpoint' && c.args.index === 2 && c.args.status === 'completed'));
});
