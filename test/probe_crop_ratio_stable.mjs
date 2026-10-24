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
  
  const r = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const rect = () => { const c = document.getElementById('fx-canvas-crop'); const b = c.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(v => Math.round(v * 10) / 10); };
    const vis = () => { const bd = document.getElementById('fx-canvas-bd'); const c = document.getElementById('fx-canvas-crop'); const el = cropMode && c ? c : (bd && bd.style.display !== 'none' ? bd : FX.cv); const b = el.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(v => Math.round(v * 10) / 10); };
    await sleep(500);
    const out = { start: vis(), moves: [] };
    const sel = document.getElementById('sel-crop-ar');
    const opts = [...sel.options].map(o => o.value).filter(v => v && v !== 'shot' && v !== 'custom' && v !== '0');
    for (const v of ['1.5', '1', '0.7071']) { if (cropMode) { try { cropExit && cropExit(); renderPreview(); } catch (e) {} await sleep(600); } out.start = vis(); sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); await sleep(900); out.moves.push([v, vis(), out.start]); }
    { const w=document.getElementById('fx-wrap'); out.kids=[...w.children].map(c=>{const b=c.getBoundingClientRect();return c.id+':'+getComputedStyle(c).display+':'+Math.round(b.left)+','+Math.round(b.top)+','+Math.round(b.width)+'x'+Math.round(b.height)}); const cs=getComputedStyle(w); out.wrap=cs.display+' '+cs.flexDirection+' '+cs.alignItems+' '+cs.justifyContent; }
    return out;
  });
  console.log(JSON.stringify(r));
  const d = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  const worst = Math.max(...r.moves.map(m => d(m[1], m[2])));
  ok = worst < 1;
  console.log(ok ? 'PASS' : 'FAIL: photo moved by up to ' + worst + 'px when picking a crop aspect ratio');
} finally { await browser.close(); server.close(); }
process.exit(ok ? 0 : 1);
