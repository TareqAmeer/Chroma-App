// CHR-272 starter workspaces change presentation state while preserving recipe values.
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
  await page.waitForFunction(() => typeof csWorkspacePresetApply === 'function' && typeof getUISnapshot === 'function', null, { timeout: 30000 });

  for (const variant of [{ width: 1280, height: 800, light: false }, { width: 1440, height: 900, light: true }]) {
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await page.evaluate(light => document.body.classList.toggle('light', light), variant.light);
    await page.evaluate(() => {
      localStorage.removeItem('cs_workspace_controls_v1');
      switchTab('fx');
      const exposure = document.getElementById('sl-adj-exp');
      exposure.value = '27';
      exposure.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Exercise the same menu action a user sees, then switch profiles through the real UI.
    await page.evaluate(() => appearanceBuild());
    for (const [label, profile, hidden] of [
      ['Film look', 'film-look', ['curves', 'crop']],
      ['Colour grade', 'colour-grade', ['grain', 'crop']],
      ['Quick edit', 'quick-edit', ['grain', 'pointcolor']],
    ]) {
      const menu = page.locator('#fx-appearance-menu');
      const choice = menu.locator('button').filter({ hasText: new RegExp(`^${label}$`) });
      assert.equal(await choice.count(), 1, `${label} is available in the starter workspace menu`);
      await choice.evaluate(button => button.click());
      const result = await page.evaluate(() => ({
        snapshot: getUISnapshot().sliders['adj-exp'],
        exposure: document.getElementById('sl-adj-exp').value,
        sections: JSON.parse(localStorage.getItem('cs_workspace_controls_v1')),
      }));
      assert.equal(result.exposure, '27', `${label} leaves the live edit value unchanged`);
      assert.equal(result.snapshot, '27', `${label} leaves the photo recipe snapshot unchanged`);
      assert.ok(hidden.every(section => result.sections.hiddenSections.includes(section)), `${label} hides its out-of-focus sections`);
      assert.deepEqual(result.sections.hiddenControls, [], `${label} restores individual controls`);
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => typeof csWorkspaceLayoutGet === 'function', null, { timeout: 30000 });
      assert.ok(await page.locator(`.fx-ctrl[data-fxsec="${hidden[0]}"]`).evaluate(card => card.hidden), `${label} persists after reload`);
      await page.evaluate(() => {
        const exposure = document.getElementById('sl-adj-exp');
        exposure.value = '27';
        exposure.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.evaluate(() => appearanceBuild());
    }
  }
  assert.deepEqual(errors, [], 'no page errors while applying or restoring starter workspaces');
  console.log('workspace presets: Film look, Colour grade, and Quick edit menu actions, layout persistence, and edit snapshot preservation passed in dark/light themes');
} finally {
  await browser.close();
}
