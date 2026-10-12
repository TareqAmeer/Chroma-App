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
const screenshotPath = process.env.CULL_GEOMETRY_BATCH_SCREENSHOT || 'docs/validation/chr193/geometry-batch-native.png';
const darkDialogOnly = process.env.CULL_GEOMETRY_BATCH_DARK_DIALOG === '1';
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
  await page.setViewportSize({ width: 1366, height: 768 });
  const runtime = await page.evaluate(() => ({ build: BUILD, url: location.href,
    tauriInvoke: !!window.__TAURI__?.core?.invoke, theme: localStorage.getItem('csTheme') || getComputedStyle(document.body).color,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio } }));
  assert(runtime.tauriInvoke, 'Expected the actual Tauri WebView, not a browser test page');
  assert.equal(runtime.build, expectedBuild, 'Native app build does not match the expected candidate');
  assert.deepEqual({ width: runtime.viewport.width, height: runtime.viewport.height }, { width: 1366, height: 768 }, 'native CSS viewport must be 1366x768');
  report.runtime = runtime;
  if (darkDialogOnly) {
    const available = await page.evaluate(() => Array.isArray(fxImages) && fxImages.map(item => item.name));
    assert.deepEqual(available, ['chart', 'portrait', 'panorama'], 'dark dialog check must reuse the already loaded PNG-only task batch');
    await page.evaluate(() => fxSetTheme('dark'));
    assert.equal(await page.evaluate(() => document.body.classList.contains('light')), false, 'dark theme must be active');
    await page.locator('#btn-geom-apply-all').click();
    const dialog = await page.evaluate(() => {
      const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      const dlg = document.querySelector('#fx-confirm-modal');
      const cancel = dlg?.querySelector('#fx-confirm-cancel'), apply = dlg?.querySelector('#fx-confirm-ok');
      const visible = el => !!el && getComputedStyle(el).visibility !== 'hidden' && rect(el).width > 0 && rect(el).height > 0;
      return { open: !!dlg?.open, message: dlg?.querySelector('#fx-confirm-msg')?.textContent || '',
        cancelText: cancel?.textContent.trim(), applyText: apply?.textContent.trim(),
        dialog: dlg ? rect(dlg) : null, messageBounds: rect(dlg?.querySelector('#fx-confirm-msg')),
        cancelBounds: rect(cancel), applyBounds: rect(apply), visible: { dialog: visible(dlg), message: visible(dlg?.querySelector('#fx-confirm-msg')), cancel: visible(cancel), apply: visible(apply) },
        darkBackground: getComputedStyle(dlg).backgroundColor, darkText: getComputedStyle(dlg).color,
        theme: document.body.classList.contains('light') ? 'light' : 'dark',
        viewport: { width: innerWidth, height: innerHeight } };
    });
    assert(dialog.open && Object.values(dialog.visible).every(Boolean), `counted geometry dialog controls must be visible in dark theme: ${JSON.stringify(dialog)}`);
    assert.match(dialog.message, /chart/); assert.match(dialog.message, /portrait, panorama/);
    assert.equal(dialog.applyText, 'Apply to 2 photos');
    for (const [name, bounds] of Object.entries({ dialog: dialog.dialog, cancel: dialog.cancelBounds, apply: dialog.applyBounds })) {
      assert(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= dialog.viewport.width && bounds.bottom <= dialog.viewport.height,
        `${name} must remain within the 1366x768 viewport: ${JSON.stringify(bounds)}`);
    }
    assert.notEqual(dialog.darkBackground, 'rgba(0, 0, 0, 0)');
    assert.notEqual(dialog.darkBackground, dialog.darkText, 'dark dialog text and surface must remain distinguishable');
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath });
    report.darkDialog = dialog;
    report.screenshot = screenshotPath;
    await page.locator('#fx-confirm-cancel').click();
  } else {
    await loadGeometryFixtures(page, root);
    report.behavior = await exerciseGeometryBatch(page, { onConfirmDialog: async () => {
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath });
    } });
    report.screenshot = screenshotPath;
  }
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
