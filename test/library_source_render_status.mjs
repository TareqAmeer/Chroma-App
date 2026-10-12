import assert from 'node:assert/strict';
import { chromium } from 'playwright';
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
  for (const scenario of [
    { query: 'libtest=1&libn=3', source: /Original available/, render: /Full resolution ready/, offline: false, ready: true },
    { query: 'libtest=1&libn=3&libforceoffline=1&liboffqconflict=1', source: /Reduced-quality offline preview/, render: /Full resolution unavailable/, offline: true, ready: false },
    { query: 'libtest=1&libn=3&libforceoffline=1&libhqcache=1&liboffqconflict=1', source: /Offline full-quality cache/, render: /Full resolution ready/, offline: true, ready: true },
  ]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(() => {
      localStorage.setItem('chromasmith-tour-seen-v1', '1');
      window.__chr194ProbeCalls = [];
      window.__libtestCatalogInvoke = (command, args) => {
        if (command === 'read_file_head' && args.len === 0) {
          window.__chr194ProbeCalls.push({ path: args.path, available: window.__libtestOriginalAvailable ?? !/[?&]libforceoffline=1/.test(location.search) });
        }
        return null;
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?${scenario.query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => typeof window.__libOpenFolder === 'function', { timeout: 30000 });
    await page.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });
    await page.evaluate(() => window.__libOpenFolder('/test/Photos'));
    await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length >= 2, { timeout: 30000 });
    const rawCard = page.locator('#lib-grid .lib-card[data-path$=".RW2"]').first();
    if (scenario.query.includes('libhqcache=1')) {
      await page.evaluate(async () => {
        const path = document.querySelector('#lib-grid .lib-card[data-path$=".RW2"]')?.dataset.path;
        if (!path) throw new Error('HQ cache fixture needs a visible source card');
        const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR4nGNgYGD4DwABBAEAAAG6AS1ZAAAAAElFTkSuQmCC'), c => c.charCodeAt(0)).buffer;
        window.__libtestSeedHqOfflineCache(path, '/test/offline-cache/IMG_1001.jpg', bytes);
        window.__libtestPersistenceCalls = [];
      });
    } else await page.evaluate(() => { window.__libtestPersistenceCalls = []; });
    await rawCard.dblclick();
    await page.waitForFunction(() => window.chromasmithGetOpenedPaths?.().length > 0, { timeout: 30000 });
    const status = page.locator('#cs-source-render-state');
    await page.waitForFunction(() => {
      const el = document.getElementById('cs-source-render-state');
      return el && !el.hidden && !/Checking source|Loading preview/.test(el.textContent);
    }, { timeout: 30000 });
    const text = await status.innerText();
    assert.match(text, scenario.source, `source status for ${scenario.query}: ${text}`);
    assert.match(text, scenario.render, `render status for ${scenario.query}: ${text}`);
    if (scenario.offline) {
      assert.equal(await page.evaluate(() => window.chromasmithFullQualityReady), scenario.ready, 'export readiness follows the offline render tier');
      if (!scenario.ready) {
        assert.match(await status.getAttribute('title'), /reconnect the source drive and reopen/, 'offline preview gives a distinct recovery action');
      } else {
        assert.match(await status.getAttribute('title'), /full-quality offline cached copy/, 'offline HQ cache explains that the original is unavailable');
      }
      await page.evaluate(() => {
        window.chromasmithOnEdit(getUISnapshot());
        return window.chromasmithFlushPendingSave();
      });
      assert.match(await page.locator('#cs-save-state').innerText(), /Saved offline/, 'editing an offline source reports a queued save');
      const offlineMaskSave = await page.evaluate(() => window.chromasmithSaveMaskSetForCurrentPhoto([], null, fxImages[0]));
      assert.equal(offlineMaskSave.queued, true, 'offline mask-set persistence follows the original source availability');
      const offlineWrites = await page.evaluate(() => window.__libtestPersistenceCalls);
      assert.equal(offlineWrites.filter(({ command }) => command === 'queue_offline_edit').length, 2, 'offline edits and mask sets enter the reconnect queue');
      assert.equal(offlineWrites.filter(({ command }) => command === 'set_sidecar').length, 0, 'offline edits never claim a durable sidecar write');
      const offlinePath = await page.evaluate(() => window.chromasmithGetOpenedPaths()[0]);
      assert.deepEqual(offlineWrites.map(({ args }) => args.path), [offlinePath, offlinePath], 'both queued writes stay attached to the opened original photo');
      // Even an explicit apply-anyway cannot prove that the source is back: the catalog
      // mutation can succeed while the original volume remains unavailable.
      await page.evaluate(() => { window.__chr194QueueCheck = window.chromasmithCheckOfflineQueue(); });
      await page.waitForSelector('#lib-offq-modal[open]', { timeout: 10000 });
      await page.locator('#lib-offq-apply').click();
      await page.evaluate(() => window.__chr194QueueCheck);
      assert.equal(await status.getAttribute('data-source'), scenario.ready ? 'offlineCache' : 'offlinePreview', 'a queued-edit replay with a failed original-source probe stays unavailable');
      await page.evaluate(() => {
        window.chromasmithOnEdit(getUISnapshot());
        return window.chromasmithFlushPendingSave();
      });
      // Discarding a subsequent queued edit also cannot make the original available.
      await page.evaluate(() => { window.__chr194QueueCheck = window.chromasmithCheckOfflineQueue(); });
      await page.waitForSelector('#lib-offq-modal[open]', { timeout: 10000 });
      await page.locator('#lib-offq-ignore').click();
      await page.evaluate(() => window.__chr194QueueCheck);
      assert.equal(await status.getAttribute('data-source'), scenario.ready ? 'offlineCache' : 'offlinePreview', 'discarding a queued edit does not clear source unavailability');
      await page.evaluate(() => {
        window.chromasmithOnEdit(getUISnapshot());
        return window.chromasmithFlushPendingSave();
      });
      await page.evaluate(() => window.__libtestSetOriginalAvailable(true));
      assert.equal(await page.evaluate(() => window.__libtestOriginalAvailable), true, 'the fixture makes the original source probe readable before replay');
      const beforeReplayState = await page.evaluate(path => window.__libtestOriginalSourceState(path), offlinePath);
      assert.equal(beforeReplayState.queueRequired, true, 'the blocked original still requires queued persistence before reconnect replay');
      await page.evaluate(() => { window.__chr194QueueCheck = window.chromasmithCheckOfflineQueue(); });
      await page.waitForSelector('#lib-offq-modal[open]', { timeout: 10000 });
      await page.locator('#lib-offq-apply').click();
      await page.evaluate(() => window.__chr194QueueCheck);
      const probes = await page.evaluate(() => window.__chr194ProbeCalls);
      assert.ok(probes.some(({ path, available }) => path === offlinePath && available), 'successful replay must perform a source-availability probe that succeeds');
      const confirmations = await page.evaluate(() => window.__libtestSourceAvailabilityConfirms || []);
      const replayConfirmation = confirmations.at(-1);
      assert.equal(replayConfirmation?.path, offlinePath, 'replay probe targets the queued photo');
      assert.equal(replayConfirmation?.openedPath, offlinePath, 'replay probe sees the same photo open');
      assert.equal(replayConfirmation?.available, true, 'replay confirms the same original is readable; error=' + replayConfirmation?.error);
      const afterReplayState = await page.evaluate(path => window.__libtestOriginalSourceState(path), offlinePath);
      assert.equal(afterReplayState.queueRequired, false, 'a successful source probe after replay clears the unavailable-source routing flag');
      await page.evaluate(() => {
        window.chromasmithOnEdit(getUISnapshot());
        return window.chromasmithFlushPendingSave();
      });
      const replayedWrites = await page.evaluate(() => window.__libtestPersistenceCalls);
      assert.equal(replayedWrites.filter(({ command }) => command === 'set_sidecar').length, 1, 'edits switch to durable sidecar writes only after the queued edit replays');
      await page.evaluate(path => window.chromasmithOpenInEditor(path), offlinePath);
      await page.waitForFunction(() => document.getElementById('cs-source-render-state')?.dataset.source === 'original', { timeout: 10000 });
    } else {
      await page.evaluate(() => {
        window.chromasmithOnEdit(getUISnapshot());
        return window.chromasmithFlushPendingSave();
      });
      assert.match(await page.locator('#cs-save-state').innerText(), /Saved locally/, 'an available original reports a durable sidecar save');
      const onlineMaskSave = await page.evaluate(() => window.chromasmithSaveMaskSetForCurrentPhoto([], null, fxImages[0]));
      assert.equal(onlineMaskSave.durable, true, 'available-source mask sets continue using durable sidecar persistence');
      const onlineWrites = await page.evaluate(() => window.__libtestPersistenceCalls);
      assert.equal(onlineWrites.filter(({ command }) => command === 'set_sidecar').length, 2, 'online edits and mask sets persist to the sidecar');
      assert.equal(onlineWrites.filter(({ command }) => command === 'queue_offline_edit').length, 0, 'online edits do not enter the offline queue');
      const onlinePath = await page.evaluate(() => window.chromasmithGetOpenedPaths()[0]);
      assert.deepEqual(onlineWrites.map(({ args }) => args.path), [onlinePath, onlinePath], 'durable writes stay attached to the opened photo');
      await page.evaluate(() => {
        window.__chr194WarmImage = fxImages[0].img;
        window.__libtestSetOriginalAvailable(false);
        window.__libtestPersistenceCalls = [];
        return window.chromasmithOpenInEditor(window.chromasmithGetOpenedPaths()[0]);
      });
      await page.waitForFunction(() => document.getElementById('cs-source-render-state')?.dataset.source === 'missing', { timeout: 10000 });
      assert.equal(await page.locator('#cs-source-render-state').getAttribute('data-render'), 'full', 'source loss does not downgrade already-loaded full-quality pixels');
      assert.equal(await page.evaluate(() => fxImages[0].img === window.__chr194WarmImage), true, 'warm reopen retains the existing image object when the source disappears');
      assert.equal(await page.evaluate(() => window.chromasmithFullQualityReady), true, 'cached full-quality pixels remain ready while the source is unavailable');
      await page.evaluate(() => {
        window.chromasmithOnEdit(getUISnapshot());
        return window.chromasmithFlushPendingSave();
      });
      const unpluggedWrites = await page.evaluate(() => window.__libtestPersistenceCalls);
      assert.equal(unpluggedWrites.filter(({ command }) => command === 'queue_offline_edit').length, 1, 'editing after a warm-cache reopen with a missing source is queued');
      assert.equal(unpluggedWrites.filter(({ command }) => command === 'set_sidecar').length, 0, 'a warm cache cannot make an unavailable original appear durable');
    }
    await page.close();
  }
  console.log('PASS original, offline-preview, and offline-HQ source/render states with durable-vs-queued edit persistence');
} finally {
  await browser.close();
  server.close();
}
