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
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().startsWith('set_sidecar failed')) consoleErrors.push(msg.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => { localStorage.removeItem('chromasmith_lib_cull_auto_advance'); localStorage.setItem('chromasmith_lib_stars_enabled','1'); });
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=10&libtime=1&libdupes=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
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
  assert.equal(groups.length, 6, '15-second threshold splits five capture bursts and keeps the unknown-time group');
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
  assert.equal(await page.textContent('#lib-cull-time-count'), '10 photos selected · 3 suggestions');
  await page.click('#lib-cull-dupes');
  await page.waitForFunction(() => document.querySelector('#lib-cull-dupes')?.textContent.includes('Found 1 near-duplicate group'), { timeout: 30000 });
  groups = await page.evaluate(() => window.__libCullTimeGroups());
  const matched = groups.find((group) => group.duplicate && group.paths.some((p) => /IMG_1001\./.test(p)) && group.paths.some((p) => /IMG_1002\./.test(p)));
  assert.ok(matched, 'near-duplicate hashes join photos from separate capture-time bursts');
  await firstGroup.locator('summary').click();
  let recommendations = await page.evaluate(() => window.__libCullRecommendations());
  assert.match(recommendations[0].path, /IMG_1003\.RW2$/, 'highest catalog focus score is suggested across the joined duplicate/burst group');
  assert.match(recommendations[0].reason, /Highest available focus score.*near-duplicate cluster/, 'the suggestion explains focus ranking and duplicate evidence');
  await page.locator('[data-best-prev="0"]').click();
  recommendations = await page.evaluate(() => window.__libCullRecommendations());
  assert.match(recommendations[0].path, /IMG_1001\.RW2$/, 'reviewer can override the suggested keeper');
  assert.equal(recommendations[0].manual, true, 'override is recorded as manual');
  assert.match(recommendations[0].reason, /Manual override/, 'override reason is shown');
  await page.click('#lib-cull-time-start');
  await page.waitForSelector('#fx-confirm-modal[open]');
  assert.match(await page.textContent('#fx-confirm-msg'), /Start culling 10 photos/, 'confirmation shows the selected photo count');
  assert.match(await page.textContent('#fx-confirm-msg'), /suggested best frame/, 'confirmation explains the suggestions');
  assert.ok((await page.evaluate(() => window.__libSurveyState().cullLabels)).every((label) => !label), 'suggestions never change labels before confirmation');
  await page.click('#fx-confirm-cancel');
  assert.equal((await page.evaluate(() => window.__libSurveyState())).groupPicker, true, 'cancel leaves the group review open');
  assert.ok((await page.evaluate(() => window.__libSurveyState().cullLabels)).every((label) => !label), 'cancel still leaves every label unchanged');
  await page.click('#lib-cull-time-start');
  await page.waitForSelector('#fx-confirm-modal[open]');
  await page.click('#fx-confirm-ok');
  await page.waitForFunction(() => window.__libSurveyState()?.active && window.__libSurveyState().mode === 'cull' && !window.__libSurveyState().groupPicker, { timeout: 45000 });
  const orderedCullPaths = await page.evaluate(() => window.__libSurveyState().cullPaths);
  assert.match(orderedCullPaths[0], /IMG_1001\.RW2$/, 'confirmed culling begins with the manually preferred frame');
  await page.waitForFunction(() => document.querySelectorAll('#lib-survey .lib-survey-cell').length === 4, { timeout: 45000 });
  assert.equal(await page.locator('#lib-survey .lib-survey-cell.cmp-focus').count(), 1, 'cull view has one prominent focused preview');
  assert.equal(await page.locator('#lib-survey .lib-survey-cell:not(.cmp-focus)').count(), 3, 'the remaining loaded photos form the filmstrip');
  const focusHeight = await page.locator('#lib-survey .lib-survey-cell.cmp-focus').evaluate((el) => el.getBoundingClientRect().height);
  const stripHeight = await page.locator('#lib-survey .lib-survey-cell:not(.cmp-focus)').first().evaluate((el) => el.getBoundingClientRect().height);
  assert.ok(focusHeight > stripHeight * 2, `focused preview (${focusHeight}px) is substantially larger than filmstrip (${stripHeight}px)`);
  assert.equal(await page.locator('#lib-cull-auto-advance').isChecked(), true, 'auto-advance defaults on to preserve the existing keyboard-first flow');
  await page.click('#lib-cull-fullscreen');
  await page.waitForFunction(() => document.fullscreenElement?.id === 'lib-survey');
  await page.click('#lib-cull-fullscreen');
  await page.waitForFunction(() => !document.fullscreenElement);
  // The fullscreen toggle keeps focus after native activation; return keyboard focus to the survey cell.
  await page.locator('#lib-survey .lib-survey-cell.cmp-focus').focus();

  // The user can pause after each decision; undo still restores cull flags while the survey owns
  // keyboard focus, and a failed persistence attempt leaves focus on the same photo.
  await page.locator('#lib-cull-auto-advance').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('chromasmith_lib_cull_auto_advance')), '0');
  await page.locator('#lib-survey .lib-survey-cell[data-survey-idx="0"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.lib-survey-cell[data-survey-idx="0"] [data-survey-action="pick"]')?.classList.contains('on'));
  assert.equal((await page.evaluate(() => window.__libSurveyState())).focus, 0, 'disabled auto-advance leaves the decision photo focused');
  await page.keyboard.press('Control+Z');
  await page.waitForFunction(() => !document.querySelector('.lib-survey-cell[data-survey-idx="0"] [data-survey-action="pick"]')?.classList.contains('on'));
  assert.equal((await page.evaluate(() => window.__libSurveyState())).focus, 0, 'undo clears the pick without moving focus');
  await page.evaluate(() => window.__libtestFailNextSidecarWrite());
  await page.keyboard.press('Shift+X');
  await page.waitForTimeout(100);
  assert.equal((await page.evaluate(() => window.__libSurveyState())).focus, 0, 'failed reject write does not advance');
  assert.equal(await page.locator('.lib-survey-cell[data-survey-idx="0"] [data-survey-action="reject"]').evaluate((el) => el.classList.contains('on')), false, 'failed reject is rolled back');
  await page.locator('#lib-cull-auto-advance').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('chromasmith_lib_cull_auto_advance')), '1');
  await page.locator('#lib-survey .lib-survey-cell[data-survey-idx="0"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.lib-survey-cell[data-survey-idx="0"] [data-survey-action="pick"]')?.classList.contains('on') && window.__libSurveyState().focus === 1);
  await page.evaluate(() => window.__libtestFailNextSidecarWrite());
  await page.keyboard.press('Shift+X');
  await page.waitForTimeout(100);
  assert.equal((await page.evaluate(() => window.__libSurveyState())).focus, 1, 'failed write with auto-advance on still does not advance');
  await page.keyboard.press('Shift+X');
  await page.waitForFunction(() => document.querySelector('.lib-survey-cell[data-survey-idx="1"] [data-survey-action="reject"]')?.classList.contains('on') && window.__libSurveyState().focus === 2);
  // Return to the beginning so the existing page-boundary assertions cover a full four-photo page.
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');

  // Rebound registry actions must use the same cull advance path as legacy Enter/Shift+X.
  await page.evaluate(()=>{csShortcutSet('library.pick','F7');csShortcutSet('library.reject','F8');csShortcutSet('library.rate-5','F9');});
  await page.keyboard.press('F7');await page.waitForFunction(()=>window.__libSurveyState().focus===1);
  await page.keyboard.press('F8');await page.waitForFunction(()=>window.__libSurveyState().focus===2);
  await page.evaluate(()=>window.__libtestFailNextSidecarWrite());await page.keyboard.press('F9');await page.waitForTimeout(100);
  assert.equal((await page.evaluate(()=>window.__libSurveyState())).focus,2,'failed rebound rating stays on decision photo');
  assert.notEqual(await page.locator('.lib-survey-cell[data-survey-idx="2"] .lib-cmp-chrome span').textContent(),'5★','failed rating is rolled back');
  await page.keyboard.press('F9');await page.waitForFunction(()=>window.__libSurveyState().focus===3);
  assert.equal(await page.locator('.lib-survey-cell[data-survey-idx="2"] .lib-cmp-chrome span').textContent(),'5★');
  await page.locator('#lib-cull-auto-advance').click();await page.locator('.lib-survey-cell[data-survey-idx="3"]').focus();await page.keyboard.press('F9');await page.waitForTimeout(100);
  assert.equal((await page.evaluate(()=>window.__libSurveyState())).focus,3,'rebound rating respects paused advance');
  await page.evaluate(()=>{for(const id of ['library.pick','library.reject','library.rate-5'])csShortcutSet(id,null);});
  await page.locator('#lib-cull-auto-advance').click();
  await page.locator('.lib-survey-cell[data-survey-idx="0"]').focus();

  let state = await page.evaluate(() => window.__libSurveyState());
  assert.equal(state.paths.length, 4, 'culling keeps the visible batch bounded to four');
  assert.equal(state.cullPaths.length, 10, 'culling retains the full selected shoot');
  const orderedPaths = groups.flatMap((g, i) => { const preferred = recommendations[i]?.path; return preferred && g.paths.includes(preferred) ? [preferred, ...g.paths.filter((path) => path !== preferred)] : g.paths; });
  assert.deepEqual(state.cullPaths, orderedPaths, 'the cull follows capture-time groups, with unknown-time photos last');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector(`.lib-survey-cell[data-survey-idx="0"] [data-survey-action="pick"]`)?.classList.contains('on') && window.__libSurveyState().focus === 1);
  state = await page.evaluate(() => window.__libSurveyState());
  assert.equal(state.paths[1], orderedPaths[1], 'Enter flags the focused path then advances');

  for (let i = 0; i < 3; i++) { await page.keyboard.press('Enter'); await page.waitForFunction(position=>window.__libSurveyState().offset+window.__libSurveyState().focus===position,i+2); }
  await page.waitForFunction((expected) => window.__libSurveyState().offset === 4 && window.__libSurveyState().paths[0] === expected, orderedPaths[4]);
  await page.waitForFunction(() => document.querySelectorAll('#lib-survey .lib-survey-cell').length === 4);
  state = await page.evaluate(() => window.__libSurveyState());
  assert.deepEqual(state.paths, orderedPaths.slice(4, 8), 'next page continues through the original full selection');
  assert.equal(await page.locator('#lib-survey [data-survey-remove]').count(), 0, 'Culling hides Survey removal controls to keep the full shoot paging stable');
  await page.keyboard.press('Shift+X');
  await page.waitForFunction(() => document.querySelector('.lib-survey-cell[data-survey-idx="0"] [data-survey-action="reject"]')?.classList.contains('on') && window.__libSurveyState().focus === 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__libSurveyState().active), false, 'Escape exits Culling');
  assert.equal(await page.evaluate(() => localStorage.getItem('chromasmith_lib_cull_auto_advance')), '1', 'auto-advance preference survives cull exit');
  assert.notEqual(await page.locator('#lib-grid').evaluate((el) => getComputedStyle(el).display), 'none');
  await page.evaluate((selected) => { selected.forEach((p) => window.__libSelect(p)); window.__libRenderGrid(); }, paths);
  await page.waitForSelector('#lib-batchbar [data-act="cull"]');
  await page.locator('#lib-batchbar [data-act="cull"]').click();
  await page.waitForFunction(() => window.__libSurveyState()?.active && window.__libSurveyState().groupPicker);
  await page.click('#lib-cull-time-all'); await page.click('#lib-cull-time-start');
  await page.waitForSelector('#fx-confirm-modal[open]');
  await page.click('#fx-confirm-ok');
  await page.waitForFunction(() => window.__libSurveyState()?.active && !window.__libSurveyState().groupPicker);
  assert.equal(await page.locator('#lib-cull-auto-advance').isChecked(), true, 'preference is restored when cull mode is entered again');
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join('; ')}`);
  console.log(`PASS: capture grouping 60s→2 and 15s→6 groups; mocked dHash joins two captures 120s apart (6→${groups.length}); focus-ranked reason/override; focus/filmstrip ${focusHeight}px/${stripHeight}px; fullscreen, auto-advance/undo, and 10-photo cull pass.`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
