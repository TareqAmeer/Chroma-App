// CHR-267: "Delete rejected (n)" after culling. Reject never deletes; the explicit step counts the
// rejects, asks once, and trashes through trash_file (system Trash). Also CHR-268 Survey header.
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
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); } catch {} });
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=12&libtime=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.__libEnterSurvey === 'function' && typeof window.__libOpenFolder === 'function', { timeout: 30000 });
  await page.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });
  await page.evaluate(() => window.__libOpenFolder('/test/Photos'));
  await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length >= 8, { timeout: 30000 });
  const paths = await page.locator('#lib-grid .lib-card').evaluateAll((c) => c.slice(0, 10).map((x) => x.dataset.path));
  const trashCalls = () => page.evaluate(() => (window.__libtestCalls || []).filter(([c]) => c === 'trash_file').map(([, a]) => a.path));
  const modalButton = (re) => page.locator('#fx-confirm-modal button').filter({ hasText: re });
  const select = async (list) => { await page.evaluate((l) => { l.forEach((p) => window.__libSelect(p)); window.__libRenderGrid(); }, list); };

  // CHR-268: Survey header states shown-of-max and what was left out.
  await select(paths.slice(0, 10));
  await page.evaluate(() => window.__libEnterSurvey());
  await page.waitForFunction(() => window.__libSurveyState()?.active && window.__libSurveyState().mode === 'survey', { timeout: 45000 });
  const head = await page.locator('#lib-survey .survey-count').textContent();
  assert.equal(head, 'Survey · 8 of 8 max · 2 more selected, not shown');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__libSurveyState().active);

  // Flow A: cull 4, reject the first, finish the shoot -> end-of-cull prompt; Cancel keeps everything.
  await page.evaluate(() => { document.querySelectorAll('.lib-card.sel').forEach((c) => c.classList.remove('sel')); });
  const four = paths.slice(0, 4);
  await page.evaluate(() => { /* fresh selection */ });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__libOpenFolder === 'function', { timeout: 30000 });
  await page.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });
  await page.evaluate(() => window.__libOpenFolder('/test/Photos'));
  await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length >= 8, { timeout: 30000 });
  await select(four);
  await page.waitForSelector('#lib-batchbar [data-act="cull"]');
  await page.locator('#lib-batchbar [data-act="cull"]').click();
  await page.waitForFunction(() => window.__libSurveyState()?.active && window.__libSurveyState().mode === 'cull', { timeout: 45000 });
  await page.locator('#lib-cull-time-all').click();
  await page.locator('#lib-cull-time-start').click(); // confirm the selected capture-time groups before opening cull mode
  await page.locator('#fx-confirm-ok').click();
  await page.waitForSelector('#lib-cull-del');
  const rejectedPath = (await page.evaluate(() => window.__libSurveyState().cullPaths))[0];
  assert.equal(await page.locator('#lib-cull-del').textContent(), 'Delete rejected (0)');
  assert.equal(await page.locator('#lib-cull-del').isDisabled(), true, 'nothing rejected: button disabled');

  await page.keyboard.press('Shift+X'); // reject photo 1, advance
  await page.waitForFunction(() => window.__libSurveyState().focus === 1);
  await page.waitForFunction(() => document.querySelector('#lib-cull-del')?.textContent === 'Delete rejected (1)');
  assert.deepEqual(await trashCalls(), [], 'rejecting never deletes');
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(250); } // pick the rest; last one ends the shoot
  await modalButton(/^Move 1 to Trash$/).waitFor({ timeout: 5000 });
  const prompt = await page.locator('#fx-confirm-msg').innerText();
  const rejectedName = path.win32.basename(rejectedPath);
  assert(prompt.includes('Delete 1 rejected photo') && prompt.includes(rejectedName) && /Trash/.test(prompt), `prompt lists count and name (${rejectedName}): ${prompt}`);
  await modalButton(/^Cancel$/).click();
  await page.waitForFunction(() => !window.__libSurveyState().active);
  assert.deepEqual(await trashCalls(), [], 'cancel trashes nothing');

  // Flow B: cull again; the reject is still flagged; delete via the bar button.
  await select(four);
  await page.waitForSelector('#lib-batchbar [data-act="cull"]');
  await page.locator('#lib-batchbar [data-act="cull"]').click();
  await page.waitForFunction(() => window.__libSurveyState()?.active && window.__libSurveyState().mode === 'cull', { timeout: 45000 });
  await page.locator('#lib-cull-time-all').click();
  await page.locator('#lib-cull-time-start').click();
  await page.locator('#fx-confirm-ok').click();
  await page.waitForSelector('#lib-cull-del');
  assert.equal(await page.locator('#lib-cull-del').textContent(), 'Delete rejected (1)');
  await page.locator('#lib-cull-del').click();
  await modalButton(/^Move 1 to Trash$/).click();
  await page.waitForFunction(() => window.__libSurveyState().cullPaths.length === 3, { timeout: 10000 });
  assert.deepEqual(await trashCalls(), [rejectedPath], 'exactly the rejected photo went to trash_file');
  const st = await page.evaluate(() => window.__libSurveyState());
  assert(!st.cullPaths.includes(rejectedPath) && st.paths.length === 3, 'cull continues with the survivors');
  assert.equal(await page.locator('#lib-cull-del').textContent(), 'Delete rejected (0)');
  await page.keyboard.press('Control+z');
  await page.waitForFunction((p) => window.__libSurveyState().cullPaths.includes(p), rejectedPath, { timeout: 10000 });
  const restoredState = await page.evaluate(() => window.__libSurveyState());
  assert.equal(restoredState.cullPaths.length, 4, 'Trash undo restores the deleted reject to the exact cull path list');
  assert.equal(restoredState.paths.length, 4, 'Trash undo restores the deleted photo to visible Library state');
  const restoreCalls = await page.evaluate(() => (window.__libtestCalls || []).filter(([cmd]) => ['restore_trashed_entry', 'catalog_note_restored'].includes(cmd)));
  const restoredReceiptIndex = restoreCalls.findIndex(([cmd, args]) => cmd === 'restore_trashed_entry' && args.receipt.originalPath === rejectedPath);
  const catalogRestoreIndex = restoreCalls.findIndex(([cmd]) => cmd === 'catalog_note_restored');
  assert(restoredReceiptIndex >= 0 && catalogRestoreIndex > restoredReceiptIndex, 'catalog visibility is restored only after the exact native receipt restore');
  assert.deepEqual(restoreCalls[catalogRestoreIndex][1].paths, [rejectedPath]);

  // All rejected items leave cull mode. Undo must refresh the current grid view instead of
  // trying to reconstruct the old cull state after the cull surface has closed.
  const allCullPaths = await page.evaluate(() => window.__libSurveyState().cullPaths);
  await page.evaluate(async (list) => {
    for (const p of list) await window.__libSetLabel(p, 'Red');
    window.__libPendingCullDelete = window.__libDeleteCullRejects();
  }, allCullPaths);
  await modalButton(/^Move 4 to Trash$/).click();
  await page.waitForFunction(() => !window.__libSurveyState().active, { timeout: 10000 });
  await page.evaluate(() => window.__libUndoLast());
  await page.waitForFunction((p) => window.__libTrashContext().viewMode === 'grid' && window.__libTrashContext().paths.includes(p), allCullPaths[0], { timeout: 15000 });
  assert.equal((await page.evaluate(() => window.__libTrashContext())).folder, '/test/Photos');

  // A delete started in one folder and completed after navigating must keep its original
  // provenance. Undo may refresh the new destination, but must not inject the old row there.
  const navPath = allCullPaths[0];
  await page.evaluate((p) => {
    window.__libtestHoldTrash = true;
    window.__libStartTrashDelete([p]);
  }, navPath);
  await modalButton(/^Move to Trash$/).click();
  await page.waitForFunction(() => (window.__libtestHeldTrash || []).length === 1, { timeout: 10000 });
  await page.evaluate(async () => { await window.__libOpenFolder('/test/Other'); });
  await page.waitForFunction(() => window.__libTrashContext().folder === '/test/Other', { timeout: 15000 });
  await page.evaluate(() => { window.__libtestHoldTrash = false; window.__libResolveHeldTrash(); });
  await page.evaluate(() => window.__libWaitTrashDelete());
  await page.evaluate(() => window.__libUndoLast());
  await page.waitForFunction((p) => window.__libTrashContext().folder === '/test/Other' && !window.__libTrashContext().paths.includes(p), navPath, { timeout: 15000 });
  const currentContext = await page.evaluate(() => window.__libTrashContext());
  assert(currentContext.paths.every((p) => p.startsWith('/test/Other/')), 'Undo after navigation never appends stale entries from the original folder');
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log('PASS: Delete rejected counts, confirms, cancels cleanly and trashes only the rejects; Survey header shows count vs cap.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
