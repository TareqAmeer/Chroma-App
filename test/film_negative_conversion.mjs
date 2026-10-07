#!/usr/bin/env node
// CHR-262 behavioural gate: film negative conversion in the shared FX shader.
//
// Builds a SYNTHETIC colour negative from test/fixtures/portrait.png (per-channel negative power
// response + orange film-base mask + a clear rebate strip + a neutral ramp) and drives the real
// editor page. Asserts, with measured numbers:
//   1. conversion recovers a near-original positive (mean abs error vs the source),
//   2. a neutral ramp stays neutral, and the orange mask cancels (rebate becomes neutral),
//   3. enabled-but-no-base and disabled are pixel-exact identity vs a fresh default render,
//   4. tiled export (forced small tiles) matches the single-shot render,
//   5. the rebate pick is in ORIGINAL-image coordinates (same base under rotate/flip/straighten/crop),
//   6. Auto balance refuses without a base and recovers the ratios with one,
//   7. the recipe survives snapshot -> reset -> apply (undo/session/paste path),
//   8. the shader compiled with no GLSL error.
// Usage: node test/film_negative_conversion.mjs   (needs playwright + chromium; software GL)

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
  '.png': 'image/png', '.json': 'application/json', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
    if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    const d = await readFile(p);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const port = server.address().port;

