#!/usr/bin/env node
// A lost pointerup (released outside the window / swallowed by a context menu) left _fxPreviewInteracting stuck true,
// pinning the preview to the blurry screen-res draft (glowScale 2 halation, no full-res crop) until the next slider drag.
// Expect: after a pointerdown on the photo whose pointerup never arrives, the preview settles back to "Full res".
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 792 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FX !== 'undefined' && FX.ok, null, { timeout: 30000 });
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
    const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 3000, 2000); gr.addColorStop(0, '#236'); gr.addColorStop(1, '#c84'); g.fillStyle = gr; g.fillRect(0, 0, 3000, 2000);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await loadFXImages([new File([blob], 'a.png', { type: 'image/png' })]);
    await new Promise(res => { const t = Date.now(); const p = () => fxImages.length || Date.now() - t > 30000 ? res() : setTimeout(p, 20); p(); });
  });
  await page.waitForTimeout(800);
  await page.evaluate(async () => { document.querySelectorAll('.cs-modal,#cs-modal-ov,[class*=cs-modal]').forEach(e => e.remove()); if (!fxFullResPreview) fxFullResPreviewToggle(); zoomSet(2); await new Promise(r => setTimeout(r, 800)); });
  const box = await page.evaluate(() => { const b = document.getElementById('fx-zoom-wrap').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.mouse.move(box.x, box.y);
  console.log(await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return (e && (e.id || e.className || e.tagName)) + ' ' + JSON.stringify([x, y]); }, [box.x, box.y]));
  await page.mouse.down();                      // real pointerdown on the photo; the matching pointerup never arrives
  const r = await page.evaluate(async () => {
    const during = _fxPreviewInteracting;
    const o = { bubbles: true, pointerId: 1, pointerType: 'mouse', buttons: 0 };
    // the OS keeps reporting hover moves (buttons 0) once the release was lost outside the window
    for (let i = 0; i < 3; i++) { document.dispatchEvent(new PointerEvent('pointermove', o)); await new Promise(r => setTimeout(r, 100)); }
    await new Promise(r => setTimeout(r, 1500));
    renderPreview();
    return { during, after: _fxPreviewInteracting, info: document.getElementById('fx-info').textContent };
  });
  console.log(JSON.stringify(r));
  ok = r.after === false && /^Full res/.test(r.info);
  console.log(ok ? 'PASS' : 'FAIL: preview stuck on the draft');
} finally { await browser.close(); server.close(); }
process.exit(ok ? 0 : 1);
