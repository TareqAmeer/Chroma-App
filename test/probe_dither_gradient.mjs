#!/usr/bin/env node
// Float+half-LSB-dither still export vs the old 8-bit chain on a smooth gradient with a strong grade: the dithered export must not shift the
// mean colour (> 0.6/255 per channel) and must not band MORE than the 8-bit export (longest identical run along the ramp).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = createServer(async (req, res) => { try { const f = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname));
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Content-Type', f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); res.end(await readFile(f)); } catch { res.writeHead(404).end('nf'); } });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'] });
let ok = true;
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FX !== 'undefined' && FX.ok, null, { timeout: 30000 });
  const r = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const W = 2048, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, '#202020'); gr.addColorStop(1, '#8a8a90'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    fxImages.length = 0;
    await loadFXImages([new File([await new Promise(r => c.toBlob(r, 'image/png'))], 'g.png', { type: 'image/png' })]);
    await new Promise(rs => { const t = Date.now(); const p = () => fxImages.length || Date.now() - t > 30000 ? rs() : setTimeout(p, 20); p(); });
    await sleep(600); document.querySelectorAll('.cs-modal,#cs-modal-ov').forEach(e => e.remove());
    const sel = document.getElementById('sel-lut'); sel.value = 'p:' + Object.keys(LUT_META)[3]; await selectLUT(sel.value); await sleep(400);
    const stats = cv => { const d = cv.getContext('2d').getImageData(0, cv.height >> 1, cv.width, 1).data; let run = 0, maxRun = 0, last = -1; const m = [0, 0, 0];
      for (let x = 0; x < cv.width; x++) { const v = d[x * 4 + 1]; if (v === last) run++; else { run = 1; last = v; } if (run > maxRun) maxRun = run; for (let k = 0; k < 3; k++) m[k] += d[x * 4 + k]; }
      return { maxRun, mean: m.map(v => v / cv.width) }; };
    const P = getFXParams(); P.adjust = { ...(P.adjust || {}), enabled: true, contrast: 0.5, exposure: 0.2 };
    const src = fxWork || fxImg, w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
    const real = stats(await processToCanvas(P, src, w, h));
    const keep = window.fxStillQualityOpts; window.fxStillQualityOpts = () => ({});
    const old = stats(await processToCanvas(P, src, w, h)); window.fxStillQualityOpts = keep;
    return { real, old };
  });
  const shift = r.real.mean.map((v, i) => Math.abs(v - r.old.mean[i]));
  console.log('8-bit chain:', JSON.stringify(r.old), '\nfloat+dither:', JSON.stringify(r.real), '\nmean shift', shift.map(v => v.toFixed(3)).join(','));
  ok = Math.max(...shift) <= 0.6 && r.real.maxRun <= r.old.maxRun;
} finally { await browser.close(); server.close(); }
console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
