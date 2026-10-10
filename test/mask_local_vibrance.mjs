#!/usr/bin/env node
// Focused shader/UI regression for per-mask Vibrance using the editor's real GLSL/exporter.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.wasm': 'application/wasm' };
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

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
const shaderErrors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('console', msg => { if (msg.type() === 'error' && /GLSL compile error|LINK FAILED|SHADER_COMPILE|program.*link/i.test(msg.text())) shaderErrors.push(msg.text()); });
  page.on('pageerror', err => shaderErrors.push(`page error: ${err.message}`));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FX !== 'undefined', null, { timeout: 30000 });

  const result = await page.evaluate(async () => {
    const w = 1700, h = 500, source = document.createElement('canvas'); source.width = w; source.height = h;
    const ctx = source.getContext('2d'), pixels = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const rgb = y >= 2 * h / 3 ? [0.48, 0.48, 0.48] : x < w / 2 ? [0.58, 0.50, 0.46] : [0.58, 0.38, 0.33];
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) pixels.data[i + c] = Math.round(rgb[c] * 255);
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const blob = await new Promise(resolve => source.toBlob(resolve, 'image/png'));
    await loadFXImages([new File([blob], 'local-vibrance.png', { type: 'image/png' })]);
    await new Promise(resolve => { const start = Date.now(); const poll = () => fxImages.length ? resolve() : Date.now() - start > 30000 ? resolve() : setTimeout(poll, 20); poll(); });
    if (!fxImages.length) throw new Error('fixture image did not load');

    let m = { type: 'radial', cx: 0.5, cy: 0.5, rx: 0.42, ry: 0.48, feather: 0.5,
      id: 'vibrance-mask', amount: 100, vibrance: 0, ..._mskAdjustDefaults(), ..._mskSkinDefaults() };
    fxState.masks = [m]; fxImages[fxCurIdx].masks = fxState.masks; mskSel = 0; _mskTexDirty = true; mskRebuild();
    const localToggle = document.getElementById('tg-local');
    if (localToggle && !localToggle.classList.contains('on')) toggleFX('local');
    mskRebuild(); fxHistoryPush();
    const input = document.querySelector('#local-ctl input[data-k="vibrance"]');
    if (!input) throw new Error('local Vibrance range input was not rendered');
    input.value = '44'; mskSlide(input); clearTimeout(_fxHistPushTimer); _fxHistPushTimer = null; fxHistoryPush();
    await fxUndo();
    const undoVibrance = fxState.masks[0]?.vibrance ?? 0;
    fxState.masks[0].vibrance = 0.63;
    const savedState = getUISnapshot(); await applyUISnapshot(savedState);
    const snapshotVibrance = fxState.masks[0]?.vibrance;
    m = fxState.masks[0]; m.vibrance = 0;

    const img = curItem().img, iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const P = getFXParams();
    P.grain = { enabled: false }; P.halation = { enabled: false }; P.bloom = { enabled: false };
    P.adjust = { enabled: false }; P.lut = null; P.print = null; P.vignette = { enabled: false }; P.redEyeOps = [];
    Math.random = () => 0.375;
    const sample = (canvas, x, y) => [...canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data];
    const makeRenderer = () => { const renderer = new FXR(document.createElement('canvas')); if (!renderer.ok) throw new Error('could not create a direct-render WebGL renderer'); return renderer; };
    const directRenderer = makeRenderer();
    const render = async () => {
      directRenderer.setImage(img); directRenderer.render(P, iw, ih, { glowScale: 1, seed: 4.25 });
      const { px, w: rw, h: rh } = directRenderer.getPixels();
      const out = document.createElement('canvas'); out.width = rw; out.height = rh;
      out.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), rw, rh), 0, 0);
      return { canvas: out, packed: Array.from(directRenderer._mskU.mDep.slice(0, 4)), amountPack: Array.from(directRenderer._mskU.mE.slice(0, 4)) };
    };
    const baselineRender = await render(), baseline = baselineRender.canvas;
    delete m.vibrance; const omittedZero = (await render()).canvas; m.vibrance = 0; const explicitZero = (await render()).canvas;
    m.vibrance = 1; const positiveRender = await render(), positive = positiveRender.canvas;
    m.vibrance = -1; const negativeRender = await render(), negative = negativeRender.canvas;
    const points = { muted: [Math.round(iw * 0.42), Math.round(ih * 0.5)], saturated: [Math.round(iw * 0.58), Math.round(ih * 0.5)],
      gray: [Math.round(iw * 0.5), Math.round(ih * 0.84)], outside: [Math.round(iw * 0.03), Math.round(ih * 0.5)] };
    const sat = rgb => { const mx = Math.max(...rgb.slice(0, 3)), mn = Math.min(...rgb.slice(0, 3)); return mx > 0 ? (mx - mn) / mx : 0; };
    const delta = (out, key) => sat(sample(out, ...points[key])) - sat(sample(baseline, ...points[key]));
    const relativeDelta = (out, key) => delta(out, key) / sat(sample(baseline, ...points[key]));
    const equalPixels = (a, b) => {
      const x = a.getContext('2d').getImageData(0, 0, iw, ih).data, y = b.getContext('2d').getImageData(0, 0, iw, ih).data;
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
      return true;
    };
    const missingZeroExact = equalPixels(omittedZero, explicitZero);
    m.vibrance = 0;
    const selRenderer = makeRenderer(); selRenderer.setImage(img);
    selRenderer.render(P, iw, ih, { previewOnly: MSK_PREVIEW_RENDER_TOKEN, showSel: 0, showSelMode: 2, glowScale: 1, seed: 4.25 });
    const selPixels = selRenderer.getPixels().px;
    const selectionAt = (x, y) => selPixels[(y * iw + x) * 4];
    const selectionMuted = selectionAt(...points.muted), selectionSaturated = selectionAt(...points.saturated), selectionOutside = selectionAt(...points.outside);
    const zeroBefore = baseline.getContext('2d').getImageData(0, 0, iw, ih).data;
    const exactNeutral = canvas => {
      const b = canvas.getContext('2d').getImageData(0, 0, iw, ih).data;
      if (zeroBefore.length !== b.length) return false;
      for (let i = 0; i < b.length; i++) if (zeroBefore[i] !== b[i]) return false;
      return true;
    };
    const amountState = async (amount, muted) => { m.vibrance = 1; m.amount = amount; m.muted = muted; const c = await render(); m.amount = 100; m.muted = false; m.vibrance = 0; return c; };
    const amountZero = (await amountState(0, false)).canvas, muted = (await amountState(100, true)).canvas;

    const renderExport = async (renderer, tiled) => {
      let tiles = 0; const previous = shouldTile; shouldTile = () => tiled;
      try { const canvas = await processToCanvas(P, img, iw, ih, () => { tiles++; }, renderer); return { canvas, tiles }; }
      finally { shouldTile = previous; }
    };
    const compare = (a, b) => {
      const x = a.getContext('2d').getImageData(0, 0, iw, ih).data, y = b.getContext('2d').getImageData(0, 0, iw, ih).data;
      let maxDelta = 0, pixelsOver1 = 0, nonblank = 0;
      for (let i = 0; i < x.length; i += 4) {
        let d = 0; for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(x[i + c] - y[i + c]));
        maxDelta = Math.max(maxDelta, d); if (d > 1) pixelsOver1++;
        if (x[i + 3] > 0 && (x[i] || x[i + 1] || x[i + 2])) nonblank++;
      }
      return { maxDelta, pixelsOver1, nonblank };
    };
    const parityRenderer = new FXR(document.createElement('canvas'));
    if (!parityRenderer.ok) throw new Error('could not create a production-wrapper parity renderer');
    m.vibrance = 0.68; m.amount = 82; m.muted = false;
    const radialDirect = await renderExport(parityRenderer, false), radialPack = Array.from(parityRenderer._mskU.mDep.slice(0, 4));
    const radialTiles = await renderExport(parityRenderer, true), radialTilePack = Array.from(parityRenderer._mskU.mDep.slice(0, 4));
    const radialParity = compare(radialDirect.canvas, radialTiles.canvas);
    m.type = 'brush'; m.origin = 'paint'; const dims = mskTexDims(iw, ih); m.mtW = dims.w; m.mtH = dims.h;
    m.px = new Uint8ClampedArray(m.mtW * m.mtH);
    for (let y = 0; y < m.mtH; y++) for (let x = 0; x < m.mtW; x++) m.px[y * m.mtW + x] = (x * 7 + y * 3) & 255;
    _mskTexDirty = true; mskRebuild();
    const brushDirect = await renderExport(parityRenderer, false), brushTiles = await renderExport(parityRenderer, true);
    const brushParity = compare(brushDirect.canvas, brushTiles.canvas);
    const packDirect = radialPack[3], packTile = radialTilePack[3];
    m.type = 'radial'; delete m.origin; delete m.px; delete m.mtW; delete m.mtH; _mskTexDirty = true; mskRebuild();

    const defaults = _mskAdjustDefaults();
    const cloned = _mskCloneLive({ ...m, vibrance: -0.47 });
    const restored = _mskFromSnap(_mskToSnap(cloned));
    m.vibrance = 0.36; mskSel = 0; mskDuplicate(false); const duplicateVibrance = fxState.masks[1]?.vibrance;
    fxImages.push({ masks: [] }); m.vibrance = -0.28; mskCopyToAll(); const copiedVibrance = fxImages[1].masks[0]?.vibrance;
    return { dims: [iw, ih], undoVibrance, snapshotVibrance, defaultVibrance: defaults.vibrance ?? 0, persistedVibrance: restored.vibrance,
      duplicateVibrance, copiedVibrance, deltaPositiveMuted: delta(positive, 'muted'), deltaNegativeMuted: delta(negative, 'muted'),
      deltaPositiveSaturated: delta(positive, 'saturated'), deltaNegativeSaturated: delta(negative, 'saturated'),
      relativePositiveMuted: relativeDelta(positive, 'muted'), relativeNegativeMuted: relativeDelta(negative, 'muted'),
      relativePositiveSaturated: relativeDelta(positive, 'saturated'), relativeNegativeSaturated: relativeDelta(negative, 'saturated'),
      deltaPositiveGray: delta(positive, 'gray'), deltaNegativeGray: delta(negative, 'gray'),
      pixelPositiveMuted: sample(positive, ...points.muted), pixelNegativeMuted: sample(negative, ...points.muted),
      pixelBaselineMuted: sample(baseline, ...points.muted), pixelPositiveSaturated: sample(positive, ...points.saturated),
      selectionMuted, selectionSaturated, selectionOutside,
      actualPackedPositive: positiveRender.packed, actualPackedAmount: positiveRender.amountPack,
      actualPackedNegative: negativeRender.packed, actualPackedZero: baselineRender.packed,
      positiveOutsideExact: sample(positive, ...points.outside).every((v, i) => v === sample(baseline, ...points.outside)[i]),
      negativeOutsideExact: sample(negative, ...points.outside).every((v, i) => v === sample(baseline, ...points.outside)[i]),
      amountZeroExact: exactNeutral(amountZero), mutedExact: exactNeutral(muted), missingZeroExact,
      labels: [...document.querySelectorAll('#local-ctl .fx-row .fx-label')].map(e => e.textContent.trim()),
      radialParity, brushParity, radialTileCount: radialTiles.tiles, brushTileCount: brushTiles.tiles, packDirect, packTile,
      grayBaseline: sample(baseline, ...points.gray), mutedBaseline: sample(baseline, ...points.muted), saturatedBaseline: sample(baseline, ...points.saturated) };
  });

  if (shaderErrors.length) throw new Error(shaderErrors.join('\n'));
  const checks = [
    ['positive Vibrance gives a larger relative saturation increase to muted colors', result.relativePositiveMuted > 0 && result.relativePositiveMuted > result.relativePositiveSaturated],
    ['negative Vibrance gives a larger relative saturation reduction to muted colors', result.relativeNegativeMuted < 0 && Math.abs(result.relativeNegativeMuted) > Math.abs(result.relativeNegativeSaturated)],
    ['neutral gray remains unchanged in both directions', result.deltaPositiveGray === 0 && result.deltaNegativeGray === 0],
    ['matched effective mask weights are visible at both color samples, zero outside; uncovered pixels remain exact', result.selectionMuted > 0 && result.selectionMuted === result.selectionSaturated && result.selectionOutside === 0 && result.positiveOutsideExact && result.negativeOutsideExact],
    ['Amount zero and mute independently preserve the baseline exactly', result.amountZeroExact && result.mutedExact],
    ['omitted legacy Vibrance and explicit zero are byte-identical', result.missingZeroExact],
    ['Vibrance defaults, undo, snapshot, duplicate and cross-photo copy preserve the scalar', result.defaultVibrance === 0 && result.undoVibrance === 0 && result.snapshotVibrance === 0.63 && result.persistedVibrance === -0.47 && result.duplicateVibrance === 0.36 && result.copiedVibrance === -0.28],
    ['local Vibrance control is visible in the Adjust panel', result.labels.includes('Vibrance')],
    ['radial and brush production-wrapper exports use two tiles and full-buffer parity within one channel value', result.radialTileCount === 2 && result.brushTileCount === 2 && [result.radialParity, result.brushParity].every(p => p.maxDelta <= 1 && p.pixelsOver1 === 0 && p.nonblank > 0)],
    ['signed normalized Vibrance reaches the GPU at full ±1 scale and direct/tiled paths pack it identically', Math.abs(result.packDirect - 0.68) < 1e-6 && result.packDirect === result.packTile && result.actualPackedPositive[3] === 1 && result.actualPackedNegative[3] === -1 && result.actualPackedAmount[3] === 1 && result.actualPackedZero[3] === 0]
  ];
  for (const [label, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`);
  console.log(JSON.stringify(result, null, 2));
  if (checks.some(([, pass]) => !pass)) process.exitCode = 1;
} finally {
  await browser.close(); server.close();
}
