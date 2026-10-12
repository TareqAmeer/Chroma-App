// CHR-200 native integration check for durable RAW review preparation jobs.
// This attaches to an already launched, isolated Tauri app; it never starts/closes the app.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile, mkdir, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

const rawPath = process.env.CULL_RAW_PATH;
const expectedSha = process.env.CULL_RAW_SHA256 || 'e54a6c4264bf685214f538036fd9d39088e510b2bfedf288e568f0db1897880e';
const expectedBuild = process.env.CULL_EXPECTED_BUILD;
const sourceCommit = process.env.CULL_NATIVE_COMMIT;
const catalogDir = process.env.CULL_NATIVE_CATALOG_DIR;
const cacheDir = process.env.CULL_NATIVE_CACHE_DIR;
assert(rawPath && /\.(nef|cr3|arw|raf|rw2|dng)$/i.test(rawPath), 'Set CULL_RAW_PATH to a real camera RAW fixture');
assert(expectedBuild && /^[a-f0-9]{40}$/.test(sourceCommit || ''), 'Set exact CULL_EXPECTED_BUILD and CULL_NATIVE_COMMIT');
assert(catalogDir && cacheDir, 'Set task-owned CULL_NATIVE_CATALOG_DIR and CULL_NATIVE_CACHE_DIR');
const rawBytes = await readFile(rawPath);
const sha256 = createHash('sha256').update(rawBytes).digest('hex');
assert.equal(sha256, expectedSha.toLowerCase(), 'RAW fixture checksum mismatch');
const fixtureStat = await stat(rawPath);

function jpegSize(buffer) {
  assert(buffer[0] === 0xff && buffer[1] === 0xd8, 'display proxy is not a JPEG');
  let i = 2;
  while (i + 4 <= buffer.length) {
    if (buffer[i++] !== 0xff) continue;
    while (buffer[i] === 0xff) i++;
    const marker = buffer[i++];
    if (marker === 0xd9 || marker === 0xda) break;
    const len = buffer.readUInt16BE(i); if (len < 2 || i + len > buffer.length) break;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(i + 3), width: buffer.readUInt16BE(i + 5) };
    }
    i += len;
  }
  throw new Error('JPEG frame dimensions not found');
}
const now = Date.now();
const unique = `${now}-${process.pid}`;
const recipeKey = `raw-review-jobs-native:${sha256.slice(0,16)}:${unique}`;
const pendingRecipeKey = `${recipeKey}:uncached`;
const settings = { recipeKey, profile: '', rawNr: 'off', cacheNr: 'off', autoLens: false,
  demosaicAlgo: '', lensOverride: '', lensOverrideFocal: 0, fullCleanup: false };
const pendingSettings = { ...settings, recipeKey: pendingRecipeKey };
const endpoint = process.env.NATIVE_CDP || 'http://127.0.0.1:9223';
const reportPath = process.env.RAW_REVIEW_JOBS_REPORT || 'test/output/raw-review-jobs-native.json';
const report = { issue: 'CHR-200', capturedAt: new Date().toISOString(), sourceCommit, expectedBuild,
  fixture: { path: rawPath, sha256, bytes: fixtureStat.size, decodedSize: null },
  isolation: { catalogDir, cacheDir, endpoint }, hardware: { platform: os.platform(), release: os.release(), cpu: os.cpus()[0]?.model },
  stages: [], result: 'RUNNING' };
const stamp = name => report.stages.push({ name, at: new Date().toISOString() });
const save = async () => { await mkdir(path.dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2)); };
const resolvedInside = (root, candidate) => {
  const rel = path.relative(root, candidate);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};
