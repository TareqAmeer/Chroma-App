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
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const theme of ['dark', 'light']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(theme => { localStorage.setItem('chromasmith-tour-seen-v1', '1'); localStorage.setItem('csTheme', theme); localStorage.setItem('csThemeGallery', theme); localStorage.setItem('csThemeEditor', theme); }, theme);
  await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=6&deskx=1`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('#lib-grid .lib-card[data-path]');
  await page.waitForTimeout(1800);

  await page.evaluate(() => {
    const source = getUISnapshot();
    source.sliders['adj-exp'] = 30;
    source.sliders['grain-a'] = 98;
    window.__copiedRecipe = btoa(unescape(encodeURIComponent(JSON.stringify(source))));
    window.libtestRecipeBatchFailNext([1]);
  });
  const cards = page.locator('#lib-grid .lib-card[data-path]');
  const paths = [];
  for (let index = 0; index < 3; index++) {
    paths.push(await cards.nth(index).getAttribute('data-path'));
    await cards.nth(index).click({ modifiers: index ? ['Meta'] : [] });
  }
  await cards.nth(1).click({ button: 'right' });
  await page.getByText('Edit (3)', { exact: true }).hover();
  await page.getByText('Paste edit (selective)…', { exact: true }).click();
  await page.locator('#paste-confirm').waitFor();
  for (const checkbox of await page.locator('.paste-cat-cb').all()) await checkbox.uncheck();
  await page.locator('.paste-cat-cb[value="adjust"]').check();
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
    assert.notEqual(recipe.sliders['grain-a'], 98, 'excluded grain leaked into target');
  });
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
  restored.forEach(sidecar => assert.equal(sidecar.recipe, ''));
  assert.deepEqual(errors, []);
  console.log(theme + ' PASS: context-menu selective paste → per-photo results → select failed → history retry → history undo (numeric IDs), excluded settings preserved.');
  await page.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

















