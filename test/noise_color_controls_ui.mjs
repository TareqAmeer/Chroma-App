// CHR-249: Color Detail and Smoothness must drive the production RAW-source NR pass.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bytes = (await readFile(path.join(root, 'test/fixtures/portrait.png'))).toString('base64');
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: [process.platform === 'win32' ? '--use-gl=angle' : '--use-gl=swiftshader', '--use-angle=swiftshader',
    '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
  const errors = [], glErrors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /GLSL compile error|LINK FAILED/i.test(m.text())) glErrors.push(m.text()); });
  await page.goto(pathToFileURL(path.join(root, 'chromasmith-22.html')).href, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof processToCanvas === 'function');
  await page.evaluate(async b64 => {
    const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    await loadFXImages([new File([raw], 'noise-controls.png', { type: 'image/png' })]);
    document.body.classList.add('fx-single');
    document.getElementById('panel-fx')?.classList.add('active');
    fxSection('nr');
    window.__noiseSamples = {};
    window.__noiseCapture = name => {
      const src = FX.cv, cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
      const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(src, 0, 0);
      window.__noiseSamples[name] = { width: cv.width, height: cv.height, data: ctx.getImageData(0, 0, cv.width, cv.height).data };
    };
    window.__noiseDiff = (a, b) => {
      const x = window.__noiseSamples[a].data, y = window.__noiseSamples[b].data;
      let changed = 0, sum = 0, max = 0;
      for (let i = 0; i < x.length; i += 4) for (let c = 0; c < 3; c++) {
        const d = Math.abs(x[i + c] - y[i + c]); if (d) changed++; sum += d; max = Math.max(max, d);
      }
      return { changed, sum, max };
    };
  }, bytes);
  const set = async (id, value) => {
    await page.locator(`#sl-nr-${id}`).evaluate((e, v) => {
      e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
    await page.evaluate(() => renderPreview());
    await page.waitForTimeout(100);
    await page.evaluate(name => window.__noiseCapture(name), `${id}-${value}`);
  };

  for (const id of ['color-detail', 'smooth']) {
    assert.equal(await page.locator(`#sl-nr-${id}`).count(), 1, `${id} control exists`);
    assert.ok(await page.locator(`#sl-nr-${id}`).isVisible(), `${id} is visible in Detail`);
  }
  const defaultState = await page.evaluate(() => ({
    colorDetail: document.getElementById('sl-nr-color-detail').value,
    smooth: document.getElementById('sl-nr-smooth').value,
    paste: PASTE_CATEGORIES.find(c => c.key === 'nr')?.sliders || [],
  }));
  assert.deepEqual(defaultState, { colorDetail: '50', smooth: '50', paste: ['nr-lum', 'nr-col', 'nr-det', 'nr-con', 'nr-color-detail', 'nr-smooth', 'nr-hldesat'] });

  await set('lum', 0); await set('col', 0); await set('color-detail', 50); await set('smooth', 50);
  await page.evaluate(() => window.__noiseCapture('nr-off-default'));
  await set('color-detail', 100); await page.evaluate(() => window.__noiseCapture('nr-off-high-detail'));
  const disabledIdentity = await page.evaluate(() => window.__noiseDiff('nr-off-default', 'nr-off-high-detail'));
  assert.equal(disabledIdentity.max, 0, 'detail controls are exact identity when NR amount is zero');

  await set('col', 90); await set('color-detail', 50); await set('smooth', 50);
  await page.evaluate(() => window.__noiseCapture('center'));
  await set('color-detail', 0); const lowDetail = await page.evaluate(() => window.__noiseDiff('center', 'color-detail-0'));
  await set('color-detail', 100); const highDetail = await page.evaluate(() => window.__noiseDiff('center', 'color-detail-100'));
  await set('color-detail', 50); await set('smooth', 0); const lowSmooth = await page.evaluate(() => window.__noiseDiff('center', 'smooth-0'));
  await set('smooth', 100); const highSmooth = await page.evaluate(() => window.__noiseDiff('center', 'smooth-100'));
  for (const [name, d] of Object.entries({ lowDetail, highDetail, lowSmooth, highSmooth })) {
    assert.ok(d.changed > 0 && d.sum > 0, `${name} changes real renderer pixels`);
  }

  await set('color-detail', 78); await set('smooth', 63);
  await page.evaluate(() => window.__noiseCapture('both-78-63'));
  const snap = await page.evaluate(() => JSON.parse(JSON.stringify(getUISnapshot())));
  assert.equal(snap.sliders['nr-color-detail'], '78'); assert.equal(snap.sliders['nr-smooth'], '63');
  await set('color-detail', 50); await set('smooth', 50);
  await page.evaluate(s => applyUISnapshot(s), snap); await page.evaluate(() => renderPreview()); await page.waitForTimeout(100);
  await page.evaluate(() => window.__noiseCapture('restored'));
  const restore = await page.evaluate(() => window.__noiseDiff('both-78-63', 'restored'));
  assert.equal(restore.max, 0, 'snapshot restore reproduces Color Detail and Smoothness');
  await page.evaluate(() => resetNR());
  const reset = await page.evaluate(() => [document.getElementById('sl-nr-color-detail').value, document.getElementById('sl-nr-smooth').value]);
  assert.deepEqual(reset, ['50', '50'], 'Noise Reduction reset returns centered controls to neutral');
  await set('lum', 0); await set('col', 90); await set('color-detail', 78); await set('smooth', 63);

  await page.evaluate(() => { if (!fxLoupe) toggleLoupe(); renderLoupe(); window.__noiseCapture('loupe'); });

  const parity = await page.evaluate(async () => {
    const it = curItem(), src = geomCanvas(it), w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
    const p = getFXParams(), full = await processToCanvas(p, src, w, h);
    const old = window.fxExportTileSize; window.fxExportTileSize = () => 160;
    let tiled;
    try { tiled = await renderTiled(p, src, w, h); } finally { window.fxExportTileSize = old; }
    const a = full.getContext('2d').getImageData(0, 0, w, h).data, b = tiled.getContext('2d').getImageData(0, 0, w, h).data;
    let max = 0, changed = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); max = Math.max(max, d); if (d) changed++; }
    const l = window.__noiseSamples.loupe, sameSize = l.width === w && l.height === h;
    let loupeMax = -1;
    if (sameSize) for (let i = 0; i < a.length; i++) loupeMax = Math.max(loupeMax, Math.abs(a[i] - l.data[i]));
    return { max, changed, width: w, height: h, loupeWidth: l.width, loupeHeight: l.height, loupeMax };
  });
  assert.ok(parity.max <= 1, `tiled render matches full render within one level (max ${parity.max})`);
  assert.ok(parity.loupeMax >= 0 && parity.loupeMax <= 1, `1:1 loupe matches full render within one level (max ${parity.loupeMax})`);
  assert.deepEqual(errors, [], `no page errors: ${errors.join('; ')}`);
  assert.deepEqual(glErrors, [], `no GLSL errors: ${glErrors.join('; ')}`);
  console.log(JSON.stringify({ disabledIdentity, lowDetail, highDetail, lowSmooth, highSmooth, restore, parity }));
} finally { await browser.close(); }
