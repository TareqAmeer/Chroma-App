#!/usr/bin/env node
// A lost pointerup (released outside the window / swallowed by a context menu) left _fxPreviewInteracting stuck true,
// pinning the preview to the blurry screen-res draft (glowScale 2 halation, no full-res crop) until the next slider drag.
// Expect: after a pointerdown on the photo whose pointerup never arrives, the preview settles back to "Full res".
const { chromium, webkit } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
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
const browser = await (process.env.WK ? webkit : chromium).launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
let ok = false;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 792 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FX !== 'undefined' && FX.ok, null, { timeout: 30000 });
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
    const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 3000, 2000); gr.addColorStop(0, '#236'); gr.addColorStop(1, '#c84'); g.fillStyle = gr; g.fillRect(0, 0, 3000, 2000); g.fillStyle='#000'; for(let x=0;x<3000;x+=8)g.fillRect(x,0,2,2000); g.fillStyle='#fff'; g.font='bold 300px sans-serif'; g.fillText('SHARP',900,1100);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await loadFXImages([new File([blob], 'a.png', { type: 'image/png' })]);
    await new Promise(res => { const t = Date.now(); const p = () => fxImages.length || Date.now() - t > 30000 ? res() : setTimeout(p, 20); p(); });
  });
  await page.waitForTimeout(800);
  await page.evaluate(v=>{window.__FR=v},!!process.env.FR);
  const SD=process.env.SHOTS||'.';
  await page.exposeFunction('__SH', async t => { await page.screenshot({path:SD+'/allfx_'+t+'.png'}); });
  const r = await page.evaluate(async () => {
    document.querySelectorAll('.cs-modal,#cs-modal-ov,[class*=cs-modal]').forEach(e => e.remove());
    if (!!window.__FR && !fxFullResPreview) fxFullResPreviewToggle();
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const snap = tag => { const bd = document.getElementById('fx-canvas-bd'), cv = FX.cv; const on = bd && bd.style.display !== 'none';
      const el = on ? bd : cv; const css = parseFloat(el.style.width) || el.clientWidth;
      return { tag, bd: on, w: el.width, css, zoom: fxZoom, eff: el.width / css * 1, info: document.getElementById('fx-info').textContent }; };
    const out = [];
    await sleep(800); out.push(snap('noFX')); enableAll(); await sleep(2500); out.push(snap('allFX'));
    return out;
  });
  await page.screenshot({path:SD+'/allfx_after.png'});
  console.log(JSON.stringify(r, null, 1));
  // Fit view, Full res: the bordered/matted composite must be rendered at ~2x its on-screen size (clean downscale), not the whole 3000px source point-sampled down to ~1000px
  const b = r[1]; ok = b.w <= b.css * 2 * 1.2 && b.w >= b.css;
  console.log(ok ? 'PASS' : 'FAIL: matted preview rendered at ' + b.w + ' for ' + b.css + ' css px (aliased shrink)');
} finally { await browser.close(); server.close(); }
process.exit(ok ? 0 : 1);
