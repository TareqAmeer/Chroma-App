// CHR-270 bounded comparison-divider interaction regression.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', error => { throw error; });
  await page.goto(pathToFileURL(path.join(ROOT, 'chromasmith-22.html')).href, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof window.loadFXImages === 'function');
  const image = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
  await page.evaluate(async b64 => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    await loadFXImages([new File([bytes], 'portrait.png', { type: 'image/png' })]);
    document.body.classList.add('fx-single');
    document.getElementById('panel-fx')?.classList.add('active');
    fxSplit = true;
    initSplitDrag();
  }, image);
  const divider = page.locator('#fx-split-line');
  await page.evaluate(() => { fxSplitAxis = 'vertical'; fxSplitPos = .5; _applySplitPos(); });
  await divider.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => fxSplitPos), .51, 'vertical arrow nudges divider by 1%');
  await page.keyboard.press('Shift+ArrowRight');
  assert.equal(await page.evaluate(() => fxSplitPos), .56, 'Shift+arrow nudges divider by 5%');
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(() => fxSplitPos), .95, 'End reaches trailing limit');
  await divider.dblclick();
  assert.equal(await page.evaluate(() => fxSplitPos), .5, 'double-click recentres divider');
  const verticalBox = await divider.boundingBox();
  assert.ok(verticalBox, 'vertical divider is visible and hit-testable');
  await page.mouse.move(verticalBox.x + verticalBox.width / 2, verticalBox.y + verticalBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(verticalBox.x + verticalBox.width / 2 + 70, verticalBox.y + verticalBox.height / 2, { steps: 5 });
  await page.mouse.up();
  const verticalDragPos = await page.evaluate(() => fxSplitPos);
  assert.ok(verticalDragPos > .52, 'pointer drag moves the vertical divider with the photo');

  await page.evaluate(() => { fxSplitAxis = 'horizontal'; fxSplitPos = .5; _applySplitPos(); });
  assert.equal(await divider.getAttribute('aria-orientation'), 'horizontal');
  assert.equal(await divider.getAttribute('data-axis'), 'horizontal');
  await divider.focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => fxSplitPos), .51, 'horizontal arrow nudges divider by 1%');
  const horizontalBox = await divider.boundingBox();
  assert.ok(horizontalBox, 'horizontal divider is visible and hit-testable');
  await page.mouse.move(horizontalBox.x + horizontalBox.width / 2, horizontalBox.y + horizontalBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(horizontalBox.x + horizontalBox.width / 2, horizontalBox.y + horizontalBox.height / 2 + 70, { steps: 5 });
  await page.mouse.up();
  const horizontalDragPos = await page.evaluate(() => fxSplitPos);
  assert.ok(horizontalDragPos > .52, 'pointer drag moves the horizontal divider with the photo');
  const clips = await page.evaluate(() => ({ pos: fxSplitPos, before: document.getElementById('fx-canvas-orig').style.clipPath, after: FX.cv.style.clipPath }));
  assert.match(clips.before, new RegExp(`${(100 - clips.pos * 100).toFixed(1)}%`), 'before canvas clipping follows the dragged divider');
  assert.match(clips.after, new RegExp(`${(clips.pos * 100).toFixed(1)}%`), 'after canvas clipping follows the dragged divider');
  const recipe = await page.evaluate(() => JSON.stringify(getUISnapshot()));
  assert.doesNotMatch(recipe, /fxSplitAxis|fxSplitPos/, 'divider presentation state is not serialized in recipe');
  console.log(`CHR-270 divider regression: PASS (vertical drag .500→${verticalDragPos.toFixed(3)}, horizontal drag .510→${horizontalDragPos.toFixed(3)}, keyboard, limits, recenter, split clipping, recipe isolation)`);
} finally {
  await browser.close();
}
