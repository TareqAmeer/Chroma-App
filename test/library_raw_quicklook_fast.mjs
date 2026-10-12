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
    try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); } catch {}
    const resolveCache = (window.__rawQuicklookResolve ||= {});
    window.__libtestCatalogInvoke = (command, args) => {
      if (command === 'peek_raw_camera_path') return { __libtestHandled: true, result: { make: 'Panasonic', model: 'Test RAW' } };
      if (command === 'cache_raw_decode') {
        (window.__rawQuicklookCalls ||= []).push({ command, args });
        return { __libtestHandled: true, result: new Promise((resolve, reject) => { resolveCache[args.path] = { resolve, reject }; }) };
      }
      if (command === 'get_quicklook_preview') {
        (window.__rawQuicklookCalls ||= []).push({ command, args });
        return { __libtestHandled: true, result: new Uint8Array([137, 80, 78, 71]).buffer };
      }
      return null;
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=12&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.libtestShowQuickLook === 'function', { timeout: 30000 });
  await page.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });

  const a = '/test/RAW/A.RW2';
  const calls = (cmd) => page.evaluate(([c, p]) => (window.__rawQuicklookCalls || []).filter(i => i.command === c && i.args.path === p).length, [cmd, a]);
  await page.evaluate(path => { void window.libtestShowQuickLook(path); }, a);
  await page.waitForFunction(() => document.getElementById('lib-ql-img')?.dataset.previewSource === 'camera-preview', { timeout: 10000 });
  assert.equal(await calls('get_quicklook_preview'), 1, 'RAW Quick Look uses the embedded camera preview by default');
  assert.equal(await calls('cache_raw_decode'), 0, 'default RAW Quick Look never starts a RAW decode');
  assert.match(await page.locator('#lib-ql-caption').textContent(), /D to develop/);

  await page.keyboard.press('d');
  await page.waitForFunction(path => !!window.__rawQuicklookResolve[path], a);
  const dev = await page.evaluate(path => window.__rawQuicklookCalls.find(i => i.command === 'cache_raw_decode' && i.args.path === path), a);
  assert.equal(dev.args.displayOnly, true, 'D requests the display-only developed render');
  await page.evaluate(path => window.__rawQuicklookResolve[path].resolve('/test/fixtures/chart.png'), a);
  await page.waitForFunction(() => document.getElementById('lib-ql-img')?.dataset.previewSource === 'developed-raw', { timeout: 10000 });
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log('PASS: RAW Quick Look is instant (embedded preview) by default and develops only on D.');
} finally {
  await browser.close();
  server.close();
}
