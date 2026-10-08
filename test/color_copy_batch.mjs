import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from './editor_state_harness.mjs';

const { server, port } = await startServer();
let browser;
const b64 = bytes => Buffer.from(bytes).toString('base64');
try {
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const theme of ['dark', 'light']) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(theme => {
      localStorage.setItem('chromasmith-tour-seen-v1', '1');
      localStorage.setItem('csTheme', theme); localStorage.setItem('csThemeGallery', theme); localStorage.setItem('csThemeEditor', theme);
    }, theme);
    await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=6&deskx=1`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('#lib-grid .lib-card[data-path]');
    await page.waitForTimeout(900);

    // Use an actual bundled photograph for the selected Library source; make its reference a
    // warm-graded version of the same photograph so the color-distribution change is measurable.
    const reference = await page.evaluate(async () => {
      const img = new Image(); img.src = '/design/prototypes/swiss-kinetic/photos/canal.webp'; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = Math.round(640 * img.naturalHeight / img.naturalWidth);
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const source = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.94));
      window.__libtestQuicklookBytes = await source.arrayBuffer();
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < d.data.length; i += 4) {
        d.data[i] = Math.min(255, d.data[i] * 0.82);
        d.data[i + 1] = Math.min(255, d.data[i + 1] * 1.04 + 5);
        d.data[i + 2] = Math.min(255, d.data[i + 2] * 1.22 + 8);
      }
      ctx.putImageData(d, 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.94));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });

    const cards = page.locator('#lib-grid .lib-card[data-path]');
    const paths = [];
    for (let i = 0; i < 4; i++) paths.push(await cards.nth(i).getAttribute('data-path'));
    const baseline = await page.evaluate(selected => {
      const prior = getUISnapshot(); prior.sliders['grain-a'] = '77';
      prior.selects['sel-print'] = document.getElementById('sel-print')?.value || '';
      const recipe = btoa(unescape(encodeURIComponent(JSON.stringify(prior))));
      selected.forEach(path => window.__libtestSeedSidecar(path, { edited: true, recipe }));
      return { grain: prior.sliders['grain-a'], print: prior.selects['sel-print'] };
    }, paths.slice(0, 3));
    for (let i = 0; i < 3; i++) await cards.nth(i).click({ modifiers: i ? ['Control'] : [] });
    await cards.nth(1).click({ button: 'right' });
    await page.getByText('Edit (3)', { exact: true }).hover();
    await page.getByText('Colour Copy: match selection (3)…', { exact: true }).click();
    await page.waitForFunction(() => typeof ST !== 'undefined' && ST.cpTargetPaths?.length === 3 && document.querySelector('#panel-copy')?.classList.contains('active'));

    await page.locator('#dz-cp-ref input[type="file"]').setInputFiles({ name: 'canal-warm-reference.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(reference) });
    await page.waitForFunction(() => _cpPrev?.s?.px?.length && document.querySelector('#btn-cp-batch')?.disabled === false, { timeout: 20000 });
    assert.match(await page.locator('#btn-cp-batch').textContent(), /3 selected photos/);
    assert.equal(await page.locator('#cp-batch-targets').isVisible(), true);

    const pixels = await page.evaluate(() => {
      const source = _cpPrev.s, reference = _cpPrev.r, after = document.getElementById('cp-prev-after');
      const read = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const cdf = (a, b, w, h) => {
        let total = 0;
        for (let c = 0; c < 3; c++) {
          const ah = new Uint32Array(256), bh = new Uint32Array(256);
          for (let i = 0; i < w * h; i++) { ah[a[i * 4 + c]]++; bh[b[i * 4 + c]]++; }
          let ac = 0, bc = 0, d = 0;
          for (let v = 0; v < 256; v++) { ac += ah[v]; bc += bh[v]; d += Math.abs(ac / (w * h) - bc / (w * h)); }
          total += d / 256;
        }
        return total / 3;
      };
      const src = source.px, ref = reference.px, out = read(after), w = source.w, h = source.h;
      const beforeGap = cdf(src, ref, w, h), matchedGap = cdf(out, ref, w, h);
      document.getElementById('cp-str').value = '0'; cpPreviewUpdate();
      const zero = read(after); let zeroMaxDelta = 0, changedPixels = 0, meanDelta = 0;
      for (let i = 0; i < zero.length; i += 4) {
        for (let c = 0; c < 3; c++) { zeroMaxDelta = Math.max(zeroMaxDelta, Math.abs(zero[i + c] - src[i + c])); meanDelta += Math.abs(out[i + c] - src[i + c]); }
        if (Math.abs(out[i] - src[i]) + Math.abs(out[i + 1] - src[i + 1]) + Math.abs(out[i + 2] - src[i + 2]) > 3) changedPixels++;
      }
      document.getElementById('cp-str').value = '100'; cpPreviewUpdate();
      return { width: w, height: h, beforeGap, matchedGap, zeroMaxDelta, changedPixels, totalPixels: w * h, meanDelta: meanDelta / (w * h * 3) };
    });
    assert.equal(pixels.zeroMaxDelta, 0, 'zero Color Copy strength must be an exact identity');
    assert.ok(pixels.changedPixels > pixels.totalPixels * 0.2 && pixels.meanDelta > 3, 'the match must change a measurable part of the real photo');
    assert.ok(pixels.matchedGap < pixels.beforeGap * 0.55, `match should move the photo toward the reference histogram: ${JSON.stringify(pixels)}`);

    await page.locator('#cp-name').fill('chr221-batch');
    await page.locator('#btn-cp-batch').click();
    await page.waitForFunction(() => document.querySelector('#btn-cp-batch')?.disabled === false, { timeout: 30000 });
    const batches = await page.evaluate(() => window.libtestRecipeBatchInvoke('recipe_batch_list', {}));
    const batch = batches.find(item => item.label?.startsWith('Color Copy: chr221-batch'));
    assert.ok(batch, 'the visible apply action must create a durable recipe batch');
    const detail = await page.evaluate(id => window.libtestRecipeBatchInvoke('recipe_batch_get', { id }), batch.id);
    assert.equal(detail.status, 'completed');
    assert.deepEqual(detail.items.map(item => item.path).sort(), paths.slice(0, 3).sort());
    assert.deepEqual(detail.items.map(item => item.status), ['applied', 'applied', 'applied']);
    const recipes = detail.items.map(item => JSON.parse(decodeURIComponent(escape(atob(item.recipe)))));
    recipes.forEach(recipe => {
      assert.equal(recipe.selects['sel-lut'], 'l:chr221-batch v1.0', 'each selected target must reference the generated match look');
      assert.equal(recipe.sliders['lut-mix'], '100');
      assert.equal(recipe.sliders['grain-a'], baseline.grain, 'batch application must retain each target’s unrelated settings');
      assert.equal(recipe.selects['sel-print'], baseline.print, 'batch application must retain print settings');
    });
    assert.equal(detail.items.some(item => item.path === paths[3]), false, 'unselected photo must not be changed');
    assert.equal(await page.locator('#lib-grid .lib-card[data-path]').count(), 6);
    assert.deepEqual(errors, []);
    console.log(`${theme} PASS: real-photo Color Copy, zero-strength identity, histogram CDF ${pixels.beforeGap.toFixed(4)} → ${pixels.matchedGap.toFixed(4)}, 3 selected recipes updated, unrelated settings and unselected photo preserved, zero page errors.`);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
