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
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=12`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.__libEnterSurvey === 'function' && typeof window.__libOpenFolder === 'function', { timeout: 30000 });
  await page.evaluate(() => document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); }));
  await page.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });
  await page.evaluate(() => window.__libOpenFolder('/test/Photos'));
  await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length >= 8, { timeout: 30000 });
  const paths = await page.locator('#lib-grid .lib-card').evaluateAll((cards) => cards.slice(0, 10).map((card) => card.dataset.path));
  await page.evaluate((selected) => { selected.forEach((p) => window.__libSelect(p)); window.__libRenderGrid(); }, paths);
  await page.waitForSelector('#lib-batchbar [data-act="cull"]');
  assert.equal(await page.locator('#lib-batchbar [data-act="cull"]').textContent(), 'Cull selection');
  await page.locator('#lib-batchbar [data-act="cull"]').click();
  await page.waitForFunction(() => window.__libSurveyState()?.active && window.__libSurveyState().mode === 'cull', { timeout: 45000 });

  let state = await page.evaluate(() => window.__libSurveyState());
  assert.equal(state.paths.length, 4, 'culling keeps the visible batch bounded to four');
  assert.equal(state.cullPaths.length, 10, 'culling retains the full selected shoot');
  await page.keyboard.press('Enter');
  await page.waitForFunction((p) => document.querySelector(`.lib-survey-cell[data-survey-idx="0"] [data-survey-action="pick"]`)?.classList.contains('on') && window.__libSurveyState().focus === 1, paths[0]);
  state = await page.evaluate(() => window.__libSurveyState());
  assert.equal(state.paths[1], paths[1], 'Enter flags the focused path then advances');

  for (let i = 0; i < 3; i++) await page.keyboard.press('Enter');
  await page.waitForFunction((expected) => window.__libSurveyState().offset === 4 && window.__libSurveyState().paths[0] === expected, paths[4]);
  state = await page.evaluate(() => window.__libSurveyState());
  assert.deepEqual(state.paths, paths.slice(4, 8), 'next page continues through the original full selection');
  await page.keyboard.press('Shift+X');
  await page.waitForFunction(() => document.querySelector('.lib-survey-cell[data-survey-idx="0"] [data-survey-action="reject"]')?.classList.contains('on') && window.__libSurveyState().focus === 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__libSurveyState().active), false, 'Escape exits Culling');
  assert.notEqual(await page.locator('#lib-grid').evaluate((el) => getComputedStyle(el).display), 'none');
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log('PASS: Culling offers multi-selection entry, reviews all selections in four-photo pages, advances Pick/Reject through existing flags, and exits cleanly.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
