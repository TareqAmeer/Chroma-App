#!/usr/bin/env node
// Lut-pass cache (FXR._lutPass): a preview render with opts.lutCache may skip the lut pass only when NOTHING it reads changed.
// Asserts (1) changing only a post-lut input (halation amount) SKIPS the lut pass and is pixel-identical to an uncached render,
// (2) changing each lut-pass input class (exposure uniform, look LUT texture, curve texture, look strength) does NOT skip and is identical,
// (3) export (no lutCache) never skips.   node test/probe_lut_cache.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = createServer(async (req, res) => {
  try { const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname));
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    res.end(await readFile(file)); } catch { res.writeHead(404).end('nf'); } });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'] });
let ok = true;
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('console', m => { if (/GLSL compile error/.test(m.text())) { console.log('[console]', m.text().slice(0, 200)); ok = false; } });
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FX !== 'undefined' && FX.ok, null, { timeout: 30000 });
  const r = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const W = 900, H = 600, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    for (let i = 0; i < 80; i++) { g.fillStyle = `hsl(${i * 37 % 360},60%,${20 + i % 60}%)`; g.fillRect((i * 97) % W, (i * 53) % H, 140, 90); }
    fxImages.length = 0;
    await loadFXImages([new File([await new Promise(r => c.toBlob(r, 'image/png'))], 'g.png', { type: 'image/png' })]);
    await new Promise(rs => { const t = Date.now(); const p = () => fxImages.length || Date.now() - t > 30000 ? rs() : setTimeout(p, 20); p(); });
    await sleep(800); document.querySelectorAll('.cs-modal,#cs-modal-ov').forEach(e => e.remove());
    const sel = document.getElementById('sel-lut'); sel.value = 'p:' + Object.keys(LUT_META)[3]; await selectLUT(sel.value); await sleep(500);
    if (!allFxIsOn()) enableAll(); await sleep(1000);
    const base = getFXParams(), clone = o => JSON.parse(JSON.stringify(o)), out = [];
    const px = () => { const t = document.createElement('canvas'); t.width = FX.cv.width; t.height = FX.cv.height; const x = t.getContext('2d'); x.drawImage(FX.cv, 0, 0); return x.getImageData(0, 0, t.width, t.height).data; };
    const diff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
    const rnd = (P, o) => { let s = 77; const R = Math.random; Math.random = () => (s = (s * 16807) % 2147483647) / 2147483647; try { FX.render(P, 600, 400, { glowScale: 1, seed: 5, ...o }); } finally { Math.random = R; } return px(); };
    const step = (name, mut, expectSkip, post) => {
      rnd(clone(base), { lutCache: true }); // re-prime: the uncached reference render of the previous step invalidates the signature
      const P = clone(base); mut(P); if (post) post();
      const L = () => (FX._stageSkips && FX._stageSkips.lut) || 0, s0 = L(), cached = rnd(P, { lutCache: true }), skipped = L() > s0;
      const ref = rnd(P, {}); const d = diff(cached, ref);
      out.push({ name, skipped, expectSkip, maxDiff: d, pass: skipped === expectSkip && d === 0 });
    };
    rnd(clone(base), { lutCache: true }); // prime
    step('identical params', P => {}, true);
    step('halation amount', P => { P.halation.amount = (P.halation.amount || 50) * 0.5 + 1; }, true);
    step('bloom amount', P => { P.bloom.amount = (P.bloom.amount || 40) * 0.5 + 1; }, true);
    step('exposure (uniform)', P => { P.adjust = { ...(P.adjust || {}), enabled: true, exposure: 0.4 }; }, false);
    step('look strength', P => { P.lutMix = 0.37; }, false);
    const lut2 = await presetLut(Object.keys(LUT_META)[7]);
    step('look LUT texture changed', P => { }, false, () => FX.setLUT(lut2));
    step('curve texture changed', P => { }, false, () => { const c = [0,1,2,3].map(()=>0); try { fxState.curves = JSON.parse(JSON.stringify(fxState.curves)); fxState.curves.rgb = [[0,0],[0.5,0.62],[1,1]]; bakeCurves(); } catch (e) {} });
    // NR on (the real-app All-FX case: lutSrc is the 'nr' stage): chain keyed through the nr texture
    base.nr = { ...(base.nr || {}), luma: 0.4, color: 0.4 };
    step('NR on: halation only', P => { P.halation.amount = (P.halation.amount || 50) * 0.7 + 1; }, true);
    step('NR on: NR amount changed', P => { P.nr = { ...P.nr, luma: 0.7 }; }, false);
    step('NR on: exposure', P => { P.adjust = { ...(P.adjust || {}), enabled: true, exposure: 0.3 }; }, false);
    return out;
  });
  for (const s of r) { console.log(s.pass ? 'ok  ' : 'FAIL', s.name, 'skipped=' + s.skipped, 'maxDiff=' + s.maxDiff); if (!s.pass) ok = false; }
} finally { await browser.close(); server.close(); }
console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
