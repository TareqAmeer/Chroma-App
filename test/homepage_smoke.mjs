import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = pathToFileURL(path.join(root, 'index.html')).href;
const shots = process.argv.includes('--shots');
const browser = await chromium.launch();

try {
  for (const [name, viewport, reducedMotion] of [
    ['desktop', { width: 1440, height: 900 }, 'no-preference'],
    ['mobile', { width: 390, height: 844 }, 'reduce'],
    ['small-mobile', { width: 320, height: 700 }, 'reduce'],
  ]) {
    const context = await browser.newContext({ viewport, reducedMotion });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.waitForLoadState('load');
    assert.equal(await page.locator('.chapter').count(), 8, name + ': chapter count');
    assert.equal(await page.locator('.chapter-nav a').count(), 8, name + ': number count');
    assert.equal(await page.locator('h1').count(), 1, name + ': one primary heading');
    assert.equal(await page.locator('.brand-rail .rail-word').textContent(), 'SMITH');
    assert.deepEqual(errors, [], name + ': JavaScript errors');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 1, name + ': horizontal overflow of ' + overflow + 'px');
    for (const image of await page.locator('img').all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate(img => img.decode().catch(() => {}));
    }
    const missing = await page.locator('img').evaluateAll(images =>
      images.filter(img => !img.complete || img.naturalWidth === 0).map(img => img.src));
    assert.deepEqual(missing, [], name + ': missing images');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const audit = await new AxeBuilder({ page }).analyze();
    const serious = audit.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
    assert.deepEqual(serious.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), [], name + ': accessibility');

    await page.locator('.chapter-nav a[href="#gallery"]').click();
    await page.waitForFunction(() =>
      document.querySelector('.chapter-nav a[href="#gallery"]').getAttribute('aria-current') === 'location');
    assert.equal(await page.locator('.rail-word').textContent(), 'GALLERY');

    const comparison = page.locator('.ba input[type="range"]');
    await comparison.focus();
    await comparison.press('ArrowRight');
    assert.equal(await comparison.inputValue(), '51', name + ': keyboard comparison');

    if (shots) {
      await page.emulateMedia({ reducedMotion });
      await mkdir(path.join(root, 'drafts'), { recursive: true });
      await page.goto(url);
      for (const id of (name === 'desktop' ? ['smith', 'gallery', 'click', 'guy'] : name === 'mobile' ? ['smith', 'gallery', 'anywhere'] : ['smith'])) {
        await page.evaluate(id => document.getElementById(id).scrollIntoView({ block: 'start', behavior: 'instant' }), id);
        await page.waitForTimeout(850);
        await page.screenshot({ path: path.join(root, 'drafts', `chr-152-${name}-${id}.png`) });
      }
    }
    await context.close();
  }
  console.log('Homepage smoke check passed: desktop, mobile, narrow mobile, navigation, images, comparison, and accessibility.');
} finally {
  await browser.close();
}
