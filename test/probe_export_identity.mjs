#!/usr/bin/env node
// Export identity guard: the bloom/halation export look (the capped, truncated blur kernels on wide images) must not change.
// Renders two images wider than 3100px (where the kernel cap binds) with halation+bloom on, through processToCanvas, in an OLD copy
// of the app (OLD=<git ref>, default b96045f3~1) and in the working tree, and compares an FNV hash + max/mean pixel difference.
// The working tree is rendered with fxStillQualityOpts disabled (8-bit, no dither) because float+dither is a separate, intended change.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ref = process.env.OLD || 'b96045f3~1';
const oldFile = path.join(root, 'test/_old_app_identity.html');
await writeFile(oldFile, execFileSync('git', ['show', `${ref}:chromasmith-22.html`], { cwd: root, maxBuffer: 1 << 30 }));
const server = createServer(async (req, res) => {
  try { const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname));
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    res.end(await readFile(file)); } catch { res.writeHead(404).end('nf'); } });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
const sizes = [[4800, 3200], [6240, 2400]];
async function run(file, neutral) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/${file}?deskx=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FX !== 'undefined' && FX.ok, null, { timeout: 30000 });
  const out = await page.evaluate(async ([sizes, neutral]) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const res = [];
    for (const [W, H] of sizes) {
      const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
      g.fillStyle = '#101418'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff';
      for (let i = 0; i < 30; i++) { g.beginPath(); g.arc(W * (0.08 + (i * 0.37) % 0.84), H * (0.1 + (i * 0.23) % 0.8), W * 0.004 + (i % 4) * W * 0.002, 0, 7); g.fill(); }
      g.fillStyle = '#ffd9a0'; g.fillRect(W * 0.3, H * 0.45, W * 0.25, H * 0.02);
      fxImages.length = 0;
      await loadFXImages([new File([await new Promise(r => c.toBlob(r, 'image/png'))], 'g.png', { type: 'image/png' })]);
      await new Promise(rs => { const t = Date.now(); const p = () => fxImages.length || Date.now() - t > 30000 ? rs() : setTimeout(p, 20); p(); });
      await sleep(500); document.querySelectorAll('.cs-modal,#cs-modal-ov').forEach(e => e.remove());
      if (!allFxIsOn()) enableAll(); await sleep(1200);
      const t = document.getElementById('tg-grain'); if (t && t.classList.contains('on')) t.click(); await sleep(600);
      const P = getFXParams(); P.bordersEnabled = false; P.b1 = { thickness: 0 }; P.b2 = { thickness: 0 };
      if (neutral) window.fxStillQualityOpts = () => ({});
      let s = 12345; Math.random = () => (s = (s * 16807) % 2147483647) / 2147483647;
      const src = fxWork || fxImg, cv = await processToCanvas(P, src, src.naturalWidth || src.width, src.naturalHeight || src.height);
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let h = 2166136261 >>> 0, sum = 0; for (let i = 0; i < d.length; i++) { h = Math.imul(h ^ d[i], 16777619) >>> 0; sum += d[i]; }
      // a coarse copy for a difference measure
      const sm = document.createElement('canvas'); sm.width = 480; sm.height = 320; sm.getContext('2d').drawImage(cv, 0, 0, 480, 320);
      res.push({ W, H, hash: h, sum, small: Array.from(sm.getContext('2d').getImageData(0, 0, 480, 320).data) });
    }
    return res;
  }, [sizes, neutral]);
  await page.close(); return out;
}
let ok = true;
try {
  const a = await run('test/_old_app_identity.html', false), b = await run('chromasmith-22.html', true);
  for (let i = 0; i < a.length; i++) {
    let mx = 0, d = 0; for (let k = 0; k < a[i].small.length; k++) { const e = Math.abs(a[i].small[k] - b[i].small[k]); d += e; if (e > mx) mx = e; }
    const same = a[i].hash === b[i].hash;
    console.log(`${a[i].W}x${a[i].H}: old ${a[i].hash.toString(16)} new ${b[i].hash.toString(16)} ${same ? 'IDENTICAL' : 'DIFFERENT'} (coarse mean ${(d / a[i].small.length).toFixed(4)} max ${mx})`);
    if (!same) ok = false;
  }
} finally { await browser.close(); server.close(); await rm(oldFile, { force: true }); }
console.log(ok ? 'PASS: export output identical to the old export' : 'FAIL: export output changed');
process.exit(ok ? 0 : 1);
