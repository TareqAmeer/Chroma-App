// CHR-267 functional regression: cull focus must refit real fixture pixels.
// This mock-IPC browser test is not evidence for native RAW performance.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const server = createServer(async (req, res) => {
  try {
    let source = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
    if (source === 'desktop/dist/library-ui.js') source = 'desktop/library-ui.js';
    if (/serviceworker|service-worker|favicon/.test(source)) { res.writeHead(200).end(''); return; }
    const body = await readFile(path.join(process.cwd(), source));
    res.writeHead(200, { 'Content-Type': source.endsWith('.html') ? 'text/html' : source.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('chromasmith-tour-seen-v1', '1'));
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=10`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__libOpenFolder === 'function');
  await page.evaluate(async () => {
    if (!chromasmithLibraryIsOpen()) await chromasmithToggleLibrary();
    await window.__libOpenFolder('/test/Photos');
  });
  await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length >= 2);
  await page.evaluate(async () => {
    const paths = [...document.querySelectorAll('#lib-grid .lib-card')].slice(0, 2).map(el => el.dataset.path);
    const pixels = await (await fetch('/test/fixtures/chart.png')).arrayBuffer();
    window.__libtestFileBytes = Object.fromEntries(paths.map(p => [p, pixels]));
    paths.forEach(p => window.__libSelect(p)); window.__libRenderGrid();
  });
  await page.locator('#lib-batchbar [data-act="cull"]').click();
  await page.locator('#lib-cull-time-all').click();
  await page.locator('#lib-cull-time-start').click();
  await page.locator('#fx-confirm-ok').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#lib-survey .lib-survey-cell')].length === 2
    && [...document.querySelectorAll('#lib-survey .lib-survey-cell')].every(el => +el.dataset.sourceWidth > 100));
  await page.locator('#lib-survey [data-detail="fit"]').click();
  await page.locator('.lib-survey-cell[data-survey-idx="0"]').focus();
  const samples = [];
  for (const key of ['ArrowRight', 'ArrowLeft']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(400);
    const sample = await page.evaluate(() => {
      const el = document.querySelector('.lib-survey-cell.cmp-focus'), wrap = el.querySelector('.lib-cmp-canvas-wrap');
      const iw = +el.dataset.sourceWidth, ih = +el.dataset.sourceHeight;
      const fit = Math.min(1, wrap.clientWidth / iw, wrap.clientHeight / ih);
      const canvas = el.querySelector('canvas'), rect = canvas.getBoundingClientRect();
      return { index: el.dataset.surveyIdx, actual: [rect.width, rect.height], expected: [iw * fit, ih * fit], pixels: [canvas.width, canvas.height] };
    });
    samples.push(sample);
    assert.ok(sample.actual.every((n, i) => Math.abs(n - sample.expected[i]) < 3), `Focused cull canvas must fit its enlarged viewport: ${JSON.stringify(sample)}`);
    assert.ok(sample.pixels.every((n, i) => n >= Math.floor(sample.actual[i])), 'focused canvas must have enough rendered pixels');
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ samples, errors }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
