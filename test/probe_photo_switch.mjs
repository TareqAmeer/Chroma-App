#!/usr/bin/env node
// Photo switch at Fit (landscape <-> portrait, borders off/on): sample the photo rect every ~50ms for 3s after
// the switch. Every sample must already be the final fitted+centred frame (or no photo yet) — a transient
// smaller / off-centre frame is the "brief jump" seen when clicking a filmstrip thumb.
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
  const res = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const mk = async (w, h, col, name) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, w, h); return new File([await new Promise(r => c.toBlob(r, 'image/png'))], name, { type: 'image/png' }); };
    await loadFXImages([await mk(3000, 2000, '#357', 'land.png'), await mk(2000, 3000, '#753', 'port.png')]);
    await new Promise(res => { const t = Date.now(); const p = () => fxImages.length >= 2 || Date.now() - t > 30000 ? res() : setTimeout(p, 20); p(); });
    const snap = () => { const r = fxPhotoClientRect(); if (!r) return null; const w = document.getElementById('fx-wrap').getBoundingClientRect(); return { cx: r.left + r.width / 2 - (w.left + w.width / 2), cy: r.top + r.height / 2 - (w.top + w.height / 2), w: r.width, h: r.height, ar: r.width / r.height }; };
    const out = [];
    for (const borders of [false, true]) {
      document.getElementById('tg-borders').classList.toggle('on', borders); document.getElementById('sl-b1-t').value = 40;
      for (const to of [1, 0, 1]) {
        const samples = []; fxSelectImage(to); const t0 = performance.now();
        while (performance.now() - t0 < 3000) { samples.push(snap()); await sleep(50); }
        const fin = samples[samples.length - 1];
        const bad = samples.filter(s => s && fin && (Math.abs(s.cx - fin.cx) > 3 || Math.abs(s.cy - fin.cy) > 3 || Math.abs(s.w - fin.w) > 3 || Math.abs(s.h - fin.h) > 3) && Math.abs(s.ar - fin.ar) < 0.05);
        out.push({ borders, to, n: samples.length, transient: bad.length, first: bad[0] || null, fin });
      }
    }
    return out;
  });
  let bad = 0;
  for (const r of res) { const f = r.transient > 0; if (f) bad++; console.log(`${f ? 'FAIL' : 'ok  '} | photo switch ${r.borders ? 'border' : 'plain '} -> ${r.to ? 'portrait ' : 'landscape'} | transient frames ${r.transient}/${r.n} ${f ? JSON.stringify(r.first) + ' final ' + JSON.stringify(r.fin) : ''}`); }
  ok = bad === 0; console.log(ok ? 'PASS photo switch steady' : 'FAIL photo switch transient');
} finally { await browser.close(); server.close(); if (!ok) process.exitCode = 1; }
