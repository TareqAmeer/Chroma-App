// CHR-199 native culling-title/focus-note smoke check. Attach only to an already-running
// task-isolated Tauri app; this script never launches, scans, or closes the native app.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

const expectedBuild = process.env.CULL_EXPECTED_BUILD;
const sourceCommit = process.env.CULL_NATIVE_COMMIT;
const nativeAppPid = Number(process.env.CULL_NATIVE_APP_PID || 0) || null;
const catalogDir = process.env.CULL_NATIVE_CATALOG_DIR;
const cacheDir = process.env.CULL_NATIVE_CACHE_DIR;
const fixtureA = process.env.CULL_CULLING_FIXTURE_A;
const fixtureB = process.env.CULL_CULLING_FIXTURE_B;
const reportPath = process.env.CULLING_NATIVE_REPORT || 'docs/validation/chr199/culling-title-native.json';
const screenshotPath = process.env.CULLING_NATIVE_SCREENSHOT || 'docs/validation/chr199/culling-title-native.png';
assert(expectedBuild && /^[a-f0-9]{40}$/.test(sourceCommit || ''), 'Set exact CULL_EXPECTED_BUILD and CULL_NATIVE_COMMIT');
assert(catalogDir && cacheDir && fixtureA && fixtureB, 'Set the task-owned catalog/cache and two PNG fixture paths');
for (const fixture of [fixtureA, fixtureB]) assert(/\.png$/i.test(fixture), 'CHR-199 fixtures must be PNGs; RAW is not allowed');
const endpoint = process.env.NATIVE_CDP || 'http://127.0.0.1:9223';
const browser = await chromium.connectOverCDP(endpoint);
const report = { issue: 'CHR-199', capturedAt: new Date().toISOString(), sourceCommit, expectedBuild,
  isolation: { nativeAppPid, catalogDir, cacheDir, endpoint }, hardware: { platform: os.platform(), release: os.release() },
  measurements: [], result: 'RUNNING' };
