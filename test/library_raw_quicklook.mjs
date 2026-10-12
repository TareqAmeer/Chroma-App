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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); localStorage.setItem('chromasmithQuickLookDeveloped', '1'); } catch {}
    const resolveCache = (window.__rawQuicklookResolve ||= {});
    window.__libtestCatalogInvoke = (command, args) => {
      if (command === 'peek_raw_camera_path') return { __libtestHandled: true, result: { make: 'Panasonic', model: 'Test RAW' } };
      if (command === 'cache_raw_decode') {
        (window.__rawQuicklookCalls ||= []).push({ command, args });
        return { __libtestHandled: true, result: new Promise((resolve, reject) => { resolveCache[args.path] = { resolve, reject }; }) };
      }
      if (command === 'get_quicklook_preview') {
        (window.__rawQuicklookCalls ||= []).push({ command, args });
        return { __libtestHandled: true, result: Promise.reject(new Error('RAW must not use embedded preview')) };
      }
      return null;
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=12&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.libtestShowQuickLook === 'function', { timeout: 30000 });
  await page.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });

  const [a, b, failed] = ['/test/RAW/A.RW2', '/test/RAW/B.RW2', '/test/RAW/C.RW2'];
  const recipe = btoa(JSON.stringify({ rawNr: 'off', demosaicAlgo: 'markesteijn3' }));
  await page.evaluate(([paths, encoded]) => paths.forEach(path => window.__libtestSeedSidecar(path, { recipe: encoded })), [[a, b, failed], recipe]);

  // Hold A while the user moves A → B → A. A and the second A share the same request;
  // B completes later and must not replace the final A preview.
  const editorSettingsBefore = await page.evaluate(() => ({ rawNr: window.chromasmithRawNr, demosaicAlgo: window.chromasmithDemosaicAlgo }));
  await page.evaluate(path => { void window.libtestShowQuickLook(path); }, a);
  await page.waitForFunction(path => !!window.__rawQuicklookResolve[path], a);
  await page.evaluate(path => { void window.libtestShowQuickLook(path); }, b);
  await page.evaluate(path => { void window.libtestShowQuickLook(path); }, a);
  const initialA = await page.evaluate(path => {
    const call = window.__rawQuicklookCalls.find(item => item.command === 'cache_raw_decode' && item.args.path === path);
    return { call, previewSource: document.getElementById('lib-ql-img')?.dataset.previewSource };
  }, a);
  assert.ok(initialA.call, 'A RAW uses the native developed-cache command');
  assert.equal(initialA.call.args.displayOnly, true, 'Quick Look requests a display-only decode');
  assert.equal(initialA.call.args.rawNr, 'off', 'saved per-photo NR setting is applied');
  assert.equal(initialA.call.args.demosaicAlgo, 'markesteijn3', 'saved per-photo demosaic setting is applied');
  assert.deepEqual(await page.evaluate(() => ({ rawNr: window.chromasmithRawNr, demosaicAlgo: window.chromasmithDemosaicAlgo })), editorSettingsBefore,
    'Quick Look resolves per-photo settings without mutating the active Editor settings');
  assert.equal(initialA.previewSource, '', 'the pending RAW does not claim an image before decode completes');
  await page.evaluate(path => window.__rawQuicklookResolve[path].resolve('/test/fixtures/chart.png'), a);
  await page.waitForFunction(() => document.getElementById('lib-ql-img')?.dataset.previewSource === 'developed-raw');
  await page.waitForFunction(path => !!window.__rawQuicklookResolve[path], b);
  const aSource = await page.locator('#lib-ql-img').getAttribute('src');
  await page.evaluate(path => window.__rawQuicklookResolve[path].resolve('/test/fixtures/portrait.png'), b);
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#lib-ql-caption').textContent(), 'A.RW2', 'late B completion cannot replace the final A');
  assert.equal(await page.locator('#lib-ql-img').getAttribute('src'), aSource, 'late B completion leaves A pixels in place');

  const countsBeforeHit = await page.evaluate(path => window.__rawQuicklookCalls.filter(item => item.command === 'cache_raw_decode' && item.args.path === path).length, a);
  await page.evaluate(path => { void window.libtestShowQuickLook(path); }, a);
  await page.waitForTimeout(50);
  const countsAfterHit = await page.evaluate(path => window.__rawQuicklookCalls.filter(item => item.command === 'cache_raw_decode' && item.args.path === path).length, a);
  assert.equal(countsAfterHit, countsBeforeHit, 'a warm Quick Look preview is served from memory cache');

  // Changing the saved recipe changes the proxy key; the old image cannot be served for it.
  const changedRecipe = btoa(JSON.stringify({ rawNr: 'fast', demosaicAlgo: 'ahd' }));
  await page.evaluate(([path, encoded]) => window.__libtestSeedSidecar(path, { recipe: encoded }), [a, changedRecipe]);
  await page.evaluate(path => { void window.libtestShowQuickLook(path); }, a);
  await page.waitForFunction(path => window.__rawQuicklookCalls.filter(item => item.command === 'cache_raw_decode' && item.args.path === path).length === 2, a);
  const changedCall = await page.evaluate(path => window.__rawQuicklookCalls.filter(item => item.command === 'cache_raw_decode' && item.args.path === path).at(-1), a);
  assert.equal(changedCall.args.demosaicAlgo, 'ahd', 'a changed recipe uses a new developed proxy');
  await page.evaluate(path => window.__rawQuicklookResolve[path].resolve('/test/fixtures/chart.png'), a);
  await page.waitForFunction(() => document.getElementById('lib-ql-img')?.dataset.previewSource === 'developed-raw');

  await page.evaluate(path => {
    const sc = window.__libtestReadSidecar(path);
    window.__libtestSeedSidecar(path, { ...sc, edited: true });
    void window.libtestShowQuickLook(path);
  }, a);
  await page.waitForFunction(() => document.getElementById('lib-ql-caption')?.textContent.includes('creative edits not shown'));
  assert.match(await page.locator('#lib-ql-caption').getAttribute('title'), /Open in Editor/);
  const editedHitCount = await page.evaluate(path => window.__rawQuicklookCalls.filter(item => item.command === 'cache_raw_decode' && item.args.path === path).length, a);
  assert.equal(editedHitCount, countsAfterHit + 1, 'edited caption uses the same native preview after the earlier recipe invalidation');
  await page.evaluate(path => {
    const sc = window.__libtestReadSidecar(path);
    window.__libtestSeedSidecar(path, { ...sc, edited: false });
    void window.libtestShowQuickLook(path);
  }, a);
  await page.waitForFunction(() => document.getElementById('lib-ql-caption')?.textContent === 'A.RW2');
  assert.equal(await page.locator('#lib-ql-caption').getAttribute('title'), '', 'unmodified RAW does not retain the edited-preview hint');

  await page.evaluate(path => { void window.libtestShowQuickLook(path); }, failed);
  await page.waitForFunction(path => !!window.__rawQuicklookResolve[path], failed);
  await page.evaluate(path => window.__rawQuicklookResolve[path].reject(new Error('simulated RAW cache failure')), failed);
  await page.waitForFunction(() => document.getElementById('lib-ql-caption')?.textContent === 'C.RW2 — preview unavailable');
  const outcomes = await page.evaluate(() => ({
    calls: window.__rawQuicklookCalls,
    fallback: window.__rawQuicklookCalls.some(item => item.command === 'get_quicklook_preview'),
  }));
  assert.equal(outcomes.fallback, false, 'RAW failure never falls back to embedded-JPEG Quick Look');
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log('PASS: RAW Quick Look uses saved NR/demosaic settings, display-only cache, guards stale navigation, rejects fallback and serves a warm memory hit.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
