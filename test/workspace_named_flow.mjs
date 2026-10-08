// CHR-272 named-workspace flow: capture a layout, switch away, restore it, delete it, and reset defaults.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const relative = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(root, relative);
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [], consoleErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('chromasmith-tour-seen-v1', '1');
    if (!sessionStorage.getItem('chr272-test-initialized')) {
      for (const key of ['cs_layouts', 'chromasmith-session-v1', 'chromasmith_fx_sec_collapsed', 'cs_workspace_controls_v1', 'cs_panelw']) localStorage.removeItem(key);
      sessionStorage.setItem('chr272-test-initialized', '1');
    }
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?libtest=1`, { waitUntil: 'load', timeout: 60000 });
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
  });
  await page.evaluate(() => {
    const collapsed = JSON.parse(localStorage.getItem('chromasmith_fx_sec_collapsed') || '{}');
    collapsed.grain = true;
    localStorage.setItem('chromasmith_fx_sec_collapsed', JSON.stringify(collapsed));
    if (typeof _fxSecCollapsed === 'object') _fxSecCollapsed.grain = true;
  });

  await page.evaluate(() => { csLayoutSave(); });
  await page.locator('#fx-ask-input').waitFor({ state: 'visible' });
  await page.locator('#fx-ask-input').fill('Film workspace');
  await page.locator('#fx-ask-ok').click();
  await page.waitForFunction(() => csLayoutsList().some(layout => layout.name === 'Film workspace'));
  const saved = await page.evaluate(() => csLayoutsList()[0]);
  assert.equal(saved.name, 'Film workspace', 'the named workspace is saved with its exact name');
  assert.ok(saved.keys.cs_workspace_controls_v1, 'the saved layout includes the customized section visibility/order');
  assert.equal(JSON.parse(saved.keys.chromasmith_fx_sec_collapsed).grain, true, 'the saved workspace captures the UI-toggled closed section');

  await page.evaluate(() => csWorkspacePresetApply('quick-edit'));
  assert.equal(await page.locator('.fx-ctrl[data-fxsec="grain"]').evaluate(card => card.hidden), true, 'the alternate workspace differs before restore');
  await page.evaluate(() => { csLayoutApply(0); });
  await page.locator('#fx-confirm-modal').waitFor({ state: 'visible' });
  assert.match(await page.locator('#fx-confirm-msg').innerText(), /Film workspace/);
  await page.locator('#fx-confirm-ok').click();
  await page.waitForLoadState('load');
  await page.waitForFunction(() => typeof csLayoutApply === 'function' && document.getElementById('sl-adj-exp'), null, { timeout: 30000 });
  assert.equal(await page.locator('.fx-ctrl[data-fxsec="grain"]').evaluate(card => card.hidden), false, 'applying restores the saved Film look layout');
  assert.equal(await page.locator('.fx-ctrl[data-fxsec="grain"]').evaluate(card => card.classList.contains('fx-sec-collapsed')), true, 'applying restores the saved closed section state');
  assert.equal(await page.locator('#sl-adj-exp').inputValue(), '27', 'switching reloads with the saved photo edit value');
  assert.equal(await page.evaluate(() => getUISnapshot().sliders['adj-exp']), '27', 'the restored edit remains in the recipe snapshot');

  await page.evaluate(() => { csLayoutDelete(0); });
  await page.locator('#fx-confirm-modal').waitFor({ state: 'visible' });
  await page.locator('#fx-confirm-ok').click();
  await page.waitForFunction(() => csLayoutsList().length === 0);
  await page.evaluate(() => {
    localStorage.setItem('cs_panelw', '411');
    localStorage.setItem('chromasmith_fx_sec_collapsed', '{"grain":true}');
    localStorage.setItem('cs_workspace_controls_v1', '{"hiddenSections":["grain"]}');
    csWorkspaceCustomizeOpen();
  });
  await page.locator('#cs-workspace-reset-all').waitFor({ state: 'visible' });
  await page.locator('#cs-workspace-reset-all').click();
  await page.locator('#fx-confirm-modal').waitFor({ state: 'visible' });
  await page.locator('#fx-confirm-ok').click();
  await page.waitForLoadState('load');
  await page.waitForFunction(() => typeof csLayoutReset === 'function' && document.getElementById('sl-adj-exp'), null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => localStorage.getItem('cs_panelw')), null, 'reset clears customized panel width');
  assert.equal(await page.evaluate(() => localStorage.getItem('chromasmith_fx_sec_collapsed')), null, 'reset restores default section open state');
  assert.equal(await page.evaluate(() => localStorage.getItem('cs_workspace_controls_v1')), null, 'reset clears customized control visibility/order');
  assert.equal(await page.locator('#sl-adj-exp').inputValue(), '27', 'reset preserves the photo edit');
  assert.equal(await page.evaluate(() => getUISnapshot().sliders['adj-exp']), '27', 'reset preserves the edit in the recipe snapshot');
  assert.deepEqual(errors, [], 'no page errors during save, switch, delete, or reset');
  assert.deepEqual(consoleErrors, [], `no browser console errors: ${consoleErrors.join('; ')}`);
  console.log('workspace named flow: save/name, open-section state, switch/apply, delete, always-available reset, and edit preservation passed');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
