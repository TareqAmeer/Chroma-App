// CHR-192 native UI integration check. Attaches to an already launched isolated Tauri app;
// it never starts/closes the app and only opens an ordinary PNG/JPEG fixture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

const repoRoot = path.resolve(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(), '..', '..');
const sourceCommit = process.env.CULL_NATIVE_COMMIT;
const expectedBuild = process.env.CULL_EXPECTED_BUILD;
const catalogDir = process.env.CULL_NATIVE_CATALOG_DIR;
const cacheDir = process.env.CULL_NATIVE_CACHE_DIR;
const fixturePath = process.env.CULL_LIBRARY_FIXTURE_PATH;
const endpoint = process.env.NATIVE_CDP || 'http://127.0.0.1:9223';
const reportPath = process.env.CULL_LIBRARY_NAV_REPORT || 'docs/validation/chr192/library-navigation-native-2026-10-12.json';
const screenshotPath = process.env.CULL_LIBRARY_NAV_SCREENSHOT || 'docs/validation/chr192/library-navigation-native-2026-10-12.png';

assert(expectedBuild && /^[a-f0-9]{40}$/.test(sourceCommit || ''), 'Set exact CULL_EXPECTED_BUILD and CULL_NATIVE_COMMIT');
assert(catalogDir && cacheDir && fixturePath, 'Set task-owned catalog/cache and CULL_LIBRARY_FIXTURE_PATH');
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceCommit, 'checkout must match the recorded source commit');
const expectedCatalogDir = path.join(repoRoot, '.worktrees', '_shared-test-runtime', 'native', 'chr192-20261012', 'catalog');
const expectedCacheDir = path.join(repoRoot, '.worktrees', '_shared-test-runtime', 'native', 'chr192-20261012', 'cache');
assert.equal(path.resolve(catalogDir).toLowerCase(), path.resolve(expectedCatalogDir).toLowerCase(), 'catalog must be the CHR-192 task-owned directory');
assert.equal(path.resolve(cacheDir).toLowerCase(), path.resolve(expectedCacheDir).toLowerCase(), 'cache must be the CHR-192 task-owned directory');
assert(/\.(png|jpe?g)$/i.test(fixturePath), 'native UI fixture must be an ordinary PNG/JPEG, never RAW');
const fixtureBytes = await readFile(fixturePath);
const fixtureSha = createHash('sha256').update(fixtureBytes).digest('hex');
const fixtureStat = await stat(fixturePath);
const report = { issue: 'CHR-192', capturedAt: new Date().toISOString(), sourceCommit, expectedBuild,
  fixture: { path: fixturePath, sha256: fixtureSha, bytes: fixtureStat.size },
  isolation: { catalogDir, cacheDir, endpoint },
  hardware: { platform: os.platform(), release: os.release(), cpu: os.cpus()[0]?.model },
  browser: { viewport: '1366x768', themes: [], nativeDecode: false }, result: 'RUNNING' };
const save = async () => { await mkdir(path.dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2)); };
const samePath = (a, b) => path.resolve(String(a)).toLowerCase() === path.resolve(String(b)).toLowerCase();
const sameBrowserPath = (a, b) => String(a || '').replace(/[\\/]+/g, '/').toLowerCase() === String(b || '').replace(/[\\/]+/g, '/').toLowerCase();

