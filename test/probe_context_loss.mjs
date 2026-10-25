#!/usr/bin/env node
// WEBGL_lose_context: lose and restore the Editor's GL context; the preview must come back by itself, pixel-identical (no reload).
// Also probes the 2nd and 3rd loss in a row.

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
    const c = document.createElement('canvas'); c.width = 1800; c.height = 1200; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 1800, 1200); gr.addColorStop(0, '#234'); gr.addColorStop(1, '#c84'); g.fillStyle = gr; g.fillRect(0, 0, 1800, 1200);
    g.fillStyle = '#fff'; g.font = 'bold 260px sans-serif'; g.fillText('LOSS', 500, 700);
    await loadFXImages([new File([await new Promise(r => c.toBlob(r))], 'a.png', { type: 'image/png' })]);
    await sleep(1200); document.querySelectorAll('.cs-modal,#cs-modal-ov').forEach(e => e.remove());
    enableAll(); await sleep(1500);
    const sig = () => { const P = getFXParams(); P.bordersEnabled = false; FX.setImage(fxWork || fxImg); FX.render(P, 900, 600, { glowScale: 1, seed: 7 }); const { px } = FX.getPixels(); let h = 2166136261 >>> 0; for (let i = 0; i < px.length; i += 7) h = Math.imul(h ^ px[i], 16777619) >>> 0; return h; };
    const ext = FX.gl.getExtension('WEBGL_lose_context');
    if (!ext) return { error: 'no WEBGL_lose_context' };
    const before = sig(), out = [];
    for (let n = 0; n < 3; n++) {
      let restored = false; FX.onRestored = (old => () => { restored = true; old && old(); })(FX.onRestored);
      ext.loseContext(); await sleep(150);
      const lostFlag = FX._lost === true;
      FX.gl.getExtension('WEBGL_lose_context') && 0; // (the extension object survives; restore through the original handle)
      ext.restoreContext();
      for (let i = 0; i < 60 && !restored; i++) await sleep(100);
      await sleep(800);
      out.push({ n, lostFlag, restored, ok: FX.ok, same: sig() === before, hasProgs: Object.keys(FX.progs).length });
    }
    return { before, out };
  });
  console.log(JSON.stringify(r));
  ok = !r.error && r.out.every(o => o.restored && o.same && o.ok);
  console.log(ok ? 'PASS: preview survives repeated context loss' : 'FAIL');
} finally { await browser.close(); server.close(); }
process.exit(ok ? 0 : 1);
