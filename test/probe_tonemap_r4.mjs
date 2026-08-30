#!/usr/bin/env node
// One-off visual/numeric demo for ROADMAP.md's R4 (native film-stock highlight shoulder) —
// NOT part of npm test, same role as test/probe_tonemap_r1.mjs. Loads the
// spektra_kodak_portra_400_endura look, pushes a blown ramp +3 stops with useTonemap on, and
// renders it once with tonemapStyle='' (BT.2390) and once with tonemapStyle='native', printing
// the row's RGBA samples so the difference is a real number, not a screenshot judgment call.
// Also confirms the JS-side fallback: selecting 'native' on a NON-spektra look must render
// byte-identical to BT.2390 (no shader garbage, no missing-texture artifact).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.bin': 'application/octet-stream', '.cube': 'text/plain' };

function startServer(root) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        let filePath = path.join(root, urlPath === '/' ? '/index.html' : urlPath);
        if (!filePath.startsWith(root)) { res.writeHead(403); res.end(); return; }
        const data = await readFile(filePath);
        const ext = path.extname(filePath);
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      } catch (e) { res.writeHead(404); res.end('not found'); }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const server = await startServer(ROOT);
  const { port } = server.address();
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage();
  let compileErrors = 0;
  page.on('console', (m) => { if (m.type() === 'error') { console.log('[pageerror]', m.text()); if (/GLSL compile error/.test(m.text())) compileErrors++; } });
  await page.goto(`http://127.0.0.1:${port}/chromasmith-22.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.processToCanvas === 'function' && typeof window.getFXParams === 'function' && typeof window.presetLut === 'function', { timeout: 30000 });

  const results = {};
  for (const [label, lutKey, tonemapVal] of [
    ['bt2390_spektra', 'spektra_kodak_portra_400_endura', ''],
    ['native_spektra', 'spektra_kodak_portra_400_endura', 'native'],
    ['native_nonspektra_fallback', 'kodak_gold_200', 'native'],
    ['bt2390_nonspektra', 'kodak_gold_200', ''],
  ]) {
    const out = await page.evaluate(async ({ lutKey, tonemapVal }) => {
      const w = 16, h = 4;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h); // dummy 8-bit backing, unused once _sceneLinear is set
      // ROADMAP.md R1's real headroom path: setImage() uploads img._sceneLinear (RGB float,
      // values may exceed 1.0) as an RGBA16F texture instead of clamping the 8-bit canvas --
      // this is the ONLY way to get real >1.0 values INTO the lut pass (an exposure slider
      // runs in basicAdjust, which is AFTER the look LUT -- it can't create headroom the LUT
      // pass itself will see). One row, 16 texels stepping 0..+4 stops above white (1,2,4,8,16x).
      const data = new Float32Array(w * h * 3);
      for (let x = 0; x < w; x++) {
        const stops = (x / (w - 1)) * 4; // 0..4 stops above white across the row
        const v = Math.pow(2, stops);
        for (let y = 0; y < h; y++) {
          const i = (y * w + x) * 3;
          data[i] = v; data[i + 1] = v; data[i + 2] = v;
        }
      }
      c._sceneLinearPresent = true;
      c._sceneLinear = { data, w, h };
      fxImages.length = 0;
      fxImages.push({ img: c, name: 'headroom_ramp', ext: 'png', dpi: null, bytes: null });
      fxCurIdx = 0;
      fxState.useTonemap = true;
      const lut = await window.presetLut(lutKey);
      FX.setLUT(lut); fxState.lut = lut;
      const tmEl = document.getElementById('sel-tonemap'); if (tmEl) tmEl.value = tonemapVal;
      // Pre-warm the shoulder texture synchronously (render()'s own async fetch-on-first-use
      // would otherwise race a single processToCanvas call in this test -- the app itself
      // covers this via renderPreview() re-firing once the fetch resolves, see FX.render()).
      if (tonemapVal === 'native' && typeof SPEKTRA_SHOULDER_KEYS !== 'undefined' && SPEKTRA_SHOULDER_KEYS.has(lutKey)) {
        const b = await window.stockShoulderBytes(lutKey);
        if (b) { FX.setStockShoulderTex(b); FX._shoulderKey = lutKey; }
      }
      const P = window.getFXParams();
      P.lutKey = 'p:' + lutKey; // mirror what the real sel-lut option value would carry
      const outCanvas = await window.processToCanvas(P, c, w, h);
      const octx = outCanvas.getContext('2d');
      const row = Math.floor(outCanvas.height / 2);
      const px = octx.getImageData(0, row, outCanvas.width, 1).data;
      const samples = [];
      for (let x = 0; x < outCanvas.width; x++) {
        const i = x * 4;
        samples.push([px[i], px[i + 1], px[i + 2], px[i + 3]]);
      }
      return samples;
    }, { lutKey, tonemapVal });
    results[label] = out;
  }
  await browser.close();
  server.close();

  console.log(compileErrors ? `FAIL: ${compileErrors} GLSL compile error(s)` : 'no GLSL compile errors');

  // Compare bt2390_spektra vs native_spektra: must be REAL and DIFFERENT, not garbage.
  const a = results['bt2390_spektra'], b = results['native_spektra'];
  console.log('\nx      bt2390(R,G,B,A)      native(R,G,B,A)');
  let maxDiff = 0, anyNonBlank = false;
  for (let k = 0; k < a.length; k++) {
    const ar = a[k], br = b[k];
    const d = Math.max(Math.abs(ar[0] - br[0]), Math.abs(ar[1] - br[1]), Math.abs(ar[2] - br[2]));
    maxDiff = Math.max(maxDiff, d);
    if (ar[3] !== 0) anyNonBlank = true;
    console.log(`${String(k).padStart(3)}    ${ar.join(',').padEnd(15)}   ${br.join(',')}`);
  }
  console.log(`\nmax |bt2390-native| over sampled row: ${maxDiff}`);
  console.log(`non-blank alpha: ${anyNonBlank}`);
  if (maxDiff === 0) console.log('FAIL: native and BT.2390 produced IDENTICAL output on a blown-highlight spektra look -- feature not engaging');
  else console.log('PASS: native-stock shoulder visibly differs from BT.2390 on a blown highlight');

  // Fallback check: native on a non-spektra look must equal BT.2390 exactly (no shader garbage,
  // no missing-texture artifact).
  const c1 = results['bt2390_nonspektra'], c2 = results['native_nonspektra_fallback'];
  let fbMax = 0;
  for (let k = 0; k < c1.length; k++) for (let ch = 0; ch < 4; ch++) fbMax = Math.max(fbMax, Math.abs(c1[k][ch] - c2[k][ch]));
  console.log(`\nnon-spektra look, native vs BT.2390: max byte diff = ${fbMax} (${fbMax === 0 ? 'PASS: exact fallback' : 'FAIL: fallback not exact'})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
