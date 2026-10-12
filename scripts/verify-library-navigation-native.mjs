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
const nativeAppPid = Number(process.env.CULL_NATIVE_APP_PID || 0) || null;
const nativeBackendCommit = process.env.CULL_NATIVE_BACKEND_COMMIT || null;
const nativeBackendTree = process.env.CULL_NATIVE_BACKEND_TREE || null;
const webviewProfile = process.env.WEBVIEW2_USER_DATA_FOLDER || null;
const catalogDir = process.env.CULL_NATIVE_CATALOG_DIR;
const cacheDir = process.env.CULL_NATIVE_CACHE_DIR;
const fixturePath = process.env.CULL_LIBRARY_FIXTURE_PATH;
const endpoint = process.env.NATIVE_CDP || 'http://127.0.0.1:9223';
const reportPath = process.env.CULL_LIBRARY_NAV_REPORT || 'docs/validation/chr192/library-navigation-native-2026-10-12.json';
const screenshotPath = process.env.CULL_LIBRARY_NAV_SCREENSHOT || 'docs/validation/chr192/library-navigation-native-2026-10-12.png';
const restoredTestRoot = 'C:/Users/Tareq/Documents/github/Chroma-App/.worktrees/_shared-test-runtime/fixtures/chr267/chr268-native-compare';

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
  isolation: { catalogDir, cacheDir, endpoint, nativeAppPid, nativeBackendCommit, nativeBackendTree, webviewProfile },
  hardware: { platform: os.platform(), release: os.release(), cpu: os.cpus()[0]?.model },
  browser: { viewport: '1366x768', themes: [], nativeDecode: false }, result: 'RUNNING' };
const save = async () => { await mkdir(path.dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2)); };
const samePath = (a, b) => path.resolve(String(a)).toLowerCase() === path.resolve(String(b)).toLowerCase();
const sameBrowserPath = (a, b) => String(a || '').replace(/[\\/]+/g, '/').toLowerCase() === String(b || '').replace(/[\\/]+/g, '/').toLowerCase();
const assertHeaderGeometry = (header, label, titleText) => {
  const requiredTitleWidth = Math.min(100, header.title.scrollWidth || 0);
  assert(titleText?.trim() && header.title.visible && header.title.height > 0 && header.title.width + 1 >= requiredTitleWidth,
    `${label}: filename must be fully visible up to 100px: ${JSON.stringify({ titleText, requiredTitleWidth, title: header.title })}`);
  assert(header.zoom.visible && header.zoom.width >= 48 && /zoom/i.test(header.zoom.aria || ''),
    `${label}: zoom control must be visible and accessible: ${JSON.stringify(header.zoom)}`);
  const overlaps = (a, b) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
  for (const [name, other] of [['scope', header.scope], ['zoom', header.zoom], ['Jobs', header.jobs]]) {
    assert(!overlaps(header.title, other), `${label}: filename overlaps ${name}: ${JSON.stringify({ title: header.title, other })}`);
  }
  assert(!overlaps(header.scope, header.zoom) && !overlaps(header.scope, header.jobs),
    `${label}: photo scope overlaps zoom or Jobs: ${JSON.stringify(header)}`);
};

