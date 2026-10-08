import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from './editor_state_harness.mjs';

const { server, port } = await startServer();
let browser;
async function poll(read, ready) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const result = await read(); if (ready(result)) return result; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('Timed out waiting for batch journal');
}
try {
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const theme of ['dark', 'light']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  const failedResponses = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`); });
  // The desktop dist excludes the web-only COI service worker and favicon; keep these unrelated
  // shell assets from generating 404 console errors while the Library behavior is under test.
  await page.route('**/coi-serviceworker.min.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.route('**/favicon.ico*', route => route.fulfill({ status: 204, body: '' }));
  await page.addInitScript(theme => { localStorage.setItem('chromasmith-tour-seen-v1', '1'); localStorage.setItem('csTheme', theme); localStorage.setItem('csThemeGallery', theme); localStorage.setItem('csThemeEditor', theme); }, theme);
  await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=6&deskx=1`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('#lib-grid .lib-card[data-path]');
  await page.waitForTimeout(1800);

  await page.evaluate(() => {
    const source = getUISnapshot();
    source.sliders['adj-exp'] = 30;
    source.sliders['adj-sharp-radius'] = 2.6;
    source.sliders['adj-sharp-mask'] = 41;
    source.sliders['nr-lum'] = 63;
    source.sliders['nr-con'] = 27;
    source.sliders['nr-color-detail'] = 82;
    window.__copiedRecipe = btoa(unescape(encodeURIComponent(JSON.stringify(source))));
    window.libtestRecipeBatchFailNext([1]);
  });
  const cards = page.locator('#lib-grid .lib-card[data-path]');
  const paths = [];
  for (let index = 0; index < 3; index++) {
    paths.push(await cards.nth(index).getAttribute('data-path'));
    await cards.nth(index).click({ modifiers: index ? [process.platform === 'darwin' ? 'Meta' : 'Control'] : [] });
  }
  const untouchedPath = await cards.nth(3).getAttribute('data-path');
  const originalRecipes = await page.evaluate(({ paths, untouchedPath }) => {
    const source = getUISnapshot();
    const b64 = sliders => btoa(unescape(encodeURIComponent(JSON.stringify({ ...source, sliders: { ...source.sliders, ...sliders } }))));
    const initial = new Map();
    paths.forEach((path, index) => {
      const recipe = b64({ 'adj-exp': 5 + index, 'nr-lum': 2 + index, 'nr-con': 7 + index, 'nr-color-detail': 12 + index, 'adj-sharp-radius': 0.6 + index, 'adj-sharp-mask': 8 + index, 'grain-a': 20 + index, 'lens-dist': 30 + index });
      initial.set(path, recipe);
      window.__libtestSeedSidecar(path, { recipe, edited: true });
    });
    const untouched = b64({ 'adj-exp': 77, 'nr-lum': 78, 'grain-a': 79, 'lens-dist': 80 });
    initial.set(untouchedPath, untouched);
    window.__libtestSeedSidecar(untouchedPath, { recipe: untouched, edited: true });
    return Object.fromEntries(initial);
  }, { paths, untouchedPath });
  await cards.nth(1).click({ button: 'right' });
  await page.getByText('Edit (3)', { exact: true }).hover();
  await page.getByText('Paste edit (selective)…', { exact: true }).click();
  await page.locator('#paste-confirm').waitFor();
  for (const checkbox of await page.locator('.paste-cat-cb').all()) await checkbox.uncheck();
  await page.locator('.paste-cat-cb[value="adjust"]').check();
  await page.locator('.paste-cat-cb[value="nr"]').check();
  await page.locator('#paste-confirm').click();
  await poll(() => page.evaluate(() => window.libtestRecipeBatchInvoke('recipe_batch_list', {})), batches => batches.some(batch => batch.status === 'completed'));
  const summaries = await page.evaluate(() => window.libtestRecipeBatchInvoke('recipe_batch_list', {}));
  assert.equal(summaries[0].items, undefined, 'history must not transfer full recipes');
  const first = await page.evaluate(async id => window.libtestRecipeBatchInvoke('recipe_batch_get', { id }), summaries[0].id);
  assert.ok(first, 'no journal/errors ' + JSON.stringify(errors) + ': ' + JSON.stringify(await page.evaluate(() => ({ calls: window.__libtestRecipeBatchCalls, text: document.body.innerText.slice(-2000) }))));
  assert.equal(typeof first.id, 'number');
  assert.deepEqual(first.items.map(item => item.path).sort(), paths.slice().sort());
  assert.deepEqual(first.items.map(item => item.status), ['applied', 'failed', 'applied']);
  const recipes = await page.evaluate(items => items.filter(i => i.status === 'applied').map(i => JSON.parse(decodeURIComponent(escape(atob(i.recipe))))), first.items);
  recipes.forEach(recipe => {
    assert.equal(recipe.sliders['adj-exp'], 30);
    assert.equal(recipe.sliders['adj-sharp-radius'], 2.6, 'source Sharpen Radius was not batch-applied');
    assert.equal(recipe.sliders['adj-sharp-mask'], 41, 'source Sharpen Mask was not batch-applied');
    assert.equal(recipe.sliders['nr-lum'], 63, 'source Luminance NR was not batch-applied');
    assert.equal(recipe.sliders['nr-con'], 27, 'source Noise Contrast was not batch-applied');
    assert.equal(recipe.sliders['nr-color-detail'], 82, 'source Color Detail was not batch-applied');
  });
  const initialByPath = originalRecipes;
  for (const item of first.items) {
    const expectedTarget = JSON.parse(decodeURIComponent(escape(atob(initialByPath[item.path]))));
    const actual = JSON.parse(decodeURIComponent(escape(atob(item.recipe))));
    if (item.status === 'applied') {
      assert.equal(actual.sliders['grain-a'], expectedTarget.sliders['grain-a'], 'target-specific grain should be retained');
      assert.equal(actual.sliders['lens-dist'], expectedTarget.sliders['lens-dist'], 'target-specific lens correction should be retained');
    }
  }
  const untouched = await page.evaluate(path => window.libtestRecipeBatchInvoke('get_sidecar', { path }), untouchedPath);
  assert.equal(untouched.recipe, originalRecipes[untouchedPath], 'unselected photo must remain unchanged');
  await page.evaluate(async () => { if (!document.querySelector('#lib-overlay').classList.contains('on')) await window.chromasmithToggleLibrary(); });
  if (!(await page.locator('#lib-overlay').evaluate(el => el.classList.contains('full')))) await page.keyboard.press('g');
  await page.locator('#lib-act-pill').click();
  await page.screenshot({ path: "test/output/recipe-batch-" + theme + '-activity.png' });
  await page.locator('#lib-act-batch-results').click({ timeout: 5000 });
  await page.locator('dialog[open] table tbody tr').first().waitFor();
  const dialogTheme = await page.locator('dialog[open]').evaluate(el => {const cs=getComputedStyle(el); return { background:cs.backgroundColor, text:cs.color, named:!!el.getAttribute('aria-labelledby'), expectedBackground:getComputedStyle(document.body).getPropertyValue('--bg').trim(), expectedText:getComputedStyle(document.body).getPropertyValue('--txt').trim() };});
  await page.screenshot({ path: 'test/output/recipe-batch-' + theme + '-results.png' });
  assert.ok(dialogTheme.named, 'results dialog needs an accessible name');
  assert.notEqual(dialogTheme.background, 'rgba(0, 0, 0, 0)');
  assert.notEqual(dialogTheme.background, dialogTheme.text);
  if(theme==='light') assert.notEqual(dialogTheme.background, 'rgb(32, 32, 36)', 'light dialog must use theme background');
  assert.equal(await page.locator('dialog[open] table tbody tr').count(), 3);
  await page.locator('dialog[open] [data-action="select"]').click();
  await page.waitForTimeout(200);
  const selectedPaths = await page.locator('#lib-grid .lib-card.multi').evaluateAll(nodes => nodes.map(n => n.dataset.path));
  assert.deepEqual(selectedPaths, [first.items[1].path]);
  await page.evaluate(() => window.chromasmithRecipeBatchHistory());
  await page.locator(`dialog[open] [data-batch="${first.id}"]`).click();
  await page.locator('dialog[open] [data-action="resume"]').click();
  await poll(() => page.evaluate(id => window.libtestRecipeBatchInvoke('recipe_batch_get', { id }), first.id), batch => batch.items.every(i => i.status === 'applied'));
  await page.waitForTimeout(50);
  await page.evaluate(() => window.chromasmithRecipeBatchHistory());
  await page.locator(`dialog[open] [data-batch="${first.id}"]`).click();
  await page.locator('dialog[open] [data-action="undo"]').click();
  await poll(() => page.evaluate(id => window.libtestRecipeBatchInvoke('recipe_batch_get', { id }), first.id), batch => batch.status === 'undone');
  const undone = await page.evaluate(async id => await window.libtestRecipeBatchInvoke('recipe_batch_get', { id }), first.id);
  assert.equal(undone.items.filter(i => i.status === 'undone').length, 3);
  assert.equal(await page.locator('dialog[open] table tbody tr').count(), 3);
  const restored = await page.evaluate(async paths => Promise.all(paths.map(path => window.libtestRecipeBatchInvoke('get_sidecar', { path }))), paths);
  restored.forEach((sidecar, index) => assert.equal(sidecar.recipe, originalRecipes[paths[index]], 'undo must restore each target recipe exactly'));
  const untouchedAfterUndo = await page.evaluate(path => window.libtestRecipeBatchInvoke('get_sidecar', { path }), untouchedPath);
  assert.equal(untouchedAfterUndo.recipe, originalRecipes[untouchedPath]);
  assert.deepEqual(errors, [], `browser console/page errors; failed responses: ${failedResponses.join(', ')}`);
  assert.deepEqual(failedResponses, [], 'all app resources should load');
  console.log(theme + ' PASS: Detail/NR selective paste to 3 photos; per-photo values preserved outside selected categories; unselected identity; retry and exact undo.');
  await page.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}












