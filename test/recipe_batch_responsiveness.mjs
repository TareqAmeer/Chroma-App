import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from './editor_state_harness.mjs';

const COUNT = 5000;
const { server, port } = await startServer();
let browser;
async function poll(read, ready, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (ready(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for large recipe batch state');
}

try {
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/coi-serviceworker.min.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.route('**/favicon.ico*', route => route.fulfill({ status: 204, body: '' }));
  await page.addInitScript(() => {
    localStorage.setItem('chromasmith-tour-seen-v1', '1');
    localStorage.setItem('csTheme', 'dark');
    localStorage.setItem('csThemeGallery', 'dark');
    localStorage.setItem('csThemeEditor', 'dark');
  });
  await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=6&deskx=1`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('#lib-grid .lib-card[data-path]');
  await page.waitForTimeout(1200);

  await page.evaluate(count => {
    // Simulate asynchronous native sidecar IPC, leaving the real JS preparation, job runner,
    // activity tray, progress updates and cancellation path under test.
    window.__libtestRecipeBatchApplyDelayMs = 8;
    window.__libtestLargeBatchPromise = window.libtestRecipeBatchStartLarge(count);
  }, COUNT);

  const running = await poll(
    () => page.evaluate(() => window.libtestRecipeBatchInvoke('recipe_batch_list', {})),
    batches => batches.some(batch => batch.total === COUNT && batch.status === 'running'),
  );
  const batch = running.find(candidate => candidate.total === COUNT && candidate.status === 'running');
  await poll(
    () => page.evaluate(() => (window.__libtestRecipeBatchCalls || []).filter(call => call.command === 'recipe_batch_apply_item').length),
    appliedCalls => appliedCalls >= 1,
  );

  await page.locator('#lib-act-pill').click();
  await page.waitForSelector('#lib-act-pill .lib-act-pop');
  const responsiveness = await page.evaluate(async () => {
    let frames = 0;
    let maxFrameGapMs = 0;
    let previous = performance.now();
    const deadline = performance.now() + 800;
    while (performance.now() < deadline) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const now = performance.now();
      maxFrameGapMs = Math.max(maxFrameGapMs, now - previous);
      previous = now;
      frames++;
    }
    return { frames, maxFrameGapMs };
  });
  assert.ok(responsiveness.frames >= 20, `expected animation frames during active batch, got ${responsiveness.frames}`);
  assert.ok(responsiveness.maxFrameGapMs < 250, `Library UI frame gap reached ${responsiveness.maxFrameGapMs.toFixed(1)}ms`);

  // Open an ordinary Library control while the 5,000-item batch is still active.
  await page.locator('#lib-sort-btn').click();
  await assert.doesNotReject(() => page.waitForFunction(() => {
    const menu = document.querySelector('#lib-sort-menu');
    return menu && getComputedStyle(menu).display !== 'none' && !menu.hidden;
  }, { timeout: 1000 }));
  const stateAtInteraction = await page.evaluate(async id => ({
    batch: await window.libtestRecipeBatchInvoke('recipe_batch_get', { id }),
    pill: document.querySelector('#lib-act-pill')?.innerText || '',
  }), batch.id);
  assert.match(stateAtInteraction.pill, /Responsiveness fixture/);
  assert.equal(stateAtInteraction.batch.status, 'running', 'the batch must still be active while Library controls respond');

  await page.locator('#lib-act-cancel').click();
  await poll(
    () => page.evaluate(id => window.libtestRecipeBatchInvoke('recipe_batch_get', { id }), batch.id),
    journal => journal?.status === 'cancelled',
  );
  await page.evaluate(() => window.__libtestLargeBatchPromise);
  assert.deepEqual(errors, [], `browser errors during responsiveness run: ${errors.join('\n')}`);
  console.log(`PASS: ${COUNT}-item batch remained active; ${responsiveness.frames} animation frames (max ${responsiveness.maxFrameGapMs.toFixed(1)}ms); sort menu responded; cancellation completed.`);
  await page.close();
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
