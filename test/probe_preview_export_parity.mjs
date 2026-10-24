#!/usr/bin/env node
// Preview vs export parity at Fit / 100% / 200% / 500% with Full res ON and "All FX" on.
// Metric A (no grain): mean abs diff between the on-screen photo pixels (screenshot of the preview) and the
// export render resampled to the same on-screen geometry. Metric B: high-frequency energy ratio preview/export.
// Env: FR=0 to test with Full res off, GRAIN=1 to keep grain, SHOTS=dir to keep screenshots, MAXDIFF to override.
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
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
  page.on('console', m => { if (/error/i.test(m.type())) console.log('[console.error]', m.text().slice(0, 200)); });
  if (process.env.CRISP) await page.addInitScript(() => { window.__fxCrispForce = true; });
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FX !== 'undefined' && FX.ok, null, { timeout: 30000 });
  await page.evaluate(async () => {
    const W = 4200, H = 2800, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#345'); gr.addColorStop(1, '#a86'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = '#000'; for (let x = 0; x < W; x += 60) g.fillRect(x, 0, 14, H);
    g.fillStyle = '#fff'; g.font = 'bold 420px sans-serif'; g.fillText('SHARP', 1100, 1500);
    g.fillStyle = '#fffbe0'; for (let i = 0; i < 60; i++) { g.beginPath(); g.arc(300 + (i * 977) % 3600, 200 + (i * 613) % 2400, 6 + (i % 5) * 4, 0, 7); g.fill(); }
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await loadFXImages([new File([blob], 'a.png', { type: 'image/png' })]);
    await new Promise(res => { const t = Date.now(); const p = () => fxImages.length || Date.now() - t > 30000 ? res() : setTimeout(p, 20); p(); });
  });
  await page.waitForTimeout(800);
  const FR = process.env.FR !== '0', GRAIN = process.env.GRAIN === '1';
  const info = await page.evaluate(async ([FR, GRAIN]) => {
    document.querySelectorAll('.cs-modal,#cs-modal-ov,[class*=cs-modal]').forEach(e => e.remove());
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    if (FR && !fxFullResPreview) fxFullResPreviewToggle();
    enableAll(); await sleep(1500);
    if (!GRAIN) { const t = document.getElementById('tg-grain'); if (t && t.classList.contains('on')) t.click(); }
    await sleep(1500);
    const P = getFXParams();
    return { grain: !!(P.grain && P.grain.enabled), hal: !!(P.halation && P.halation.enabled), bloom: !!(P.bloom && P.bloom.enabled), borders: !!P.bordersEnabled, frame: P.filmFrame && P.filmFrame.style, canvas: !!(P.canvas && P.canvas.enabled) };
  }, [FR, GRAIN]);
  console.log('recipe', JSON.stringify(info));
  // Export render (full res, no tiles) as an offscreen PNG data kept in page memory.
  await page.evaluate(async () => {
    const work = fxWork || fxImg, iw = work.naturalWidth || work.width, ih = work.naturalHeight || work.height;
    const P = getFXParams(); const cv = await processToCanvas(P, work, iw, ih);
    const t = document.createElement('canvas'); t.width = cv.width; t.height = cv.height; t.getContext('2d').drawImage(cv, 0, 0); window.__EXP = t; window.__EXPS = { iw, ih, w: t.width, h: t.height };
  });
  console.log('export', JSON.stringify(await page.evaluate(() => window.__EXPS)));
  const rows = [];
  for (const pct of [0, 100, 200, 500]) {
    await page.evaluate(async pct => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      _resetZoom(false); renderPreview(); await sleep(900);
      if (pct) { fxZoom = _fxPctToZoom(pct); _applyZoom(false); renderPreview(); await sleep(3500); }
    }, pct);
    const geo = await page.evaluate(() => {
      const bd = document.getElementById('fx-canvas-bd'), onBd = bd && bd.style.display !== 'none';
      const el = onBd ? bd : FX.cv, b = el.getBoundingClientRect(), M = (typeof _fxDisplayMap !== "undefined") ? _fxDisplayMap : null;
      const wr = document.getElementById('fx-wrap').getBoundingClientRect();
      // Photo rect on screen (device px == css px at dpr 1): the composed canvas inset by _fxDisplayMap, else the element.
      let ph = { x: b.x, y: b.y, w: b.width, h: b.height };
      if (onBd && M) { const k = b.width / el.width; ph = { x: b.x + M.offX * k, y: b.y + M.offY * k, w: M.w * k, h: M.h * k }; }
      return { onBd, bw: el.width, bcss: b.width, crop: !!window._fxCropShown || (typeof _fxCropShown !== 'undefined' && _fxCropShown), zoom: fxZoom, ph, wr: { x: wr.x, y: wr.y, w: wr.width, h: wr.height }, info: document.getElementById('fx-info').textContent };
    });
    // central 300x200 css-px window of the photo area that is visible inside fx-wrap
    const vx0 = Math.max(geo.ph.x, geo.wr.x), vy0 = Math.max(geo.ph.y, geo.wr.y), vx1 = Math.min(geo.ph.x + geo.ph.w, geo.wr.x + geo.wr.w), vy1 = Math.min(geo.ph.y + geo.ph.h, geo.wr.y + geo.wr.h);
    const cw = Math.min(300, vx1 - vx0), ch = Math.min(200, vy1 - vy0), cx = Math.round((vx0 + vx1) / 2 - cw / 2), cy = Math.round((vy0 + vy1) / 2 - ch / 2);
    const buf = await page.screenshot({ clip: { x: cx, y: cy, width: Math.round(cw), height: Math.round(ch) } });
    if (process.env.SHOTS) await writeFile(`${process.env.SHOTS}/parity_${pct}.png`, buf);
    const m = await page.evaluate(async ([b64, cx, cy, cw, ch, ph]) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const sc = document.createElement('canvas'); sc.width = Math.round(cw); sc.height = Math.round(ch); sc.getContext('2d').drawImage(img, 0, 0);
      const A = sc.getContext('2d').getImageData(0, 0, sc.width, sc.height).data;
      // matching export window: screen px -> fraction of photo -> export px
      const E = window.__EXP, PAD = 4, k = E.width / ph.w;
      const ex = (cx - ph.x) * k - PAD * k, ey = (cy - ph.y) * k - PAD * k, ew = (cw + 2 * PAD) * k, eh = (ch + 2 * PAD) * k;
      const ec = document.createElement('canvas'); ec.width = sc.width + 2 * PAD; ec.height = sc.height + 2 * PAD; const g = ec.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(E, ex, ey, ew, eh, 0, 0, ec.width, ec.height);
      const B = g.getImageData(0, 0, ec.width, ec.height).data, WB = ec.width, WA = sc.width, HA = sc.height;
      const L = (D, i) => 0.3 * D[i] + 0.59 * D[i + 1] + 0.11 * D[i + 2];
      // best alignment over +-PAD px shifts (sub-pixel placement of the screenshot window is not exact)
      let best = 1e9, bdx = 0, bdy = 0;
      for (let dy = -PAD; dy <= PAD; dy++) for (let dx = -PAD; dx <= PAD; dx++) { let d = 0, n = 0;
        for (let y = PAD; y < HA - PAD; y += 2) for (let x = PAD; x < WA - PAD; x += 2) { d += Math.abs(L(A, (y * WA + x) * 4) - L(B, ((y + PAD + dy) * WB + x + PAD + dx) * 4)); n++; }
        if (d / n < best) { best = d / n; bdx = dx; bdy = dy; } }
      let hfA = 0, hfB = 0, n2 = 0;
      for (let y = PAD; y < HA - PAD; y++) for (let x = PAD; x < WA - PAD; x++) { const i = (y * WA + x) * 4, j = ((y + PAD + bdy) * WB + x + PAD + bdx) * 4;
        hfA += Math.abs(4 * L(A, i) - L(A, i - 4) - L(A, i + 4) - L(A, i - WA * 4) - L(A, i + WA * 4));
        hfB += Math.abs(4 * L(B, j) - L(B, j - 4) - L(B, j + 4) - L(B, j - WB * 4) - L(B, j + WB * 4)); n2++; }
      const d = best, n = 1; hfA /= 1; hfB /= 1; const nn = n2; hfA = hfA / nn * n; hfB = hfB / nn * n;
      return { meanAbsDiff: +d.toFixed(2), shift: [bdx, bdy], hfPreview: +hfA.toFixed(2), hfExport: +hfB.toFixed(2), hfRatio: +(hfA / hfB).toFixed(3) };
    }, [buf.toString('base64'), cx, cy, cw, ch, geo.ph]);
    rows.push({ pct: pct || 'fit', ...m, bw: geo.bw, bcss: Math.round(geo.bcss), onBd: geo.onBd, crop: geo.crop, info: geo.info });
    console.log(JSON.stringify(rows[rows.length - 1]));
  }
  const maxDiff = +(process.env.MAXDIFF || 6);
  ok = rows.every(r => r.meanAbsDiff <= maxDiff);
  console.log(ok ? 'PASS' : 'FAIL: preview differs from export by more than ' + maxDiff + ' levels at: ' + rows.filter(r => r.meanAbsDiff > maxDiff).map(r => r.pct).join(','));
} finally { await browser.close(); server.close(); }
process.exit(ok ? 0 : 1);
