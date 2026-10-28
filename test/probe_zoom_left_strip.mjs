#!/usr/bin/env node
// Regression: zoomed in at Full res, a full-height strip at the LEFT of the view stayed soft (the coarse
// underlay showing through) while the rest was crisp. _fxCropGeom computed the visible rect without
// #fx-zoom-wrap's flex-centring offset inside #fx-wrap (screen = offsetLeft + z·(x+translate)), so whenever
// the photo's fit footprint is narrower than the preview cell (portrait photos, wide windows) the crisp
// crop was shifted right by offsetLeft/z. Pad and 512px tile snapping sometimes hid it ("sometimes"); with
// big images on retina the pad shrinks to 0 and the strip showed.
// Check: the crop rect _fxCropGeom returns must contain the visible part of the photo measured from the
// real DOM rects (#fx-wrap ∩ #fx-zoom-wrap), at several zooms/pans, for portrait and landscape photos.
// CHROMASMITH_PAGE=<file> runs it against another copy of the app (used to prove red before the fix).
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = createServer(async (req, res) => {
  try {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname));
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
const page_ = process.env.CHROMASMITH_PAGE || 'chromasmith-22.html';
let fails = 0;
try {
  for (const [W, H, dpr, iw, ih] of [[1916, 1000, 2, 1200, 1800], [1916, 1000, 2, 1800, 1200], [1440, 900, 1, 1200, 1800]]) {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/${page_}?deskx=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FX !== 'undefined' && FX.ok, null, { timeout: 60000 });
    const rows = await page.evaluate(async ([iw, ih]) => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const c = document.createElement('canvas'); c.width = iw; c.height = ih; c.getContext('2d').fillRect(0, 0, 10, 10);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      await loadFXImages([new File([blob], 'a.png', { type: 'image/png' })]);
      await new Promise(res => { const t = Date.now(); const p = () => fxImages.length || Date.now() - t > 30000 ? res() : setTimeout(p, 20); p(); });
      fxFullResPreview = true; fxZoom = 2; fxPanX = 0; fxPanY = 0; _applyZoom(false); renderPreview(); await sleep(500);
      const wrap = document.getElementById('fx-wrap'), zw = document.getElementById('fx-zoom-wrap'), out = [];
      for (const z of [2, 3, 5, 8]) for (const pan of ['left', 'centre', 'right', 'top']) {
        fxZoom = z; fxPanX = 0; fxPanY = 0; _applyZoom(false, true); // noRender: geometry only
        const { w: cw, h: ch } = _fxZoomFootprint();
        const hx = Math.max(0, (cw - wrap.clientWidth / z) / 2), hy = Math.max(0, (ch - wrap.clientHeight / z) / 2);
        if (pan === 'left') fxPanX = hx; if (pan === 'right') fxPanX = -hx; if (pan === 'top') fxPanY = hy;
        _applyZoom(false, true);
        const g = _fxCropGeom(iw, ih, cw, ch), wr = wrap.getBoundingClientRect(), zr = zw.getBoundingClientRect();
        const vis = { l: (Math.max(wr.left, zr.left) - zr.left) / z, r: (Math.min(wr.right, zr.right) - zr.left) / z,
                      t: (Math.max(wr.top, zr.top) - zr.top) / z, b: (Math.min(wr.bottom, zr.bottom) - zr.top) / z };
        // Missing visible strip on each side, in SCREEN css px.
        const gap = g ? { l: (g.x0 - vis.l) * z, r: (vis.r - g.x1) * z, t: (g.y0 - vis.t) * z, b: (vis.b - g.y1) * z } : null;
        out.push({ z, pan, offL: zw.offsetLeft, gap: gap && Object.fromEntries(Object.entries(gap).map(([k, v]) => [k, Math.round(v)])) });
      }
      return out;
    }, [iw, ih]);
    for (const r of rows) {
      const bad = !r.gap || Object.values(r.gap).some(v => v > 1);
      if (bad) fails++;
      console.log(`${bad ? 'FAIL' : 'ok  '} ${W}x${H}@${dpr} ${iw}x${ih} z=${r.z} ${r.pan.padEnd(6)} offsetLeft=${r.offL} uncovered(screen px) ${JSON.stringify(r.gap)}`);
    }
    if (errs.length) { fails++; console.log('FAIL page errors: ' + errs.join('; ')); }
    await page.close();
  }
} finally { await browser.close(); server.close(); }
if (fails) { console.log(`FAIL ${fails} view(s): the crisp crop does not cover the visible photo (soft strip at the view edge)`); process.exitCode = 1; }
else console.log('PASS crisp crop covers the whole visible photo at every zoom/pan');
