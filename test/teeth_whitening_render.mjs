#!/usr/bin/env node
// Pixel-level contract for the guided manual teeth-whitening defaults and tiled export.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.join(ROOT, pathname === '/' ? 'chromasmith-22.html' : pathname.slice(1));
    const body = await readFile(file);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});

const livePreviewMode = process.env.TEETH_LIVE_PREVIEW === '1' || process.argv.includes('--live-preview');
const browser = await chromium.launch({
  // Use the installed browser's normal GPU path for the optional live-preview gate. The
  // default software renderer is retained for deterministic headless shader/export checks.
  headless: !livePreviewMode,
  executablePath: process.env.CHROME_PATH || (process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined),
  args: livePreviewMode ? [] : ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('console', message => { if (message.type() === 'error' && /GLSL compile error|LINK FAILED|SHADER_COMPILE|CONTEXT_LOST_WEBGL/i.test(message.text())) errors.push(message.text()); });
  page.on('pageerror', error => errors.push(`page error: ${error.message}`));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FXR === 'function', null, { timeout: 30000 });

  const result = await page.evaluate(async () => {
    const width = 1700, height = 640, source = document.createElement('canvas');
    source.width = width; source.height = height;
    const context = source.getContext('2d'), image = context.createImageData(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const enamel = x >= width * 0.15 && x < width * 0.85 && y >= height * 0.2 && y < height * 0.8;
      const checker = ((Math.floor(x / 8) + Math.floor(y / 8)) & 1) ? 9 : -9;
      const i = (y * width + x) * 4;
      image.data[i] = enamel ? 222 + checker : 72;
      image.data[i + 1] = enamel ? 188 + checker : 70;
      image.data[i + 2] = enamel ? 132 + checker : 68;
      image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    const blob = await new Promise(resolve => source.toBlob(resolve, 'image/png'));
    await loadFXImages([new File([blob], 'warm-enamel-detail.png', { type: 'image/png' })]);
    if (!fxImages.length) throw new Error('synthetic enamel fixture did not load');
    await updateWork();

    const dims = mskTexDims(width, height), mask = {
      type: 'brush', origin: 'manual-teeth', name: 'Teeth Whitening (manual)',
      amount: 100, ..._mskAdjustDefaults(), ..._mskSkinDefaults(), temp: -0.12, sat: -0.12,
      id: 'teeth-render-mask', mtW: dims.w, mtH: dims.h, px: new Uint8ClampedArray(dims.w * dims.h),
    };
    for (let y = Math.floor(dims.h * 0.2); y < Math.ceil(dims.h * 0.8); y++) {
      mask.px.fill(255, y * dims.w + Math.floor(dims.w * 0.15), y * dims.w + Math.ceil(dims.w * 0.85));
    }
    fxState.masks = [mask]; fxImages[fxCurIdx].masks = fxState.masks; mskSel = 0; _mskTexDirty = true; mskRebuild();
    const localToggle = document.getElementById('tg-local');
    if (localToggle && !localToggle.classList.contains('on')) toggleFX('local');

    const img = curItem().img, iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const baseGetFXParams = window.getFXParams;
    const recipe = () => {
      const p = baseGetFXParams();
      p.grain = { enabled: false }; p.halation = { enabled: false }; p.bloom = { enabled: false };
      p.adjust = { enabled: false }; p.lut = null; p.print = null; p.vignette = { enabled: false }; p.redEyeOps = [];
      return p;
    };
    const previewParams = getFXParams;
    window.getFXParams = recipe;
    let preview, previewBytes, previewRange = 0, previewAttempts = 0, appContextLostBeforeProbe = false;
    try {
      appContextLostBeforeProbe = FX.gl?.isContextLost() || false;
      preview = FX.cv;
      const readPixels = canvas => {
        const copy = document.createElement('canvas');
        copy.width = canvas.width; copy.height = canvas.height;
        const context = copy.getContext('2d', { willReadFrequently: true });
        context.drawImage(canvas, 0, 0);
        return context.getImageData(0, 0, copy.width, copy.height).data;
      };
      if (!appContextLostBeforeProbe) {
        for (; previewAttempts < 8 && previewRange === 0; previewAttempts++) {
          renderPreview();
          // FX.cv must be copied in the same task as FX.render; once the browser composites the
          // WebGL frame, headless Chrome may expose a cleared buffer even with preserved draws.
          previewBytes = readPixels(preview);
          let min = 255, max = 0;
          for (let i = 0; i < previewBytes.length; i += 4) {
            for (let channel = 0; channel < 3; channel++) {
              min = Math.min(min, previewBytes[i + channel]);
              max = Math.max(max, previewBytes[i + channel]);
            }
          }
          previewRange = max - min;
        }
      }
    } finally { window.getFXParams = previewParams; }

    const renderer = new FXR(document.createElement('canvas'));
    if (!renderer.ok) throw new Error('could not create the direct-render WebGL renderer');
    const render = async () => {
      renderer.setImage(img); renderer.render(recipe(), iw, ih, { glowScale: 1, seed: 4.25 });
      const { px, w, h } = renderer.getPixels(), canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), w, h), 0, 0);
      return canvas;
    };
    renderer.setImage(img);
    renderer.render(recipe(), preview.width, preview.height, mskPreviewRenderOptions({ glowScale: fxPreviewGlowScale(), gamutWarn: fxClipCode() }));
    const expected = renderer.getPixels().px;
    let maxDelta = Infinity;
    if (previewRange > 0) {
      maxDelta = 0;
      for (let i = 0; i < previewBytes.length; i += 4) {
        for (let channel = 0; channel < 3; channel++) {
          maxDelta = Math.max(maxDelta, Math.abs(previewBytes[i + channel] - expected[i + channel]));
        }
      }
    }
    const previewParity = { maxDelta, range: previewRange, attempts: previewAttempts, width: preview.width, height: preview.height, appContextLostBeforeProbe };
    const bytes = canvas => canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, iw, ih).data;
    const sample = (data, x, y) => [...data.slice((y * iw + x) * 4, (y * iw + x) * 4 + 3)];
    mask.temp = 0; mask.sat = 0; mskRebuild();
    const baseline = await render();
    const baselineBytes = bytes(baseline);

    // Exercise the actual mask sliders as well as direct edit state: the defaults must change
    // only the painted pixels, and returning both controls to zero must restore the baseline.
    for (const key of ['temp', 'sat']) {
      const input = document.querySelector(`#local-ctl input[data-k="${key}"]`);
      if (!input) throw new Error(`local ${key} slider is missing`);
      input.value = '-12'; mskSlide(input);
    }
    const corrected = await render(), correctedBytes = bytes(corrected);
    for (const key of ['temp', 'sat']) {
      const input = document.querySelector(`#local-ctl input[data-k="${key}"]`);
      input.value = '0'; mskSlide(input);
    }
    const reset = await render(), resetBytes = bytes(reset);
    for (const key of ['temp', 'sat']) {
      const input = document.querySelector(`#local-ctl input[data-k="${key}"]`);
      input.value = '-12'; mskSlide(input);
    }
    const inside = [Math.round(iw * 0.48), Math.round(ih * 0.48)];
    const outside = [Math.round(iw * 0.06), Math.round(ih * 0.08)];
    const rgbChange = (a, b, point) => {
      const av = sample(a, ...point), bv = sample(b, ...point);
      return { before: av, after: bv, delta: bv.map((v, i) => v - av[i]) };
    };
    let detailBefore = 0, detailAfter = 0, detailPairs = 0;
    for (let y = Math.round(ih * 0.40); y < Math.round(ih * 0.60); y += 8) {
      for (let x = Math.round(iw * 0.40); x < Math.round(iw * 0.60) - 8; x += 8) {
        const a = (y * iw + x) * 4, b = (y * iw + x + 8) * 4;
        detailBefore += Math.abs(baselineBytes[a] - baselineBytes[b]);
        detailAfter += Math.abs(correctedBytes[a] - correctedBytes[b]);
        detailPairs++;
      }
    }
    const snapshot = JSON.parse(JSON.stringify(getUISnapshot()));
    await applyUISnapshot(snapshot); mskRebuild();
    const restored = await render(), restoredBytes = bytes(restored);

    const direct = await processToCanvas(recipe(), img, iw, ih, () => {}, renderer);
    let tiles = 0; const oldShouldTile = shouldTile; shouldTile = () => true;
    let tiled;
    try { tiled = await processToCanvas(recipe(), img, iw, ih, () => { tiles++; }, renderer); }
    finally { shouldTile = oldShouldTile; }
    const directBytes = bytes(direct), tiledBytes = bytes(tiled);
    let tileMaxDelta = 0;
    for (let i = 0; i < directBytes.length; i++) tileMaxDelta = Math.max(tileMaxDelta, Math.abs(directBytes[i] - tiledBytes[i]));
    const exact = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

    // Exercise the real embedded-matte importer with a deterministic low-resolution PNG.
    // Its left half selects enamel; the right half must remain untouched after resampling.
    const matteWidth = 48, matteHeight = 18, matteCanvas = document.createElement('canvas');
    matteCanvas.width = matteWidth; matteCanvas.height = matteHeight;
    const matteContext = matteCanvas.getContext('2d'), matteImage = matteContext.createImageData(matteWidth, matteHeight);
    for (let y = 0; y < matteHeight; y++) for (let x = 0; x < matteWidth; x++) {
      const i = (y * matteWidth + x) * 4, value = x < matteWidth / 2 ? 255 : 0;
      matteImage.data[i] = matteImage.data[i + 1] = matteImage.data[i + 2] = value;
      matteImage.data[i + 3] = 255;
    }
    matteContext.putImageData(matteImage, 0, 0);
    const embeddedPath = 'fixture/warm-enamel-detail.heic';
    fxImages[fxCurIdx].path = embeddedPath;
    window.__TAURI__ = { ...(window.__TAURI__ || {}), core: { invoke: async (command, args) => {
      if (command !== 'extract_embedded_auxiliary' || args?.path !== embeddedPath) throw new Error('unexpected auxiliary request');
      return [{ kind: 'teeth', width: matteWidth, height: matteHeight,
        png_b64: matteCanvas.toDataURL('image/png').split(',')[1] }];
    } } };
    const embeddedImported = await mskAddEmbeddedTeethWhitening();
    const embeddedMask = fxState.masks[mskSel];
    const embeddedOrigin = embeddedMask?.origin === 'embedded-teeth' && embeddedMask?.sourceKind === 'teeth'
      && embeddedMask?.sourcePath === embeddedPath;
    const embeddedLeft = embeddedMask?.px?.[Math.floor(embeddedMask.mtH / 2) * embeddedMask.mtW + Math.floor(embeddedMask.mtW * 0.25)] || 0;
    const embeddedRight = embeddedMask?.px?.[Math.floor(embeddedMask.mtH / 2) * embeddedMask.mtW + Math.floor(embeddedMask.mtW * 0.75)] || 0;
    const embeddedSelection = embeddedImported && embeddedLeft > 240 && embeddedRight === 0;
    embeddedMask.temp = 0; embeddedMask.sat = 0; mskRebuild();
    const embeddedBaseline = await render(), embeddedBaselineBytes = bytes(embeddedBaseline);
    embeddedMask.temp = -0.12; embeddedMask.sat = -0.12; mskRebuild();
    const embeddedCorrected = await render(), embeddedCorrectedBytes = bytes(embeddedCorrected);
    const embeddedInside = rgbChange(embeddedBaselineBytes, embeddedCorrectedBytes, [Math.round(iw * 0.25), Math.round(ih * 0.5)]);
    const embeddedOutside = rgbChange(embeddedBaselineBytes, embeddedCorrectedBytes, [Math.round(iw * 0.75), Math.round(ih * 0.5)]);
    const embeddedSnapshot = JSON.parse(JSON.stringify(getUISnapshot()));
    await applyUISnapshot(embeddedSnapshot); mskRebuild();
    const embeddedRestored = await render(), embeddedRestoredBytes = bytes(embeddedRestored);
    const embeddedDirect = await processToCanvas(recipe(), img, iw, ih, () => {}, renderer);
    let embeddedTiles = 0, embeddedTiled;
    shouldTile = () => true;
    try { embeddedTiled = await processToCanvas(recipe(), img, iw, ih, () => { embeddedTiles++; }, renderer); }
    finally { shouldTile = oldShouldTile; }
    const embeddedDirectBytes = bytes(embeddedDirect), embeddedTiledBytes = bytes(embeddedTiled);
    let embeddedTileMaxDelta = 0;
    for (let i = 0; i < embeddedDirectBytes.length; i++) {
      embeddedTileMaxDelta = Math.max(embeddedTileMaxDelta, Math.abs(embeddedDirectBytes[i] - embeddedTiledBytes[i]));
    }
    const deltaInside = rgbChange(baselineBytes, correctedBytes, inside);
    const deltaOutside = rgbChange(baselineBytes, correctedBytes, outside);
    return {
      inside: deltaInside, outside: deltaOutside,
      resetExact: exact(baselineBytes, resetBytes), snapshotExact: exact(correctedBytes, restoredBytes),
      detailRatio: detailBefore ? detailAfter / detailBefore : 0,
      tiles, tileMaxDelta,
      embeddedMatte: {
        imported: embeddedImported, origin: embeddedOrigin, selection: embeddedSelection,
        leftCoverage: embeddedLeft, rightCoverage: embeddedRight,
        inside: embeddedInside, outside: embeddedOutside,
        snapshotExact: exact(embeddedCorrectedBytes, embeddedRestoredBytes),
        tiles: embeddedTiles, tileMaxDelta: embeddedTileMaxDelta,
      },
      previewParity,
      defaults: [fxState.masks[0].temp, fxState.masks[0].sat],
      dims: [iw, ih], detailPairs,
    };
  });

  if (errors.length) throw new Error(errors.join('\n'));
  const checks = [
    ['the default cooling/desaturation changes the painted enamel pixels', result.inside.delta.some(value => value !== 0)],
    ['pixels outside the Brush selection remain exactly unchanged', result.outside.delta.every(value => value === 0)],
    ['zeroing the editable Temp and Saturation controls restores the exact baseline', result.resetExact],
    ['the correction retains at least 70% of the synthetic fine-detail contrast', result.detailRatio >= 0.70 && result.detailPairs > 0],
    ['save/reopen snapshot restores the identical rendered correction', result.snapshotExact],
    ['forced tiled export matches direct output within one channel value', result.tiles > 1 && result.tileMaxDelta <= 1],
    ['embedded teeth matte imports as the expected editable selection', result.embeddedMatte.imported && result.embeddedMatte.origin && result.embeddedMatte.selection],
    ['embedded teeth correction changes selected pixels and preserves unselected pixels', result.embeddedMatte.inside.delta.some(value => value !== 0) && result.embeddedMatte.outside.delta.every(value => value === 0)],
    ['snapshot restores identical embedded-matte rendering', result.embeddedMatte.snapshotExact],
    ['forced tiled export matches direct embedded-matte output within one channel value', result.embeddedMatte.tiles > 1 && result.embeddedMatte.tileMaxDelta <= 1],
    ['the live app preview matches a direct production renderer frame and is not blank', result.previewParity.appContextLostBeforeProbe ? null : result.previewParity.maxDelta <= 1 && result.previewParity.range > 0],
  ];
  for (const [label, pass] of checks) console.log(`${pass === null ? 'SKIP' : pass ? 'PASS' : 'FAIL'} ${label}${pass === null ? ' (main WebGL context was already lost)' : ''}`);
  console.log(JSON.stringify(result, null, 2));
  if (checks.some(([, pass]) => pass === false)) process.exitCode = 1;
} finally {
  await browser.close(); server.close();
}
