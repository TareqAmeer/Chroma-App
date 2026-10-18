#!/usr/bin/env node
// ── EDITOR ZOOM / TILE-CACHE EDGE CASES + GPU LEAK GATE ─────────────────────────────────────────
// The cached-1:1-tile zoom path (docs/render-pipeline.md "Full-res zoom = cached 1:1 tiles") must
// show EXACTLY what a cold render shows, in every state a user can reach while zoomed, and must
// never leave a stale tile behind after a recipe change.
//
//   node test/zoom_edge_cases.mjs
//
// Per scenario (mask, rotate+crop+flip, split, hold-to-compare, border frame, scene-linear "HDR"
// source, undo while zoomed, recipe change while zoomed):
//   WARM  the view as the app produced it (tiles/underlay cached, possibly from an earlier recipe)
//   COLD  the same view after dropping every cached tile and re-rendering from scratch
// WARM must equal COLD (99.9th-percentile 8-bit error <= 3: grain is a per-pixel hash of global uv,
// so a handful of isolated pixels may differ by float rounding, while a stale or misplaced tile
// moves whole areas). Where the tiled path is active the view is also checked against one direct
// crop render (the perf_bench approach). Last, a GL texture-count leak check over repeated
// open / zoom / pan / close cycles: idle pool bytes must stay under the pool cap and the number of
// live GL textures must stop growing.
//
// Runs on whatever GPU Chromium gives it (software is fine, just slower).

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_HTML = process.env.PERF_HTML || 'chromasmith-22.html';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json' };

const server = await new Promise((resolve) => {
  const s = createServer(async (req, res) => {
    try {
      const fp = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      const data = await readFile(fp);
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' }); res.end(data);
    } catch { res.writeHead(404); res.end('nf'); }
  });
  s.listen(0, '127.0.0.1', () => resolve(s));
});
const port = server.address().port;

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

let failed = 0;
const report = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };

