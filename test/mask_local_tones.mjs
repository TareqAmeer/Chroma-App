#!/usr/bin/env node
// Focused GPU check for per-mask Whites/Blacks. Uses the real editor shader and tiled exporter.
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
    const w = 1700, h = 500, source = document.createElement('canvas');
    source.width = w; source.height = h;
    const ctx = source.getContext('2d');
    const pixels = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dark = (y < h / 2) === (x < w / 2), v = dark ? 0.1 : 0.92, i = (y * w + x) * 4;
      const s = Math.round(v * 255); pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = s; pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const blob = await new Promise(resolve => source.toBlob(resolve, 'image/png'));
    await loadFXImages([new File([blob], 'local-tones.png', { type: 'image/png' })]);
    await new Promise(resolve => { const start = Date.now(); const poll = () => fxImages.length ? resolve() : Date.now() - start > 30000 ? resolve() : setTimeout(poll, 20); poll(); });
    if (!fxImages.length) throw new Error('fixture image did not load');

    let m = { type: 'radial', cx: 0.5, cy: 0.5, rx: 0.43, ry: 0.48, feather: 0.5,
      id: 'tone-mask', amount: 100, wh: 0, bl: 0,
      ..._mskAdjustDefaults(), ..._mskSkinDefaults() };
    fxState.masks = [m]; fxImages[fxCurIdx].masks = fxState.masks; mskSel = 0; _mskTexDirty = true; mskRebuild();
    const localToggle = document.getElementById('tg-local');
    if (localToggle && !localToggle.classList.contains('on')) toggleFX('local');
    mskRebuild(); fxHistoryPush();
    const whInput = document.querySelector('#local-ctl input[data-k="wh"]');
    if (!whInput) throw new Error('Whites range input was not rendered');
    whInput.value = '48'; mskSlide(whInput); clearTimeout(_fxHistPushTimer); _fxHistPushTimer = null; fxHistoryPush();
    await fxUndo();
    const undoWh = fxState.masks[0]?.wh ?? 0;
    fxState.masks[0].wh = 0.6; fxState.masks[0].bl = -0.4;
    const savedState = getUISnapshot(); await applyUISnapshot(savedState);
    const snapshotValues = [fxState.masks[0]?.wh, fxState.masks[0]?.bl];
    m = fxState.masks[0]; m.wh = 0; m.bl = 0;
    const img = curItem().img, iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const sample = (canvas, x, y) => { const q = canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data; return q[0]; };
    const P = getFXParams();
    P.grain = { enabled: false }; P.halation = { enabled: false }; P.bloom = { enabled: false };
    P.adjust = { enabled: false }; P.lut = null; P.print = null; P.vignette = { enabled: false }; P.redEyeOps = [];
    Math.random = () => 0.375;
    const directRenderer = new FXR(document.createElement('canvas'));
    if (!directRenderer.ok) throw new Error('could not create a direct-render WebGL renderer');
    const render = async () => {
      directRenderer.setImage(img); directRenderer.render(P, iw, ih, { glowScale: 1, seed: 4.25 });
      const { px, w: rw, h: rh } = directRenderer.getPixels();
      const out = document.createElement('canvas'); out.width = rw; out.height = rh;
      out.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), rw, rh), 0, 0);
      return out;
    };
    const base = await render();
    m.hi = 0.37; m.sh = -0.29; delete m.wh; delete m.bl; const hiShLegacy = await render();
    m.wh = 0; m.bl = 0; const hiShZero = await render(); m.hi = 0; m.sh = 0;
    const legacyBytes = hiShLegacy.getContext('2d').getImageData(0, 0, iw, ih).data;
    const zeroBytes = hiShZero.getContext('2d').getImageData(0, 0, iw, ih).data;
    let legacyExact = legacyBytes.length === zeroBytes.length;
    for (let i = 0; legacyExact && i < legacyBytes.length; i++) if (legacyBytes[i] !== zeroBytes[i]) legacyExact = false;
    const stateCheck = { localOn: !!localToggle?.classList.contains('on'), maskCount: getFXParams().masks.length,
      baseRenderPixels: [sample(base, 425, 125), sample(base, 1275, 125)],
      panelLabels: [...document.querySelectorAll('#local-ctl .fx-row .fx-label')].map(e => e.textContent.trim()), legacyExact };
    const tileRenderer = new FXR(document.createElement('canvas'));
    if (!tileRenderer.ok) throw new Error('could not create a parity-check WebGL renderer');
    const compareBuffers = (one, many) => {
      const a = one.getContext('2d').getImageData(0, 0, iw, ih).data, b = many.getContext('2d').getImageData(0, 0, iw, ih).data;
      let maxDelta = 0, pixelsOver1 = 0, nonblank = 0, minX = iw, minY = ih, maxX = -1, maxY = -1;
      for (let i = 0; i < a.length; i += 4) {
        let d = 0; for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(a[i + c] - b[i + c]));
        maxDelta = Math.max(maxDelta, d); if (d > 1) { pixelsOver1++; const p = i / 4, x = p % iw, y = Math.floor(p / iw); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
        if (a[i + 3] > 0 && (a[i] || a[i + 1] || a[i + 2])) nonblank++;
      }
      return { maxDelta, pixelsOver1, nonblank, bounds: pixelsOver1 ? [minX, minY, maxX, maxY] : null };
    };
    let tileCount = 0;
    const renderExport = async tiled => {
      const previous = shouldTile; tileCount = 0; shouldTile = () => tiled;
      try { return await processToCanvas(P, img, iw, ih, () => { tileCount++; }, tileRenderer); }
      finally { shouldTile = previous; }
    };
    const zeroTiled = await renderExport(true);
    const neutralParity = compareBuffers(base, zeroTiled);
    const renderTilePair = async () => {
      const direct = await renderExport(false);
      const directPack = Array.from(tileRenderer._mskU.mK.slice(0, 4));
      const tiled = await renderExport(true);
      const tiledPack = Array.from(tileRenderer._mskU.mK.slice(0, 4));
      return { direct, tiled, stats: compareBuffers(direct, tiled), directPack, tiledPack };
    };
    const savedMasks = P.masks; P.masks = [];
    const noMaskParity = await renderTilePair(); P.masks = savedMasks;
    m.hi = 0.37; m.sh = -0.29;
    const hiShParity = await renderTilePair();
    m.wh = 0.65; m.bl = -0.45; m.hi = 0.21; m.sh = -0.17;
    const combinedParity = await renderTilePair();
    m.hi = 0; m.sh = 0;
    const wbParity = await renderTilePair();
    const maskDims = mskTexDims(iw, ih); m.type = 'brush'; m.origin = 'paint'; m.mtW = maskDims.w; m.mtH = maskDims.h;
    m.px = new Uint8ClampedArray(m.mtW * m.mtH);
    for (let y = 0; y < m.mtH; y++) for (let x = 0; x < m.mtW; x++) m.px[y * m.mtW + x] = (x * 7 + y * 3) & 255;
    _mskTexDirty = true; mskRebuild(); m.wh = 0; m.bl = 0; m.hi = 0; m.sh = 0;
    const brushBase = await renderTilePair();
    m.hi = 0.37; m.sh = -0.29; const brushHiSh = await renderTilePair();
    m.wh = 0.65; m.bl = -0.45; m.hi = 0; m.sh = 0; const brushWb = await renderTilePair();
    m.hi = 0.21; m.sh = -0.17; const brushCombined = await renderTilePair();
    m.type = 'radial'; delete m.origin; delete m.px; delete m.mtW; delete m.mtH;
    _mskTexDirty = true; mskRebuild();
    m.wh = 0; m.bl = 0; m.hi = 0; m.sh = 0;
    Object.assign(stateCheck, { neutralParity, noMaskParity: noMaskParity.stats, hiShParity: hiShParity.stats, wbParity: wbParity.stats,
      combinedParity: combinedParity.stats, brushParity: { neutral: brushBase.stats, hiSh: brushHiSh.stats,
        wb: brushWb.stats, combined: brushCombined.stats }, tileCount,
      directPack: combinedParity.directPack, tilePack: combinedParity.tiledPack });
    m.wh = 1; const whiteUp = await render(); m.wh = -1; const whiteDown = await render(); m.wh = 0;
    m.bl = 1; const blackUp = await render(); m.bl = -1; const blackDown = await render(); m.bl = 0;
    const coords = { darkIn: [Math.round(w * .25), Math.round(h * .25)], darkOut: [Math.round(w * .95), Math.round(h * .75)],
      whiteIn: [Math.round(w * .75), Math.round(h * .25)], whiteOut: [Math.round(w * .95), Math.round(h * .25)] };
    const read = (c, k) => sample(c, ...coords[k]);
    const amountNeutral = async (amount, isMuted) => { m.wh = 1; m.bl = 1; m.amount = amount; m.muted = isMuted; const c = await render(); m.amount = 100; m.muted = false; m.wh = 0; m.bl = 0; return c; };
    const amountZero = await amountNeutral(0, false), muted = await amountNeutral(100, true);
    const sampleKeys = Object.keys(coords);
    const baseVals = Object.fromEntries(sampleKeys.map(k => [k, read(base, k)]));
    const delta = Object.fromEntries(sampleKeys.map(k => [k, {
      whiteUp: read(whiteUp, k) - baseVals[k], whiteDown: read(whiteDown, k) - baseVals[k],
      blackUp: read(blackUp, k) - baseVals[k], blackDown: read(blackDown, k) - baseVals[k],
      amountZero: read(amountZero, k) - baseVals[k], muted: read(muted, k) - baseVals[k]
    }]));
    const uiDefaults = _mskAdjustDefaults();
    const cloned = _mskCloneLive({ ...m, wh: 0.73, bl: -0.41 });
    const snap = _mskToSnap(cloned), restored = _mskFromSnap(snap);
    m.wh = 0.73; m.bl = -0.41; mskSel = 0; mskDuplicate(false);
    const duplicateValues = [fxState.masks[1]?.wh, fxState.masks[1]?.bl];
    fxImages.push({ masks: [] }); m.wh = 0.53; m.bl = -0.24; mskCopyToAll();
    const copiedValues = [fxImages[1].masks[0]?.wh, fxImages[1].masks[0]?.bl];
    return { defaults: [uiDefaults.wh ?? 0, uiDefaults.bl ?? 0], persisted: [restored.wh, restored.bl], deltas: delta,
      dims: [iw, ih], stateCheck, undoWh, snapshotValues, duplicateValues, copiedValues };
  });

  if (glslErrors.length) throw new Error(glslErrors.join('\n'));
  const d = result.deltas;
  const checks = [
    ['Whites positive lifts bright masked tones', d.whiteIn.whiteUp > 2],
    ['Whites negative lowers bright masked tones', d.whiteIn.whiteDown < -2],
    ['Blacks positive lifts dark masked tones', d.darkIn.blackUp > 2],
    ['Blacks negative lowers dark masked tones', d.darkIn.blackDown < -2],
    ['uncovered white is unchanged', Math.abs(d.whiteOut.whiteUp) <= 1 && Math.abs(d.whiteOut.whiteDown) <= 1],
    ['uncovered dark is unchanged', Math.abs(d.darkOut.blackUp) <= 1 && Math.abs(d.darkOut.blackDown) <= 1],
    ['Amount zero disables both controls', Object.values(d).every(v => Math.abs(v.amountZero) <= 1)],
    ['muted mask disables both controls', Object.values(d).every(v => Math.abs(v.muted) <= 1)],
    ['two-tile full-buffer diagnostics cover no-mask, radial, and painted-mask cases in neutral, hi/sh, WB, and combined modes', result.stateCheck.tileCount === 2 && result.stateCheck.noMaskParity.nonblank > 0 && result.stateCheck.neutralParity.nonblank > 0 && result.stateCheck.hiShParity.nonblank > 0 && result.stateCheck.wbParity.nonblank > 0 && result.stateCheck.combinedParity.nonblank > 0 && Object.values(result.stateCheck.brushParity).every(v => v.nonblank > 0)],
    ['direct/tiled output differs by at most one channel value in every covered full buffer', [result.stateCheck.noMaskParity, result.stateCheck.neutralParity, result.stateCheck.hiShParity, result.stateCheck.wbParity, result.stateCheck.combinedParity, ...Object.values(result.stateCheck.brushParity)].every(v => v.maxDelta <= 1 && v.pixelsOver1 === 0)],
    ['direct and tiled render paths pack the new signed mask scalars identically', result.stateCheck.directPack.length === 4 && result.stateCheck.directPack.every((v, i) => Math.abs(v - result.stateCheck.tilePack[i]) < 1e-6) && Math.abs(result.stateCheck.directPack[1] - 0.65) < 1e-6 && Math.abs(result.stateCheck.directPack[2] + 0.45) < 1e-6],
    ['legacy missing values are zero and snapshot clone retains signed values', result.defaults[0] === 0 && result.defaults[1] === 0 && result.persisted[0] === 0.73 && result.persisted[1] === -0.41],
    ['both controls appear in the Adjust panel', result.stateCheck.panelLabels.includes('Whites') && result.stateCheck.panelLabels.includes('Blacks')],
    ['legacy Highlights/Shadows output is byte-exact with explicit zero Whites/Blacks', result.stateCheck.legacyExact],
    ['Undo, recipe restore, duplicate, and cross-photo copy preserve local values', result.undoWh === 0 && result.snapshotValues[0] === 0.6 && result.snapshotValues[1] === -0.4 && result.duplicateValues[0] === 0.73 && result.duplicateValues[1] === -0.41 && result.copiedValues[0] === 0.53 && result.copiedValues[1] === -0.24]
  ];
  for (const [label, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`);
  console.log(JSON.stringify({ dims: result.dims, stateCheck: result.stateCheck, undoWh: result.undoWh, snapshotValues: result.snapshotValues,
    duplicateValues: result.duplicateValues, copiedValues: result.copiedValues, deltas: d }, null, 2));
  console.log('DIAGNOSTIC brush direct/tiled stats count pixels with channel max delta > 1; existing raster export parity is outside this WB slice.');
  if (checks.some(([, pass]) => !pass)) process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
