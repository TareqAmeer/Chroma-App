#!/usr/bin/env node
// A render at 2x the width (sc doubles, so glow sigma doubles in pixels) must equal the 1x render once shrunk back:
// the glow is defined relative to image width. Before the N-pass blur, the blur kernels were capped (r<=48 / r<=64 taps) so
// anything past sigma~16 / ~21 was truncated and the big render's halo came out TIGHTER than the small one.
// Measured 2026-10-25 (4800px, bloom sigma 24.8): old kernel cap 0.074 mean / new N-pass 0.029 mean => limit 0.05.
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
  await page.goto(`http://127.0.0.1:${server.address().port}/${process.env.HTMLFILE || 'chromasmith-22.html'}?deskx=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FX !== 'undefined' && FX.ok, null, { timeout: 30000 });
  const r = await page.evaluate(async () => {
    const mk = (W, H) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
      g.fillStyle = '#101418'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff';
      for (let i = 0; i < 24; i++) { g.beginPath(); g.arc(W * (0.08 + (i * 0.37) % 0.84), H * (0.1 + (i * 0.23) % 0.8), W * 0.004 + (i % 4) * W * 0.002, 0, 7); g.fill(); }
      g.fillRect(W * 0.3, H * 0.45, W * 0.25, H * 0.02); return c; };
    const P = () => { const p = getFXParams(); return p; };
    document.querySelectorAll('.cs-modal,#cs-modal-ov').forEach(e => e.remove());
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const base = mk(4800, 3200);
    await loadFXImages([new File([await new Promise(r => base.toBlob(r, 'image/png'))], 'g.png', { type: 'image/png' })]);
    await new Promise(res => { const t = Date.now(); const p = () => fxImages.length || Date.now() - t > 30000 ? res() : setTimeout(p, 20); p(); });
    await sleep(500);
    enableAll(); await sleep(1200);
    for (const id of ['tg-grain']) { const t = document.getElementById(id); if (t && t.classList.contains('on')) t.click(); }
    await sleep(800);
    const params = getFXParams(); params.bordersEnabled = false; params.b1 = { thickness: 0 }; params.b2 = { thickness: 0 };
    const render = async (w, h) => {
      Math.random = (() => { let s = 12345; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
      const cv = await processToCanvas(params, fxWork || fxImg, w, h);
      return cv;
    };
    // small render: source downscaled to 2400 wide; big render: 4800 wide (sigma doubles => N=2 passes on the bloom)
    const src = fxWork || fxImg, iw = src.naturalWidth || src.width;
    const big = await render(iw, src.height);
    const small = document.createElement('canvas'); small.width = iw / 2; small.height = src.height / 2; small.getContext('2d').drawImage(src, 0, 0, small.width, small.height);
    const smallOut = await processToCanvas(params, small, small.width, small.height);
    const down = document.createElement('canvas'); down.width = small.width; down.height = small.height;
    const dg = down.getContext('2d'); dg.imageSmoothingQuality = 'high'; dg.drawImage(big, 0, 0, down.width, down.height);
    const A = dg.getImageData(0, 0, down.width, down.height).data, B = smallOut.getContext('2d').getImageData(0, 0, down.width, down.height).data;
    let d = 0, n = 0, mx = 0; for (let i = 0; i < A.length; i += 4) { for (let c = 0; c < 3; c++) { const e = Math.abs(A[i + c] - B[i + c]); d += e; n++; if (e > mx) mx = e; } }
    return { meanAbsDiff: +(d / n).toFixed(3), max: mx, w: iw };
  });
  console.log(JSON.stringify(r));
  const lim = +(process.env.MAXDIFF || 0.05);
  ok = r.meanAbsDiff <= lim;
  console.log(ok ? 'PASS' : `FAIL: glow at 2x width differs from the 1x render by ${r.meanAbsDiff} levels (> ${lim}): wide glow sigma is being truncated`);
} finally { await browser.close(); server.close(); }
process.exit(ok ? 0 : 1);
