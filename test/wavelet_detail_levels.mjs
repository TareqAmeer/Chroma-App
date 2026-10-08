// CHR-261 behavioral regression: drive the live wavelet sliders on a real photo and compare
// pixels from Chromasmith's production preview/export renderer.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.wasm': 'application/wasm', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep)) throw new Error('outside test root');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const browser = await chromium.launch({ args: [process.platform === 'win32' ? '--use-gl=angle' : '--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });

try {
  const fixture = await readFile(path.join(root, 'test/fixtures/portrait.png'));
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof renderTiled === 'function');
  await page.evaluate(async b64 => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    await loadFXImages([new File([bytes], 'wavelet-real-photo.png', { type: 'image/png' })]);
  }, fixture.toString('base64'));
  await page.waitForFunction(() => fxImages.length === 1 && !!curItem()?.img?.naturalWidth, { timeout: 30000 });
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    window.__waveletSet = (values, enabled = true) => {
      document.getElementById('tg-adjust').classList.toggle('on', enabled);
      for (const [key, id] of Object.entries({ fine: 'sl-adj-wavelet-1', small: 'sl-adj-wavelet-2', medium: 'sl-adj-wavelet-3', residual: 'sl-adj-wavelet-res' })) {
        const input = document.getElementById(id);
        input.value = String(values[key] ?? 0);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      fxUpdate();
    };
    window.__waveletRender = async tiled => {
      window.__reseed && window.__reseed();
      const item = curItem(), src = geomCanvas(item), w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
      const params = getFXParams(item.adjustOverride || undefined);
      window.__waveletParams = params.adjust.wavelet;
      const saved = window.fxExportTileSize;
      if (tiled) window.fxExportTileSize = () => 128;
      let canvas;
      try { canvas = tiled ? await renderTiled(params, src, w, h) : await processToCanvas(params, src, w, h); }
      finally { window.fxExportTileSize = saved; }
      return { w: canvas.width, h: canvas.height, pixels: Array.from(canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data) };
    };
    window.__waveletView = async loupe => {
      fxLoupe = loupe; fxZoom = 1; loupeCX = 0.5; loupeCY = 0.5;
      renderPreview();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const { px, w, h } = FX.getPixels();
      return { w, h, pixels: Array.from(px), wavelet: getFXParams().adjust.wavelet };
    };
  });

  await page.evaluate(() => window.__waveletSet({}, false));
  const offPreview = await page.evaluate(() => window.__waveletView(false));
  const offLoupe = await page.evaluate(() => window.__waveletView(true));
  await page.evaluate(() => window.__waveletSet({}, true));
  const neutralPreview = await page.evaluate(() => window.__waveletView(false));
  const neutralLoupe = await page.evaluate(() => window.__waveletView(true));
  assert.deepEqual(neutralPreview.pixels, offPreview.pixels, 'zero-valued live preview is exact identity');
  assert.deepEqual(neutralLoupe.pixels, offLoupe.pixels, 'zero-valued 1:1 loupe is exact identity');
  const off = await page.evaluate(() => { window.__waveletSet({}, false); return window.__waveletRender(false); });
  const neutral = await page.evaluate(() => { window.__waveletSet({}, true); return window.__waveletRender(false); });
  assert.deepEqual(neutral.pixels, off.pixels, 'enabled Adjust with zero wavelet values is exact identity');

  const results = [];
  for (const [key, slider] of [['fine', 'adj-wavelet-1'], ['small', 'adj-wavelet-2'], ['medium', 'adj-wavelet-3'], ['residual', 'adj-wavelet-res']]) {
    const values = { [key]: 65 };
    await page.evaluate(values => window.__waveletSet(values), values);
    const preview = await page.evaluate(() => window.__waveletView(false));
    const loupe = await page.evaluate(() => window.__waveletView(true));
    const full = await page.evaluate(() => window.__waveletRender(false));
    const tiled = await page.evaluate(() => window.__waveletRender(true));
    assert.equal(full.w, off.w); assert.equal(full.h, off.h);
    let changedChannels = 0, maxDelta = 0, sumDelta = 0, maxTileDiff = 0, maxPreviewDiff = 0, maxLoupeDiff = 0;
    for (let i = 0; i < full.pixels.length; i++) {
      const delta = Math.abs(full.pixels[i] - off.pixels[i]);
      if (delta) changedChannels++;
      maxDelta = Math.max(maxDelta, delta); sumDelta += delta;
      maxTileDiff = Math.max(maxTileDiff, Math.abs(full.pixels[i] - tiled.pixels[i]));
      maxPreviewDiff = Math.max(maxPreviewDiff, Math.abs(full.pixels[i] - preview.pixels[i]));
      maxLoupeDiff = Math.max(maxLoupeDiff, Math.abs(full.pixels[i] - loupe.pixels[i]));
    }
    assert.equal(preview.w, full.w); assert.equal(preview.h, full.h);
    assert.equal(loupe.w, full.w); assert.equal(loupe.h, full.h);
    const wavelet = await page.evaluate(() => window.__waveletParams);
    assert.ok(changedChannels > 1000 && maxDelta >= 2 && sumDelta / full.pixels.length >= 0.05,
      `${key} slider must produce a measurable real-photo change; got ${JSON.stringify({ changedChannels, maxDelta, meanDelta: sumDelta / full.pixels.length })}`);
    assert.ok(maxTileDiff <= 1, `${key} full render and 128px tiled export must agree within 1 output level; got ${maxTileDiff}`);
    assert.ok(maxPreviewDiff <= 1, `${key} live preview and full render must agree within 1 level; got ${maxPreviewDiff}`);
    assert.ok(maxLoupeDiff <= 1, `${key} 1:1 loupe and full render must agree within 1 level; got ${maxLoupeDiff}`);
    assert.ok(wavelet[key === 'fine' ? 'fine' : key === 'small' ? 'small' : key === 'medium' ? 'medium' : 'residual'] > 0.6,
      `${slider} must reach the render params at the expected scale`);
    results.push({ key, changedChannels, maxDelta, meanDelta: Number((sumDelta / full.pixels.length).toFixed(3)), maxPreviewDiff, maxLoupeDiff, maxTileDiff });
  }
  assert.deepEqual(pageErrors, [], 'no browser runtime errors');
  console.log(`CHR-261 wavelet behavioral checks: exact zero identity; ${JSON.stringify(results)}; zero page errors.`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
