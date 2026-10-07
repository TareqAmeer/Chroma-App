import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
    if (pathname.endsWith('coi-serviceworker.min.js')) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(''); return; }
    if (pathname.endsWith('/favicon.ico')) { res.writeHead(204); res.end(); return; }
    const sourcePath = pathname === 'desktop/dist/library-ui.js' ? 'desktop/library-ui.js' : pathname;
    const body = await readFile(path.join(root, sourcePath));
    const type = sourcePath.endsWith('.html') ? 'text/html' : /\.(?:m?js)$/.test(sourcePath) ? 'text/javascript' : sourcePath.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(body);
  } catch { console.error('HARNESS_404', req.url); res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));

const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [], consoleErrors = []; await page.addInitScript(() => { try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); } catch {} }); // first-run welcome card would intercept clicks
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=10&libtime=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => document.readyState === 'complete', { timeout: 30000 });
  await page.waitForFunction(() => typeof window.__libEnterSurvey === 'function' && typeof window.__libOpenFolder === 'function', { timeout: 30000 });
  await page.evaluate(() => document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); }));
  await page.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });
  await page.locator('#cs-modal-ov button').filter({ hasText: /^Got it$/ }).click({ timeout: 3000 }).catch(() => {});
  await page.evaluate(() => window.__libOpenFolder('/test/Photos'));
  await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length >= 8, { timeout: 30000 });
  const paths = await page.locator('#lib-grid .lib-card').evaluateAll((cards) => cards.slice(0, 10).map((card) => card.dataset.path));
  // Deliberately add them in reverse selection order: the shoot should still follow the
  // Library's visible sort order, not whichever card was clicked first.
  await page.evaluate((selected) => { selected.forEach((p) => window.__libSelect(p)); window.__libRenderGrid(); }, [...paths].reverse());
  await page.locator('#cs-modal-ov button').filter({ hasText: /^Got it$/ }).click({ timeout: 3000 }).catch(() => {});
  await page.waitForSelector('#lib-batchbar [data-act="cull"]');
  assert.equal(await page.locator('#lib-batchbar [data-act="cull"]').textContent(), 'Cull selection');
  await page.locator('#lib-batchbar [data-act="cull"]').click();
  await page.waitForFunction(() => window.__libSurveyState()?.active && window.__libSurveyState().mode === 'cull' && window.__libSurveyState().groupPicker, { timeout: 45000 });

  assert.equal((await page.evaluate(() => window.__libCullTimeGroups())).length, 2, '60-second threshold chains adjacent captures; missing time stays separate');
  await page.selectOption('#lib-cull-time-gap', '15');
  let groups = await page.evaluate(() => window.__libCullTimeGroups());
  assert.equal(groups.length, 5, '15-second threshold splits the four capture bursts and keeps the unknown-time group');
  assert.equal(groups.at(-1).unknown, true, 'unknown capture times form their own final group');
  const firstGroup = page.locator('details[data-time-group="0"]');
  assert.equal(await firstGroup.evaluate((el) => el.open), false, 'capture groups start collapsed');
  await firstGroup.locator('summary').click();
  assert.equal(await firstGroup.evaluate((el) => el.open), true, 'a group expands to show its photo names');
  await firstGroup.locator('summary').click();
  assert.equal(await firstGroup.evaluate((el) => el.open), false, 'the group collapses again');
  await page.selectOption('#lib-cull-time-gap', '60');
  assert.equal((await page.evaluate(() => window.__libCullTimeGroups())).length, 2, 'changing the threshold regroups immediately');
  await page.selectOption('#lib-cull-time-gap', '15');
  groups = await page.evaluate(() => window.__libCullTimeGroups());
  await page.click('#lib-cull-time-all');
  assert.equal(await page.textContent('#lib-cull-time-count'), '10 selected');
  await page.click('#lib-cull-time-start');
  await page.waitForFunction(() => window.__libSurveyState()?.active && window.__libSurveyState().mode === 'cull' && !window.__libSurveyState().groupPicker, { timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll('#lib-survey .lib-survey-cell').length === 4, { timeout: 45000 });
  assert.equal(await page.locator('#lib-survey .lib-survey-cell.cmp-focus').count(), 1, 'cull view has one prominent focused preview');
  assert.equal(await page.locator('#lib-survey .lib-survey-cell:not(.cmp-focus)').count(), 3, 'the remaining loaded photos form the filmstrip');
  const focusHeight = await page.locator('#lib-survey .lib-survey-cell.cmp-focus').evaluate((el) => el.getBoundingClientRect().height);
  const stripHeight = await page.locator('#lib-survey .lib-survey-cell:not(.cmp-focus)').first().evaluate((el) => el.getBoundingClientRect().height);
  assert.ok(focusHeight > stripHeight * 2, `focused preview (${focusHeight}px) is substantially larger than filmstrip (${stripHeight}px)`);
  await page.click('#lib-cull-fullscreen');
  await page.waitForFunction(() => document.fullscreenElement?.id === 'lib-survey');
  await page.click('#lib-cull-fullscreen');
  await page.waitForFunction(() => !document.fullscreenElement);
  // The fullscreen toggle keeps focus after native activation; return keyboard focus to the survey cell.
  await page.locator('#lib-survey .lib-survey-cell.cmp-focus').focus();

  let state = await page.evaluate(() => window.__libSurveyState());
  assert.equal(state.paths.length, 4, 'culling keeps the visible batch bounded to four');
  assert.equal(state.cullPaths.length, 10, 'culling retains the full selected shoot');
  const orderedPaths = groups.flatMap((g) => g.paths);
  assert.deepEqual(state.cullPaths, orderedPaths, 'the cull follows capture-time groups, with unknown-time photos last');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector(`.lib-survey-cell[data-survey-idx="0"] [data-survey-action="pick"]`)?.classList.contains('on') && window.__libSurveyState().focus === 1);
  state = await page.evaluate(() => window.__libSurveyState());
  assert.equal(state.paths[1], orderedPaths[1], 'Enter flags the focused path then advances');

  for (let i = 0; i < 3; i++) await page.keyboard.press('Enter');
  await page.waitForFunction((expected) => window.__libSurveyState().offset === 4 && window.__libSurveyState().paths[0] === expected, orderedPaths[4]);
  await page.waitForFunction(() => document.querySelectorAll('#lib-survey .lib-survey-cell').length === 4);
  state = await page.evaluate(() => window.__libSurveyState());
  assert.deepEqual(state.paths, orderedPaths.slice(4, 8), 'next page continues through the original full selection');
  assert.equal(await page.locator('#lib-survey [data-survey-remove]').count(), 0, 'Culling hides Survey removal controls to keep the full shoot paging stable');
  await page.keyboard.press('Shift+X');
  await page.waitForFunction(() => document.querySelector('.lib-survey-cell[data-survey-idx="0"] [data-survey-action="reject"]')?.classList.contains('on') && window.__libSurveyState().focus === 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__libSurveyState().active), false, 'Escape exits Culling');
  assert.notEqual(await page.locator('#lib-grid').evaluate((el) => getComputedStyle(el).display), 'none');
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join('; ')}`);
  console.log(`PASS: capture grouping 60s→2 groups, 15s→${groups.length} groups, unknown-time isolated; focus/filmstrip ${focusHeight}px/${stripHeight}px; fullscreen enter/exit; 10-photo cull in four-photo pages with capture-ordered Pick/Reject advance and clean exit.`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