try {
  const SCENARIOS = ['baseline', 'mask', 'geometry', 'split', 'compare', 'border', 'hdr', 'edits', 'leak'];
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
  for (const SC of SCENARIOS) {
  if (only && only !== SC) continue;
  // A fresh page per scenario: UI state (split, compare, matte, masks) must not leak between them.
  await page.goto(`http://127.0.0.1:${port}/${APP_HTML}?deskx=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.loadFXImages === 'function', null, { timeout: 30000 });
  const results = await page.evaluate(async (SC) => {
    const out = [];
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const W = 3600, H = 2400;
    const synth = (W, H) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#203050'); g.addColorStop(0.5, '#a08060'); g.addColorStop(1, '#304020');
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      for (let i = 0; i < 40; i++) {
        const cx = ((i * 7919) % 97) / 97 * W, cy = ((i * 104729) % 89) / 89 * H, r = W * (0.01 + (i % 5) * 0.006);
        const rg = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        rg.addColorStop(0, 'rgba(255,250,235,1)'); rg.addColorStop(1, 'rgba(255,250,235,0)');
        x.fillStyle = rg; x.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      }
      return c;
    };
    const toFile = (c, name) => new Promise(r => c.toBlob(b => r(new File([b], name, { type: 'image/png' })), 'image/png'));
    const file = await toFile(synth(W, H), 'edge.png');
    const gl = FX.gl;
    // Live-texture accounting for the leak check.
    let liveTex = 0; const cT = gl.createTexture.bind(gl), dT = gl.deleteTexture.bind(gl);
    gl.createTexture = () => { liveTex++; return cT(); };
    gl.deleteTexture = (t) => { if (t) liveTex--; return dT(t); };

    // Grain on for the tiled path (seeded, deterministic); the full-frame preview path seeds grain
    // randomly per render by design, so scenarios that use it compare with grain off.
    let grain = true;
    const fresh = async () => {
      await window.loadFXImages([file]); await sleep(300);
      fxFullResPreview = true;
      (grain ? ['tg-grain', 'tg-hal', 'tg-bloom'] : ['tg-hal', 'tg-bloom']).forEach(id => document.getElementById(id).classList.add('on'));
      fxUpdate(); await sleep(500);
    };
    // Pixels of whatever is on screen: the border/matte canvas when shown, else the WebGL canvas
    // (read synchronously after the render that drew it), plus the canvas geometry.
    const snap = () => {
      const bd = document.getElementById('fx-canvas-bd');
      const geo = [FX.cv.style.width, FX.cv.style.height, FX.cv.style.transform, FX.cv.width, FX.cv.height].join('|');
      if (bd && bd.style.display !== 'none' && bd.width) {
        const d = bd.getContext('2d').getImageData(0, 0, bd.width, bd.height).data;
        return { px: d, w: bd.width, h: bd.height, geo: 'bd|' + bd.style.width + '|' + bd.style.height, flip: false };
      }
      const w = FX.cv.width, h = FX.cv.height, px = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { px, w, h, geo, flip: true };
    };
    const diff = (a, b) => {
      if (a.w !== b.w || a.h !== b.h || a.geo !== b.geo) return { p999: 255, max: 255, why: `geometry ${a.w}x${a.h} ${a.geo} vs ${b.w}x${b.h} ${b.geo}` };
      const hist = new Uint32Array(256); let n = 0, max = 0;
      for (let y = 0; y < a.h; y += 2) for (let x = 0; x < a.w; x += 2) {
        const i = (y * a.w + x) * 4;
        for (let c = 0; c < 3; c++) { const d = Math.abs(a.px[i + c] - b.px[i + c]); hist[d]++; n++; if (d > max) max = d; }
      }
      let acc = 0, p = 0; for (let d = 0; d < 256; d++) { acc += hist[d]; if (acc >= n * 0.999) { p = d; break; } }
      return { p999: p, max, why: '' };
    };
    const coldRender = () => { fxInvalidateTiles(); _fxTilesClear(); fxInvalidateFullBase(); fxRenderPreviewViewOnly(); };
    const settle = async (ms = 900) => { await sleep(ms); };
    const zoomIn = async (z = 2.2) => { zoomSet(z); for (let i = 0; i < 100 && !window.__fxCrispView && !/translate/.test(FX.cv.style.transform || ''); i++) await sleep(20); await settle(); };
    const check = (name, warm, cold, extra) => {
      const d = diff(warm, cold);
      out.push({ name, ok: d.p999 <= 3, detail: `warm vs cold p99.9 err ${d.p999} (max ${d.max}) ${d.why}${extra || ''}` });
    };
    // Tile-mode view vs one direct render of the same region (as perf_bench).
    const directErr = () => {
      const v = window.__fxCrispView; if (!v) return null;
      const P = fxCompare ? fxCompareParams() : getFXParams();
      const shown = new Uint8Array(v.outW * v.outH * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, v.outW, v.outH, gl.RGBA, gl.UNSIGNED_BYTE, shown);
      const pad = v.refPad, sx = Math.max(0, v.sx - pad), sy = Math.max(0, v.sy - pad);
      const ex = Math.min(v.iw, v.sx + v.sw + pad), ey = Math.min(v.ih, v.sy + v.sh + pad);
      const crop = document.createElement('canvas'); crop.width = ex - sx; crop.height = ey - sy;
      crop.getContext('2d').drawImage(fxWork, sx, sy, ex - sx, ey - sy, 0, 0, ex - sx, ey - sy);
      const rw = Math.round((ex - sx) * v.s), rh = Math.round((ey - sy) * v.s);
      FX.pushTempImage(crop);
      FX.render(P, rw, rh, mskPreviewRenderOptions({ glowScale: 1, scOverride: v.iw / FXR.CAL.refWidth, seed: v.seed, gamutWarn: fxClipCode(),
        uvOff: [sx / v.iw, (v.ih - ey) / v.ih], uvScale: [(ex - sx) / v.iw, (ey - sy) / v.ih] }));
      FX.popTempImage();
      const ref = new Uint8Array(rw * rh * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, ref);
      const ox = Math.round((v.sx - sx) * v.s), oyBot = rh - Math.round((v.sy - sy) * v.s) - v.outH;
      const hist = new Uint32Array(256); let n = 0;
      for (let y = 0; y < v.outH; y += 3) for (let x = 0; x < v.outW; x += 3) {
        const a = (y * v.outW + x) * 4, b = ((y + oyBot) * rw + x + ox) * 4;
        for (let c = 0; c < 3; c++) { hist[Math.abs(shown[a + c] - ref[b + c])]++; n++; }
      }
      let acc = 0, p = 0; for (let d = 0; d < 256; d++) { acc += hist[d]; if (acc >= n * 0.999) { p = d; break; } }
      renderPreview(); // restore the on-screen frame
      return p;
    };
    const scenario = async (name, setup, opts = {}) => {
      await fresh();
      if (setup) await setup();
      await zoomIn(2.2);
      const tiled = !!window.__fxCrispView;
      const warm = snap();
      coldRender();
      const cold = snap();
      check(name, warm, cold, ` (tiled path ${tiled ? 'on' : 'off'})`);
      if (tiled && !opts.noDirect) {
        const e = directErr();
        out.push({ name: name + ' vs direct crop', ok: e <= 3, detail: `p99.9 err ${e}` });
      }
      // Pan, then the same warm/cold comparison (pan settle reuses cached tiles).
      fxPanX -= 260; fxPanY -= 120; _applyZoom(); fxRenderPreviewViewOnly(); await settle();
      const warm2 = snap(); coldRender(); const cold2 = snap();
      check(name + ' after pan', warm2, cold2, '');
      return { tiled };
    };

    // ── scenarios ──
    if (SC === 'baseline') await scenario('baseline');
    if (SC === 'mask') await scenario('mask active', async () => { fxState.masks.length = 0; mskSel = -1; const m = mskAdd('radial'); if (m) { m.exp = 1.2; } fxUpdate(); await sleep(400); });
    if (SC === 'geometry') await scenario('rotated + cropped + flipped', async () => {
      geomRotate(90); geomFlip('h');
      const g = curGeom(); g.crop = { x: 0.1, y: 0.15, w: 0.75, h: 0.7 }; updateWork(); renderPreview(); await sleep(400);
    });
    if (SC === 'split') { grain = false; await scenario('split view', async () => { toggleSplit(); await sleep(200); }, { noDirect: true }); }
    if (SC === 'compare') await scenario('hold-to-compare', async () => { fxCompare = true; renderPreview(); await sleep(300); });
    if (SC === 'border') {
      grain = false;
      await scenario('border frame', async () => { document.getElementById('tg-borders').classList.add('on'); fxUpdate(); await sleep(500); }, { noDirect: true });
      out.push({ name: 'border frame is actually shown', ok: document.getElementById('fx-canvas-bd').style.display !== 'none', detail: '' });
    }
    if (SC === 'hdr') {
      await scenario('scene-linear (HDR preview) source', async () => {
        window.chromasmithHdrPreview = true; fxWork._sceneLinearPresent = true; renderPreview(); await sleep(300);
      }, { noDirect: true });
      out.push({ name: 'HDR source falls back to the single-crop path', ok: !window.__fxCrispView, detail: '' });
    }

    // ── recipe change / undo while zoomed: no stale tile ──
    if (SC === 'edits') {
    await fresh(); await zoomIn(2.2);
    const before = snap();
    const sl = document.getElementById('sl-adj-exp');
    sl.value = '35'; sl.dispatchEvent(new Event('input', { bubbles: true })); await settle(1200);
    fxHistoryPush && fxHistoryPush();
    const after = snap();
    const moved = diff(before, after);
    out.push({ name: 'recipe change is visible while zoomed', ok: moved.p999 > 3, detail: `before vs after p99.9 err ${moved.p999}` });
    coldRender(); check('recipe change while zoomed (no stale tile)', after, snap(), '');
    await fxUndo(); await settle(1200);
    const undone = snap();
    coldRender(); check('undo while zoomed (no stale tile)', undone, snap(), '');
    const back = diff(before, undone);
    out.push({ name: 'undo restores the pre-edit zoomed view', ok: back.p999 <= 3, detail: `p99.9 err vs pre-edit ${back.p999}` });
    // Synchronous recipe change at an already-warm view: the very next frame must not use old tiles.
    sl.value = '-30'; sl.dispatchEvent(new Event('input', { bubbles: true }));
    _fxPreviewInteracting = false; renderPreview(); const sync1 = snap(); coldRender(); check('synchronous renderPreview after change', sync1, snap(), '');

    }
    // ── GPU leak: open / zoom / pan / close cycles ──
    if (SC === 'leak') {
    const cap = FX._bufPoolBudget();
    const live = [];
    for (let cycle = 0; cycle < 7; cycle++) {
      await window.loadFXImages([file]); await sleep(250);
      fxFullResPreview = true; fxUpdate(); await sleep(250);
      zoomSet(2.5); await sleep(700);
      for (let k = 0; k < 3; k++) { fxPanX -= 200; fxPanY -= 90; _applyZoom(); fxRenderPreviewViewOnly(); await sleep(250); }
      zoomFit(); await sleep(400);
      live.push({ tex: liveTex, idle: FX._bufStats().idleBytes, tiles: _fxTileCacheStats().bytes });
    }
    const last = live[live.length - 1], mid = live[2];
    out.push({ name: 'GL textures stop growing across open/zoom/pan/close', ok: last.tex <= mid.tex + 2, detail: `live textures per cycle ${live.map(l => l.tex).join(',')}` });
    out.push({ name: 'idle buffer pool within cap', ok: Math.max(...live.map(l => l.idle)) <= cap, detail: `max idle ${(Math.max(...live.map(l => l.idle)) / 1048576).toFixed(1)}MB, cap ${(cap / 1048576).toFixed(0)}MB` });
    out.push({ name: 'tile cache within budget', ok: Math.max(...live.map(l => l.tiles)) <= _fxTileBudget() + 64e6, detail: `max ${(Math.max(...live.map(l => l.tiles)) / 1048576).toFixed(1)}MB, budget ${(_fxTileBudget() / 1048576).toFixed(0)}MB` });
    // Low-memory cap behaviour: with the 48MB cap in force from the start, idle bytes stay under it.
    FXR.BUF_POOL_BYTES = 48e6; FX.releaseBufferPool();
    await window.loadFXImages([file]); await sleep(250); fxFullResPreview = true;
    for (const z of [1, 2.5, 1, 3, 1]) { zoomSet(z); await sleep(600); }
    out.push({ name: 'idle pool within the 48MB low-memory cap', ok: FX._bufStats().idleBytes <= 48e6, detail: `idle ${(FX._bufStats().idleBytes / 1048576).toFixed(1)}MB` });
    FXR.BUF_POOL_BYTES = null;
    }
    return out;
  }, SC);
  for (const r of results) report(r.name, r.ok, r.detail);
  }
} finally { await browser.close(); server.close(); }

if (errors.length) { failed++; console.log('FAIL  page errors:\n  ' + [...new Set(errors)].slice(0, 8).join('\n  ')); }
console.log(`\nRESULT: ${failed ? 'FAIL' : 'PASS'}`);
process.exit(failed ? 1 : 0);
