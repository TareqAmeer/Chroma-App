#!/usr/bin/env node
// CHR-288 / CHR-289 live gate: drives the real page (Chromium + SwiftShader) through the actual
// controls (Exposure & Tone > Advanced) and checks identity, effect, preview/export parity and
// tile exactness. Usage: node test/hl_drc_live.mjs
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const f = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(root)) throw 0;
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Content-Type', mime[path.extname(f)] || 'application/octet-stream');
    res.end(await readFile(f));
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'] });
let fails = 0;
const check = (name, ok, info = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; };
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const glsl = [];
  page.on('console', (m) => { if (m.type() === 'error') { const t = m.text(); console.error('  [console.error]', t); if (/GLSL|LINK FAILED|SHADER/i.test(t)) glsl.push(t); } });
  page.on('pageerror', (e) => { console.error('  [pageerror]', e.message); fails++; });
  await page.addInitScript(() => { let s = 0xC0FFEE; window.__reseed = () => { s = 0xC0FFEE; }; Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; });
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.loadFXImages === 'function' && typeof window.processToCanvas === 'function', null, { timeout: 30000 });

  // Fixture: 2200x1400. Left half a deep-shadow ramp, right half a bright ramp; a hard edge between them;
  // inside the bright half a clipped blob with a magenta cast (R,B at 255, G below) surrounded by warm hue.
  await page.evaluate(async () => {
    const W = 2200, H = 1400, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), id = g.createImageData(W, H), d = id.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = 4 * (y * W + x), t = x / W;
      let r, gg, b;
      if (x < W / 2) { const v = 6 + 40 * (y / H) + 10 * t; r = v; gg = v * 0.95; b = v * 0.9; }
      else { r = 150 + 60 * (y / H); gg = 130 + 50 * (y / H); b = 90 + 40 * (y / H); }
      const dx = x - 1650, dy = y - 700, rr = Math.sqrt(dx * dx + dy * dy);
      if (rr < 180) { r = 255; b = 255; gg = 225; }
      d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    await window.loadFXImages([new File([blob], 'hl_drc_fixture.png', { type: 'image/png' })]);
  });
  await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length > 0 && fxWork, null, { timeout: 20000 });

  const api = () => page.evaluate(() => {
    window.T = {
      set(id, v) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); },
      async render(tile) {
        const it = curItem();
        const P = getFXParams(it.adjustOverride || undefined);
        const base = geomCanvas(await fxHlItemFor(it, P));
        await new Promise((r) => setTimeout(r, 400)); // let any preview renders the control change queued finish before reseeding
        fxState.artSeed = 7.7; window.__reseed();
        const iw = base.width, ih = base.height;
        const old = window.shouldTile; window.shouldTile = () => !!tile;
        try {
          const out = await processToCanvas(P, base, iw, ih);
          const px = out.getContext('2d').getImageData(0, 0, out.width, out.height).data;
          return px;
        } finally { window.shouldTile = old; }
      },
    };
    window.T.sig = (px) => { let h = 2166136261; for (let i = 0; i < px.length; i += 7) h = Math.imul(h ^ px[i], 16777619); return (h >>> 0) + ':' + px.length; };
    window.T.mean = (px, x0, y0, x1, y1, W = 2200) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = 4 * (y * W + x); s += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]; n++; } return s / n; };
    return true;
  });
  await api();

  // ---- identity ----
  const base = await page.evaluate(async () => T.sig(await T.render(false)));
  await page.evaluate(() => { T.set('sl-adj-hl-mode', 0); T.set('sl-adj-drc-sh', 0); T.set('sl-adj-drc-hl', 0); });
  const base2 = await page.evaluate(async () => T.sig(await T.render(false)));
  check('exact-zero settings are byte-identical to untouched defaults', base === base2);
  const noWork = await page.evaluate(() => ({ drc: !!FX.drcTx, snap: !!FX._drcSnapshot, hlShown: _hlShownMode }));
  check('neutral path: no DRC texture, no HL stage', !noWork.drc && !noWork.snap && noWork.hlShown === null);

  // ---- fold is collapsed by default ----
  const fold = await page.evaluate(() => { const d = document.getElementById('fx-adv-adjust'); return { exists: !!d, open: d && d.open }; });
  check('Advanced fold exists and is collapsed by default', fold.exists && fold.open === false);

  // ---- DRC effect ----
  await page.evaluate(() => { T.set('sl-adj-drc-sh', 70); T.set('sl-adj-drc-hl', 40); });
  const drc = await page.evaluate(async () => {
    const base = await (async () => { T.set('sl-adj-drc-sh', 0); T.set('sl-adj-drc-hl', 0); return T.render(false); })();
    T.set('sl-adj-drc-sh', 70); T.set('sl-adj-drc-hl', 40);
    const a = await T.render(false);
    const shadowB = T.mean(base, 100, 100, 900, 1300), shadowA = T.mean(a, 100, 100, 900, 1300);
    const hiB = T.mean(base, 1300, 100, 2100, 400), hiA = T.mean(a, 1300, 100, 2100, 400);
    const midB = T.mean(base, 100, 100, 2100, 1300), midA = T.mean(a, 100, 100, 2100, 1300);
    const tiled = await T.render(true);
    let maxd = 0, sum = 0, n = 0; for (let i = 0; i < a.length; i += 4) { for (let c = 0; c < 3; c++) { const d = Math.abs(a[i + c] - tiled[i + c]); if (d > maxd) maxd = d; sum += d; n++; } }
    return { shadowB, shadowA, hiB, hiA, midB, midA, maxd, mean: sum / n, snap: !!FX._drcSnapshot };
  });
  check('DRC lifts shadows', drc.shadowA > drc.shadowB + 3, `${drc.shadowB.toFixed(1)} -> ${drc.shadowA.toFixed(1)}`);
  check('DRC compresses highlights', drc.hiA < drc.hiB - 1, `${drc.hiB.toFixed(1)} -> ${drc.hiA.toFixed(1)}`);
  check('DRC leaves global mean roughly in place', Math.abs(drc.midA - drc.midB) < 25, `${drc.midB.toFixed(1)} -> ${drc.midA.toFixed(1)}`);
  check('DRC tiled export == single-shot export (max channel diff <= 1)', drc.maxd <= 1, `max ${drc.maxd}, mean ${drc.mean.toFixed(4)}`);

  // ---- HL modes ----
  const hl = await page.evaluate(async () => {
    T.set('sl-adj-drc-sh', 0); T.set('sl-adj-drc-hl', 0);
    const out = {};
    const W = 2200;
    T.set('sl-adj-hl-mode', 0); const off = await T.render(false);
    for (const [k, m] of [['blend', 1], ['propagate', 2], ['opposed', 3]]) {
      T.set('sl-adj-hl-mode', m);
      const a = await T.render(false);
      const o = 4 * (700 * W + 1650 + 176); // 4 px inside the blob edge (the stage fades out beyond ~0.5% of the long edge from unclipped pixels)
      const far = 4 * (200 * W + 300);  // far shadow pixel
      let changedFar = 0, changedBlob = 0;
      for (let y = 0; y < 1400; y += 3) for (let x = 0; x < W; x += 3) { const q = 4 * (y * W + x); const d = Math.abs(a[q] - off[q]) + Math.abs(a[q + 1] - off[q + 1]) + Math.abs(a[q + 2] - off[q + 2]); const rr = Math.hypot(x - 1650, y - 700); if (d > 3) { if (rr < 260) changedBlob++; else changedFar++; } }
      out[k] = { centreOff: [off[o], off[o + 1], off[o + 2]], centre: [a[o], a[o + 1], a[o + 2]], changedFar, changedBlob, tiled: null };
      const t = await T.render(true);
      let maxd = 0; for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) { const d = Math.abs(a[i + c] - t[i + c]); if (d > maxd) maxd = d; }
      out[k].tiled = maxd;
      void far;
    }
    T.set('sl-adj-hl-mode', 0);
    const back = await T.render(false);
    out.backSig = T.sig(back); out.offSig = T.sig(off);
    return out;
  });
  for (const k of ['blend', 'propagate', 'opposed']) {
    const r = hl[k], spreadOff = Math.max(...r.centreOff) - Math.min(...r.centreOff), spread = Math.max(...r.centre) - Math.min(...r.centre);
    check(`HL ${k}: changes the clipped blob`, r.changedBlob > 0, `centre ${r.centreOff} -> ${r.centre}, ${r.changedBlob} px`);
    check(`HL ${k}: touches nothing away from the clipped region`, r.changedFar === 0, `${r.changedFar} far px changed`);
    check(`HL ${k}: tiled export == single-shot export`, r.tiled <= 1, `max ${r.tiled}`);
    void spread; void spreadOff;
  }
  check('HL blend reduces the magenta cast near the blob edge', Math.abs(hl.blend.centre[0] - hl.blend.centre[1]) < Math.abs(hl.blend.centreOff[0] - hl.blend.centreOff[1]), `${hl.blend.centreOff} -> ${hl.blend.centre}`);
  check('HL back to Off is byte-identical to the untouched render', hl.backSig === hl.offSig && hl.offSig === base);

  // ---- preview path uses the same reconstructed frame as export ----
  const prev = await page.evaluate(async () => {
    T.set('sl-adj-hl-mode', 2);
    const t0 = Date.now(); while (Date.now() - t0 < 15000) { const it = curItem(), e = _hlCache.get(it.img); if (e && e.mode === 'propagate' && e.out !== undefined && fxWork === e.out) break; await new Promise(r => setTimeout(r, 50)); }
    const it = curItem(), P = getFXParams(), srcItem = await fxHlItemFor(it, P);
    const same = fxWork === geomCanvas(srcItem);
    T.set('sl-adj-hl-mode', 0);
    await new Promise(r => setTimeout(r, 300));
    return { same, back: fxWork === it.img };
  });
  check('preview source (fxWork) is the same reconstructed canvas the export reads', prev.same);
  check('preview returns to the original source when HL is Off', prev.back);

  // ---- 1:1 loupe geometry: a cropped render with uvOff/uvScale matches the same crop of the full render ----
  const loupe = await page.evaluate(async () => {
    T.set('sl-adj-drc-sh', 70); T.set('sl-adj-drc-hl', 40);
    const it = curItem(), P = getFXParams(), src = geomCanvas(it), W = src.width, H = src.height;
    const full = await T.render(false);
    const sx = 900, sy = 300, rw = 700, rh = 500;
    const crop = document.createElement('canvas'); crop.width = rw; crop.height = rh; crop.getContext('2d').drawImage(src, sx, sy, rw, rh, 0, 0, rw, rh);
    FX.setImage(crop);
    FX.render(P, rw, rh, { glowScale: 1, scOverride: W / FXR.CAL.refWidth, seed: 3, uvOff: [sx / W, (H - (sy + rh)) / H], uvScale: [rw / W, rh / H] });
    const { px } = FX.getPixels();
    let maxd = 0; for (let y = 0; y < rh; y += 5) for (let x = 0; x < rw; x += 5) { const a = 4 * (y * rw + x), b = 4 * ((sy + y) * W + sx + x); for (let c = 0; c < 3; c++) { const d = Math.abs(px[a + c] - full[b + c]); if (d > maxd) maxd = d; } }
    updateWork(); T.set('sl-adj-drc-sh', 0); T.set('sl-adj-drc-hl', 0);
    return { maxd };
  });
  check('crop render (loupe/tile path) matches the full render with DRC on', loupe.maxd <= 1, `max ${loupe.maxd}`);

  // ---- recipe round trips ----
  const rt = await page.evaluate(() => {
    T.set('sl-adj-hl-mode', 3); T.set('sl-adj-drc-sh', 33); T.set('sl-adj-drc-hl', 22);
    const snap = JSON.parse(JSON.stringify(getUISnapshot()));
    T.set('sl-adj-hl-mode', 0); T.set('sl-adj-drc-sh', 0); T.set('sl-adj-drc-hl', 0);
    applyUISnapshot(snap);
    const v = [document.getElementById('sl-adj-hl-mode').value, document.getElementById('sl-adj-drc-sh').value, document.getElementById('sl-adj-drc-hl').value];
    const label = document.getElementById('vl-adj-hl-mode').textContent;
    const inSess = ['sl-adj-hl-mode', 'sl-adj-drc-sh', 'sl-adj-drc-hl'].every((i) => _SESS_SLIDERS.includes(i));
    const inLayout = CS_LAYOUT_KEYS.includes('chromasmith_fx_adv_open');
    const blk = computeAdjustBlock();
    T.set('sl-adj-hl-mode', 0); T.set('sl-adj-drc-sh', 0); T.set('sl-adj-drc-hl', 0);
    return { v, label, inSess, inLayout, blk: [blk.hlMode, blk.drc.shadows, blk.drc.highlights] };
  });
  check('snapshot (undo / copy-paste / sidecar) round-trips the three controls', rt.v.join() === '3,33,22' && rt.label === 'Opposed', rt.v.join() + ' ' + rt.label);
  check('session lists carry the controls; fold state key is in workspace layouts', rt.inSess && rt.inLayout);
  check('recipe block carries named parameters', rt.blk.join() === 'opposed,0.33,0.22', rt.blk.join());
  check('no GLSL compile errors', glsl.length === 0, glsl[0] || '');
} finally { await browser.close(); server.close(); }
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
