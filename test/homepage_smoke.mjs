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
    ['laptop', { width: 1280, height: 720 }, 'no-preference'],
    ['tablet', { width: 1024, height: 768 }, 'reduce'],
    ['landscape', { width: 800, height: 600 }, 'reduce'],
    ['mobile', { width: 390, height: 844 }, 'no-preference'],
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
    if (name === 'mobile') {
      assert.match(await page.locator('html').evaluate(el => getComputedStyle(el).scrollSnapType), /mandatory/, 'touch layout snaps by chapter');
    }
    if (name === 'desktop') {
      await page.mouse.wheel(0, 120);
      await page.waitForFunction(() => Math.abs(scrollY - document.getElementById('gallery').offsetTop) < 2);
      assert.equal(await page.locator('.rail-word').textContent(), 'GALLERY', 'wheel advances to Gallery');
      for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 120);
      await page.waitForTimeout(850);
      assert.equal(await page.locator('.rail-word').textContent(), 'GALLERY', 'momentum does not skip a chapter');
      await page.waitForTimeout(350);
      await page.mouse.wheel(0, 120);
      await page.waitForFunction(() => Math.abs(scrollY - document.getElementById('studio').offsetTop) < 2);
      assert.equal(await page.locator('.rail-word').textContent(), 'STUDIO', 'second wheel advances one chapter');
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 1, name + ': horizontal overflow of ' + overflow + 'px');
    const sizing = await page.locator('.chapter').evaluateAll(sections => sections.map(section => {
      const inner = section.querySelector('.chapter-inner');
      const top = section.getBoundingClientRect().top;
      const boxes = [...section.querySelectorAll('.chapter-num,h1,h2,.display-shot,.red-panel,.ba-stage,.phone-frame,.portrait-placeholder,.download-details,.btn-row,.hero-note,.mini-list,.privacy-line,blockquote,.site-credit')]
        .map(element => element.getBoundingClientRect());
      return { id: section.id, height: Math.round(section.getBoundingClientRect().height),
        inner: Math.round(inner.getBoundingClientRect().height), content: inner.scrollHeight,
        first: Math.round(Math.min(...boxes.map(box => box.top - top))),
        last: Math.round(Math.max(...boxes.map(box => box.bottom - top))) };
    }));
    if (process.argv.includes('--layout')) console.log(name, JSON.stringify(sizing));
    for (const section of sizing) {
      assert.ok(Math.abs(section.height - viewport.height) <= 1, `${name}: ${section.id} should fill one viewport`);
      assert.ok(section.first >= 0 && section.last <= viewport.height, `${name}: ${section.id} content should fit the viewport`);
    }
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

    await page.locator('.chapter-nav a[href="#yours"]').click();
    await page.locator('.download-details summary').click();
    assert.equal(await page.locator('.download-details').getAttribute('open'), '', name + ': download details open');
    await page.waitForFunction(() => document.documentElement.classList.contains('details-open'));
    assert.equal(await page.locator('html').evaluate(el => el.classList.contains('details-open')), true, name + ': expanded details allow natural scroll');

    if (shots) {
      await page.emulateMedia({ reducedMotion });
      await mkdir(path.join(root, 'drafts'), { recursive: true });
      await page.goto(url);
      for (const id of (name === 'desktop' ? ['smith', 'gallery', 'click', 'guy', 'yours'] : name === 'mobile' ? ['smith', 'gallery', 'anywhere', 'yours'] : ['smith'])) {
        await page.evaluate(id => document.getElementById(id).scrollIntoView({ block: 'start', behavior: 'instant' }), id);
        await page.waitForTimeout(850);
        await page.screenshot({ path: path.join(root, 'drafts', `chr-152-${name}-${id}.png`) });
      }
    }
    await context.close();
  }
  console.log('Homepage smoke check passed: six viewports, chapter paging, navigation, images, comparison, details, and accessibility.');
} finally {
  await browser.close();
}
