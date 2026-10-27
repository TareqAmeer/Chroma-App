// Library grid cards show each edited photo's saved look (not the camera image): after a batch
// edit the card updates once its edited render lands, "Refresh thumbnail(s)" forces a re-render,
// and Reset edit puts the original back.
//   node test/library_edited_thumbs.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) throw Error('outside root');
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css' };
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); localStorage.setItem('chromasmithAutoPreviews', '0'); } catch {} });
  await page.goto(`${base}/desktop/dist/index.html?libtest=1&libn=12&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.__libRefreshThumbs === 'function' && typeof window.__libEditPreviewEnqueue === 'function', { timeout: 60000 });
  await page.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });
  await page.waitForFunction(() => document.querySelectorAll('.lib-card[data-path] .lib-thumb-wrap img.loaded').length >= 4, null, { timeout: 60000 });

  const paths = await page.evaluate(async () => {
    const ps = [...document.querySelectorAll('.lib-card[data-path]')].map((c) => c.dataset.path).filter((p) => !/\.(mp4|mov)$/i.test(p)).slice(0, 3);
    const c = document.createElement('canvas'); c.width = 900; c.height = 600; const g = c.getContext('2d');
    g.fillStyle = '#4a6fa5'; g.fillRect(0, 0, 900, 600); g.fillStyle = '#d4a373'; g.fillRect(100, 100, 400, 300);
    const jpg = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());
    window.__libtestQuicklookBytesByPath = window.__libtestQuicklookBytesByPath || {};
    window.__enc = (snap) => btoa(unescape(encodeURIComponent(JSON.stringify(snap))));
    window.__img = (p) => document.querySelector(`.lib-card[data-path="${CSS.escape(p)}"] .lib-thumb-wrap img`);
    for (const p of ps) window.__libtestQuicklookBytesByPath[p] = jpg.buffer.slice(0);
    return ps;
  });
  const idle = () => page.waitForFunction(() => { const d = window.__libEditPreviewDebug(); return !d.running && !d.queue.length; }, null, { timeout: 300000, polling: 100 });
  const cardState = () => page.evaluate((ps) => ps.map((p) => { const i = window.__img(p); return { edited: !!(i && i.dataset.editedThumb), src: i && i.src }; }), paths);

  // 1. Batch edit: every photo's recipe saved through set_sidecar (as the Editor's batch apply does).
  const origSrc = (await cardState()).map((s) => s.src);
  await page.evaluate(async (ps) => {
    for (const [i, p] of ps.entries()) {
      const recipe = window.__enc({ ver: 2, sliders: { 'adj-exp': 20 + i * 10 }, toggles: { adjust: true }, selects: {}, colors: {} });
      window.__libtestSeedSidecar(p, { edited: true, recipe });
    }
    ps.forEach((p) => window.__libEditPreviewEnqueue(p)); // what each batch set_sidecar triggers
  }, paths);
  await idle();
  await page.waitForFunction((ps) => ps.every((p) => window.__img(p) && window.__img(p).dataset.editedThumb), paths, { timeout: 30000 });
  const afterBatch = await cardState();
  afterBatch.forEach((s, i) => assert.notEqual(s.src, origSrc[i], `${paths[i]}: card shows the edited render`));
  console.log('batch edit: all 3 cards show the edited look');

  // 2. Grid re-render keeps the edited look (same as scrolling a card out and back).
  await page.evaluate(() => window.__libRenderGrid());
  await page.waitForFunction((ps) => ps.every((p) => window.__img(p) && window.__img(p).dataset.editedThumb), paths, { timeout: 30000 });

  // 2b. Fresh launch: nothing in memory, the stored edited renders are reused (no re-render).
  const storedNow = await page.evaluate(() => window.__libtestEditPreviews.size);
  await page.evaluate(() => { window.__libEditedThumbsForget(); window.__libRenderGrid(); });
  await page.waitForFunction((ps) => ps.every((p) => window.__img(p) && window.__img(p).dataset.editedThumb), paths, { timeout: 30000 });
  await idle();
  assert.equal(await page.evaluate(() => window.__libtestEditPreviews.size), storedNow, 'stored renders reused after a fresh launch');
  console.log('fresh launch: edited looks come back from the stored renders');

  // 3. Refresh thumbnails forces a new render even though one is stored.
  const storedBefore = await page.evaluate(() => window.__libtestEditPreviews.size);
  await page.evaluate((ps) => { window.__libtestEditPreviews.clear(); window.__libRefreshThumbs(ps); }, paths);
  await idle();
  await page.waitForFunction((ps) => ps.every((p) => window.__img(p) && window.__img(p).dataset.editedThumb), paths, { timeout: 30000 });
  assert.equal(await page.evaluate(() => window.__libtestEditPreviews.size), 3, 'refresh re-rendered every edited photo');
  console.log(`refresh: re-rendered 3 edited looks (${storedBefore} were stored before)`);

  // 4. A new edit replaces the card's look; reset puts the original back.
  const before = (await cardState())[0].src;
  await page.evaluate((p) => {
    const recipe = window.__enc({ ver: 2, sliders: { 'adj-exp': -60 }, toggles: { adjust: true }, selects: {}, colors: {} });
    window.__libtestSeedSidecar(p, { edited: true, recipe });
    window.__libEditPreviewEnqueue(p);
  }, paths[0]);
  await idle();
  await page.waitForFunction(([p, s]) => window.__img(p).dataset.editedThumb && window.__img(p).src !== s, [paths[0], before], { timeout: 30000 });
  await page.evaluate((p) => { window.__libtestSeedSidecar(p, { edited: false, recipe: '' }); window.__libRefreshThumbs([p]); }, paths[0]);
  await page.waitForFunction((p) => !window.__img(p).dataset.editedThumb && window.__img(p).classList.contains('loaded'), paths[0], { timeout: 30000 });
  console.log('new edit updates the card; an unedited photo goes back to its original thumbnail');
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log('PASS: edited looks on Library grid cards.');
} finally {
  await browser.close(); server.close();
}