const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = browser.contexts()[0]?.pages().find(p => !p.url().includes('devtools'));
  assert(page, 'Native WebView page missing');
  await page.setViewportSize({ width: 1366, height: 768 });
  const runtime = await page.evaluate(async () => {
    if (new URL(location.href).searchParams.has('libtest') || !window.__TAURI__?.core?.invoke) throw Error('Real Tauri IPC is required');
    const catalog = await window.__TAURI__.core.invoke('catalog_query', { q: { offset: 0, limit: 200 } });
    return { build: BUILD, url: location.href, catalogTotal: catalog.total, entries: catalog.entries || [],
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio } };
  });
  report.runtime = { build: runtime.build, url: runtime.url, catalogTotal: runtime.catalogTotal,
    viewport: runtime.viewport, fixtureIndexed: runtime.entries.some(entry => samePath(entry.path, fixturePath)) };
  assert.equal(runtime.build, expectedBuild, 'attached app BUILD does not match expected build');
  assert.deepEqual({ width: runtime.viewport.width, height: runtime.viewport.height }, { width: 1366, height: 768 }, 'native WebView CSS viewport must be 1366x768');
  const invoke = (command, args = {}) => page.evaluate(([cmd, a]) => window.__TAURI__.core.invoke(cmd, a), [command, args]);
  const rootPath = process.env.CULL_LIBRARY_ROOT || path.dirname(path.dirname(fixturePath));
  const folderPath = path.dirname(fixturePath);
  assert.equal(path.resolve(folderPath), path.resolve(path.join(rootPath, 'Session')), 'fixture must be in the task-owned Session folder');
  const rootsBefore = await invoke('catalog_root_identity');
  assert(Array.isArray(rootsBefore), 'catalog_root_identity must return a root list');
  const foreignRoots = rootsBefore.filter(root => !samePath(root.path, rootPath));
  if (foreignRoots.length) {
    assert.equal(process.env.CULL_ALLOW_RESTORED_TEST_ROOT, restoredTestRoot,
      `refusing restored roots without exact authorization: ${JSON.stringify(foreignRoots.map(root => root.path))}`);
    assert.equal(foreignRoots.length, 1, 'only the exact known restored test root may be removed');
    assert(samePath(foreignRoots[0].path, restoredTestRoot), 'restored root path must match the known RAW-test fixture');
  }
  assert(rootsBefore.length <= 1, 'task catalog may contain only its one navigation root');
  report.catalogRootsBefore = rootsBefore;
  // Startup may have inherited a previous Library folder from WebView localStorage. Pause all
  // background indexing and pin the task-only root before reloading; the app catalog is already
  // guarded above, so no other folder can be scanned by this helper.
  await page.evaluate(root => {
    localStorage.setItem('chromasmith_bg_paused', '1');
    localStorage.setItem('chromasmith_lib_root', root);
  }, rootPath);
  await invoke('catalog_bg_set_paused', { paused: true });
  await invoke('catalog_scan_cancel');
  if (foreignRoots.length) {
    const removed = await invoke('catalog_remove_root', { id: foreignRoots[0].id });
    report.catalogRestoredRootRemoval = { rootId: foreignRoots[0].id, exactPath: foreignRoots[0].path,
      observedPhotoCount: 3, result: removed, reason: 'startup-restored prior RAW test root in task-owned CHR-192 catalog; count verified by root read-only SQLite inspection' };
    const remaining = await invoke('catalog_root_identity');
    assert(remaining.every(root => samePath(root.path, rootPath)), 'only the exact restored test root may be removed');
  }
  const root = await invoke('catalog_add_root', { path: rootPath, kind: 'library' });
  assert(samePath(root.abs_path, rootPath), 'catalog_add_root must resolve only the task fixture root');
  const scan = await invoke('catalog_scan', { volumeId: root.volume_id });
  assert(scan && typeof scan.scanned === 'number', 'native catalog scan must complete for the tiny PNG-only fixture root');
  report.catalogBootstrap = { root: root.abs_path, volumeId: root.volume_id, scan, backgroundPaused: true };
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__TAURI__?.core?.invoke && typeof BUILD === 'string', null, { timeout: 30000 });
  await page.waitForTimeout(750);
  const catalog = await invoke('catalog_query', { q: { offset: 0, limit: 200 } });
  const indexed = catalog.entries || [];
  assert(indexed.some(entry => samePath(entry.path, fixturePath)), 'task fixture must be indexed after the owned native scan');
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
  const rootRow = page.locator('#lib-side .lib-tree-row[title^="Right-click to remove this folder"]');
  const rootLabel = await rootRow.locator('span').last().textContent();
  const rootChevron = rootRow.locator('[data-chev-toggle]');
  if (!(await rootChevron.evaluate(el => el.classList.contains('open')))) await rootChevron.click();
  const sessionRow = page.locator('#lib-side .lib-tree-row').filter({ hasText: 'Session' }).first();
  await sessionRow.waitFor({ state: 'visible', timeout: 15000 });
  await sessionRow.click();
  await page.waitForFunction((expected) => [...document.querySelectorAll('#lib-grid .lib-card[data-path]')].some(card => card.dataset.path.replace(/[\\/]+/g, '/').toLowerCase() === expected.replace(/[\\/]+/g, '/').toLowerCase()), fixturePath, { timeout: 30000 });
  const targetIndex = await page.locator('#lib-grid .lib-card[data-path]').evaluateAll((cards, expected) => cards.findIndex(card => card.dataset.path.replace(/[\\/]+/g, '/').toLowerCase() === expected.replace(/[\\/]+/g, '/').toLowerCase()), fixturePath);
  assert(targetIndex >= 0, 'ordinary PNG fixture card must be present in selected folder');
  const targetCard = page.locator('#lib-grid .lib-card[data-path]').nth(targetIndex);
  const gallerySnapshot = () => page.evaluate(() => {
    const root = document.getElementById('lib-main'), bounds = root.getBoundingClientRect();
    const cards = [...document.querySelectorAll('#lib-grid .lib-card[data-path]')];
    const visible = cards.filter(el => { const rect = el.getBoundingClientRect(); return rect.bottom > bounds.top && rect.top < bounds.bottom; });
    const card = visible[0], grid = document.getElementById('lib-grid'), gridStyle = getComputedStyle(grid);
    const firstCard = cards[0], cardRect = firstCard?.getBoundingClientRect();
    return { path: card?.dataset.path || '', offset: card ? card.getBoundingClientRect().top - bounds.top : null,
      folder: document.querySelector('#lib-side .lib-tree-row.on')?.textContent.trim() || '', scrollTop: root.scrollTop,
      main: { width: bounds.width, height: bounds.height, top: bounds.top },
      grid: { width: grid.getBoundingClientRect().width, top: grid.getBoundingClientRect().top, columns: gridStyle.gridTemplateColumns,
        firstCardWidth: cardRect?.width, firstCardHeight: cardRect?.height, cardCount: cards.length,
        firstPaths: cards.slice(0, 12).map(el => el.dataset.path), visiblePaths: visible.slice(0, 8).map(el => el.dataset.path) } };
  });
  let anchorBefore = await gallerySnapshot();
  assert(anchorBefore.path, 'Gallery must have a visible photo anchor before opening');
  assert.match(anchorBefore.folder, /Session/);
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
  await targetCard.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForFunction(() => {
    const main = document.getElementById('lib-main'), grid = document.getElementById('lib-grid');
    if (!main || !grid) return false;
    const sample = [main.clientWidth, main.clientHeight, grid.clientWidth,
      getComputedStyle(grid).gridTemplateColumns, main.scrollTop.toFixed(2)].join('|');
    if (window.__chr192StableSample === sample) window.__chr192StableFrames = (window.__chr192StableFrames || 0) + 1;
    else { window.__chr192StableSample = sample; window.__chr192StableFrames = 0; }
    return window.__chr192StableFrames >= 3;
  }, null, { timeout: 10000 });
  const targetGeometry = await targetCard.evaluate(el => ({ path: el.dataset.path,
    top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom,
    viewportTop: document.getElementById('lib-main').getBoundingClientRect().top,
    viewportBottom: document.getElementById('lib-main').getBoundingClientRect().bottom }));
  assert(sameBrowserPath(targetGeometry.path, fixturePath)
    && targetGeometry.top >= targetGeometry.viewportTop && targetGeometry.bottom <= targetGeometry.viewportBottom,
  `native click target must be fully visible before scroll baseline: ${JSON.stringify(targetGeometry)}`);
  anchorBefore = await gallerySnapshot();
  const galleryScrollBefore = anchorBefore.scrollTop;
  report.galleryBeforeOpen = anchorBefore;
  await page.evaluate(() => {
    window.__chr192PointerDown = [];
    document.getElementById('lib-main').addEventListener('pointerdown', event => {
      const card = event.target.closest?.('.lib-card[data-path]');
      if (card) window.__chr192PointerDown.push({ path: card.dataset.path, scrollTop: event.currentTarget.scrollTop,
        rectTop: card.getBoundingClientRect().top, rectBottom: card.getBoundingClientRect().bottom });
    }, true);
  });
  await targetCard.dblclick();
  const pointerOpen = await page.evaluate(() => window.__chr192PointerDown?.at(-1) || null);
  assert(pointerOpen && sameBrowserPath(pointerOpen.path, fixturePath)
    && Math.abs(pointerOpen.scrollTop - anchorBefore.scrollTop) <= 1,
  `native Gallery baseline must match the actual photo pointerdown: ${JSON.stringify({ anchorBefore, pointerOpen })}`);
  report.browser.photoPointerDown = pointerOpen;
  await page.waitForFunction(expected => String(window.chromasmithSourcePath || '').replace(/[\\/]+/g, '/').toLowerCase() === expected.replace(/[\\/]+/g, '/').toLowerCase(), fixturePath, { timeout: 30000 });
  // The first-edit guide is opened asynchronously after the initial photo render.
  await page.waitForTimeout(1000);
  const firstEditGuide = page.locator('#cs-modal-ov [data-guide-skip]');
  if (await firstEditGuide.isVisible().catch(() => false)) {
    await firstEditGuide.click();
    await page.waitForFunction(() => !document.querySelector('#cs-modal-ov') || getComputedStyle(document.querySelector('#cs-modal-ov')).display === 'none');
    report.browser.firstEditGuideDismissed = true;
  }
  assert.equal(await page.evaluate(() => typeof window.__TAURI__?.core?.invoke), 'function');
  await page.locator('#fx-zoom-slider').evaluate(el => {
    el.value = '225'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => document.getElementById('fx-zoom-slider')?.value === '225');
  const studioState = await page.evaluate(() => ({
    source: window.chromasmithSourcePath, zoom: document.getElementById('fx-zoom-slider')?.value,
    title: document.getElementById('db-title-name')?.textContent.trim(),
    header: (() => { const rect = el => { const r = el?.getBoundingClientRect(), s = el && getComputedStyle(el); return r && {
      x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,scrollWidth:el.scrollWidth,
      visible:!!el.getClientRects().length && s.display!=='none' && s.visibility==='visible' && Number(s.opacity)>0,
      aria:el.getAttribute('aria-label') }; };
      return { title:rect(document.getElementById('db-title-name')), zoom:rect(document.getElementById('fx-zoom-slider')),
        scope:rect(document.getElementById('fx-batch-scope')), jobs:rect(document.getElementById('sk2-act-jobs')) }; })(),
    titleCount: document.querySelectorAll('#db-title-name').length,
    zoomCount: document.querySelectorAll('#fx-zoom-slider').length,
    sourceSlots: document.querySelectorAll('#fx-canvas').length,
    capClones: document.querySelectorAll('#sk2-cap-copy').length,
    rails: [...document.querySelectorAll('#fx-toolrail .fx-rail-btn')].map(button => ({ text: button.querySelector('.fx-rail-lb')?.textContent.trim(), aria: button.getAttribute('aria-label') })),
  }));
  assert.equal(studioState.source, fixturePath);
  assert.equal(studioState.zoom, '225');
  assert.equal(studioState.titleCount, 1); assert.equal(studioState.zoomCount, 1); assert.equal(studioState.capClones, 0);
  assert.equal(studioState.title, path.basename(fixturePath, path.extname(fixturePath)), 'photo title identifies the opened PNG');
  report.studio = studioState;
  await save();
  assertHeaderGeometry(studioState.header, 'Native Studio header', studioState.title);
  assert(studioState.rails.length > 0 && studioState.rails.every(item => item.text && item.aria), 'tool rail names remain accessible');
  assert.equal(studioState.sourceSlots, 1, 'one canonical Studio source slot is visible in the DOM');
  await setTheme('dark');
  await exerciseJobs('Enter', 'dark', '#fx-deskbar-tools', '#cs-brand-name');
  await page.locator('#cs-tog-lib').click();
  await page.waitForFunction(() => document.body.classList.contains('lib-full'));
  await page.waitForFunction(({ path, offset }) => {
    const main = document.getElementById('lib-main'), grid = document.getElementById('lib-grid');
    if (!main || !grid) return false;
    const bounds = main.getBoundingClientRect();
    const card = [...document.querySelectorAll('#lib-grid .lib-card[data-path]')].find(el => {
      const rect = el.getBoundingClientRect(); return rect.bottom > bounds.top && rect.top < bounds.bottom;
    });
    if (!card || card.dataset.path.toLowerCase() !== path.toLowerCase()
      || Math.abs(card.getBoundingClientRect().top - bounds.top - offset) > 2) {
      window.__chr192ReturnStableFrames = 0;
      return false;
    }
    const sample = [main.clientWidth, main.clientHeight, grid.clientWidth,
      getComputedStyle(grid).gridTemplateColumns, main.scrollTop.toFixed(2)].join('|');
    if (window.__chr192ReturnSample === sample) window.__chr192ReturnStableFrames = (window.__chr192ReturnStableFrames || 0) + 1;
    else { window.__chr192ReturnSample = sample; window.__chr192ReturnStableFrames = 0; }
    return window.__chr192ReturnStableFrames >= 3;
  }, { path: anchorBefore.path, offset: anchorBefore.offset }, { timeout: 5000 });
  const roundTrip = await gallerySnapshot();
  assert.match(roundTrip.folder, /Session/);
  assert(sameBrowserPath(roundTrip.path, anchorBefore.path), `Gallery visible anchor must return: ${JSON.stringify({ anchorBefore, roundTrip })}`);
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
    header: (() => { const rect = el => { const r = el?.getBoundingClientRect(), s = el && getComputedStyle(el); return r && {
      x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,scrollWidth:el.scrollWidth,
      visible:!!el.getClientRects().length && s.display!=='none' && s.visibility==='visible' && Number(s.opacity)>0,
      aria:el.getAttribute('aria-label') }; };
      return { title:rect(document.getElementById('db-title-name')), zoom:rect(document.getElementById('fx-zoom-slider')),
        scope:rect(document.getElementById('fx-batch-scope')), jobs:rect(document.getElementById('sk2-act-jobs')) }; })(),
    bodyLight: document.body.classList.contains('light'),
    titleCount: document.querySelectorAll('#db-title-name').length,
    zoomCount: document.querySelectorAll('#fx-zoom-slider').length,
    jobsCount: document.querySelectorAll('#sk2-act-jobs').length,
    popoverCount: document.querySelectorAll('#sk2-act-pop').length }));
  assert(sameBrowserPath(finalState.source, fixturePath));
  assert.equal(finalState.zoom, '225');
  assertHeaderGeometry(finalState.header, 'Native Studio header after Gallery return', path.basename(fixturePath, path.extname(fixturePath)));
  assert.equal(finalState.bodyLight, true);
  assert.deepEqual([finalState.titleCount, finalState.zoomCount, finalState.jobsCount, finalState.popoverCount], [1, 1, 1, 1]);

  report.gallery = { root: rootPath, selectedFolder: roundTrip.folder, anchorBefore, roundTrip,
    scrollBefore: galleryScrollBefore, scrollAfter: roundTrip.scrollTop };
  report.studio = studioState;
  report.finalState = finalState;
  report.initialSourcePath = activeSourceBefore;
  report.browser.nativeDecode = false;
  report.result = 'PASS';
  await mkdir(path.dirname(screenshotPath), { recursive: true });
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