const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = browser.contexts()[0]?.pages().find(p => !p.url().includes('devtools'));
  assert(page, 'Native WebView page missing');
  const runtime = await page.evaluate(async () => {
    if (new URL(location.href).searchParams.has('libtest') || !window.__TAURI__?.core?.invoke) throw Error('Real Tauri IPC is required');
    const catalog = await window.__TAURI__.core.invoke('catalog_query', { q: { offset: 0, limit: 200 } });
    return { build: BUILD, url: location.href, catalogTotal: catalog.total, entries: catalog.entries || [] };
  });
  report.runtime = { build: runtime.build, url: runtime.url, catalogTotal: runtime.catalogTotal,
    fixtureIndexed: runtime.entries.some(entry => samePath(entry.path, fixturePath)) };
  assert.equal(runtime.build, expectedBuild, 'attached app BUILD does not match expected build');
  assert(report.runtime.fixtureIndexed, 'task fixture must already be indexed in the isolated catalog');
  const invoke = (command, args = {}) => page.evaluate(([cmd, a]) => window.__TAURI__.core.invoke(cmd, a), [command, args]);
  const rootPath = process.env.CULL_LIBRARY_ROOT || path.dirname(path.dirname(fixturePath));
  const folderPath = path.dirname(fixturePath);
  assert.equal(path.resolve(folderPath), path.resolve(path.join(rootPath, 'Session')), 'fixture must be in the task-owned Session folder');
  const catalog = await invoke('catalog_query', { q: { offset: 0, limit: 200 } });
  const indexed = catalog.entries || [];
  const sessionEntries = indexed.filter(entry => path.resolve(entry.path).toLowerCase().startsWith(path.resolve(folderPath).toLowerCase() + path.sep.toLowerCase()));
  assert(sessionEntries.some(entry => samePath(entry.path, fixturePath)), 'fixture path must be available to Gallery');
  assert.equal(sessionEntries.length, 72, 'task-owned Session should contain only its 72 PNG fixture hardlinks');
  assert(sessionEntries.every(entry => /\.(png|jpe?g)$/i.test(entry.path)), 'isolated native catalog must contain no RAW sources');
  report.runtime.sessionPhotoCount = sessionEntries.length;
  report.runtime.sessionExtensions = [...new Set(sessionEntries.map(entry => path.extname(entry.path).toLowerCase()))];

  const activeSourceBefore = await page.evaluate(() => window.chromasmithSourcePath || '');
  if (!(await page.evaluate(() => document.body.classList.contains('lib-full')))) {
    await page.locator('#cs-tog-lib').click();
    await page.waitForFunction(() => document.body.classList.contains('lib-full'));
  }
  await page.waitForSelector('#lib-side .lib-tree-row', { state: 'visible', timeout: 30000 });
  const rootRow = page.locator('#lib-side .lib-tree-row').first();
  const rootLabel = await rootRow.locator('span').last().textContent();
  const rootChevron = rootRow.locator('[data-chev-toggle]');
  if (!(await rootChevron.evaluate(el => el.classList.contains('open')))) await rootChevron.click();
  const sessionRow = page.locator('#lib-side .lib-tree-row').filter({ hasText: 'Session' }).first();
  await sessionRow.waitFor({ state: 'visible', timeout: 15000 });
  await sessionRow.click();
  await page.waitForFunction((expected) => [...document.querySelectorAll('#lib-grid .lib-card[data-path]')].some(card => card.dataset.path.replace(/[\\/]+/g, '/').toLowerCase() === expected.replace(/[\\/]+/g, '/').toLowerCase()), fixturePath, { timeout: 30000 });
  const targetIndex = await page.locator('#lib-grid .lib-card[data-path]').evaluateAll((cards, expected) => cards.findIndex(card => card.dataset.path.replace(/[\\/]+/g, '/').toLowerCase() === expected.replace(/[\\/]+/g, '/').toLowerCase()), fixturePath);
  assert(targetIndex >= 0, 'ordinary PNG fixture card must be present in selected folder');
  await page.locator('#lib-grid .lib-card[data-path]').nth(targetIndex).scrollIntoViewIfNeeded();
  const anchorBefore = await page.evaluate(() => {
    const root = document.getElementById('lib-main'), bounds = root.getBoundingClientRect();
    const card = [...document.querySelectorAll('#lib-grid .lib-card[data-path]')].find(el => {
      const rect = el.getBoundingClientRect(); return rect.bottom > bounds.top && rect.top < bounds.bottom;
    });
    return { path: card?.dataset.path || '', offset: card ? card.getBoundingClientRect().top - bounds.top : null,
      folder: document.querySelector('#lib-side .lib-tree-row.on')?.textContent.trim() || '' };
  });
  assert(sameBrowserPath(anchorBefore.path, fixturePath), 'the selected PNG should be the visible Gallery anchor before opening');
  assert.match(anchorBefore.folder, /Session/);
  const galleryScrollBefore = await page.locator('#lib-main').evaluate(el => el.scrollTop);

  const jobsSnapshot = async expectedHost => page.evaluate((host) => {
    const button = document.getElementById('sk2-act-jobs');
    return { visible: !!button && button.getClientRects().length > 0,
      host: !!button?.closest(host), buttons: document.querySelectorAll('#sk2-act-jobs').length,
      popovers: document.querySelectorAll('#sk2-act-pop').length,
      activity: document.querySelectorAll('#lib-activity').length,
      activityInHost: !!document.getElementById('lib-activity')?.closest('#sk2-act'),
      footerCopy: !!document.querySelector('#lib-statusbar #lib-activity, #lib-footer #lib-activity') };
  }, expectedHost);
  const exerciseJobs = async (key, theme, host, outsideSelector) => {
    const button = page.locator('#sk2-act-jobs');
    assert.deepEqual(await jobsSnapshot(host), { visible: true, host: true, buttons: 1, popovers: 1, activity: 1, activityInHost: true, footerCopy: false }, `${theme} Jobs control must be unique and visible in ${host}`);
    const modeBefore = await page.evaluate(() => document.body.classList.contains('lib-full'));
    await button.focus(); await button.press(key);
    await page.waitForFunction(() => document.getElementById('sk2-act-jobs')?.getAttribute('aria-expanded') === 'true');
    assert.equal(await page.locator('#sk2-act-pop').evaluate(el => el.hidden), false, `${key} opens the native Jobs disclosure`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('sk2-act-jobs')?.getAttribute('aria-expanded') === 'false');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'sk2-act-jobs', 'Escape returns focus to Jobs');
    assert.equal(await page.evaluate(() => document.body.classList.contains('lib-full')), modeBefore, 'Escape does not switch Gallery/Studio');
    await button.click();
    await page.locator(outsideSelector).click();
    await page.waitForFunction(() => document.getElementById('sk2-act-jobs')?.getAttribute('aria-expanded') === 'false');
    assert.equal(await page.evaluate(() => document.body.classList.contains('lib-full')), modeBefore, 'click-away does not switch Gallery/Studio');
    report.browser.themes.push({ theme, host, keyboardKey: key, opened: true, escapeFocusRestored: true, clickAwayClosed: true });
  };

  // Set theme by the app's own toggle, not DOM class mutation. Each view remembers its choice.
  const setTheme = async theme => {
    await page.evaluate(expected => {
      if (document.body.classList.contains('light') !== (expected === 'light')) toggleTheme();
    }, theme);
    assert.equal(await page.evaluate(() => document.body.classList.contains('light')), theme === 'light');
  };
  await setTheme('dark');
  await exerciseJobs('Space', 'dark', '#lib-top-right', '#lib-grid-title');
  await page.locator('#lib-grid .lib-card[data-path]').nth(targetIndex).dblclick();
  await page.waitForFunction(expected => String(window.chromasmithSourcePath || '').replace(/[\\/]+/g, '/').toLowerCase() === expected.replace(/[\\/]+/g, '/').toLowerCase(), fixturePath, { timeout: 30000 });
  assert.equal(await page.evaluate(() => typeof window.__TAURI__?.core?.invoke), 'function');
  await page.locator('#fx-zoom-slider').evaluate(el => {
    el.value = '225'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => document.getElementById('fx-zoom-slider')?.value === '225');
  const studioState = await page.evaluate(() => ({
    source: window.chromasmithSourcePath, zoom: document.getElementById('fx-zoom-slider')?.value,
    title: document.getElementById('db-title-name')?.textContent.trim(),
    titleCount: document.querySelectorAll('#db-title-name').length,
    zoomCount: document.querySelectorAll('#fx-zoom-slider').length,
    sourceSlots: document.querySelectorAll('#fx-canvas').length,
    capClones: document.querySelectorAll('#sk2-cap-copy').length,
    rails: [...document.querySelectorAll('#fx-toolrail .fx-rail-btn')].map(button => ({ text: button.querySelector('.fx-rail-lb')?.textContent.trim(), aria: button.getAttribute('aria-label') })),
  }));
  assert.equal(studioState.source, fixturePath);
  assert.equal(studioState.zoom, '225');
  assert.equal(studioState.titleCount, 1); assert.equal(studioState.zoomCount, 1); assert.equal(studioState.capClones, 0);
  assert(studioState.title, 'canonical photo title remains mounted');
  assert(studioState.rails.length > 0 && studioState.rails.every(item => item.text && item.aria), 'tool rail names remain accessible');
  assert.equal(studioState.sourceSlots, 1, 'one canonical Studio source slot is visible in the DOM');
  await setTheme('dark');
  await exerciseJobs('Enter', 'dark', '#fx-deskbar-tools', '#cs-brand-name');
  await page.locator('#cs-tog-lib').click();
  await page.waitForFunction(() => document.body.classList.contains('lib-full'));
  const roundTrip = await page.evaluate(() => {
    const root = document.getElementById('lib-main'), bounds = root.getBoundingClientRect();
    const card = [...document.querySelectorAll('#lib-grid .lib-card[data-path]')].find(el => {
      const rect = el.getBoundingClientRect(); return rect.bottom > bounds.top && rect.top < bounds.bottom;
    });
    return { folder: document.querySelector('#lib-side .lib-tree-row.on')?.textContent.trim() || '',
      anchor: card?.dataset.path || '', offset: card ? card.getBoundingClientRect().top - bounds.top : null,
      scrollTop: root.scrollTop };
  });
  assert.match(roundTrip.folder, /Session/);
  assert(sameBrowserPath(roundTrip.anchor, anchorBefore.path), `Gallery visible anchor must return: ${JSON.stringify({ anchorBefore, roundTrip })}`);
  assert(Math.abs(roundTrip.offset - anchorBefore.offset) <= 2, 'Gallery anchor screen position is preserved');
  assert(Math.abs(roundTrip.scrollTop - galleryScrollBefore) <= 2, 'Gallery scroll position is preserved');

  await setTheme('light');
  await exerciseJobs('Space', 'light', '#lib-top-right', '#lib-grid-title');
  await page.locator('#cs-tog-studio').click();
  await page.waitForFunction(() => !document.body.classList.contains('lib-full'));
  await page.waitForFunction(expected => String(window.chromasmithSourcePath || '').replace(/[\\/]+/g, '/').toLowerCase() === expected.replace(/[\\/]+/g, '/').toLowerCase(), fixturePath);
  await setTheme('light');
  await exerciseJobs('Enter', 'light', '#fx-deskbar-tools', '#cs-brand-name');
  const finalState = await page.evaluate(() => ({ source: window.chromasmithSourcePath,
    zoom: document.getElementById('fx-zoom-slider')?.value,
    bodyLight: document.body.classList.contains('light'),
    titleCount: document.querySelectorAll('#db-title-name').length,
    zoomCount: document.querySelectorAll('#fx-zoom-slider').length,
    jobsCount: document.querySelectorAll('#sk2-act-jobs').length,
    popoverCount: document.querySelectorAll('#sk2-act-pop').length }));
  assert(sameBrowserPath(finalState.source, fixturePath));
  assert.equal(finalState.zoom, '225');
  assert.equal(finalState.bodyLight, true);
  assert.deepEqual([finalState.titleCount, finalState.zoomCount, finalState.jobsCount, finalState.popoverCount], [1, 1, 1, 1]);

  report.gallery = { root: rootPath, selectedFolder: roundTrip.folder, anchorBefore, roundTrip,
    scrollBefore: galleryScrollBefore, scrollAfter: roundTrip.scrollTop };
  report.studio = studioState;
  report.finalState = finalState;
  report.initialSourcePath = activeSourceBefore;
  report.browser.nativeDecode = false;
  report.result = 'PASS';
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await save();
  console.log(JSON.stringify({ result: report.result, build: runtime.build, fixture: fixturePath, report: reportPath, screenshot: screenshotPath }));
} catch (error) {
  report.result = 'FAIL'; report.error = String(error.stack || error);
  await save(); throw error;
} finally {
  // Disconnect this helper only; the root-owned Tauri app stays running.
  await browser.close();
}
