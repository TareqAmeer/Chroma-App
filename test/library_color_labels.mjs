// CHR-267: independent colour-label surfaces, persistence, shortcuts, and undo.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
    if (pathname.endsWith('/favicon.ico')) { res.writeHead(204); res.end(); return; }
    const sourcePath = pathname === 'desktop/dist/library-ui.js' ? 'desktop/library-ui.js' : pathname;
    const body = await readFile(path.join(root, sourcePath));
    const type = sourcePath.endsWith('.html') ? 'text/html' : /\.(?:m?js)$/.test(sourcePath) ? 'text/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('chromasmith-tour-seen-v1', '1');
    if (!localStorage.getItem('chromasmith_color_test_initialized')) {
      localStorage.removeItem('chromasmith_color_labels_enabled');
      localStorage.setItem('chromasmith_color_test_initialized', '1');
    }
    localStorage.removeItem('chromasmith_lib_cull_auto_advance');
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=5`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.__libOpenFolder === 'function' && typeof window.chromasmithShortcutRegistry === 'object', { timeout: 30000 });
  await page.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });
  await page.evaluate(() => window.__libOpenFolder('/test/Photos'));
  await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length >= 4, { timeout: 30000 });
  const paths = await page.locator('#lib-grid .lib-card').evaluateAll(cards => cards.slice(0, 3).map(card => card.dataset.path));
  const [first, second] = paths;
  await page.evaluate(p => {
    window.__libtestSeedSidecar(p, { rating: 4, label: 'Green', favorite: true, color_label: '' });
    window.__libSelect(p); window.__libRenderGrid();
  }, first);
  const read = p => page.evaluate(path => window.__libtestReadSidecar(path), p);
  const settings = page.locator('#lib-color-labels-toggle');
  await page.locator('#lib-view-menu-btn').click();
  await page.locator('.fx-settings-cat[data-cat="library"]').click();
  assert.equal(await settings.isChecked(), true, 'the Gallery category is discoverable in shared Settings and labels default visible');
  assert.equal(await page.evaluate(() => localStorage.getItem('chromasmith_color_labels_enabled')), null, 'default visibility does not require a pre-existing preference');
  await page.evaluate(() => settingsClose());

  await page.keyboard.press('Alt+1');
  await page.waitForFunction(p => window.__libtestReadSidecar(p).color_label === 'Red', first);
  let saved = await read(first);
  assert.equal(saved.label, 'Green'); assert.equal(saved.rating, 4); assert.equal(saved.favorite, true);
  assert.equal(await page.locator('#lib-grid .lib-card .lib-color-dot').count(), 1, 'the labelled card displays an independent colour indicator');

  // Open the shortcut sheet first: changing the setting must refresh its rows immediately.
  await page.evaluate(() => csOpenShortcuts());
  assert.equal(await page.locator('#cs-modal-ov [data-shortcut-row] [data-binding="library.color-red"]').count(), 1);
  // Change the setting while the shortcut sheet is open to verify its live update behavior.
  await page.evaluate(() => { const t = document.querySelector('#lib-color-labels-toggle'); t.checked = false; t.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => localStorage.getItem('chromasmith_color_labels_enabled') === '0');
  await page.waitForFunction(() => !document.querySelector('#cs-modal-ov [data-binding="library.color-red"]'));
  assert.equal(await page.locator('#lib-color-label-filter-wrap').evaluate(el => getComputedStyle(el).display), 'none');
  assert.equal(await page.locator('#lib-grid .lib-color-dot').count(), 0, 'hidden preference removes card dots');

  // Undo is an explicit user action and remains available while labels are hidden.
  await page.keyboard.press('Escape');
  await page.locator('#lib-grid').focus().catch(() => {});
  await page.evaluate(() => window.__libtestFailNextSidecarWrite());
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(140);
  assert.equal((await read(first)).color_label, 'Red', 'a failed undo leaves the persisted colour and undo entry intact');
  await page.keyboard.press('Control+z');
  await page.waitForFunction(p => window.__libtestReadSidecar(p).color_label === '', first);
  const beforeHiddenKey = await read(first);
  await page.keyboard.press('Alt+1');
  await page.waitForTimeout(120);
  assert.equal((await read(first)).color_label, '', 'a hidden and rebound-capable colour shortcut cannot mutate metadata');
  assert.equal((await read(first)).label, beforeHiddenKey.label, 'Pick/Reject metadata is preserved');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__libOpenFolder === 'function', { timeout: 30000 });
  await page.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });
  await page.evaluate(() => window.__libOpenFolder('/test/Photos'));
  await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length >= 4, { timeout: 30000 });
  assert.equal(await page.evaluate(() => localStorage.getItem('chromasmith_color_labels_enabled')), '0', 'the hide preference survives reload');
  await page.evaluate(p => { window.__libtestSeedSidecar(p, { rating: 4, label: 'Green', favorite: true, color_label: '' }); window.__libSelect(p); window.__libRenderGrid(); }, first);
  await page.keyboard.press('Alt+1'); await page.waitForTimeout(120);
  assert.equal((await read(first)).color_label, '', 'the persisted hidden setting also blocks keys after reload');

  // Preference persists; enabling it restores all surfaces.
  await page.locator('#lib-view-menu-btn').click();
  await page.locator('.fx-settings-cat[data-cat="library"]').click();
  await page.locator('label[for="lib-color-labels-toggle"]').click();
  await page.waitForFunction(() => localStorage.getItem('chromasmith_color_labels_enabled') === '1');

  // Cull writes advance only after persistence succeeds; a failed write keeps the focused photo.
  await page.evaluate(ps => { ps.slice(0, 2).forEach(p => window.__libSelect(p)); window.__libRenderGrid(); }, paths);
  await page.locator('#lib-batchbar [data-act="cull"]').click();
  await page.waitForFunction(() => window.__libSurveyState()?.groupPicker, { timeout: 30000 });
  await page.click('#lib-cull-time-all');
  await page.click('#lib-cull-time-start');
  await page.waitForSelector('#fx-confirm-modal[open]');
  await page.click('#fx-confirm-ok');
  await page.waitForFunction(() => window.__libSurveyState()?.active && !window.__libSurveyState().groupPicker, { timeout: 30000 });
  const cullPath = await page.evaluate(() => window.__libSurveyState().cullPaths[0]);
  const focus0 = await page.evaluate(() => window.__libSurveyState().focus);
  await page.locator('#lib-survey .lib-survey-cell.cmp-focus .lib-cull-color-select').selectOption('Yellow');
  await page.waitForFunction(p => window.__libtestReadSidecar(p).color_label === 'Yellow', cullPath);
  await page.waitForFunction(() => window.__libSurveyState().focus !== 0);
  assert.equal(await page.evaluate(() => window.__libSurveyState().focus), 1, 'a successfully persisted cull colour advances focus');
  const focus1 = await page.evaluate(() => window.__libSurveyState().focus);
  await page.evaluate(() => window.__libtestFailNextSidecarWrite());
  await page.locator('#lib-survey .lib-survey-cell.cmp-focus .lib-cull-color-select').selectOption('Purple');
  await page.waitForTimeout(160);
  assert.equal(await page.evaluate(() => window.__libSurveyState().focus), focus1, 'failed cull colour persistence does not advance focus');
  assert.equal(focus0, 0);

  // Separate page exercises the Editor topbar with an actual open photo, independent of cull UI.
  const editorPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await editorPage.addInitScript(() => { localStorage.setItem('chromasmith-tour-seen-v1', '1'); localStorage.setItem('chromasmith_color_labels_enabled', '1'); });
  await editorPage.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=5`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await editorPage.waitForFunction(() => typeof window.__libOpenFolder === 'function', { timeout: 30000 });
  await editorPage.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });
  await editorPage.evaluate(() => window.__libOpenFolder('/test/Photos'));
  await editorPage.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length >= 4, { timeout: 30000 });
  await editorPage.locator('#lib-grid .lib-card').first().dblclick();
  await editorPage.waitForFunction(() => window.chromasmithHasOpenedPhoto?.(), { timeout: 30000 });
  const editorPicker = editorPage.locator('#btn-color-label');
  assert.notEqual(await editorPicker.evaluate(el => getComputedStyle(el).display), 'none', 'Editor label picker appears for an open photo when enabled');
  await editorPage.locator('#fx-settings').click();
  await editorPage.locator('.fx-settings-cat[data-cat="library"]').click();
  await editorPage.locator('label[for="lib-color-labels-toggle"]').click();
  await editorPage.waitForFunction(() => localStorage.getItem('chromasmith_color_labels_enabled') === '0');
  assert.equal(await editorPicker.evaluate(el => getComputedStyle(el).display), 'none', 'hidden preference hides the Editor label picker for an open photo');
  await editorPage.close();
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log('PASS: independent colour labels, Settings visibility, hidden shortcuts, persistence, undo, and cull advance');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
