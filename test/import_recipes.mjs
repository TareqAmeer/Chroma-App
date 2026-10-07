import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
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

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1`, {
    waitUntil: 'domcontentloaded', timeout: 120000,
  });
  await page.waitForFunction(() => typeof window.__libOpenImportPanel === 'function', { timeout: 20000 });
  await page.evaluate(async () => {
    window.__copiedRecipe = 'eyJleHBvc3VyZSI6MC4zfQ==';
    window.askTextModal = async () => 'Sports Desk';
    await window.__libOpenImportPanel('/Volumes/LUMIX');
  });
  await page.locator('#imp-recipe').waitFor({ state: 'visible' });
  await page.locator('#imp-folder').selectOption('{YYYY-MM-DD}');
  await page.locator('#imp-name').fill('{YYYY-MM-DD}_{seq}');
  await page.locator('#imp-seq-start').fill('7');
  let namingPreview = await page.locator('#imp-name-preview').innerText();
  assert.match(namingPreview, /P106504\.RW2/);
  assert.match(namingPreview, /2026-08-13_0007\.RW2/);
  await page.locator('#imp-name').fill('collision');
  namingPreview = await page.locator('#imp-name-preview').innerText();
  assert.match(namingPreview, /generated names collide; import will add a unique suffix/);
  await page.locator('#imp-name').fill('{YYYY-MM-DD}_{seq}');
  await page.locator('#imp-creator').fill('A. Photographer');
  await page.locator('#imp-copyright').fill('© Studio 2026');
  await page.locator('#imp-caption').fill('Match day');
  await page.locator('#imp-job-project').fill('JOB-42');
  await page.locator('#imp-keywords').fill('football, 2026, football');
  await page.locator('#imp-starting-edit').selectOption('copied');
  await page.evaluate(() => document.getElementById('imp-recipe-save').click());

  const recipeId = await page.locator('#imp-recipe').inputValue();
  assert.ok(recipeId, 'save should select the new recipe');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cs.import.recipes.v1')));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, 'Sports Desk');
  assert.deepEqual(saved[0].keywords, ['football', '2026'], 'keywords are trimmed and deduplicated');
  assert.equal(saved[0].startingEditRecipe, 'eyJleHBvc3VyZSI6MC4zfQ==', 'saved import recipe retains the copied edit snapshot');
  const preview = await page.locator('#imp-metadata-preview').innerText();
  assert.match(preview, /Creator: A\. Photographer/);
  assert.match(preview, /Keywords: football, 2026/);
  assert.match(preview, /Starting edit: Copied edit/);

  await page.locator('#imp-creator').fill('temporary change');
  await page.locator('#imp-caption').fill('');
  await page.locator('#imp-recipe').selectOption(recipeId);
  assert.equal(await page.locator('#imp-creator').inputValue(), 'A. Photographer');
  assert.equal(await page.locator('#imp-caption').inputValue(), 'Match day');
  assert.equal(await page.locator('#imp-job-project').inputValue(), 'JOB-42');
  assert.equal(await page.locator('#imp-seq-start').inputValue(), '7');
  assert.equal(await page.locator('#imp-starting-edit').inputValue(), 'saved', 'saved recipe restores its starting edit');
  assert.equal(await page.locator('#imp-starting-edit').evaluate((el) => el.dataset.savedRecipe), 'eyJleHBvc3VyZSI6MC4zfQ==');
  assert.equal(await page.locator('#imp-skip').isChecked(), true, 'recipe application preserves duplicate skip');
  assert.equal(await page.locator('#imp-backup').inputValue(), '', 'recipe application leaves the second-copy destination independent');
  await page.locator('#imp-dest').evaluate((el) => { el.value = '/tmp/Imports'; });
  await page.evaluate(() => document.getElementById('imp-go').click());
  await page.waitForFunction(() => (window.__libtestCalls || []).some(([cmd]) => cmd === 'ingest_copy'));
  const sent = await page.evaluate(() => window.__libtestCalls.find(([cmd]) => cmd === 'ingest_copy')[1]);
  assert.equal(sent.options.metadata.startingEditRecipe, 'eyJleHBvc3VyZSI6MC4zfQ==', 'import IPC sends the selected starting edit');
  console.log('PASS: filename collision preview, IPTC metadata preview, recipe save/reload, starting-edit IPC, and independent copy options.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
