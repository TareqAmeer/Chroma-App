// CHR-269: existing face crops are exposed as a current-photo close-up contact sheet.
// Run after `node tools/scripts/build-desktop.mjs` with Playwright available.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from './editor_state_harness.mjs';

const { server, port } = await startServer();
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=12&deskx=1`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelectorAll('button').forEach((button) => {
    if (button.textContent.trim() === 'Got it') button.click();
  }));
  await page.evaluate(async () => {
    if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary();
  });
  await page.evaluate(() => window.__libOpenFolder('/test/Photos'));
  await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length > 0, { timeout: 30000 });

  const card = page.locator('#lib-grid .lib-card').first();
  const path = await card.getAttribute('data-path');
  await card.click({ button: 'right' });
  await page.getByText('Face close-ups…', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Face close-ups' });
  await dialog.waitFor({ state: 'visible' });
  assert.match(await dialog.textContent(), /IMG_1001\.RW2/);
  assert.equal(await dialog.locator('.lib-face-closeup-item').count(), 2, 'show each detected face for the current photo');
  assert.match(await dialog.textContent(), /Tareq/);
  assert.match(await dialog.textContent(), /Face 2 · unnamed/);
  assert.match(await dialog.textContent(), /Eye openness and face sharpness are not scored/);
  await page.waitForFunction(() => document.querySelectorAll('.lib-face-closeup-item img.loaded').length === 2);
  const faceQuery = await page.evaluate(() => window.__libtestFacePathCalls.at(-1));
  assert.equal(faceQuery.path, path);
  assert.equal(faceQuery.stack, false, 'close-ups are scoped to this photo, not all stack members');

  await dialog.getByRole('button', { name: 'Close face close-ups' }).click();
  await card.click({ button: 'right' });
  await page.getByText('People…', { exact: true }).click();
  await page.getByRole('dialog', { name: 'People in selected photos' }).waitFor({ state: 'visible' });
  const peopleQuery = await page.evaluate(() => window.__libtestFacePathCalls.at(-1));
  assert.equal(peopleQuery.path, path);
  assert.equal(peopleQuery.stack, true, 'existing People editor retains stack-wide behavior');
  assert.deepEqual(errors, [], 'no page errors');
} finally {
  await browser.close();
  server.close();
}
console.log('CHR-269 face close-up regression — PASS');
