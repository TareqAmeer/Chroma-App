// CHR-264 bounded gate: visible range controls keep a 24px hit area across desktop widths/themes,
// including the coloured slider variant and the mobile editor override. It also exercises pointer,
// native focus/arrow input, and the app's fine/coarse keyboard modifiers.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const widths = [820, 1280, 1440, 1920];
const browser = await chromium.launch({ args: [
  '--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader',
] });
async function stableCanvasArea(page) {
  let previous = '', repeats = 0, last = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(80);
    last = await page.evaluate(() => {
      const box = document.getElementById('fx-canvas').getBoundingClientRect();
      return { width: box.width, height: box.height, area: Math.round(box.width * box.height) };
    });
    const current = JSON.stringify(last);
    repeats = current === previous ? repeats + 1 : 0;
    if (repeats >= 2) return last.area;
    previous = current;
  }
  throw new Error(`Preview did not settle: ${JSON.stringify(last)}`);
}

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (error) => { throw error; });
  const appHtml = process.env.CHR264_APP_HTML || path.join(ROOT, 'chromasmith-22.html');
  await page.goto(pathToFileURL(appHtml).href, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof window.loadFXImages === 'function', null, { timeout: 30000 });
  const fixture = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await loadFXImages([new File([bytes], 'portrait.png', { type: 'image/png' })]);
  }, fixture);
  await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length > 0, null, { timeout: 20000 });
  await page.evaluate(() => {
    // Show the real editor controls even when this standalone page starts on its Library tab.
    document.body.classList.add('fx-single');
    document.getElementById('panel-fx')?.classList.add('active');
    const card = document.querySelector('.fx-ctrl[data-fxsec="adjust"]');
    card?.classList.add('sec-active');
    const toggle = document.getElementById('tg-adjust');
    if (toggle && !toggle.classList.contains('on')) toggleFX('adjust');
  });

  const baselinePreview = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(180); // allow the editor's resize observers to settle
    for (const theme of ['dark', 'light']) {
      await page.evaluate((light) => {
        document.body.classList.toggle('light', light);
        const inputs = ['sl-adj-exp', 'sl-adj-temp'].map((id) => document.getElementById(id));
        // A same-page A/B avoids pinning a canvas number to startup timing or stored preferences:
        // zero only the new min-height rule, measure, then restore it and re-measure.
        inputs.forEach((input) => { input.style.minHeight = '0px'; });
      }, theme === 'light');
      const areaBefore = await stableCanvasArea(page);
      await page.evaluate(() => {
        const inputs = ['sl-adj-exp', 'sl-adj-temp'].map((id) => document.getElementById(id));
        inputs.forEach((input) => { input.style.removeProperty('min-height'); });
      });
      const areaAfter = await stableCanvasArea(page);
      const measured = await page.evaluate((areas) => {
        const [areaBefore, areaAfter] = areas;
        const canvas = document.getElementById('fx-canvas').getBoundingClientRect();
        const controls = ['sl-adj-exp', 'sl-adj-temp'].map((id) => {
          const input = document.getElementById(id);
          const box = input.getBoundingClientRect();
          return { id: input.id, width: Math.round(box.width), height: Math.round(box.height), tabIndex: input.tabIndex };
        });
        return { canvas: { width: Math.round(canvas.width), height: Math.round(canvas.height), area: areaAfter }, areaBefore, areaAfter, controls };
      }, [areaBefore, areaAfter]);
      baselinePreview.push({ width, theme, ...measured });
      assert.equal(measured.areaAfter, measured.areaBefore, `24px slider target leaves visible photo area unchanged at ${width}px (${theme})`);
      for (const control of measured.controls) {
        assert.ok(control.width > 0, `${control.id} is visible at ${width}px (${theme})`);
        assert.ok(control.height >= 24, `${control.id} hit area is ${control.height}px at ${width}px (${theme}); expected >=24px`);
        assert.ok(control.tabIndex >= 0, `${control.id} is keyboard focusable`);
      }
    }
  }

  // The mobile editor uses larger overrides (44px); confirm the generic target size isn't
  // accidentally defeated by either its normal or gradient-slider rules.
  const mobileHeights = await page.evaluate(() => {
    document.body.classList.add('mobile-fx');
    return ['sl-adj-exp', 'sl-adj-temp'].map((id) => {
      const input = document.getElementById(id);
      return { id, height: Math.round(input.getBoundingClientRect().height) };
    });
  });
  for (const slider of mobileHeights) {
    assert.ok(slider.height >= 24, `${slider.id} mobile hit area is ${slider.height}px; expected >=24px`);
  }
  await page.evaluate(() => document.body.classList.remove('mobile-fx'));

  // Pointer changes the real range. Native focus and arrows retain their existing fine/coarse
  // behaviour, with Alt adding a tenth of the normal step.
  const slider = page.locator('#sl-adj-exp');
  await slider.evaluate((el) => { el.value = '-100'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const box = await slider.boundingBox();
  assert.ok(box && box.width > 100 && box.height >= 24, 'pointer target is available');
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  const pointerValue = await slider.inputValue();
  assert.ok(Number(pointerValue) > -100, `pointer click changes slider value (${pointerValue})`);

  await slider.evaluate((el) => { el.value = '0'; el.focus(); });
  await page.keyboard.press('ArrowRight');
  const normalValue = Number(await slider.inputValue());
  assert.equal(normalValue, 0.1, 'plain ArrowRight applies the existing 0.1 fine increment');
  await page.keyboard.press('Alt+ArrowRight');
  const altValue = Number(await slider.inputValue());
  assert.equal(altValue, 0.11, 'Alt+ArrowRight applies the new 0.01 finer increment');
  await page.keyboard.press('Shift+ArrowRight');
  const shiftValue = Number(await slider.inputValue());
  assert.equal(shiftValue, 1.11, 'Shift+ArrowRight retains the existing 1.0 coarse increment');

  console.log(JSON.stringify({
    visiblePreviewArea: baselinePreview.map(({ width, theme, canvas }) => ({ width, theme, ...canvas })),
    desktopAndThemeHitTargets: 'PASS (2 sliders × 4 widths × 2 themes)',
    mobileHitTargets: mobileHeights,
    pointerValue,
    keyboard: { normalValue, altValue, shiftValue },
  }, null, 2));
} finally {
  await browser.close();
}
