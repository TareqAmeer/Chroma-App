#!/usr/bin/env node
// Focused GPU regression for per-mask Texture and Clarity, including production tiled export.
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
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

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || (process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined), args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('console', msg => { if (msg.type() === 'error' && /GLSL compile error|LINK FAILED|SHADER_COMPILE|program.*link/i.test(msg.text())) errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(`page error: ${err.message}`));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FX !== 'undefined', null, { timeout: 30000 });

  const result = await page.evaluate(async () => {
    const w = 1700, h = 500, source = document.createElement('canvas'); source.width = w; source.height = h;
    const ctx = source.getContext('2d'), pixels = ctx.createImageData(w, h);
    // Midtone vertical bands exercise both the small Texture and wider Clarity source taps.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = x >= 180 && x < 1520 && y >= 70 && y < 430 ? (Math.floor(x / 8) % 2 ? 0.54 : 0.46) : 0.5;
      const i = (y * w + x) * 4, s = Math.round(v * 255);
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = s; pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const blob = await new Promise(resolve => source.toBlob(resolve, 'image/png'));
    await loadFXImages([new File([blob], 'local-texture-clarity.png', { type: 'image/png' })]);
    await new Promise(resolve => { const start = Date.now(); const poll = () => fxImages.length ? resolve() : Date.now() - start > 30000 ? resolve() : setTimeout(poll, 20); poll(); });
    if (!fxImages.length) throw new Error('fixture image did not load');

    const m = { type: 'radial', cx: 0.5, cy: 0.5, rx: 0.42, ry: 0.44, rot: 0, feather: 0.02,
      id: 'texture-clarity-mask', amount: 100, tex: 0, clarity: 0, ..._mskAdjustDefaults(), ..._mskSkinDefaults() };
    fxState.masks = [m]; fxImages[fxCurIdx].masks = fxState.masks; mskSel = 0; _mskTexDirty = true; _mskGroupOpen.adjEffects = true; _mskGroupOpen.adjDetail = true; mskRebuild(); // groups are collapsed by default
    const localToggle = document.getElementById('tg-local');
    if (localToggle && !localToggle.classList.contains('on')) toggleFX('local');
    const labels = [...document.querySelectorAll('#local-ctl .fx-row .fx-label')].map(e => e.textContent.trim());
    if (!document.querySelector('#local-ctl input[data-k="tex"]') || !document.querySelector('#local-ctl input[data-k="clarity"]')) throw new Error('local Texture or Clarity slider is missing');

    const img = curItem().img, iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const P = getFXParams(); P.grain = { enabled: false }; P.halation = { enabled: false }; P.bloom = { enabled: false };
    P.adjust = { enabled: false }; P.lut = null; P.print = null; P.vignette = { enabled: false }; P.redEyeOps = [];
    Math.random = () => 0.375;
    const renderer = new FXR(document.createElement('canvas'));
    if (!renderer.ok) throw new Error('could not create a WebGL renderer');
    const render = async () => {
      renderer.setImage(img); renderer.render(P, iw, ih, { glowScale: 1, seed: 4.25 });
      const { px, w: rw, h: rh } = renderer.getPixels();
      const out = document.createElement('canvas'); out.width = rw; out.height = rh;
      out.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), rw, rh), 0, 0); return out;
    };
    const base = await render();
    m.tex = 100; m.clarity = 0; const texPlus = await render();
    m.tex = -100; const texMinus = await render();
    m.tex = 0; m.clarity = 100; const clarityPlus = await render();
    m.clarity = -100; const clarityMinus = await render();
    m.clarity = 0; const neutral = await render();
    const data = canvas => canvas.getContext('2d').getImageData(0, 0, iw, ih).data;
    const bytes = { base: data(base), texPlus: data(texPlus), texMinus: data(texMinus), clarityPlus: data(clarityPlus), clarityMinus: data(clarityMinus), neutral: data(neutral) };
    const outsidePoint = [Math.round(iw * .04), Math.round(ih * .08)];
    const rgbDiff = (a, b, x, y) => { let sum = 0; const i = (y * iw + x) * 4; for (let c = 0; c < 3; c++) sum += Math.abs(a[i + c] - b[i + c]); return sum; };
    const outsideExact = key => rgbDiff(bytes.base, bytes[key], ...outsidePoint) === 0;
    const detailDiff = key => { let sum = 0; for (let y = Math.round(ih * .3); y < Math.round(ih * .7); y++) for (let x = Math.round(iw * .34); x < Math.round(iw * .66); x++) { const i = (y * iw + x) * 4; sum += Math.abs(bytes.base[i] - bytes[key][i]); } return sum; };

    m.tex = 37; m.clarity = -29; const wire = JSON.parse(JSON.stringify(getUISnapshot()));
    const persisted = [wire.masks?.[0]?.tex, wire.masks?.[0]?.clarity];
    await applyUISnapshot(wire);
    const roundTrip = [fxState.masks[0]?.tex, fxState.masks[0]?.clarity];
    const direct = await processToCanvas(P, img, iw, ih, () => {}, renderer);
    let tiles = 0; const oldShouldTile = shouldTile; shouldTile = () => true;
    let tiled; try { tiled = await processToCanvas(P, img, iw, ih, () => { tiles++; }, renderer); } finally { shouldTile = oldShouldTile; }
    const directBytes = data(direct), tiledBytes = data(tiled); let maxDelta = 0, pixelsOver1 = 0, nonblank = 0;
    for (let i = 0; i < directBytes.length; i += 4) { let d = 0; for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(directBytes[i + c] - tiledBytes[i + c])); maxDelta = Math.max(maxDelta, d); if (d > 1) pixelsOver1++; if (directBytes[i] || directBytes[i + 1] || directBytes[i + 2]) nonblank++; }
    return { labels, detailDiff: { texPlus: detailDiff('texPlus'), texMinus: detailDiff('texMinus'), clarityPlus: detailDiff('clarityPlus'), clarityMinus: detailDiff('clarityMinus') },
      outside: { texPlus: outsideExact('texPlus'), texMinus: outsideExact('texMinus'), clarityPlus: outsideExact('clarityPlus'), clarityMinus: outsideExact('clarityMinus') },
      neutralExact: bytes.base.every((v, i) => v === bytes.neutral[i]), persisted, roundTrip, tile: { tiles, maxDelta, pixelsOver1, nonblank } };
  });

  if (errors.length) throw new Error(errors.join('\n'));
  const checks = [
    ['local Texture and Clarity controls are exposed', result.labels.includes('Texture') && result.labels.includes('Clarity')],
    ['positive and negative local Texture each change masked fine detail', result.detailDiff.texPlus > 0 && result.detailDiff.texMinus > 0],
    ['positive and negative local Clarity each change masked midtone structure', result.detailDiff.clarityPlus > 0 && result.detailDiff.clarityMinus > 0],
    ['all four local detail directions leave pixels outside the mask unchanged', Object.values(result.outside).every(Boolean)],
    ['zero Texture and Clarity remain pixel-identical to the baseline', result.neutralExact],
    ['Texture and Clarity values survive snapshot round-trip', JSON.stringify(result.persisted) === JSON.stringify([37, -29]) && JSON.stringify(result.roundTrip) === JSON.stringify([37, -29])],
    ['local Texture/Clarity tiled export matches direct output', result.tile.tiles > 1 && result.tile.maxDelta <= 1 && result.tile.pixelsOver1 === 0 && result.tile.nonblank > 0]
  ];
  for (const [label, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`);
  console.log(JSON.stringify(result, null, 2));
  if (checks.some(([, pass]) => !pass)) process.exitCode = 1;
} finally { await browser.close(); server.close(); }