const save = async () => { await mkdir(path.dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2)); };
const samePath = (a, b) => path.resolve(String(a)).toLowerCase() === path.resolve(String(b)).toLowerCase();
const hiddenTitle = async (page, mode) => {
  const snapshot = await page.evaluate(() => {
    const el = document.getElementById('lib-grid-title'), style = el && getComputedStyle(el), rect = el?.getBoundingClientRect();
    return { count: document.querySelectorAll('#lib-grid-title').length, display: style?.display,
      visible: !!el?.checkVisibility?.() && rect.width > 0 && rect.height > 0,
      width: rect?.width || 0, height: rect?.height || 0 };
  });
  assert.equal(snapshot.count, 1, `${mode}: expected one canonical Gallery title`);
  assert.equal(snapshot.visible, false, `${mode}: Gallery title must be hidden: ${JSON.stringify(snapshot)}`);
  assert(['none', ''].includes(snapshot.display) || snapshot.width === 0 || snapshot.height === 0,
    `${mode}: hidden title must not occupy visible layout space`);
  return snapshot;
};
const visibleTitle = async (page, mode) => {
  const snapshot = await page.evaluate(() => {
    const el = document.getElementById('lib-grid-title'), style = el && getComputedStyle(el);
    const title = el?.querySelector('.lgt-h'), rect = title?.getBoundingClientRect();
    return { count: document.querySelectorAll('#lib-grid-title').length, display: style?.display,
      visible: !!title?.textContent?.trim() && !!title.getClientRects().length && style?.display !== 'none'
        && style?.visibility === 'visible' && Number(style?.opacity) > 0 && rect.width > 0 && rect.height > 0,
      text: title?.textContent?.trim() || '', width: rect?.width || 0, height: rect?.height || 0 };
  });
  assert.equal(snapshot.count, 1, `${mode}: expected one canonical Gallery title`);
  assert(snapshot.visible, `${mode}: Gallery title must be visible with a readable label: ${JSON.stringify(snapshot)}`);
  return snapshot;
};
try {
  const page = browser.contexts()[0]?.pages().find(item => !item.url().includes('devtools'));
  assert(page, 'Native WebView page is missing');
  const runtime = await page.evaluate(async () => {
    if (new URL(location.href).searchParams.has('libtest') || !window.__TAURI__?.core?.invoke) throw Error('Actual native IPC is required');
    const catalog = await window.__TAURI__.core.invoke('catalog_query', { q: { offset: 0, limit: 20 } });
    return { build: BUILD, url: location.href, viewport: [innerWidth, innerHeight], total: catalog.total,
      paths: (catalog.entries || []).map(entry => entry.path) };
  });
  assert.equal(runtime.build, expectedBuild, 'Native app BUILD mismatch');
  assert.deepEqual(runtime.paths.map(value => path.resolve(value)).sort(), [fixtureA, fixtureB].map(value => path.resolve(value)).sort(),
    'Only the two exact task-owned PNG fixture rows may be in the task catalog');
  report.runtime = { ...runtime, paths: runtime.paths, nativeDecode: false };
  const rootIdentity = await page.evaluate(() => window.__TAURI__.core.invoke('catalog_root_identity'));
  assert(Array.isArray(rootIdentity) && rootIdentity.length === 1, 'Expected exactly one task-owned catalog root');
  const rootPath = path.dirname(fixtureA);
  assert(samePath(rootIdentity[0].path, rootPath) && samePath(path.dirname(fixtureB), rootPath),
    'Both PNG fixture paths must be within the single task-owned root');
  report.catalogRoot = rootIdentity[0];

  const setTheme = async light => page.evaluate(expected => {
    if (document.body.classList.contains('light') !== expected) toggleTheme();
  }, light);
  const enterGallery = async () => {
    if (!await page.evaluate(() => document.body.classList.contains('lib-full'))) await page.locator('#cs-tog-lib').click();
    await page.waitForFunction(() => document.body.classList.contains('lib-full'));
    await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card[data-path]').length === 2);
  };
  const selectBoth = async () => {
    const cards = page.locator('#lib-grid .lib-card[data-path]');
    const indices = await cards.evaluateAll((elements, paths) => paths.map(expected => elements.findIndex(el =>
      String(el.dataset.path || '').replace(/[\\/]+/g, '/').toLowerCase() === String(expected || '').replace(/[\\/]+/g, '/').toLowerCase())), [fixtureA, fixtureB]);
    assert(indices.every(index => index >= 0), 'both task PNGs must have visible Gallery cards');
    const a = cards.nth(indices[0]), b = cards.nth(indices[1]);
    await a.click();
    await b.click({ modifiers: ['Control'] });
    await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card.multi').length === 2);
    return { a: fixtureA, b: fixtureB, foundCards: await cards.count(), selectedCards: 2 };
  };
  const openMenuAction = async selector => {
    await page.locator('#lib-view-menu-btn').click();
    await page.locator(selector).click();
  };
  const runLayout = async ({ theme, width, height }) => {
    await page.setViewportSize({ width, height });
    const actualViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio }));
    await setTheme(theme === 'light');
    await enterGallery();
    await visibleTitle(page, `Gallery ${theme} ${width}x${height}`);
    const selection = await selectBoth();

    await openMenuAction('#lib-compare-btn');
    await page.waitForFunction(() => document.querySelector('#lib-compare')?.classList.contains('on'));
    const compareHidden = await hiddenTitle(page, `Compare ${theme} ${width}x${height}`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#lib-compare')?.classList.contains('on'));
    await visibleTitle(page, 'Gallery after Compare');

    await openMenuAction('#lib-survey-btn');
    await page.waitForFunction(() => document.querySelector('#lib-survey')?.classList.contains('on'));
    const surveyHidden = await hiddenTitle(page, `Survey ${theme} ${width}x${height}`);
    // Native key routing can retain focus on the Library toggle after async pane creation;
    // use the actual photo pane as the keyboard target before testing its Escape exit.
    await page.locator('#lib-survey .lib-survey-cell').first().click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#lib-survey')?.classList.contains('on'));
    await visibleTitle(page, 'Gallery after Survey');

    // Compare/Survey may leave only the active pane's source set selected. Rebuild the exact
    // two-photo selection with Gallery cards before invoking Culling.
    await selectBoth();
    await page.locator('#lib-batchbar [data-act="cull"]').click();
    await page.waitForSelector('#lib-cull-time-picker', { state: 'visible' });
    const cullPickerHidden = await hiddenTitle(page, `Cull picker ${theme} ${width}x${height}`);
    await page.locator('#lib-cull-time-all').click();
    await page.locator('#lib-cull-time-start').click();
    await page.waitForSelector('#fx-confirm-modal[open]');
    await page.locator('#fx-confirm-ok').click();
    await page.waitForFunction(() => document.querySelector('#lib-survey.on .lib-survey-cell'));
    const cullHidden = await hiddenTitle(page, `Cull review ${theme} ${width}x${height}`);
    const heading = (await page.locator('#lib-compare-bar .survey-count').textContent() || '').trim();
    assert.equal(await page.locator('#lib-compare-bar .survey-count').count(), 1, 'Culling has one range label');
    assert.equal(heading, 'Culling · 1–2 of 2', `Unexpected single culling range label: ${heading}`);
    const note = (await page.locator('#lib-compare-bar .survey-focus-note').textContent() || '').trim();
    for (const text of ['Photo 1 focused', 'arrows/Tab move', 'Enter pick and advance', 'Shift+P/X flag and advance', 'Esc exits'])
      assert(note.includes(text), `Culling focus note is missing "${text}": ${note}`);
    assert(!/Culling\s*[·:]/.test(note), 'Culling focus note must not repeat the range label');
    const themeScreenshot = screenshotPath.replace(/\.png$/i, `-${theme}.png`);
    await mkdir(path.dirname(themeScreenshot), { recursive: true });
    await page.screenshot({ path: themeScreenshot, fullPage: false });
    await page.locator('#lib-survey .lib-survey-cell').first().click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#lib-survey.on'));
    const galleryTitle = await visibleTitle(page, `Gallery after Culling ${theme} ${width}x${height}`);
    report.measurements.push({ theme, requestedViewport: [width, height], actualViewport, selection, compareHidden, surveyHidden,
      cullPickerHidden, cullHidden, heading, note, galleryTitle, screenshot: themeScreenshot });
    await save();
  };

  for (const mode of [
    { theme: 'dark', width: 1366, height: 768 },
    { theme: 'light', width: 1440, height: 900 },
  ]) await runLayout(mode);
  report.result = 'PASS';
  await save();
  console.log(JSON.stringify({ result: report.result, build: runtime.build, reportPath, screenshotPath }));
} catch (error) {
  report.result = 'FAIL'; report.error = String(error.stack || error); await save(); throw error;
} finally { await browser.close(); }
