#!/usr/bin/env node
// Grain parity: a Fit PREVIEW (rendered at half the export width, then shrunk by the compositor) must show the same grain
// strength as the EXPORT viewed at the same size. The clump cell grid is defined against the export width (opts.truncRefW),
// not the render width; before that the preview's clumps were ~2.5x coarser and the residual std ~2x the export's.
// HTMLFILE=<path relative to repo root> renders an older copy of the app for a before/after comparison.
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = createServer(async (req, res) => {
  try {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname));
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
let ok = false;
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  if (process.env.TRUNC === '0') await page.addInitScript(() => { window.__TRUNC = false; });
  await page.goto(`http://127.0.0.1:${server.address().port}/${process.env.HTMLFILE || 'chromasmith-22.html'}?deskx=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FX !== 'undefined' && FX.ok, null, { timeout: 30000 });
  const r = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.querySelectorAll('.cs-modal,#cs-modal-ov').forEach(e => e.remove());
    const W0 = 4800, H0 = 3200, c0 = document.createElement('canvas'); c0.width = W0; c0.height = H0;
    const g0 = c0.getContext('2d'); g0.fillStyle = '#808080'; g0.fillRect(0, 0, W0, H0);
    await loadFXImages([new File([await new Promise(r => c0.toBlob(r, 'image/png'))], 'g.png', { type: 'image/png' })]);
    await new Promise(res => { const t = Date.now(); const p = () => fxImages.length || Date.now() - t > 30000 ? res() : setTimeout(p, 20); p(); });
    await sleep(500);
    const params = getFXParams(); params.bordersEnabled = false; params.b1 = { thickness: 0 }; params.b2 = { thickness: 0 };
    params.halation.enabled = false; params.bloom.enabled = false;
    params.grain = { enabled: true, amount: 60, size: 5, format: '35mm' };
    const src = fxWork || fxImg, iw = src.naturalWidth || src.width, ih = src.naturalHeight || src.height;
    const TW = 1200, TH = Math.round(TW * ih / iw);
    const std = cv => { const c = document.createElement('canvas'); c.width = TW; c.height = TH; const g = c.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingQuality = 'high'; g.drawImage(cv, 0, 0, TW, TH); const d = g.getImageData(100, 100, TW - 200, TH - 200).data;
      let n = 0, s = 0, q = 0; for (let i = 0; i < d.length; i += 4) { const l = d[i] * .2126 + d[i + 1] * .7152 + d[i + 2] * .0722; s += l; q += l * l; n++; }
      return Math.sqrt(q / n - (s / n) ** 2); };
    const exp = await processToCanvas(params, src, iw, ih);
    const half = document.createElement('canvas'); half.width = iw / 2; half.height = ih / 2; half.getContext('2d').drawImage(src, 0, 0, half.width, half.height);
    FX.setImage(half); FX.render(params, half.width, half.height, { glowScale: 1, truncRefW: iw, seed: 12.3 });
    const { px, w: pw, h: ph } = FX.getPixels();
    const pc = document.createElement('canvas'); pc.width = pw; pc.height = ph;
    pc.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer), pw, ph), 0, 0);
    return { exportStd: +std(exp).toFixed(3), previewStd: +std(pc).toFixed(3) };
  });
  console.log(JSON.stringify(r));
  const ratio = r.previewStd / r.exportStd; const lim = +(process.env.MAXDEV || 0.2);
  ok = r.exportStd > 0.1 && Math.abs(ratio - 1) <= lim;
  console.log(ok ? `PASS (preview/export grain std ${ratio.toFixed(2)})` : `FAIL: preview grain std is ${ratio.toFixed(2)}x the export's (limit +-${lim})`);
} finally { await browser.close(); server.close(); }
process.exit(ok ? 0 : 1);
