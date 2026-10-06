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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('chromasmith_lib_stars_enabled', '1'));
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=12`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.__libEnterSurvey === 'function' && typeof window.__libOpenFolder === 'function', { timeout: 30000 });
  await page.evaluate(() => document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); }));
  await page.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });
  await page.evaluate(() => window.__libOpenFolder('/test/Photos'));
  await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length >= 8, { timeout: 30000 });
  const paths = await page.locator('#lib-grid .lib-card').evaluateAll((cards) => cards.slice(0, 10).map((card) => card.dataset.path));
  await page.evaluate((selected) => selected.forEach((p) => window.__libSelect(p)), paths);
  await page.keyboard.press('n');
  await page.waitForFunction(() => document.querySelectorAll('#lib-survey .lib-survey-cell').length === 8, { timeout: 45000 });

  let layout = await page.evaluate(() => ({
    count: document.querySelectorAll('#lib-survey .lib-survey-cell').length,
    columns: getComputedStyle(document.getElementById('lib-survey-grid')).gridTemplateColumns.split(' ').length,
    label: document.querySelector('.survey-count')?.textContent,
    gridDisplay: getComputedStyle(document.getElementById('lib-grid')).display,
  }));
  assert.equal(layout.count, 8);
  assert.equal(layout.columns, 4, `8 photos should fit in four columns at 1440px; got ${layout.columns}`);
  assert.match(layout.label, /first 8 of 10 selected/);
  assert.equal(layout.gridDisplay, 'none');

  const survivorCanvases = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('#lib-survey .lib-survey-cell')];
    window.__surveyBefore = cells.map((cell) => cell.querySelector('canvas'));
    window.__surveyRemovedCanvas = window.__surveyBefore[1];
    return cells.map((cell) => cell.querySelector('canvas'));
  });
  await page.keyboard.press('ArrowRight');
  assert.equal((await page.evaluate(() => window.__libSurveyState())).focus, 1);
  await page.keyboard.press('x');
  await page.waitForFunction(() => document.querySelector('.lib-survey-cell[data-survey-idx="1"] [data-survey-action="reject"]')?.classList.contains('on'));
  await page.keyboard.press('5');
  await page.waitForFunction(() => document.querySelector('.lib-survey-cell[data-survey-idx="1"] .lib-cmp-chrome span')?.textContent === '5★');
  await page.keyboard.press('Delete');
  const afterRemove = await page.evaluate(() => ({
    state: window.__libSurveyState(),
    canvases: [...document.querySelectorAll('#lib-survey .lib-survey-cell canvas')],
    removedCanvasSize: [window.__surveyRemovedCanvas.width, window.__surveyRemovedCanvas.height],
    count: document.querySelectorAll('#lib-survey .lib-survey-cell').length,
    names: [...document.querySelectorAll('#lib-survey .lib-survey-name')].map((el) => el.textContent),
  }));
  assert.equal(afterRemove.count, 7);
  assert.equal(afterRemove.state.focus, 1);
  assert.deepEqual(afterRemove.removedCanvasSize, [0, 0], 'removed canvas releases its backing store');
  assert.equal(afterRemove.state.paths[1], paths[2], 'removing the focused photo keeps following photos in order');
  assert.deepEqual(afterRemove.canvases, survivorCanvases.filter((_, i) => i !== 1), 'reflow preserves remaining rendered canvases');
  assert(!afterRemove.names.includes(paths[1].split('/').pop()));

  await page.setViewportSize({ width: 700, height: 900 });
  layout = await page.evaluate(() => getComputedStyle(document.getElementById('lib-survey-grid')).gridTemplateColumns.split(' ').length);
  assert.equal(layout, 2, 'tablet width should reflow to two columns');
  await page.setViewportSize({ width: 500, height: 900 });
  layout = await page.evaluate(() => getComputedStyle(document.getElementById('lib-survey-grid')).gridTemplateColumns.split(' ').length);
  assert.equal(layout, 1, 'phone width should reflow to one column');

  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__libSurveyState().active), false);
  assert.notEqual(await page.locator('#lib-grid').evaluate((el) => getComputedStyle(el).display), 'none');
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log('PASS: Survey shows a capped 8/10 set at 1440px, routes focused rating/flag actions, removes and reflows without repainting surviving cells, and exits cleanly.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
