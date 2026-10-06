// Exercise Windows header menus in the real Gallery/Studio layout with mocked command dispatch.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const file = path.join(root, decodeURIComponent(url.pathname));
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.otf': 'font/otf', '.png': 'image/png' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CS_BROWSER_CHANNEL ? { channel: process.env.CS_BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(8000);
  await page.addInitScript(() => {
    window.CS_PLATFORM = { os: 'windows' };
    window.__menuCalls = [];
    window.chromasmithRunMenuAction = id => window.__menuCalls.push(id);
    localStorage.setItem('csTheme', 'light');
    localStorage.setItem('chromasmith-tour-seen-v1', '1');
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libcat=1&libn=12&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const gallery = page.locator('#cs-windows-titlebar .cs-header-menus');
  await gallery.waitFor({ state: 'visible' });
  console.log('Mounted Gallery menus');
  await page.evaluate(() => { let fullscreen = false; window.__TAURI__.window = { getCurrentWindow: () => ({ minimize: async () => window.__menuCalls.push('window-minimize'), toggleMaximize: async () => window.__menuCalls.push('window-maximize'), close: async () => window.__menuCalls.push('window-close'), isFullscreen: async () => fullscreen, setFullscreen: async value => { fullscreen = value; window.__menuCalls.push('window-fullscreen:' + value); }, startDragging: async () => {} }) }; });
  assert.deepEqual(await gallery.locator('.cs-header-menu-button').allTextContents(), ['File', 'Edit', 'Photo', 'View', 'Help']);
  for (const width of [900, 1100, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => window.fxSetTheme(theme), theme);
      await page.waitForTimeout(200);
      for (const button of await gallery.locator('.cs-header-menu-button').all()) {
        const visible = await button.evaluate(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height >= 28 && r.left >= 0 && r.right <= innerWidth && el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
        });
        if (!visible) { await page.screenshot({ path: 'header-900.png' }); console.log(await button.evaluate(el => ({name:el.textContent,rect:el.getBoundingClientRect().toJSON(),hit:document.elementFromPoint(el.getBoundingClientRect().left+10,el.getBoundingClientRect().top+10)?.outerHTML.slice(0,300)}))); }
        assert.ok(visible, `Menu clipped or covered at ${width}px (${theme})`);
      }
    }
  }
  console.log('Widths and themes checked');
  const file = gallery.getByRole('menuitem', { name: 'File', exact: true });
  await file.click();
  await page.locator('#cs-titlebar-file-menu').getByRole('menuitem', { name: 'Load Session…', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__menuCalls), ['menu-load-session']);
  assert.equal(await file.getAttribute('aria-expanded'), 'false');
  await gallery.getByRole('menuitem', { name: 'Photo', exact: true }).click();
  assert.ok(await page.locator('#cs-titlebar-photo-menu').getByRole('menuitem', { name: 'Crop / Straighten', exact: true }).isDisabled());
  await page.keyboard.press('Escape');
  await file.focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Open Photo…');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Open Folder…');
  await page.keyboard.press('Escape');
  assert.ok(await file.evaluate(el => el === document.activeElement));
  await file.click();
  await page.locator('#lib-search').click();
  assert.equal(await file.getAttribute('aria-expanded'), 'false');
  await mkdir('test/output/header-menus', { recursive: true });
  await page.screenshot({ path: 'test/output/header-menus/gallery.png' });
  console.log('Gallery interaction checked');
  await page.evaluate(() => window.chromasmithToggleLibrary());
  const studio = gallery;
  await studio.waitFor({ state: 'visible' });
  await studio.getByRole('menuitem', { name: 'Help', exact: true }).click();
  await page.locator('#cs-titlebar-help-menu').getByRole('menuitem', { name: 'Chromasmith Guide', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__menuCalls.at(-1)), 'menu-guide');
  // Every dropdown item must route to an existing command, including photo-only items.
  const nativeSource = await readFile('desktop/desktop-native.js', 'utf8');
  const librarySource = await readFile('desktop/library-ui.js', 'utf8');
  const actions = await page.locator('.cs-header-menu-popup [data-action]').evaluateAll(items => items.map(item => item.dataset.action));
  assert.equal(actions.length, 40);
  for (const action of actions.filter(id => !id.startsWith('window-'))) {
    assert.ok(nativeSource.includes(`wire('${action}'`) || librarySource.includes(`listen('${action}'`), `No handler for ${action}`);
  }
  await page.evaluate(() => { window.chromasmithMenuContext = () => ({ galleryFull: false, selectionCount: 1 }); fxImages.push({}); window.__copiedRecipe = {}; });
  for (const label of ['File', 'Edit', 'Photo', 'View', 'Help']) {
    const popup = page.locator(`#cs-titlebar-${label.toLowerCase()}-menu`);
    const ids = await popup.locator('[data-action]').evaluateAll(items => items.map(item => item.dataset.action));
    for (const id of ids) {
      await gallery.getByRole('menuitem', { name: label, exact: true }).click();
      assert.ok(await popup.locator(`[data-action="${id}"]`).isEnabled(), id);
      await popup.locator(`[data-action="${id}"]`).click();
      await page.waitForTimeout(20);
      assert.equal(await page.evaluate(() => window.__menuCalls.at(-1)), id === 'window-fullscreen' ? 'window-fullscreen:true' : id);
    }
  }
  await page.screenshot({ path: 'test/output/header-menus/studio.png' });
  await page.getByRole('button', { name: 'Minimize', exact: true }).click();
  await page.getByRole('button', { name: 'Maximize / Restore', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__menuCalls.slice(-3)), ['window-minimize', 'window-maximize', 'window-close']);
  const titleRect = await page.locator('#cs-windows-titlebar').boundingBox();
  assert.equal(titleRect.y, 0);
  assert.equal(titleRect.height, 32);
  const toolbarRect = await page.locator('#fx-deskbar').boundingBox();
  assert.equal(toolbarRect.y, 32);
  console.log('PASS: Gallery/Studio menus, both themes at 900/1100/1440px, dispatch, keyboard focus and dismissal');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
