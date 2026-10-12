// RAW review preparation stays serial, yields to foreground Quick Look, and records truthful
// cancellation/failure history without promoting display-only previews to full caches.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
    const sourceRelative = relative === 'desktop/dist/library-ui.js' ? 'desktop/library-ui.js' : relative;
    const file = path.resolve(root, sourceRelative);
    if (!file.startsWith(root + path.sep)) throw Error('outside root');
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.png') ? 'image/png' : 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
assert.ok(process.env.PLAYWRIGHT_EXECUTABLE_PATH, 'set PLAYWRIGHT_EXECUTABLE_PATH to the canonical headless shell');
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); localStorage.setItem('chromasmithAutoPreviews', '0'); localStorage.setItem('chromasmithQuickLookDeveloped', '1'); } catch {}
    window.__rawPrepCalls = [];
    window.__rawPrepResolvers = {};
    window.__rawPrepActive = 0;
    window.__rawPrepMaxActive = 0;
    window.__libtestCatalogInvoke = (command, args) => {
      if (command === 'peek_raw_camera_path') return { __libtestHandled: true, result: { make: 'Panasonic', model: 'Test RAW' } };
      if (command === 'cache_raw_decode') {
        const call = { command, args };
        window.__rawPrepCalls.push(call);
        window.__rawPrepActive++;
        window.__rawPrepMaxActive = Math.max(window.__rawPrepMaxActive, window.__rawPrepActive);
        const key = args.path;
        (window.__rawPrepResolvers[key] ||= []).push({
          resolve(value) { window.__rawPrepActive--; this.settled = true; this.resolveNative(value); },
          reject(error) { window.__rawPrepActive--; this.settled = true; this.rejectNative(error); },
          settled: false,
          resolveNative: null,
          rejectNative: null,
        });
        const slot = window.__rawPrepResolvers[key].at(-1);
        return { __libtestHandled: true, result: new Promise((resolve, reject) => { slot.resolveNative = resolve; slot.rejectNative = reject; }) };
      }
      if (command === 'get_quicklook_preview') {
        (window.__rawPrepFallbackCalls ||= []).push({ command, args });
        return { __libtestHandled: true, result: Promise.reject(new Error('must not use embedded preview for RAW')) };
      }
      if (command === 'get_decode_cache_path' || (command === 'cache_raw_decode' && args.displayOnly !== true)) (window.__rawPrepFullCalls ||= []).push({ command, args });
      return null;
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=18&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.__libtestPrepareRawReviewPreviews === 'function' && typeof window.libtestShowQuickLook === 'function', { timeout: 30000 });
  await page.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });
  await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card[data-path]').length >= 8, { timeout: 30000 });

  const [a, b, c, d, e, f, foreground] = [
    '/test/RAW/A.RW2', '/test/RAW/B.RW2', '/test/RAW/C.RW2', '/test/RAW/D.RW2',
    '/test/RAW/E.RW2', '/test/RAW/F.RW2', '/test/RAW/Foreground.RW2',
  ];
  const listedRaw = await page.locator('#lib-grid .lib-card[data-path]').evaluateAll(cards => cards.map(card => card.dataset.path).filter(path => /\.RW2$/i.test(path)));
  assert.ok(listedRaw.length >= 2, 'library fixture has selectable RAW photos');
  await page.evaluate(paths => { paths.forEach(path => window.__libSelect(path)); window.__libRenderGrid(); }, listedRaw.slice(0, 2));
  const selectedCard = page.locator(`#lib-grid .lib-card[data-path="${listedRaw[0]}"]`);
  await selectedCard.click({ button: 'right' });
  const prepareMenu = page.locator('.cs-ctx-it').filter({ hasText: /^Prepare RAW review previews \(2\)$/ });
  await prepareMenu.waitFor({ state: 'visible' });
  await prepareMenu.click();
  const selectedPaths = listedRaw.slice(0, 2);
  await page.waitForFunction(path => window.__rawPrepCalls.some(call => call.args.path === path), selectedPaths[0]);
  const firstCall = await page.evaluate(path => window.__rawPrepCalls.find(call => call.args.path === path), selectedPaths[0]);
  assert.equal(firstCall.args.displayOnly, true, 'the real selected-path menu requests display-only decoding');

  // Foreground review jumps ahead of the queued next preparation item, without a second decoder.
  await page.evaluate(path => { void window.libtestShowQuickLook(path); }, foreground);
  await page.waitForFunction(path => window.__libtestRawReviewState().queued.some(job => job.path === path && job.kind === 'quicklook'), foreground);
  assert.equal(await page.evaluate(path => window.__rawPrepCalls.some(call => call.args.path === path), foreground), false,
    'foreground Quick Look waits in the queue while the active decode finishes');
  await page.evaluate(path => window.__rawPrepResolvers[path].at(-1).resolve('/test/fixtures/chart.png'), selectedPaths[0]);
  await page.waitForFunction(path => window.__rawPrepCalls.some(call => call.args.path === path), foreground);
  assert.equal(await page.evaluate(path => window.__rawPrepCalls.some(call => call.args.path === path), selectedPaths[1]), false,
    'queued background preparation waits while foreground Quick Look owns the lane');
  const foregroundCall = await page.evaluate(path => window.__rawPrepCalls.find(call => call.args.path === path), foreground);
  assert.equal(foregroundCall.args.displayOnly, true);
  await page.evaluate(path => window.__rawPrepResolvers[path].at(-1).resolve('/test/fixtures/chart.png'), foreground);
  await page.waitForFunction(path => window.__rawPrepCalls.some(call => call.args.path === path), selectedPaths[1]);
  await page.evaluate(path => window.__rawPrepResolvers[path].at(-1).resolve('/test/fixtures/chart.png'), selectedPaths[1]);
  await page.waitForFunction(() => window.__libtestRawReviewState()?.prep === null, { timeout: 30000 });

  // Cancellation can remove a prep item still queued behind an active foreground request.
  const queuedForeground = '/test/RAW/QueuedForeground.RW2', queuedPrep = '/test/RAW/QueuedPrep.RW2';
  await page.evaluate(path => { void window.libtestShowQuickLook(path); }, queuedForeground);
  await page.waitForFunction(path => window.__rawPrepCalls.some(call => call.args.path === path), queuedForeground);
  const queuedCancelStart = await page.evaluate(() => window.__rawPrepCalls.length);
  await page.evaluate(path => { void window.__libtestPrepareRawReviewPreviews([path]); }, queuedPrep);
  await page.waitForFunction(path => window.__libtestRawReviewState().queued.some(job => job.path === path && job.kind === 'prep'), queuedPrep);
  await page.evaluate(() => window.__libtestCancelRawReviewPreviews());
  await page.waitForFunction(path => !window.__libtestRawReviewState().queued.some(job => job.path === path), queuedPrep);
  await page.evaluate(path => window.__rawPrepResolvers[path].at(-1).resolve('/test/fixtures/chart.png'), queuedForeground);
  await page.waitForFunction(() => window.__libtestRawReviewState()?.prep === null, { timeout: 30000 });
  const queuedCancelledCalls = await page.evaluate(start => window.__rawPrepCalls.slice(start).map(call => call.args.path), queuedCancelStart);
  assert.deepEqual(queuedCancelledCalls, [], 'a cancelled, not-yet-started prep item never dispatches after the foreground request');
  const queuedCancelledRecord = await page.evaluate(() => JSON.parse(localStorage.getItem('chromasmith-job-history-v1') || '[]').find(row => row.label === 'Preparing RAW review previews' && row.status === 'Cancelled'));
  assert.equal(queuedCancelledRecord?.done, 0, 'queued cancellation retains truthful zero completed items');
  assert.equal(queuedCancelledRecord?.total, 1);

  // Cancellation is between files: the in-flight item is retained, the queued item never starts.
  const cancellationStart = await page.evaluate(() => window.__rawPrepCalls.length);
  await page.evaluate(paths => { void window.__libtestPrepareRawReviewPreviews(paths); }, [c, d]);
  await page.waitForFunction(path => window.__rawPrepCalls.some(call => call.args.path === path), c);
  await page.evaluate(() => window.__libtestCancelRawReviewPreviews());
  await page.evaluate(path => window.__rawPrepResolvers[path].at(-1).resolve('/test/fixtures/chart.png'), c);
  await page.waitForFunction(() => window.__libtestRawReviewState()?.prep === null, { timeout: 30000 });
  const cancelledCalls = await page.evaluate(start => window.__rawPrepCalls.slice(start).map(call => call.args.path), cancellationStart);
  assert.deepEqual(cancelledCalls, [c], 'cancelled preparation completes its active item and launches no later item');
  const cancelledRecord = await page.evaluate(() => JSON.parse(localStorage.getItem('chromasmith-job-history-v1') || '[]').find(row => row.label === 'Preparing RAW review previews' && row.status === 'Cancelled' && row.total === 2));
  assert.equal(cancelledRecord?.done, 1, 'history records completed current item progress after cancellation');
  assert.equal(cancelledRecord?.total, 2);

  // Per-file failures do not abort the remaining work and remain visible in durable job history.
  const failureStart = await page.evaluate(() => window.__rawPrepCalls.length);
  await page.evaluate(paths => { void window.__libtestPrepareRawReviewPreviews(paths); }, [e, f]);
  await page.waitForFunction(path => window.__rawPrepCalls.some(call => call.args.path === path), e);
  await page.evaluate(path => window.__rawPrepResolvers[path].at(-1).reject(new Error('simulated review cache failure')), e);
  await page.waitForFunction(path => window.__rawPrepCalls.some(call => call.args.path === path), f);
  await page.evaluate(path => window.__rawPrepResolvers[path].at(-1).resolve('/test/fixtures/chart.png'), f);
  await page.waitForFunction(() => window.__libtestRawReviewState()?.prep === null, { timeout: 30000 });
  const failedRecord = await page.evaluate(() => JSON.parse(localStorage.getItem('chromasmith-job-history-v1') || '[]').find(row => row.label === 'Preparing RAW review previews' && row.status === 'Partial'));
  assert.equal(failedRecord?.done, 2, 'failed attempts count toward honest processed progress');
  assert.equal(failedRecord?.total, 2);
  assert.equal(failedRecord?.failedCount, 1);
  assert.match(failedRecord?.failedItems?.[0] || '', /E\.RW2/);
  const outcomes = await page.evaluate(start => ({
    calls: window.__rawPrepCalls.slice(start),
    maxActive: window.__rawPrepMaxActive,
    fallback: window.__rawPrepFallbackCalls || [],
    full: window.__rawPrepFullCalls || [],
  }), failureStart);
  assert.equal(outcomes.maxActive, 1, 'RAW review cache decodes never overlap');
  assert.deepEqual(outcomes.calls.map(call => call.args.path), [e, f]);
  assert.ok(outcomes.calls.every(call => call.args.displayOnly === true), 'all preparation jobs request display-only outputs');
  assert.deepEqual(outcomes.fallback, [], 'RAW preparation never calls embedded Quick Look preview');
  assert.deepEqual(outcomes.full, [], 'RAW review preparation never requests a full-resolution cache');
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log('PASS: selected RAW preparation is serial, foreground-prioritized, display-only, cancellable between files, and truthfully recorded on failure.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
