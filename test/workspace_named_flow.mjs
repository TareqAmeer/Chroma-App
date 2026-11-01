// CHR-272 named-workspace flow: capture a layout, switch away, restore it, and delete it.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('chromasmith-tour-seen-v1', '1'));
  await page.goto(`${pathToFileURL(path.join(root, 'chromasmith-22.html')).href}?libtest=1`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof csLayoutSave === 'function' && typeof csWorkspacePresetApply === 'function', null, { timeout: 30000 });

  await page.evaluate(() => {
    localStorage.removeItem('cs_layouts');
    localStorage.removeItem('chromasmith-session-v1');
    switchTab('fx');
    const exposure = document.getElementById('sl-adj-exp');
    exposure.value = '27';
    exposure.dispatchEvent(new Event('input', { bubbles: true }));
    saveSession(true);
    csWorkspacePresetApply('film-look');
    const open = JSON.parse(localStorage.getItem('chromasmith_fx_sec_collapsed') || '{}');
    open.adjust = true;
    localStorage.setItem('chromasmith_fx_sec_collapsed', JSON.stringify(open));
    if (typeof _fxSecCollapsed === 'object') _fxSecCollapsed.adjust = true;
  });

  await page.evaluate(() => { csLayoutSave(); });
  await page.locator('#fx-ask-input').waitFor({ state: 'visible' });
  await page.locator('#fx-ask-input').fill('Film workspace');
  await page.locator('#fx-ask-ok').click();
  await page.waitForFunction(() => csLayoutsList().some(layout => layout.name === 'Film workspace'));
  const saved = await page.evaluate(() => csLayoutsList()[0]);
  assert.equal(saved.name, 'Film workspace', 'the named workspace is saved with its exact name');
  assert.ok(saved.keys.cs_workspace_controls_v1, 'the saved layout includes the customized section visibility/order');
  assert.ok(JSON.parse(saved.keys.chromasmith_fx_sec_collapsed).adjust, 'the saved workspace captures the live open/closed section state');

  await page.evaluate(() => csWorkspacePresetApply('quick-edit'));
  assert.equal(await page.locator('.fx-ctrl[data-fxsec="grain"]').evaluate(card => card.hidden), true, 'the alternate workspace differs before restore');
  await page.evaluate(() => { csLayoutApply(0); });
  await page.locator('#fx-confirm-modal').waitFor({ state: 'visible' });
  assert.match(await page.locator('#fx-confirm-msg').innerText(), /Film workspace/);
  await page.locator('#fx-confirm-ok').click();
  await page.waitForLoadState('load');
  await page.waitForFunction(() => typeof csLayoutApply === 'function' && document.getElementById('sl-adj-exp'), null, { timeout: 30000 });
  assert.equal(await page.locator('.fx-ctrl[data-fxsec="grain"]').evaluate(card => card.hidden), false, 'applying restores the saved Film look layout');
  assert.equal(await page.locator('.fx-ctrl[data-fxsec="adjust"]').evaluate(card => card.classList.contains('fx-sec-collapsed')), true, 'applying restores the saved closed section state');
  assert.equal(await page.locator('#sl-adj-exp').inputValue(), '27', 'switching reloads with the saved photo edit value');
  assert.equal(await page.evaluate(() => getUISnapshot().sliders['adj-exp']), '27', 'the restored edit remains in the recipe snapshot');

  await page.evaluate(() => { csLayoutDelete(0); });
  await page.locator('#fx-confirm-modal').waitFor({ state: 'visible' });
  await page.locator('#fx-confirm-ok').click();
  await page.waitForFunction(() => csLayoutsList().length === 0);
  await page.evaluate(() => {
    localStorage.setItem('cs_panelw', '411');
    localStorage.setItem('chromasmith_fx_sec_collapsed', '{"adjust":true}');
    csWorkspaceCustomizeOpen();
  });
  await page.locator('#cs-workspace-reset-all').click();
  await page.locator('#fx-confirm-modal').waitFor({ state: 'visible' });
  await page.locator('#fx-confirm-ok').click();
  await page.waitForLoadState('load');
  await page.waitForFunction(() => typeof csLayoutReset === 'function' && document.getElementById('sl-adj-exp'), null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => localStorage.getItem('cs_panelw')), null, 'customize mode exposes reset for the complete default layout');
  assert.equal(await page.evaluate(() => localStorage.getItem('chromasmith_fx_sec_collapsed')), null, 'reset restores default section open state');
  assert.deepEqual(errors, [], 'no page errors during save, switch, or delete');
  console.log('workspace named flow: save/name, switch away, apply with session edit preserved, delete, and browser reload passed');
} finally {
  await browser.close();
}
