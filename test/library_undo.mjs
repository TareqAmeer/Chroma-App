// CHR-184: Cmd/Ctrl+Z in the Library undoes keyword add/remove and album adds (the "moves" of a
// photo between collections) as well as rating/flag/favourite. Real write paths + real keyboard.
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
    const type = sourcePath.endsWith('.html') ? 'text/html' : sourcePath.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); } catch {} });
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=12`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.__libOpenFolder === 'function', { timeout: 30000 });
  await page.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });
  await page.evaluate(() => window.__libOpenFolder('/test/Photos'));
  await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length >= 4, { timeout: 30000 });
  const [a, b] = await page.locator('#lib-grid .lib-card').evaluateAll((c) => c.slice(0, 2).map((x) => x.dataset.path));
  const kws = (p) => page.evaluate((x) => window.__libKeywords(x), p);
  const ctrlZ = async () => { await page.keyboard.press('Control+z'); await page.waitForTimeout(150); };
  await page.locator('#lib-grid').focus().catch(() => {});

  // Keywords: add twice, undo twice, order matters.
  await page.evaluate((p) => window.__libAddKeyword(p, 'Travel'), a);
  await page.evaluate((p) => window.__libAddKeyword(p, 'Iceland'), a);
  assert.deepEqual(await kws(a), ['Travel', 'Iceland']);
  await ctrlZ();
  assert.deepEqual(await kws(a), ['Travel'], 'first undo removes the latest keyword');
  await ctrlZ();
  assert.deepEqual(await kws(a), [], 'second undo removes the earlier keyword');
  // The persisted write is reverted too, not only the in-memory copy.
  const lastSet = await page.evaluate(() => window.__libtestCalls.filter(([c]) => c === 'set_keywords').pop()[1]);
  assert.deepEqual(lastSet.keywords, []);

  // Keyword removal undo restores the keyword.
  await page.evaluate((p) => window.__libAddKeyword(p, 'Portrait'), b);
  await page.evaluate((p) => window.__libRemoveKeyword(p, 'Portrait'), b);
  assert.deepEqual(await kws(b), []);
  await ctrlZ();
  assert.deepEqual(await kws(b), ['Portrait'], 'undoing a removal puts the keyword back');
  await ctrlZ();
  assert.deepEqual(await kws(b), [], 'undoing the add afterwards clears it');

  // Album add ("move into collection"): only the newly added photo is removed on undo.
  const al = await page.evaluate(() => window.__libCreateAlbum('Keepers'));
  await page.evaluate(([id, p]) => window.__libAlbumAdd(id, 'Keepers', [p]), [al.id, a]);
  await page.evaluate(([id, p1, p2]) => window.__libAlbumAdd(id, 'Keepers', [p1, p2]), [al.id, a, b]);
  let albums = await page.evaluate(() => window.__libAlbums());
  assert.deepEqual(albums.find((x) => x.id === al.id).paths, [a, b]);
  await ctrlZ();
  albums = await page.evaluate(() => window.__libAlbums());
  assert.deepEqual(albums.find((x) => x.id === al.id).paths, [a], 'undo removes only what that action added (a was already there)');
  await ctrlZ();
  albums = await page.evaluate(() => window.__libAlbums());
  assert.deepEqual(albums.find((x) => x.id === al.id).paths, [], 'undo of the first add empties the album');

  // Mixed stack: rating then keyword — undone in reverse order.
  await page.evaluate((p) => window.__libAddKeyword(p, 'Mixed'), a);
  await ctrlZ();
  assert.deepEqual(await kws(a), []);
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log('PASS: Library undo reverts keyword add/remove and album adds in order, persisting the revert.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
