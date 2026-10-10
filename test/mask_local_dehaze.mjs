#!/usr/bin/env node
// Focused shader/UI regression for per-mask Dehaze using the editor's real GLSL and exporter.
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
const glslErrors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('console', msg => { if (msg.type() === 'error' && /GLSL compile error|LINK FAILED|SHADER_COMPILE|program.*link/i.test(msg.text())) glslErrors.push(msg.text()); });
  page.on('pageerror', err => glslErrors.push(`page error: ${err.message}`));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FX !== 'undefined', null, { timeout: 30000 });

  const result = await page.evaluate(async () => {
    const w = 1700, h = 500, source = document.createElement('canvas'); source.width = w; source.height = h;
    const ctx = source.getContext('2d'), pixels = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let rgb;
      if (x < w / 2) rgb = [0.10, 0.10, 0.10];                 // dark: outside the brightness gate
      else if (y < h / 2) rgb = [0.72, 0.72, 0.72];            // bright, desaturated haze
      else rgb = [0.28, 0.60, 0.95];                           // bright-ish saturated foreground
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) pixels.data[i + c] = Math.round(rgb[c] * 255);
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const blob = await new Promise(resolve => source.toBlob(resolve, 'image/png'));
    await loadFXImages([new File([blob], 'local-dehaze.png', { type: 'image/png' })]);
    await new Promise(resolve => { const start = Date.now(); const poll = () => fxImages.length ? resolve() : Date.now() - start > 30000 ? resolve() : setTimeout(poll, 20); poll(); });
    if (!fxImages.length) throw new Error('fixture image did not load');

    let m = { type: 'radial', cx: 0.5, cy: 0.5, rx: 0.43, ry: 0.48, feather: 0.5,
      id: 'dehaze-mask', amount: 100, dehaze: 0, ..._mskAdjustDefaults(), ..._mskSkinDefaults() };
    fxState.masks = [m]; fxImages[fxCurIdx].masks = fxState.masks; mskSel = 0; _mskTexDirty = true; mskRebuild();
    const localToggle = document.getElementById('tg-local');
    if (localToggle && !localToggle.classList.contains('on')) toggleFX('local');
    mskRebuild(); fxHistoryPush();
    const dehazeInput = document.querySelector('#local-ctl input[data-k="dehaze"]');
    if (!dehazeInput) throw new Error('local Dehaze range input was not rendered');
    dehazeInput.value = '43'; mskSlide(dehazeInput); clearTimeout(_fxHistPushTimer); _fxHistPushTimer = null; fxHistoryPush();
    await fxUndo();
    const undoDehaze = fxState.masks[0]?.dehaze ?? 0;
    fxState.masks[0].dehaze = 0.6;
    const savedState = getUISnapshot(); await applyUISnapshot(savedState);
    const snapshotDehaze = fxState.masks[0]?.dehaze;
    m = fxState.masks[0]; m.dehaze = 0;

    const img = curItem().img, iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const P = getFXParams();
    P.grain = { enabled: false }; P.halation = { enabled: false }; P.bloom = { enabled: false };
    P.adjust = { enabled: false }; P.lut = null; P.print = null; P.vignette = { enabled: false }; P.redEyeOps = [];
    Math.random = () => 0.375;
    const sample = (canvas, x, y) => canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data;
    const directRenderer = new FXR(document.createElement('canvas'));
    if (!directRenderer.ok) throw new Error('could not create a direct-render WebGL renderer');
    const render = async () => {
      directRenderer.setImage(img); directRenderer.render(P, iw, ih, { glowScale: 1, seed: 4.25 });
      const { px, w: rw, h: rh } = directRenderer.getPixels();
      const out = document.createElement('canvas'); out.width = rw; out.height = rh;
      out.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), rw, rh), 0, 0);
      return out;
    };
    const baseline = await render();
    delete m.dehaze; const omittedZero = await render(); m.dehaze = 0; const explicitZero = await render();
    m.dehaze = 1; const hazePositive = await render();
    m.dehaze = -1; const hazeNegative = await render();
    const points = { grayHaze: [Math.round(w * .62), Math.round(h * .25)], saturated: [Math.round(w * .62), Math.round(h * .75)],
      dark: [Math.round(w * .25), Math.round(h * .25)], uncoveredHaze: [Math.round(w * .97), Math.round(h * .25)] };
    const deltaAt = (canvas, key) => {
      const [x, y] = points[key], a = sample(baseline, x, y), b = sample(canvas, x, y);
      return [...b].map((v, i) => v - a[i]);
    };
    const positiveDelta = Object.fromEntries(Object.keys(points).map(k => [k, deltaAt(hazePositive, k)]));
    const negativeDelta = Object.fromEntries(Object.keys(points).map(k => [k, deltaAt(hazeNegative, k)]));
    const equalPixels = (a, b) => {
      const x = a.getContext('2d').getImageData(0, 0, iw, ih).data, y = b.getContext('2d').getImageData(0, 0, iw, ih).data;
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
      return true;
    };
    const missingZeroExact = equalPixels(omittedZero, explicitZero);

    const renderExport = async (renderer, tiled) => {
      let tiles = 0; const previous = shouldTile; shouldTile = () => tiled;
      try { const canvas = await processToCanvas(P, img, iw, ih, () => { tiles++; }, renderer); return { canvas, tiles }; }
      finally { shouldTile = previous; }
    };
    const compare = (a, b) => {
      const x = a.getContext('2d').getImageData(0, 0, iw, ih).data, y = b.getContext('2d').getImageData(0, 0, iw, ih).data;
      let maxDelta = 0, pixelsOver1 = 0, nonblank = 0, minX = iw, minY = ih, maxX = -1, maxY = -1;
      for (let i = 0; i < x.length; i += 4) {
        let d = 0; for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(x[i + c] - y[i + c]));
        maxDelta = Math.max(maxDelta, d);
        if (d > 1) { pixelsOver1++; const p = i / 4, px = p % iw, py = Math.floor(p / iw); minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); }
        if (x[i + 3] > 0 && (x[i] || x[i + 1] || x[i + 2])) nonblank++;
      }
      return { maxDelta, pixelsOver1, nonblank, bounds: pixelsOver1 ? [minX, minY, maxX, maxY] : null };
    };
    const parityRenderer = new FXR(document.createElement('canvas'));
    if (!parityRenderer.ok) throw new Error('could not create a production-wrapper parity renderer');
    m.dehaze = 0.72;
    const radialDirect = await renderExport(parityRenderer, false);
    const packedDirect = Array.from(parityRenderer._mskU.mK.slice(0, 4));
    const radialTiles = await renderExport(parityRenderer, true);
    const tilePositivePack = Array.from(parityRenderer._mskU.mK.slice(0, 4));
    const radialParity = compare(radialDirect.canvas, radialTiles.canvas), radialTileCount = radialTiles.tiles;

    m.type = 'brush'; m.origin = 'paint'; const dims = mskTexDims(iw, ih); m.mtW = dims.w; m.mtH = dims.h;
    m.px = new Uint8ClampedArray(m.mtW * m.mtH);
    for (let y = 0; y < m.mtH; y++) for (let x = 0; x < m.mtW; x++) m.px[y * m.mtW + x] = (x * 7 + y * 3) & 255;
    _mskTexDirty = true; mskRebuild();
    const brushDirect = await renderExport(parityRenderer, false), brushTiles = await renderExport(parityRenderer, true);
    const brushParity = compare(brushDirect.canvas, brushTiles.canvas), brushTileCount = brushTiles.tiles;
    m.type = 'radial'; delete m.origin; delete m.px; delete m.mtW; delete m.mtH; _mskTexDirty = true; mskRebuild();

    const amountState = async (amount, muted) => { m.dehaze = 1; m.amount = amount; m.muted = muted; const c = await render(); m.amount = 100; m.muted = false; m.dehaze = 0; return c; };
    const amountZero = await amountState(0, false), muted = await amountState(100, true);
    const neutralBytes = baseline.getContext('2d').getImageData(0, 0, iw, ih).data;
    const isExact = canvas => {
      const b = canvas.getContext('2d').getImageData(0, 0, iw, ih).data;
      if (neutralBytes.length !== b.length) return false;
      for (let i = 0; i < b.length; i++) if (neutralBytes[i] !== b[i]) return false;
      return true;
    };
    const uiDefaults = _mskAdjustDefaults();
    const cloned = _mskCloneLive({ ...m, dehaze: -0.47 });
    const restored = _mskFromSnap(_mskToSnap(cloned));
    m.dehaze = 0.36; mskSel = 0; mskDuplicate(false); const duplicateDehaze = fxState.masks[1]?.dehaze;
    fxImages.push({ masks: [] }); m.dehaze = -0.28; mskCopyToAll(); const copiedDehaze = fxImages[1].masks[0]?.dehaze;
    return { dims: [iw, ih], undoDehaze, snapshotDehaze, defaults: uiDefaults.dehaze ?? 0, persistedDehaze: restored.dehaze,
      duplicateDehaze, copiedDehaze, positiveDelta, negativeDelta, amountZeroExact: isExact(amountZero), mutedExact: isExact(muted),
      missingZeroExact,
      labels: [...document.querySelectorAll('#local-ctl .fx-row .fx-label')].map(e => e.textContent.trim()),
      radialParity, brushParity, radialTileCount, brushTileCount, packedDirect, tilePositivePack,
      grayHazeBaseline: [...sample(baseline, ...points.grayHaze)], saturatedBaseline: [...sample(baseline, ...points.saturated)] };
  });

  if (glslErrors.length) throw new Error(glslErrors.join('\n'));
  const checks = [
    ['positive Dehaze lowers a bright desaturated haze region', result.positiveDelta.grayHaze[0] < -4],
    ['negative Dehaze raises a bright desaturated haze region', result.negativeDelta.grayHaze[0] > 4],
    ['saturated foreground with zero haze gate is unchanged in both directions', result.positiveDelta.saturated.every(v => v === 0) && result.negativeDelta.saturated.every(v => v === 0)],
    ['dark tones outside the brightness gate remain unchanged', result.positiveDelta.dark.every(v => v === 0) && result.negativeDelta.dark.every(v => v === 0)],
    ['uncovered bright haze remains unchanged', result.positiveDelta.uncoveredHaze.every(v => v === 0) && result.negativeDelta.uncoveredHaze.every(v => v === 0)],
    ['Amount zero and mute independently preserve the baseline exactly', result.amountZeroExact && result.mutedExact],
    ['omitted legacy Dehaze and explicit zero are byte-identical', result.missingZeroExact],
    ['dehaze defaults, undo, snapshot, duplicate and cross-photo copy preserve the scalar', result.defaults === 0 && result.undoDehaze === 0 && result.snapshotDehaze === 0.6 && result.persistedDehaze === -0.47 && result.duplicateDehaze === 0.36 && result.copiedDehaze === -0.28],
    ['local Dehaze control is visible in the Adjust panel', result.labels.includes('Dehaze')],
    ['radial and brush production-wrapper exports use two tiles and full-buffer parity within one channel value', result.radialTileCount === 2 && result.brushTileCount === 2 && [result.radialParity, result.brushParity].every(p => p.maxDelta <= 1 && p.pixelsOver1 === 0 && p.nonblank > 0)],
    ['direct and tiled renderer pack the signed normalized dehaze field identically', result.packedDirect[3] === result.tilePositivePack[3] && Math.abs(result.packedDirect[3] - 0.72) < 1e-6]
  ];
  for (const [label, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`);
  console.log(JSON.stringify(result, null, 2));
  if (checks.some(([, pass]) => !pass)) process.exitCode = 1;
} finally {
  await browser.close(); server.close();
}
