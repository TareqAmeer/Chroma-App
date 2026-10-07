// CHR-108 (back-to-top button), on all three homepages; the CHR-110 platform line under the hero was removed.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch();
try {
  for (const page_ of ['index.html', 'accessible.html', 'ar/index.html']) {
    for (const [name, viewport, reducedMotion] of [['desktop', { width: 1440, height: 900 }, 'no-preference'], ['mobile', { width: 390, height: 844 }, 'no-preference'], ['reduced', { width: 1280, height: 720 }, 'reduce']]) {
      const ctx = await browser.newContext({ viewport, reducedMotion });
      const page = await ctx.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(pathToFileURL(path.join(root, page_)).href);
      await page.waitForLoadState('load');
      const tag = `${page_} ${name}`;
      assert.equal(await page.locator('#platforms').count(), 0, tag + ': platform line removed');
      const btn = page.locator('#totop');
      assert.equal(await btn.evaluate(b => getComputedStyle(b).pointerEvents), 'none', tag + ': hidden at the top');
      await page.evaluate(() => { const y = Math.round(innerHeight * 3); typeof lenis !== 'undefined' && lenis ? lenis.scrollTo(y, { immediate: true, force: true }) : scrollTo(0, y); });
      await page.waitForFunction(() => scrollY > innerHeight * 2);
      await page.waitForFunction(() => document.getElementById('totop').classList.contains('on'));
      const box = await btn.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, tag + ': button on screen');
      await btn.click();
      await page.waitForFunction(() => scrollY < 4, null, { timeout: 5000 });
      assert.deepEqual(errors, [], tag);
      await ctx.close();
    }
  }
  console.log('PASS homepage back-to-top (index, accessible, arabic; desktop, mobile, reduced motion)');
} finally { await browser.close(); }
