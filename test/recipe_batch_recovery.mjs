import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from './editor_state_harness.mjs';

const { server, port } = await startServer();
let browser;
try {
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('chromasmith-tour-seen-v1', '1'));
  await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=6&deskx=1&libtestBatchRecovery=1`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('#lib-grid .lib-card[data-path]');
  await page.waitForFunction(() => document.querySelector('#lib-act-pill')?.innerText.includes('Interrupted paste cancelled'));

  const recoveryCalls = await page.evaluate(() => window.__libtestRecipeBatchCalls.map(call => call.command));
  assert.ok(recoveryCalls.includes('recipe_batch_list'), 'startup scans persisted batch journals');
  assert.ok(recoveryCalls.includes('recipe_batch_get'), 'startup loads the unfinished batch report');
  assert.ok(recoveryCalls.includes('recipe_batch_cancel'), 'a renderer restart marks the orphaned worker interrupted');

  await page.locator('#lib-act-pill').click();
  const activity = await page.locator('.lib-act-pop').innerText();
  assert.match(activity, /1 applied · 1 failed · 1 pending/);
  await page.locator('#lib-act-batch-results').click();
  await page.locator('dialog[open] table tbody tr').first().waitFor();
  const rows = await page.locator('dialog[open] table tbody').innerText();
  assert.equal(await page.locator('dialog[open] table tbody tr').count(), 3);
  assert.match(rows, /applied/);
  assert.match(rows, /pending/);
  assert.match(rows, /failed: Simulated interrupted write failure/);
  await page.locator('dialog[open] [data-action="resume"]').click();
  await page.waitForFunction(async () => {
    const batch = await window.libtestRecipeBatchInvoke('recipe_batch_get', { id: 27301 });
    return batch.items.every(item => item.status === 'applied');
  });
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log('PASS: startup reports a persisted interrupted batch and resumes its pending/failed items.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
