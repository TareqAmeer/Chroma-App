// node bake.mjs <appRoot> — renders the beach photo through the REAL chromasmith-22.html
// (export_harness approach: applyUISnapshot + processToCanvas(getFXParams(), img, w, h)).
// Every look / grain / halation frame in the film comes from here; nothing is faked in post.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.argv[2]);
const OUT = path.join(here, 'bake'); await mkdir(OUT, {recursive: true});
const MIME = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp'};
const server = createServer(async (q, r) => { try { const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  r.setHeader('Cross-Origin-Opener-Policy','same-origin'); r.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  r.writeHead(200, {'Content-Type': MIME[path.extname(p)] || 'application/octet-stream'}); r.end(await readFile(p)); } catch (e) { console.error("[404]", q.url); if (!r.headersSent) r.writeHead(404); r.end(); } });
await new Promise(res => server.listen(0, '127.0.0.1', res));
const LOOK = 'a_beach_preset';
const GA = process.env.GA || '40'; // grain amount (65mm is the finest, weakest format)
const base = {sliders: {}, toggles: {}, selects: {'sel-lut': '', 'sel-print': ''}};
const m = (a, b) => ({sliders: {...a.sliders, ...(b.sliders||{})}, toggles: {...a.toggles, ...(b.toggles||{})}, selects: {...a.selects, ...(b.selects||{})}});
const looked = m(base, {selects: {'sel-lut': 'p:' + LOOK}});
const lit = m(looked, {toggles: {adjust: true}, sliders: {'adj-exp': '12', 'adj-con': '10'}});
const grained = m(lit, {toggles: {grain: true}, sliders: {'grain-a': GA, 'grain-sz': '3'}, selects: {'sel-grain-fmt': '65mm'}});
const jobs = {raw: base};
for (const k of ['classic_neg', 'portra_400_endura_premier', 'velvia', 'eterna_bleach_bypass_composed', LOOK]) jobs['look_' + k] = m(base, {selects: {'sel-lut': 'p:' + k}});
for (let i = 0; i <= 6; i++) jobs['lightE_' + i] = m(looked, {toggles: {adjust: true}, sliders: {'adj-exp': String(2 * i), 'adj-con': '0'}});
for (let i = 0; i <= 5; i++) jobs['lightC_' + i] = m(looked, {toggles: {adjust: true}, sliders: {'adj-exp': '12', 'adj-con': String(2 * i)}});
for (let i = 0; i <= 6; i++) jobs['grain_' + i] = m(lit, {toggles: {grain: true}, sliders: {'grain-a': String(Math.round(+GA * i / 6)), 'grain-sz': '3'}, selects: {'sel-grain-fmt': '65mm'}});
for (let i = 0; i <= 6; i++) jobs['hal_' + i] = m(grained, {toggles: {hal: true}, sliders: {'hal-a': String(Math.round(100 * i / 6)), 'hal-r': '30', 'hal-p': '20'}});
const only = process.argv[3] ? new RegExp(process.argv[3]) : null;
const browser = await chromium.launch({args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11']});
try {
  const page = await browser.newPage({viewport: {width: 1400, height: 1000}});
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  page.on('console', x => { if (x.type() === 'error') console.error('[console.error]', x.text()); });
  await page.addInitScript(() => { let s = 0xC0FFEE; window.__reseed = () => { s = 0xC0FFEE; }; Math.random = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; });
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, {waitUntil: 'load'});
  await page.waitForFunction(() => typeof window.processToCanvas === 'function' && typeof window.loadFXImages === 'function', null, {timeout: 60000});
  const b64 = (await readFile(path.join(ROOT, 'site/assets/story/main1-1600.webp'))).toString('base64');
  await page.evaluate(async b64 => { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    await window.loadFXImages([new File([a], 'beach.webp', {type: 'image/webp'})]); }, b64);
  await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length > 0, null, {timeout: 20000});
  for (const [name, snap] of Object.entries(jobs)) {
    if (only && !only.test(name)) continue;
    const png = await page.evaluate(async snap => {
      window.applyUISnapshot({...snap, colors: {}}); window.fxUpdate && window.fxUpdate();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const want = snap.selects['sel-lut'], t0 = Date.now();
      while ((want ? !fxState.lut : !!fxState.lut) && Date.now() - t0 < 8000) await new Promise(r => setTimeout(r, 30));
      if (want ? !fxState.lut : !!fxState.lut) throw new Error('lut not settled ' + want);
      await new Promise(r => setTimeout(r, 150));
      const it = typeof curItem === 'function' ? curItem() : fxImages[0];
      fxState.artSeed = 7.7; window.__reseed();
      const src = window.geomCanvas ? window.geomCanvas(it) : it.img;
      const cv = await window.processToCanvas(window.getFXParams(it.adjustOverride || undefined), src, src.naturalWidth || src.width, src.naturalHeight || src.height);
      const b = await new Promise(r => cv.toBlob(r, 'image/png')); const u = new Uint8Array(await b.arrayBuffer());
      let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s);
    }, snap);
    await writeFile(path.join(OUT, name + '.png'), Buffer.from(png, 'base64')); console.log('ok', name);
  }
} finally { await browser.close(); server.close(); }
