#!/usr/bin/env node
// Regression: mask overlays/pins/pointer input must map onto the photo at every zoom, incl. the
// full-res visible-crop render (fxZoom>1), where #fx-canvas is shrunk+translated to the visible crop.
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
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FX !== 'undefined' && FX.ok, null, { timeout: 30000 });
  const shot = process.env.SHOT_DIR || '';
  if (process.env.QUICK) await page.evaluate(() => { window.__QUICK = 1; });
  const res = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
    const g = c.getContext('2d'); g.fillStyle = '#222'; g.fillRect(0, 0, 3000, 2000); g.fillStyle = '#fff'; g.fillRect(1200, 800, 600, 400);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await loadFXImages([new File([blob], 'a.png', { type: 'image/png' })]);
    await new Promise(res => { const t = Date.now(); const p = () => fxImages.length || Date.now() - t > 30000 ? res() : setTimeout(p, 20); p(); });
    fxFullResPreview = true;
    fxState.masks = [{ id: 'r', type: 'radial', cx: .5, cy: .5, rx: .1, ry: .1, feather: .3, invert: false, lumLo: 0, lumHi: 1, exp: 1, con: 0, temp: 0, tint: 0, sat: 0, hue: 0, hi: 0, sh: 0, amount: 100, compositionMigrated: true }];
    mskSel = 0; mskShowPins = true;
    const out = [];
    const expected = () => { // independent ground truth: the canvas actually showing the full frame
      const bd = document.getElementById('fx-canvas-bd');
      if (_fxDisplayMap && bd && bd.style.display !== 'none') { const r = bd.getBoundingClientRect(), s = r.width / bd.width;
        return { left: r.left + _fxDisplayMap.offX * s, top: r.top + _fxDisplayMap.offY * s, width: _fxDisplayMap.w * s, height: _fxDisplayMap.h * s }; }
      const r = FX.cv.getBoundingClientRect(), v = window.__fxCrispView;
      if (_fxCropShown && v) { const W = r.width * v.iw / v.sw, H = r.height * v.ih / v.sh; // crisp crop shows source rect (sx,sy,sw,sh)
        return { left: r.left - v.sx / v.iw * W, top: r.top - v.sy / v.ih * H, width: W, height: H }; }
      return r;
    };
    for (const border of (window.__QUICK?[false]:[false, true])) {
      document.getElementById('tg-borders').classList.toggle('on', border);
      document.getElementById('sl-b1-t').value = border ? 6 : 0;
      for (const [pct, px, py] of (window.__QUICK?[[null,0,0]]:[[null, 0, 0], [100, 0, 0], [200, -300, -150], [150, 200, 120]])) {
        if (pct == null) _resetZoom(false); else { fxZoom = _fxPctToZoom(pct); fxPanX = px; fxPanY = py; _applyZoom(false); }
        renderPreview(); await sleep(900); mskOverlaySync(); await sleep(50);
        const e = expected(), ov = fxPhotoClientRect();
        const svgEl = document.getElementById('fx-mask-overlay'); fxPlacePhotoOverlay(svgEl); svgEl.style.display = 'block'; const svg = svgEl.getBoundingClientRect(); svgEl.style.display = '';
        const cvr = FX.cv.getBoundingClientRect();
        const cx = e.left + .3 * e.width, cy = e.top + .7 * e.height;
        const uv = _mskPointToUV({ clientX: cx, clientY: cy });
        const pin = document.querySelector('#msk-pin-layer .msk-pin'); const pr = pin && pin.getBoundingClientRect();
        out.push({ border, pct, crop: _fxCropShown, cvr: [cvr.left, cvr.top, cvr.width].map(Math.round), exp: [e.left, e.top, e.width, e.height].map(Math.round), ov: [ov.left, ov.top, ov.width, ov.height].map(Math.round), svg: [svg.left, svg.top, svg.width, svg.height].map(Math.round), fp: _fxZoomFootprint(), cvh: FX.cv.style.height, cvw: FX.cv.style.width, bdOn: !!_fxDisplayMap,
          dRect: Math.max(Math.abs(ov.left - e.left), Math.abs(ov.top - e.top), Math.abs(ov.width - e.width), Math.abs(ov.height - e.height)),
          dSvg: Math.max(Math.abs(svg.left - e.left), Math.abs(svg.top - e.top), Math.abs(svg.width - e.width), Math.abs(svg.height - e.height)),
          dUV: uv ? Math.max(Math.abs(uv.nx - .3), Math.abs(uv.ny - .7)) : 'null',
          pinOff: pr ? Math.hypot(pr.left + pr.width / 2 - (e.left + .5 * e.width), pr.top + pr.height / 2 - (e.top + .5 * e.height)) : null });
      }
    }
    return out;
  });
  let bad = 0;
  for (const r of res) { const fail = r.dRect > 1.5 || r.dSvg > 1.5 || r.dUV === 'null' || r.dUV > .005; if (fail) bad++; console.log(fail ? 'FAIL' : 'ok  ', JSON.stringify(r)); }
  if (errors.length) console.log('errors', errors);
  ok = bad === 0 && res.some(r => r.crop);
  console.log(ok ? 'PASS mask overlay zoom alignment' : `FAIL ${bad} misaligned (crop path exercised: ${res.some(r => r.crop)})`);
} finally { await browser.close(); server.close(); if (!ok) process.exitCode = 1; }