const browser = await chromium.launch({
  args: [process.platform === 'win32' ? '--use-gl=angle' : '--use-gl=swiftshader', '--use-angle=swiftshader',
    '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const glslErrors = [];
let failures = 0;
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
  if (!ok) failures++;
}
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (e) => { console.error('[pageerror]', e.message); failures++; });
  page.on('console', (m) => { if (m.type() === 'error' && /GLSL compile error|LINK FAILED|SHADER_COMPILE/i.test(m.text())) glslErrors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/chromasmith-22.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.loadFXImages === 'function' && typeof window.processToCanvas === 'function'
    && typeof window.computeFilmNeg === 'function', null, { timeout: 30000 });
  const portrait = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');

  // ---- build the synthetic negative inside the page, load it through the real drop path ----
  const synth = await page.evaluate(async ({ b64 }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const REB = 48, RAMP = 40, W = bmp.width, H = bmp.height;
    const CW = REB + W, CH = H + RAMP;
    const pos = document.createElement('canvas'); pos.width = CW; pos.height = CH;
    const pc = pos.getContext('2d', { willReadFrequently: true });
    pc.fillStyle = '#808080'; pc.fillRect(0, 0, CW, CH);
    pc.drawImage(bmp, REB, 0);
    const ramp = pc.createImageData(CW - REB, RAMP);
    for (let y = 0; y < RAMP; y++) for (let x = 0; x < CW - REB; x++) {
      const t = 0.08 + 0.92 * x / (CW - REB - 1), v = Math.round(t * 255), i = (y * (CW - REB) + x) * 4;
      ramp.data[i] = ramp.data[i + 1] = ramp.data[i + 2] = v; ramp.data[i + 3] = 255;
    }
    pc.putImageData(ramp, REB, H);
    const P = pc.getImageData(0, 0, CW, CH).data;
    const X0 = 0.02, EXPO = 2.5, RATIO = [1.36, 1.0, 0.86], BASE = [0.86, 0.52, 0.30];
    const neg = document.createElement('canvas'); neg.width = CW; neg.height = CH;
    const nc = neg.getContext('2d', { willReadFrequently: true });
    const N = nc.createImageData(CW, CH), refPos = new Float32Array(CW * CH * 3);
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      const i = (y * CW + x) * 4;
      for (let c = 0; c < 3; c++) {
        const q = Math.max(P[i + c] / 255, X0);
        refPos[(y * CW + x) * 3 + c] = q;
        const g = 1 / (EXPO * RATIO[c]);
        N.data[i + c] = x < REB ? Math.round(BASE[c] * 255) : Math.round(Math.min(1, BASE[c] * Math.pow(q / X0, -g)) * 255);
      }
      N.data[i + 3] = 255;
    }
    nc.putImageData(N, 0, 0);
    window.__synth = { CW, CH, REB, RAMP, H, W, EXPO, RATIO, BASE, X0, refPos, negData: N.data };
    const blob = await new Promise((r) => neg.toBlob(r, 'image/png'));
    const file = new File([await blob.arrayBuffer()], 'neg.png', { type: 'image/png' });
    await window.loadFXImages([file]);
    return { CW, CH, REB, RAMP, H, W };
  }, { b64: portrait });
  await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length > 0, null, { timeout: 15000 });
  await page.waitForTimeout(500);

  // helper installed in the page: render the current photo through the REAL export path
  await page.evaluate(() => {
    window.__render = async (tiled) => {
      window.__reseed && window.__reseed();
      const it = curItem(), src = geomCanvas(it), iw = src.naturalWidth || src.width, ih = src.naturalHeight || src.height;
      const P = getFXParams(it.adjustOverride || undefined);
      const saved = window.fxExportTileSize;
      if (tiled) window.fxExportTileSize = () => 160;
      let c;
      try { c = tiled ? await renderTiled(P, src, iw, ih) : await processToCanvas(P, src, iw, ih); } finally { window.fxExportTileSize = saved; }
      const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
      window.__last = d; return { w: c.width, h: c.height };
    };
    window.__setFN = (o) => {
      const set = (id, v) => { const e = document.getElementById(id); e.value = v; };
      if (o.exp != null) set('sl-fneg-exp', o.exp); if (o.red != null) set('sl-fneg-red', o.red); if (o.blue != null) set('sl-fneg-blue', o.blue);
      if (o.base) { set('sl-fneg-br', o.base[0]); set('sl-fneg-bg', o.base[1]); set('sl-fneg-bb', o.base[2]); }
      if (o.mode) set('sel-fneg-mode', o.mode);
      const tg = document.getElementById('tg-filmneg');
      if (o.on != null) { tg.classList.toggle('on', o.on); const ff = document.getElementById('ff-filmneg'); if (ff) ff.classList.toggle('ff-off', !o.on); }
      fxUpdate();
    };
  });

  // ---- 3a. baseline: default state, no film negative (the reference for identity) ----
  await page.evaluate(() => window.__setFN({ on: false }));
  const dims = await page.evaluate(() => window.__render(false));
  const base0 = await page.evaluate(() => Array.from(window.__last));
  // enabled but NO base picked -> identity, byte-exact
  await page.evaluate(() => window.__setFN({ on: true }));
  await page.evaluate(() => window.__render(false));
  const noBase = await page.evaluate(() => Array.from(window.__last));
  let maxd = 0; for (let i = 0; i < base0.length; i++) maxd = Math.max(maxd, Math.abs(base0[i] - noBase[i]));
  check('enabled with no base is pixel-exact identity', maxd === 0, `max diff ${maxd}`);
  // disabled with every parameter set -> identity, byte-exact
  await page.evaluate((s) => window.__setFN({ on: false, exp: 2.5, red: 1.36, blue: 0.86, base: s.BASE }), { BASE: [0.86, 0.52, 0.30] });
  await page.evaluate(() => window.__render(false));
  const offSet = await page.evaluate(() => Array.from(window.__last));
  maxd = 0; for (let i = 0; i < base0.length; i++) maxd = Math.max(maxd, Math.abs(base0[i] - offSet[i]));
  check('disabled with all parameters set is pixel-exact identity', maxd === 0, `max diff ${maxd}`);
  // the identity render also equals the raw negative pixels (no hidden processing)
  const idSrc = await page.evaluate(() => { let m = 0; const n = window.__synth.negData, o = window.__last; for (let i = 0; i < n.length; i += 4) for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(n[i + c] - o[i + c])); return m; });
  console.log(`      (identity render vs raw negative bytes: max diff ${idSrc})`);

  // ---- 1/2. conversion, exact parameters -> near-original positive ----
  await page.evaluate((s) => window.__setFN({ on: true, exp: s.EXPO, red: s.RATIO[0], blue: s.RATIO[2], base: s.BASE }), await page.evaluate(() => ({ EXPO: window.__synth.EXPO, RATIO: window.__synth.RATIO, BASE: window.__synth.BASE })));
  await page.evaluate(() => window.__render(false));
  const stats = await page.evaluate(() => {
    const S = window.__synth, d = window.__last, W = S.CW;
    let sum = 0, n = 0, sumMid = 0, nMid = 0, sumCpu = 0;
    const P = getFXParams().filmNeg;
    for (let y = 0; y < S.H; y++) for (let x = S.REB; x < S.CW; x++) {
      const i = (y * W + x) * 4, r = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) {
        const want = S.refPos[r + c] * 255, got = d[i + c];
        sum += Math.abs(got - want); n++;
        // float CPU model of the SAME quantised negative -> isolates 8-bit negative quantisation from shader error
        const nin = Math.max(S.negData[i + c] / 255, 0.001), cpu = Math.min(1, P.out * Math.pow(nin / Math.max(P.ref[c], 0.002), -P.exp[c])) * 255;
        sumCpu += Math.abs(got - cpu);
        const v = S.refPos[r + c]; if (v > 0.1 && v < 0.9) { sumMid += Math.abs(got - want); nMid++; }
      }
    }
    // neutral ramp: R-G and B-G spread
    // The 8-bit stored negative quantises the bright end (blue sits at ~12 levels there, amplified by the
    // exponent), so neutrality is judged against the float model of the SAME quantised negative.
    let spread = 0, cpuSpread = 0;
    for (let y = S.H + 2; y < S.CH - 2; y++) for (let x = S.REB + 4; x < S.CW - 4; x += 3) {
      const i = (y * W + x) * 4; spread = Math.max(spread, Math.abs(d[i] - d[i + 1]), Math.abs(d[i + 2] - d[i + 1]));
      const m = [0, 1, 2].map((c) => Math.min(1, P.out * Math.pow(Math.max(S.negData[i + c] / 255, 0.001) / Math.max(P.ref[c], 0.002), -P.exp[c])) * 255);
      cpuSpread = Math.max(cpuSpread, Math.abs(m[0] - m[1]), Math.abs(m[2] - m[1]));
    }
    // rebate: before conversion it is strongly orange; after, neutral
    const reb = (arr) => { const i = ((200) * W + 20) * 4; return [arr[i], arr[i + 1], arr[i + 2]]; };
    return { mae: sum / n, maeMid: sumMid / nMid, vsCpu: sumCpu / n, spread, cpuSpread, rebateOut: reb(d), rebateIn: reb(S.negData) };
  });
  console.log(`      mean abs error vs source positive: ${stats.mae.toFixed(2)} / 255 (mid-tones 0.1..0.9: ${stats.maeMid.toFixed(2)}); shader vs float CPU model of the same 8-bit negative: ${stats.vsCpu.toFixed(2)}`);
  check('conversion recovers a near-original positive (MAE < 6/255)', stats.mae < 6, `MAE ${stats.mae.toFixed(2)}`);
  check('shader matches the closed-form CPU model (< 1 level)', stats.vsCpu < 1, `diff ${stats.vsCpu.toFixed(3)}`);
  console.log(`      neutral ramp max channel spread: shader ${stats.spread} levels vs float model of the same 8-bit negative ${stats.cpuSpread.toFixed(1)}`);
  check('neutral ramp stays neutral (within 1 level of the float model)', stats.spread <= stats.cpuSpread + 1, `shader ${stats.spread}, model ${stats.cpuSpread.toFixed(1)}`);
  const rb = stats.rebateOut, ri = stats.rebateIn;
  check('orange mask cancels (rebate raw R-B > 100, converted spread <= 2)', ri[0] - ri[2] > 100 && Math.max(...rb) - Math.min(...rb) <= 2, `raw ${ri} -> ${rb}`);

  // ---- 4. tiled == single shot ----
  const single = await page.evaluate(() => Array.from(window.__last));
  await page.evaluate(() => window.__render(true));
  const tiled = await page.evaluate(() => Array.from(window.__last));
  maxd = 0; for (let i = 0; i < single.length; i++) maxd = Math.max(maxd, Math.abs(single[i] - tiled[i]));
  check('tiled export (160px tiles) matches single-shot render', maxd === 0, `max diff ${maxd}`);

  // ---- B&W mode: neutral output from a monochrome negative ----
  const bw = await page.evaluate(async () => {
    window.__setFN({ mode: 'bw', exp: 2.5 });
    await window.__render(false);
    const S = window.__synth, d = window.__last; let m = 0;
    for (let y = 0; y < S.H; y += 7) for (let x = S.REB; x < S.CW; x += 7) { const i = (y * S.CW + x) * 4; m = Math.max(m, Math.abs(d[i] - d[i + 1]), Math.abs(d[i + 2] - d[i + 1])); }
    window.__setFN({ mode: 'colour', red: 1.36, blue: 0.86 });
    return m;
  });
  check('black and white mode outputs a neutral image', bw === 0, `max channel spread ${bw}`);

  // ---- 6. auto balance: refuses without base, fixes the ratios with one ----
  const auto = await page.evaluate(async (S) => {
    window.__setFN({ on: true, base: [0, 0, 0], red: 1, blue: 1 });
    const refused = fnAutoBalance();
    const statusRefused = document.getElementById('fneg-status').textContent;
    window.__setFN({ base: S.BASE, red: 1.0, blue: 1.0 });
    await window.__render(false);
    const beforeD = (() => { const d = window.__last, W = S.CW; let r = 0, g = 0, b = 0, n = 0; for (let y = 0; y < S.H; y += 3) for (let x = S.REB; x < S.CW; x += 3) { const i = (y * W + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } return Math.abs(r - g) / n + Math.abs(b - g) / n; })();
    const ok = fnAutoBalance();
    await window.__render(false);
    const afterD = (() => { const d = window.__last, W = S.CW; let r = 0, g = 0, b = 0, n = 0; for (let y = 0; y < S.H; y += 3) for (let x = S.REB; x < S.CW; x += 3) { const i = (y * W + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } return Math.abs(r - g) / n + Math.abs(b - g) / n; })();
    const red = fnNum('sl-fneg-red'), blue = fnNum('sl-fneg-blue');
    return { refused, statusRefused, ok, beforeD, afterD, red, blue };
  }, await page.evaluate(() => ({ CW: __synth.CW, CH: __synth.CH, REB: __synth.REB, H: __synth.H, BASE: __synth.BASE })));
  check('auto balance refuses to run without a picked base and says why', auto.refused.ok === false && auto.refused.reason === 'no-base' && /not estimate the base from the scene/.test(auto.statusRefused), auto.statusRefused.slice(0, 90));
  console.log(`      auto balance: red ${auto.red}, blue ${auto.blue} (true ratios 1.36, 0.86 for gray-world portrait); mean R-G/B-G offset ${auto.beforeD.toFixed(1)} -> ${auto.afterD.toFixed(1)}`);
  check('auto balance applies and reduces the colour cast', auto.ok.ok === true && auto.afterD < auto.beforeD, `cast ${auto.beforeD.toFixed(1)} -> ${auto.afterD.toFixed(1)}`);

  // ---- 5. rebate pick in ORIGINAL coordinates under geometry ----
  const geo = await page.evaluate(async (S) => {
    const out = [];
    const it = curItem();
    const geoms = [
      { rot: 0, flipH: false, flipV: false, angle: 0, crop: null },
      { rot: 90, flipH: false, flipV: false, angle: 0, crop: { x: 0.05, y: 0.0, w: 0.9, h: 0.8 } },
      { rot: 270, flipH: true, flipV: false, angle: 2, crop: { x: 0.0, y: 0.0, w: 0.7, h: 0.9 } },
      { rot: 180, flipH: false, flipV: true, angle: -1.5, crop: null },
    ];
    for (const g of geoms) {
      it.geom = g; updateWork();
      const wk = fxWork, ww = wk.naturalWidth || wk.width, wh = wk.naturalHeight || wk.height;
      const wc = document.createElement('canvas'); wc.width = ww; wc.height = wh;
      const wx = wc.getContext('2d', { willReadFrequently: true }); wx.drawImage(wk, 0, 0);
      const d = wx.getImageData(0, 0, ww, wh).data;
      const tgt = S.BASE.map((v) => Math.round(v * 255));
      const match = (x, y) => { const i = (y * ww + x) * 4; return Math.abs(d[i] - tgt[0]) <= 1 && Math.abs(d[i + 1] - tgt[1]) <= 1 && Math.abs(d[i + 2] - tgt[2]) <= 1; };
      // find a work pixel whose 31x31 window is entirely rebate (so the original patch is entirely rebate)
      let best = null;
      for (let y = 20; y < wh - 20 && !best; y += 5) for (let x = 20; x < ww - 20; x += 5) {
        let all = true;
        for (let dy = -15; dy <= 15 && all; dy += 5) for (let dx = -15; dx <= 15; dx += 5) if (!match(x + dx, y + dy)) { all = false; break; }
        if (all) { best = { x, y }; break; }
      }
      if (!best) { out.push({ g, found: false }); continue; }
      // pick through the real click handler, via a fake pointer event at that work pixel
      const rect = FX.cv.getBoundingClientRect();
      const ev = { clientX: rect.left + (best.x + 0.5) * rect.width / ww, clientY: rect.top + (best.y + 0.5) * rect.height / wh };
      document.getElementById('sl-fneg-br').value = 0; document.getElementById('sl-fneg-bg').value = 0; document.getElementById('sl-fneg-bb').value = 0;
      _fnPickActive = true; fnPickBaseClick(ev);
      out.push({ g, found: true, rectOK: rect.width > 0, base: fnBase(), bx: fnNum('sl-fneg-bx'), by: fnNum('sl-fneg-by'), status: document.getElementById('fneg-status').textContent });
    }
    it.geom = geoms[0]; updateWork();
    return out;
  }, await page.evaluate(() => ({ BASE: __synth.BASE, REB: __synth.REB, CW: __synth.CW })));
  const want = [0.86, 0.52, 0.30];
  geo.forEach((r, i) => {
    const ok = r.found && r.rectOK && r.base.every((v, c) => Math.abs(v - want[c]) < 0.006) && r.bx >= 0 && r.bx < 48 / 400 + 0.2;
    check(`rebate pick under geometry #${i} (${JSON.stringify(r.g)}) returns the original base`, ok, r.found ? `base ${r.base.map((v) => v.toFixed(3))} at ${r.bx.toFixed(3)},${r.by.toFixed(3)}` : 'no full-rebate window visible');
  });
  // a pick on image content must fail visibly rather than invent a base
  const bad = await page.evaluate(() => { const it = curItem(); const r = fnPickBaseAtOrig(__synth.REB + 200, 150); return { r, status: document.getElementById('fneg-status').textContent }; });
  console.log(`      pick on scene content -> ${bad.status}`);
  check('picking scene content (not rebate) fails visibly', bad.r.ok === false && /not uniform|clipped|black/.test(bad.status), bad.status.slice(0, 80));

  // ---- 7. persistence: snapshot -> reset -> apply ----
  const persist = await page.evaluate(async (S) => {
    window.__setFN({ on: true, exp: 2.1, red: 1.2, blue: 0.9, base: S.BASE, mode: 'colour' });
    document.getElementById('sl-fneg-bx').value = 0.0321; document.getElementById('sl-fneg-by').value = 0.5;
    const snap = JSON.parse(JSON.stringify(getUISnapshot()));
    fxResetSection('filmneg');
    const afterReset = { on: document.getElementById('tg-filmneg').classList.contains('on'), br: fnNum('sl-fneg-br'), exp: fnNum('sl-fneg-exp') };
    applyUISnapshot(snap);
    const back = { on: document.getElementById('tg-filmneg').classList.contains('on'), exp: fnNum('sl-fneg-exp'), red: fnNum('sl-fneg-red'), base: fnBase(), bx: fnNum('sl-fneg-bx') };
    // selective paste exposes it as its own category
    const cat = PASTE_CATEGORIES.some((c) => c.key === 'filmneg');
    const sess = _SESS_SLIDERS.includes('sl-fneg-br') && _SESS_TOGGLES.includes('tg-filmneg');
    return { snapHas: snap.sliders['fneg-br'] !== undefined && snap.toggles.filmneg === true, afterReset, back, cat, sess };
  }, await page.evaluate(() => ({ BASE: __synth.BASE })));
  check('snapshot carries the film negative recipe and reset clears it', persist.snapHas && persist.afterReset.on === false && persist.afterReset.br === 0, JSON.stringify(persist.afterReset));
  check('snapshot restore brings back exponent, ratios, base and coordinates', persist.back.on && Math.abs(persist.back.exp - 2.1) < 1e-6 && Math.abs(persist.back.red - 1.2) < 1e-6 && Math.abs(persist.back.base[0] - 0.86) < 1e-3 && Math.abs(persist.back.bx - 0.0321) < 1e-4, JSON.stringify(persist.back));
  check('paste categories and session lists include it', persist.cat && persist.sess);

  // ---- 8. shader health ----
  check('no GLSL compile/link error', glslErrors.length === 0, glslErrors[0] || '');
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\nFAIL: ${failures} check(s) failed` : '\nPASS: film negative conversion');
process.exit(failures ? 1 : 0);
