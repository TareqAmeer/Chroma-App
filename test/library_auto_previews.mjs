// RAW Quick Look uses a per-photo developed display proxy and shares native work while
// keeping stale completions from replacing the currently selected preview.
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
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const errors = [];
  const makePage = async (disable) => {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    p.on('pageerror', error => errors.push(error.message));
    await p.addInitScript((off) => {
      try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); if (off) localStorage.setItem('chromasmithAutoPreviews', '0'); } catch {}
      window.__libtestCatalogInvoke = (command, args) => {
        if (command === 'peek_raw_camera_path') return { __libtestHandled: true, result: { make: 'Panasonic', model: 'Test RAW' } };
        if (command === 'cache_raw_decode') {
          (window.__autoCalls ||= []).push({ command, args });
          return { __libtestHandled: true, result: '/test/fixtures/chart.png' };
        }
        return null;
      };
    }, disable);
    await p.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=12&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForFunction(() => typeof window.libtestAutoPreviewTick === 'function', { timeout: 30000 });
    await p.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });
    await p.waitForSelector('.lib-card[data-path$=".RW2"]', { timeout: 30000 });
    return p;
  };
  const calls = (p) => p.evaluate(() => (window.__autoCalls || []).map(c => c.args));

  // Idle + enabled: builds a display-only proxy for every RAW in view (never the videos), nearest first.
  const page = await makePage(false);
  await page.evaluate(() => window.libtestAutoPreviewTouch());
  await page.evaluate(() => window.libtestAutoPreviewTick());
  assert.equal((await calls(page)).length, 0, 'recent input keeps background previews paused');
  await page.evaluate(() => window.libtestAutoPreviewIdle());
  await page.evaluate(() => window.libtestAutoPreviewTick());
  const built = await calls(page);
  assert.ok(built.length >= 8, `builds previews for the RAWs in view (got ${built.length})`);
  assert.ok(built.every(a => a.displayOnly === true), 'previews are display-only developed proxies');
  assert.ok(built.every(a => /\.RW2$/i.test(a.path)), 'videos are never prepared');
  assert.equal(new Set(built.map(a => a.path)).size, built.length, 'each photo is prepared once');
  await page.evaluate(() => window.libtestAutoPreviewTick());
  assert.equal((await calls(page)).length, built.length, 'already-built photos are not rebuilt');

  // Setting off: nothing runs.
  const off = await makePage(true);
  await off.evaluate(() => window.libtestAutoPreviewIdle());
  await off.evaluate(() => window.libtestAutoPreviewTick());
  assert.equal((await calls(off)).length, 0, 'chromasmithAutoPreviews=0 disables background previews');

  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log('PASS: background previews build idle-only, display-only, RAW-only, once each, and can be disabled.');
} finally {
  await browser.close();
  server.close();
}
