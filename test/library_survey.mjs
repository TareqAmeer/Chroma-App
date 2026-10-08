import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
    const sourcePath = pathname === 'desktop/dist/library-ui.js' ? 'desktop/library-ui.js' : pathname;
    const body = await readFile(path.join(root, sourcePath));
    const type = sourcePath.endsWith('.html') ? 'text/html' : /\.m?js$/.test(sourcePath) ? 'text/javascript' : sourcePath.endsWith('.css') ? 'text/css' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));

const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const consoleErrors = [];
  const failedResponses = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(`${message.text()} @ ${message.location().url}`); });
  page.on('response', (response) => { if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`); });
  await page.route('**/coi-serviceworker.min.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.route('**/favicon.ico**', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/service-worker.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
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
  assert.match(layout.label, /8 of 8 max · 2 more selected, not shown/);
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
  // Start Compare from a fresh three-photo selection, then exercise the real keyboard and pane
  // selectors. Pane contents and backing canvases are observable without test-only state hooks.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__libOpenFolder === 'function', { timeout: 30000 });
  await page.evaluate(() => window.__libOpenFolder('/test/Photos'));
  await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length >= 3, { timeout: 30000 });
  const comparePaths = await page.locator('#lib-grid .lib-card').evaluateAll((cards) => cards.slice(0, 3).map((card) => card.dataset.path));
  await page.evaluate((selected) => selected.forEach((p) => window.__libSelect(p)), comparePaths);
  await page.keyboard.press('c');
  await page.waitForFunction(() => document.querySelectorAll('#lib-compare.on .lib-cmp-pane').length === 2 && [...document.querySelectorAll('#lib-compare .lib-cmp-name')].every((el) => el.textContent), { timeout: 45000 });
  const paneNames = () => page.locator('.lib-cmp-name').evaluateAll((els) => els.map((el) => el.textContent));
  const expectedNames = comparePaths.map((p) => path.basename(p));
  assert.deepEqual(await paneNames(), expectedNames.slice(0, 2), 'Compare opens the first two selected photos in A/B');
  await page.waitForFunction(() => [...document.querySelectorAll('.lib-cmp-pane canvas')].length === 2 && [...document.querySelectorAll('.lib-cmp-pane canvas')].every((el) => el.width > 0 && el.height > 0), { timeout: 45000 });
  const initialCanvasSizes = await page.locator('.lib-cmp-pane canvas').evaluateAll((els) => els.map((el) => [el.width, el.height]));
  assert.equal(initialCanvasSizes.length, 2);
  assert(initialCanvasSizes.every(([w, h]) => w > 0 && h > 0), `both panes should render: ${JSON.stringify(initialCanvasSizes)}`);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction((name) => document.querySelector('.lib-cmp-name[data-pane="B"]')?.textContent === name, expectedNames[2]);
  assert.deepEqual(await paneNames(), [expectedNames[0], expectedNames[2]], 'right arrow cycles the B pane');
  await page.keyboard.press('Enter');
  await page.waitForFunction((names) => JSON.stringify([...document.querySelectorAll('.lib-cmp-name')].map((el) => el.textContent)) === JSON.stringify(names), [expectedNames[2], expectedNames[0]]);
  assert.deepEqual(await paneNames(), [expectedNames[2], expectedNames[0]], 'Enter promotes B and swaps the two displayed photos');
  await page.locator('.lib-cmp-photo-sel[data-pane="A"]').selectOption('0');
  await page.waitForFunction((name) => document.querySelector('.lib-cmp-name[data-pane="A"]')?.textContent === name, expectedNames[0]);
  await page.keyboard.press('Tab');
  assert(await page.locator('.lib-cmp-pane[data-pane="A"]').evaluate((el) => el.classList.contains('cmp-focus')), 'Tab switches keyboard focus to pane A');
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join('; ')}`);
  assert.deepEqual(failedResponses, [], `failed resources: ${failedResponses.join('; ')}`);
  console.log('PASS: Survey capped 8/10, rated/flagged/removed/reflowed cleanly; Compare opened two rendered panes, cycled, promoted/swapped, reassigned a pane, and switched keyboard focus with no browser errors or failed resources.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
