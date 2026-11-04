// CHR-196 / CHR-182: visible, platform-independent routes to the command palette and the
// shortcut editor. Windows has no native menu bar, so the Settings menu's "More" pane must offer
// "Search commands…" and "Keyboard shortcuts…" (with the live, rebindable key hint), and the
// Settings/About dialog must open the shortcut editor. Real clicks, desktop layout, both themes.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'] });
const errors = [];
for (const theme of ['dark', 'light']) {
  for (const width of [1280, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('dialog', (d) => { errors.push('unexpected dialog: ' + d.message()); d.dismiss(); });
    await page.goto(pathToFileURL(process.env.APP_HTML || path.join(ROOT, 'chromasmith-22.html')).href + '?deskx=1', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => typeof window.loadFXImages === 'function' && typeof settingsToggle === 'function', null, { timeout: 30000 });
    await page.evaluate(async (t) => {
      localStorage.removeItem('chromasmith-shortcuts-v1');
      if (typeof fxSetTheme === 'function') fxSetTheme(t); else document.body.classList.toggle('light', t === 'light');
      const c = document.createElement('canvas'); c.width = 600; c.height = 400; c.getContext('2d').fillRect(0, 0, 600, 400);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      await loadFXImages([new File([blob], 'a.png', { type: 'image/png' })]);
    }, theme);
    await page.waitForFunction(() => fxImages.length > 0, null, { timeout: 20000 });
    await page.keyboard.press('Escape');
    await page.evaluate(() => { document.querySelectorAll('#cs-modal-ov').forEach((x) => x.remove()); });
    const tag = `${width}px ${theme}`;

    const openMore = async () => {
      await page.locator('#fx-settings').click();
      await page.locator('#fx-settings-cats [data-cat="overflow"]').click();
    };
    // 1. Search commands… opens the palette and shows the live binding.
    await openMore();
    const cmdRow = page.locator('#fx-overflow-menu [data-ovf="commands"]');
    await assert.doesNotReject(cmdRow.waitFor({ state: 'visible', timeout: 3000 }), `${tag}: Search commands row visible`);
    assert.match(await cmdRow.innerText(), /Ctrl\s*\+?\s*K|⌘\s*K/i, `${tag}: palette row shows its shortcut`);
    const box = await cmdRow.boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= width, `${tag}: row inside the window`);
    await cmdRow.click();
    await page.waitForSelector('#cp-ov #cp-input', { timeout: 3000 });
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'cp-input', `${tag}: palette input focused`);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#cp-ov').count(), 0, `${tag}: palette closes on Escape`);

    // 2. A rebound palette key is what the menu shows.
    await page.evaluate(() => window.chromasmithShortcutRegistry.set('editor.search', 'CmdOrCtrl+Alt+J'));
    await openMore();
    assert.match(await cmdRow.innerText(), /(Alt|⌥)\s*\+?\s*J/i, `${tag}: menu hint follows the rebinding`);

    // 3. Keyboard shortcuts… opens the editor.
    await page.locator('#fx-overflow-menu [data-ovf="shortcuts"]').click();
    await page.waitForSelector('#cs-modal-ov #cs-shortcut-search', { timeout: 3000 });
    await page.keyboard.press('Escape');
    await page.evaluate(() => { document.querySelectorAll('#cs-modal-ov').forEach((x) => x.remove()); localStorage.removeItem('chromasmith-shortcuts-v1'); });

    // 4. Settings/About dialog routes to the shortcut editor.
    await page.evaluate(() => csAbout());
    await page.locator('#cs-modal-ov [data-about="shortcuts"]').click();
    await page.waitForSelector('#cs-modal-ov #cs-shortcut-search', { timeout: 3000 });
    assert.equal(await page.locator('#cs-modal-ov').count(), 1, `${tag}: exactly one modal after switching`);
    console.log(`  ${tag}: ok`);
    await page.close();
  }
}
await browser.close();
assert.deepEqual(errors, [], 'no page errors or dialogs');
console.log('SETTINGS COMMAND ROUTES: PASS');
