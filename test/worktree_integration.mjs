import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Exercises the feature overlaps found while integrating old worktrees into current main.
const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) throw Error('outside root');
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=18&deskx=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.libtestShowQuickLook === 'function');
  const quicklook = await page.evaluate(async () => {
    const paths = [...document.querySelectorAll('#lib-grid .lib-card[data-path]')].map(el => el.dataset.path);
    if (paths.length < 8) throw Error('missing Library fixtures');
    await Promise.all([libtestShowQuickLook(paths[3]), libtestShowQuickLook(paths[3])]);
    await new Promise(resolve => setTimeout(resolve, 150));
    const calls = [...window.__libtestQuicklookCalls];
    for (const p of paths.slice(0, 8)) await libtestShowQuickLook(p);
    await new Promise(resolve => setTimeout(resolve, 150));
    return { calls, path: paths[3], cache: window.__libQuicklookCacheState() };
  });
  assert.equal(quicklook.calls.filter(p => p === quicklook.path).length, 1, 'concurrent Quick Look opens share native request');
  assert(quicklook.calls.length > 1, 'neighbors are prefetched');
  assert(quicklook.cache.cached.length <= 5, 'Quick Look cache stays bounded');
  await page.keyboard.press('Escape');

  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 100;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = 'rgb(240,40,30)'; ctx.fillRect(0, 0, 100, 100);
    const before = [...ctx.getImageData(0, 0, 100, 100).data];
    const op = { x: .5, y: .5, rx: .2, ry: .2, pupilSize: 90, darken: 100, mode: 'human', enabled: true };
    applyRedEyeCorrections(canvas, []);
    const neutral = [...ctx.getImageData(0, 0, 100, 100).data];
    applyRedEyeCorrections(canvas, [{ ...op, enabled: false }]);
    const disabled = [...ctx.getImageData(0, 0, 100, 100).data];
    applyRedEyeCorrections(canvas, [op]);
    const center = [...ctx.getImageData(50, 50, 1, 1).data];
    const outside = [...ctx.getImageData(0, 0, 1, 1).data];
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 100, 100);
    applyRedEyeCorrections(canvas, [{ ...op, mode: 'white' }]);
    const white = [...ctx.getImageData(50, 50, 1, 1).data];
    await loadFXImages([new File([await (await fetch('/test/fixtures/chart.png')).blob()], 'chart.png', { type: 'image/png' })]);
    curItem().redeye = [op];
    const snap = getUISnapshot(); curItem().redeye = []; applyUISnapshot(snap);
    return { identity: JSON.stringify(before) === JSON.stringify(neutral), disabled: JSON.stringify(before) === JSON.stringify(disabled), center, outside, white,
      restored: curItem().redeye, grouped: FX_GROUPS.texture.members.includes('redeye'), params: getFXParams().redEyeOps };
  });
  assert(result.identity && result.disabled, 'neutral and disabled recipes preserve every pixel');
  assert(result.center[0] < 240, 'human pupil red is corrected');
  assert.deepEqual(result.outside, [240, 40, 30, 255], 'pixels outside selected pupil stay unchanged');
  assert(result.white[0] < 255, 'white pet reflection darkens');
  assert.equal(result.restored.length, 1, 'snapshot restores per-photo eye correction');
  assert.equal(result.params.length, 1, 'export parameters contain correction');
  assert(result.grouped, 'red-eye panel participates in current tool grouping');
  await page.evaluate(() => { window.__libToggleUnifiedView?.(false); if (chromasmithLibraryIsOpen()) document.getElementById('lib-toggle')?.click(); fxSection('redeye'); renderPreview(); redeyeOverlaySync(); });
  const eye = page.locator('[data-redeye-i="0"]');
  await eye.waitFor({ state: 'visible' });
  const box = await eye.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 + 5, { steps: 3 });
  await page.mouse.up();
  const moved = await page.evaluate(() => curItem().redeye);
  assert.equal(moved.length, 1, 'moving an existing ellipse must not create a second correction');
  assert(moved.every(op => [op.x, op.y, op.rx, op.ry].every(Number.isFinite)), 'drag keeps finite correction geometry');
  assert.deepEqual(errors, [], 'integration creates no uncaught browser errors');
  console.log('PASS: Quick Look deduplication/prefetch/cache bound; red-eye identity, pupil isolation, pet correction, snapshot and export state; tool grouping.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