const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = browser.contexts()[0].pages().find(p => !p.url().includes('devtools'));
  assert(page, 'Native WebView page missing');
  const runtime = await page.evaluate(async () => {
    if (new URL(location.href).searchParams.has('libtest') || !window.__TAURI__?.core?.invoke) throw Error('Real Tauri IPC is required');
    const catalog = await window.__TAURI__.core.invoke('catalog_query', { q: { offset: 0, limit: 8 } });
    return { build: BUILD, url: location.href, catalogTotal: catalog.total, catalogEntries: catalog.entries };
  });
  assert.equal(runtime.build, expectedBuild, 'Attached app BUILD does not match expected build');
  const catalogRows = runtime.catalogEntries || [];
  const norm = value => String(value || '').replaceAll('\\', '/').toLowerCase();
  assert(runtime.catalogTotal === 0 || (runtime.catalogTotal === 1 && catalogRows.length === 1 && norm(catalogRows[0].path) === norm(rawPath)),
    'Refuse to exercise the isolated job journal against any catalog other than empty or the single fixture source');
  report.runtime = runtime;
  const invoke = (command, args = {}) => page.evaluate(([cmd, a]) => window.__TAURI__.core.invoke(cmd, a), [command, args]);

  stamp('camera-peek');
  const camera = await invoke('peek_raw_camera_path', { path: rawPath });
  report.fixture.camera = { make: camera.make || '', model: camera.model || '' };
  stamp('journal-create');
  const created = await invoke('raw_review_jobs_create', { label: 'Native RAW review job verification', items: [
    { path: rawPath, recipeKey, settingsJson: JSON.stringify(settings) },
  ] });
  assert.equal(created.items[0].status, 'pending');
  await invoke('raw_review_jobs_checkpoint', { id: created.id, index: 0, status: 'working' });
  stamp('display-only-native-decode-start');
  const displayPath = await invoke('cache_raw_decode', { path: rawPath, recipeKey, mode: 'srgb', lutKey: '', rawNr: 'off',
    autoLens: false, demosaicAlgo: '', lensOverride: '', lensOverrideFocal: 0, displayOnly: true });
  stamp('display-only-native-decode-complete');
  const displayBytes = await readFile(displayPath);
  const dimensions = jpegSize(displayBytes);
  report.fixture.decodedSize = dimensions;
  assert(Math.max(dimensions.width, dimensions.height) <= 2560, 'display proxy exceeds 2560 px');
  assert(Math.abs(dimensions.width / dimensions.height - 8256 / 5504) < 0.01, 'display proxy aspect ratio changed');
  assert(displayBytes.length > 0);
  await assert.rejects(invoke('get_decode_cache_path', { path: rawPath, recipeKey }), 'display-only branch must not write full-resolution decode cache');
  await assert.rejects(invoke('get_cached_raw_decode', { path: rawPath, recipeKey }), 'display-only branch must not populate RAW_EDITOR_CACHE');
  await invoke('raw_review_jobs_checkpoint', { id: created.id, index: 0, status: 'completed' });
  report.displayProxy = { path: displayPath, bytes: displayBytes.length, width: dimensions.width, height: dimensions.height };
  stamp('cancel-after-checkpoint');
  const cancelled = await invoke('raw_review_jobs_cancel', { id: created.id });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.items[0].status, 'completed', 'completed proxy survives cancellation');

  stamp('resume-then-renderer-recovery');
  let resumed = await invoke('raw_review_jobs_resume', { id: created.id, expectedRecipeKeys: [{ index: 0, recipeKey }] });
  assert.equal(resumed.items[0].status, 'completed', 'existing exact prepared proxy is retained on resume');
  // Leave the native job running and reload only the renderer. On startup the real frontend
  // recovery path must mark it interrupted and publish its Jobs-history resume row.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(expected => window.BUILD === expected && !!window.__TAURI__?.core?.invoke, expectedBuild, { timeout: 30000 });
  const historyButton = `[data-job-raw-resume-id="raw-review-job-${created.id}"]`;
  await page.waitForFunction(sel => {
    const button = document.querySelector(sel);
    const row = button?.closest('[data-job-history-id]');
    return !!button && /interrupted/i.test(row?.innerText || '');
  }, historyButton, { timeout: 30000 });
  const recovered = await invoke('raw_review_jobs_get', { id: created.id });
  assert.equal(recovered.status, 'interrupted', 'frontend startup recovery interrupted the prior running job');
  assert.equal(recovered.items[0].status, 'completed', 'renderer recovery preserved the prepared proxy');
  stamp('renderer-recovery-visible');
  report.rendererRestart = { kind: 'reload', nativeProcessRestarted: false, historyButton: true, recoveredStatus: recovered.status };

  resumed = await invoke('raw_review_jobs_resume', { id: created.id, expectedRecipeKeys: [{ index: 0, recipeKey }] });
  assert.equal(resumed.items[0].status, 'completed', 'resume after renderer recovery keeps exact prepared proxy');
  await invoke('raw_review_jobs_interrupt', { id: created.id });

  stamp('evict-exact-created-proxy-and-resume-pending');
  const cacheRoot = await realpath(cacheDir);
  const proxyPath = await invoke('get_display_decode_cache_path', { path: rawPath, recipeKey, longEdge: 2560 });
  assert.equal(path.resolve(proxyPath), path.resolve(displayPath), 'journal and native cache identify the same prepared proxy');
  const realProxy = await realpath(proxyPath);
  assert(resolvedInside(cacheRoot, realProxy), 'refuse to remove a proxy outside the task-owned cache directory');
  await rm(realProxy, { force: false });
  const pending = await invoke('raw_review_jobs_resume', { id: created.id, expectedRecipeKeys: [{ index: 0, recipeKey }] });
  assert.equal(pending.items[0].status, 'pending', 'evicted exact proxy makes the prior completed item pending');
  await invoke('raw_review_jobs_interrupt', { id: created.id });
  const check = await invoke('raw_review_jobs_resume', { id: created.id, expectedRecipeKeys: [{ index: 0, recipeKey: `${recipeKey}:changed` }] });
  assert.equal(check.items[0].status, 'failed', 'changed settings cannot reuse stale proxy');
  assert.match(check.items[0].error || '', /settings changed/i);
  await invoke('raw_review_jobs_interrupt', { id: created.id });
  report.jobs = { preparedId: created.id, exactResumeStatus: resumed.items[0].status,
    evictedProxyStatus: pending.items[0].status, changedRecipeStatus: check.items[0].status };
  report.result = 'PASS';
  stamp('complete');
  await save();
  console.log(JSON.stringify({ result: report.result, displayProxy: report.displayProxy, jobs: report.jobs, report: reportPath }));
} catch (error) {
  report.result = 'FAIL'; report.error = String(error.stack || error);
  await save(); throw error;
} finally {
  // Playwright CDP close only disconnects this helper; do not close/restart the native app.
  await browser.close();
}
