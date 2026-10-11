// CHR-194: an older sidecar completion must not mark a newer edit as saved.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
    const sourcePath = pathname === 'desktop/dist/library-ui.js' ? 'desktop/library-ui.js' : pathname;
    const body = await readFile(path.join(root, sourcePath));
    const type = sourcePath.endsWith('.html') ? 'text/html' : /\.(?:m?js)$/.test(sourcePath) ? 'text/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));

const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('chromasmith-tour-seen-v1', '1'));
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=3`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.__libOpenFolder === 'function', { timeout: 30000 });
  await page.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });
  await page.evaluate(() => window.__libOpenFolder('/test/Photos'));
  await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length >= 2, { timeout: 30000 });
  await page.locator('#lib-grid .lib-card').first().dblclick();
  await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length && window.chromasmithFlushPendingSave, { timeout: 30000 });
  await page.waitForFunction(() => window.chromasmithGetOpenedPaths?.().length > 0, { timeout: 30000 });

  await page.evaluate(() => {
    window.__libtestDelayNextSidecarWrite();
    window.chromasmithOnEdit(getUISnapshot());
    window.__firstSaveFlush = window.chromasmithFlushPendingSave();
  });
  await page.waitForFunction(() => window.__libtestSidecarWriteStarted, { timeout: 10000 });
  assert.match(await page.locator('#cs-save-state').innerText(), /Saving…/, 'the top-area state names an in-flight sidecar write');
  await page.evaluate(() => window.chromasmithOnEdit(getUISnapshot()));
  assert.match(await page.locator('#cs-save-state').innerText(), /Edited/);
  await page.evaluate(() => window.__libtestSidecarWriteRelease());
  await page.evaluate(async () => await window.__firstSaveFlush);
  assert.match(await page.locator('#cs-save-state').innerText(), /Edited/, 'older write must leave the newer edit visibly pending');

  await page.evaluate(async () => await window.chromasmithFlushPendingSave());
  assert.match(await page.locator('#cs-save-state').innerText(), /Saved locally/, 'only the newest completed sidecar write may report Saved locally');

  await page.evaluate(() => {
    window.__libtestFailNextSidecarWrite();
    window.chromasmithOnEdit(getUISnapshot());
    window.__failedSaveFlush = window.chromasmithFlushPendingSave();
  });
  await page.evaluate(async () => await window.__failedSaveFlush);
  const saveState = page.locator('#cs-save-state');
  assert.match(await saveState.innerText(), /Couldn't save edit/, 'failed persistence is visible as an error, never Saved');
  assert.equal(await saveState.evaluate(el => !!el.closest('#fx-deskbar-title')), true, 'persistence state sits beside the photo identity');
  const retry = saveState.getByRole('button', { name: 'Retry' });
  assert.equal(await retry.count(), 1, 'failed persistence exposes an actionable retry');
  await page.evaluate(() => document.querySelector('#cs-save-state button')?.click());
  await page.waitForFunction(() => /Saved locally/.test(document.getElementById('cs-save-state')?.innerText || ''));
  assert.equal(await saveState.getByRole('button', { name: 'Retry' }).count(), 0, 'successful retry clears the recovery action');
  const openedPath = await page.evaluate(() => window.chromasmithGetOpenedPaths()[0]);
  assert.equal((await page.evaluate(path => window.__libtestReadSidecar(path), openedPath)).edited, true, 'retry persists the edit sidecar');
  console.log('PASS delayed stale save preserves pending edits, and failed sidecar write offers a successful retry');
} finally {
  await browser.close();
  server.close();
}
