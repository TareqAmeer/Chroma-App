import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(root, relative === 'desktop/dist/library-ui.js' ? 'desktop/library-ui.js' : relative);
    const body = await readFile(file);
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('chromasmith_lib_subfolders', '1'));
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=12`, {
    waitUntil: 'domcontentloaded', timeout: 120000,
  });
  await page.waitForFunction(() => typeof window.__libOpenFolder === 'function', { timeout: 20000 });
  await page.waitForTimeout(1000);

  const open = (folder) => page.evaluate(async (value) => window.__libOpenFolder(value), folder);
  await open('/test/Photos/A');
  let recursive = await page.evaluate(() => window.__libtestFolderQueries.at(-1));
  assert.equal(recursive.relDir, 'A');
  assert.equal(recursive.recursive, true, 'legacy global choice migrates as the per-folder default');
  assert.match(await page.locator('#lib-count').textContent(), /including subfolders/);

  await page.evaluate(() => {
    const checkbox = document.getElementById('lib-subfolders');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => window.__libtestFolderQueries.at(-1)?.recursive === false);
  recursive = await page.evaluate(() => window.__libtestFolderQueries.at(-1));
  assert.equal(recursive.recursive, false, 'the current folder override changes the catalog query');

  await open('/test/Photos/B');
  recursive = await page.evaluate(() => window.__libtestFolderQueries.at(-1));
  assert.equal(recursive.relDir, 'B');
  assert.equal(recursive.recursive, true, 'a sibling folder retains the migrated default');

  await open('/test/Photos/A');
  recursive = await page.evaluate(() => window.__libtestFolderQueries.at(-1));
  assert.equal(recursive.recursive, false, 'the folder-specific override survives navigation');
  assert.doesNotMatch(await page.locator('#lib-count').textContent(), /including subfolders/);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('chromasmith_lib_subfolders_v2')));
  assert.equal(saved.version, 2);
  assert.equal(saved.defaultValue, true);
  assert.equal(Object.values(saved.scopes).length, 1, 'only the folder explicitly changed gets an override');
  console.log('PASS: recursive view preference migrates, persists per catalog folder, and is visible in status.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
