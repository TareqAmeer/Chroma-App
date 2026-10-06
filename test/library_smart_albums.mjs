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
    const type = sourcePath.endsWith('.html') ? 'text/html' : sourcePath.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('chromasmith_lib_stars_enabled', '1'));
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libcat=1&libn=12`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.chromasmithToggleLibrary === 'function');
  await page.evaluate(() => document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); }));
  await page.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });
  await page.evaluate(() => document.querySelector('#cs-modal-ov')?.remove());
  await page.addStyleTag({ content: '#cs-modal-ov { display: none !important; }' });
  await page.locator('[data-sec-toggle="smart-albums"]').click();
  await page.locator('#lib-smart-album-new').click();
  const dialog = page.locator('#lib-smart-album-dialog');
  await dialog.waitFor({ state: 'visible' });
  await dialog.locator('[name="name"]').fill('Current selects');
  await dialog.locator('[data-smart-source]').first().check();
  let rows = dialog.locator('[data-smart-rule-row]');
  await rows.nth(0).locator('[data-smart-field]').selectOption('favorite');
  await rows.nth(0).locator('[data-smart-value]').selectOption('true');
  await dialog.locator('[name="matchMode"]').selectOption('any');
  await dialog.locator('[data-smart-add-rule]').click();
  rows = dialog.locator('[data-smart-rule-row]');
  await rows.nth(1).locator('[data-smart-field]').selectOption('captureYear');
  await rows.nth(1).locator('[data-smart-value]').fill('2026');
  await dialog.locator('button[type="submit"]').click();

  const album = page.locator('.lib-coll-row[data-smart-album]').filter({ hasText: 'Current selects' });
  await album.waitFor({ state: 'visible' });
  const title = await album.getAttribute('title');
  assert.match(title, /Favorite = true OR Capture year = 2026/);
  assert.match(title, /Sample library \/ Photos/);
  assert.match(await album.textContent(), /4/);

  await album.click();
  await page.waitForFunction(() => (window.__libtestSmartAlbumQueries || []).some((q) => q.smartAlbumId === 'smart-1'));
  const query = await page.evaluate(() => window.__libtestSmartAlbumQueries.at(-1));
  assert.equal(query.smartAlbumId, 'smart-1');
  assert.equal(query.offset, 0);
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log('PASS: Smart album builder saves selected catalog sources with All/Any conditions, explains rules and scope, and opens the live paged catalog query.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
