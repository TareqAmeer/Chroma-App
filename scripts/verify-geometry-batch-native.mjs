// CHR-193 real-app companion: attaches to an already launched isolated native app, then drives
// the same editor/UI contract as geometry_batch_scope.mjs with three ordinary PNG fixtures.
// It never starts/stops the app, indexes a folder, or opens a RAW source.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { exerciseGeometryBatch, loadGeometryFixtures } from '../test/geometry_batch_scope.mjs';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const expectedBuild = process.env.CULL_EXPECTED_BUILD;
const expectedCommit = process.env.CULL_NATIVE_COMMIT;
const endpoint = process.env.NATIVE_CDP || 'http://127.0.0.1:9223';
const reportPath = process.env.CULL_GEOMETRY_BATCH_REPORT || 'docs/validation/chr193/geometry-batch-native.json';
const appPid = Number(process.env.CULL_NATIVE_APP_PID || 0) || null;
const catalogDir = process.env.CULL_NATIVE_CATALOG_DIR || null;
const webviewProfile = process.env.WEBVIEW2_USER_DATA_FOLDER || null;

assert(expectedBuild && /^[a-f0-9]{40}$/i.test(expectedCommit || ''), 'Set exact CULL_EXPECTED_BUILD and CULL_NATIVE_COMMIT');
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), expectedCommit, 'checkout must match the candidate commit');
const browser = await chromium.connectOverCDP(endpoint);
const report = { issue: 'CHR-193', capturedAt: new Date().toISOString(), sourceCommit: expectedCommit,
  expectedBuild, endpoint, nativeAppPid: appPid, taskCatalogDir: catalogDir, webviewProfile,
  hardware: { platform: os.platform(), release: os.release(), cpu: os.cpus()[0]?.model },
  fixtureSources: ['test/fixtures/chart.png', 'test/fixtures/portrait.png', 'test/fixtures/orientation_panorama.png'],
  nativeRawDecode: false, result: 'RUNNING' };
try {
  const page = browser.contexts()[0]?.pages().find(candidate => !candidate.url().includes('devtools'));
  assert(page, 'Native app WebView page is unavailable');
  const runtime = await page.evaluate(() => ({ build: BUILD, url: location.href,
    tauriInvoke: !!window.__TAURI__?.core?.invoke, viewport: { width: innerWidth, height: innerHeight } }));
  assert(runtime.tauriInvoke, 'Expected the actual Tauri WebView, not a browser test page');
  assert.equal(runtime.build, expectedBuild, 'Native app build does not match the expected candidate');
  report.runtime = runtime;
  await loadGeometryFixtures(page, root);
  report.behavior = await exerciseGeometryBatch(page);
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.error = String(error?.stack || error);
  throw error;
} finally {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  await browser.close().catch(() => {}); // closes the CDP client only; native app stays open
}
console.log(`CHR-193 native geometry batch PASS: ${reportPath}`);
