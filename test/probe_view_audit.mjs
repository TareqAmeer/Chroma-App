#!/usr/bin/env node
// View/redraw audit: every action that must NOT move the photo, rescale it unexpectedly, redraw it needlessly
// or shift UI chrome. View-anchor rule: Fit stays fitted+centred in #fx-wrap; zoomed keeps the same image point
// under #fx-wrap's centre. Prints a table (action, state, moved px, renders actual/expected, UI shifted).
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 792 } }); page.on('console', m => { if (m.text().startsWith('MODAL')) console.log(m.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FX !== 'undefined' && FX.ok, null, { timeout: 30000 });
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
    const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 3000, 2000); gr.addColorStop(0, '#236'); gr.addColorStop(1, '#c84'); g.fillStyle = gr; g.fillRect(0, 0, 3000, 2000);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await loadFXImages([new File([blob], 'a.png', { type: 'image/png' })]);
    await new Promise(res => { const t = Date.now(); const p = () => fxImages.length || Date.now() - t > 30000 ? res() : setTimeout(p, 20); p(); });
    window.__rn = 0; window.__rfull = 0; const orig = FX.render.bind(FX);
    FX.render = function (...a) { if (!(a[3] && a[3].outFb)) { __rn++; if (a[1] * a[2] > 8e6) __rfull++; } return orig(...a); };
    window.__snap = () => {
      const w = document.getElementById('fx-wrap'), wr = w.getBoundingClientRect(), cs = getComputedStyle(w);
      const inner = { l: wr.left + parseFloat(cs.paddingLeft), t: wr.top + parseFloat(cs.paddingTop), r: wr.right - parseFloat(cs.paddingRight), b: wr.bottom - parseFloat(cs.paddingBottom) };
      const p = fxPhotoClientRect(); const cx = (inner.l + inner.r) / 2, cy = (inner.t + inner.b) / 2;
      const ui = {}; for (const sel of ['#fx-deskbar', '#fx-toolrail', '.fx-panel', '#fx-wrap', '#fx-deskbar-left', '#fx-deskbar-right', '#fx-zoom-pct', '#btn-fx-fullres']) { const e = document.querySelector(sel); if (e) { const r = e.getBoundingClientRect(); ui[sel] = [r.left, r.top, r.width, r.height].map(Math.round); } }
      return { dbg: [fxPanX.toFixed(1), fxPanY.toFixed(1), _fxCropShown, JSON.stringify(_fxZoomFootprint()), document.getElementById('fx-zoom-wrap').style.transform].join(' '), fit: Math.abs(fxZoom - FX_FIT) < 0.002, z: fxZoom, inner, p: p && { l: p.left, t: p.top, w: p.width, h: p.height }, nx: p && (cx - p.left) / p.width, ny: p && (cy - p.top) / p.height, ui, fw: _fxZoomFootprint().w, rn: __rn, rfull: __rfull };
    };
  });
  const sleep = ms => page.waitForTimeout(ms);
  const ev = (code, arg) => page.evaluate(code, arg);
  const rail = () => ev(() => { const m = document.getElementById('cs-modal-ov'); if (m && getComputedStyle(m).display !== 'none') console.log('MODAL ' + m.textContent.slice(0, 80)); const b = document.querySelector('#fx-toolrail .fx-rail-btn[data-sec="look"]'); b.click(); });
  // [name, run, expectedRenders, layoutChanges]
  const actions = [
    ['blur+focus', () => ev(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); }), 0, false],
    ['visibility', () => ev(() => { document.dispatchEvent(new Event('visibilitychange')); }), 0, false],
    ['resize-event(no size change)', () => ev(() => window.dispatchEvent(new Event('resize'))), 0, false],
    ['hover photo', async () => { await page.mouse.move(500, 400); await page.mouse.move(700, 450); }, 0, false],
    ['alt key tap (sharpen preview)', async () => { await page.keyboard.down('Alt'); await page.keyboard.up('Alt'); }, 3, false], // on + off, each may draft then settle
    ['fullres off+on', () => ev(async () => { fxFullResPreviewToggle(); await new Promise(r => setTimeout(r, 600)); fxFullResPreviewToggle(); }), 2, false],
    ['compare hold (\\)', () => ev(async () => { fxCompare = true; renderPreview(); await new Promise(r => setTimeout(r, 300)); fxCompare = false; renderPreview(); }), 2, false],
    ['panel close', rail, 1, true],
    ['panel open', rail, 1, true],
    ['window resize 1300x792', () => page.setViewportSize({ width: 1300, height: 792 }), 1, true],
    ['window resize back', () => page.setViewportSize({ width: 1440, height: 792 }), 1, true],
  ];
  const rows = []; let bad = 0;
  for (const borders of [false, true]) for (const zoomed of [false, true]) {
    const tag = (borders ? 'border ' : 'plain ') + (zoomed ? 'zoomed' : 'fit');
    if (process.env.AUDIT_ONLY && !process.env.AUDIT_ONLY.split(',').includes(tag)) continue;
    await ev(async ([b, z]) => {
      document.getElementById('tg-borders').classList.toggle('on', b); document.getElementById('sl-b1-t').value = 40;
      fxFullResPreview = true; if (z) { fxZoom = _fxPctToZoom(200); fxPanX = -150; fxPanY = -80; } else { fxZoom = FX_FIT; fxPanX = fxPanY = 0; }
      _applyZoom(false); renderPreview(); await new Promise(r => setTimeout(r, 1500));
    }, [borders, zoomed]);
    for (const [name, run, expR, layout] of actions) {
      const a = await ev(() => __snap()); await run(); await sleep(1300); const b = await ev(() => __snap());
      let moved;
      if (!a.p || !b.p) moved = 999;
      else if (!zoomed) { // Fit: same offset from the wrap centre and same photo/wrap size ratio as before
        const off = q => [(q.inner.l + q.inner.r) / 2 - (q.p.l + q.p.w / 2), (q.inner.t + q.inner.b) / 2 - (q.p.t + q.p.h / 2)];
        const oa = off(a), ob = off(b);
        moved = Math.max(Math.abs(oa[0] - ob[0]), Math.abs(oa[1] - ob[1]), Math.abs(b.p.w - a.p.w * b.fw / a.fw)); // size follows the footprint
      } else moved = Math.max(Math.abs(b.nx - a.nx) * b.p.w, Math.abs(b.ny - a.ny) * b.p.h, Math.abs(b.p.w / a.p.w - 1) * (layout ? 0 : b.p.w));
      const renders = b.rn - a.rn, full = b.rfull - a.rfull;
      const shifted = layout ? [] : Object.keys(a.ui).filter(k => JSON.stringify(a.ui[k]) !== JSON.stringify(b.ui[k]));
      const fail = moved > 3 || renders > expR || shifted.length > 0;
      if (fail) bad++;
      rows.push(`${fail ? 'FAIL' : 'ok  '} | ${(borders ? 'border ' : 'plain  ') + (zoomed ? 'zoomed' : 'fit   ')} | ${name.padEnd(30)} | moved ${moved.toFixed(1).padStart(6)}px | renders ${renders}/${expR} (full-res ${full}) | ui ${shifted.join(',') || '-'}${fail && process.env.AUDIT_DBG ? `\n      before ${a.dbg}\n      after  ${b.dbg}` : ''}`);
    }
  }
  console.log(rows.join('\n'));
  ok = bad === 0; console.log(ok ? 'PASS view audit' : `FAIL view audit (${bad} rows)`);
} finally { await browser.close(); server.close(); if (!ok) process.exitCode = 1; }

// Photo-switch rows (landscape<->portrait, borders off/on, sampled every 50ms for 3s): test/probe_photo_switch.mjs
if (!process.env.AUDIT_ONLY) await import('./probe_photo_switch.mjs');
