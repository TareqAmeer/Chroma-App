// node bake13.mjs <appRoot> <libDir> [filterRegex]
// v13 renders through the REAL chromasmith-22.html (export_harness approach: applyUISnapshot, then
// processToCanvas(getFXParams(), img, w, h)). Multiple source photos, cropped inside any baked-in border,
// rendered at up to 2400 px so close-ups and the loupe show true pixels. Nothing is faked in post.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.argv[2]), LIB = path.resolve(process.argv[3]);
const only = process.argv[4] ? new RegExp(process.argv[4]) : null;
const OUT = path.join(here, 'bake13'); await mkdir(OUT, {recursive: true});
const MIME = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp'};
const server = createServer(async (q, r) => { try { const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  const d = await readFile(p); r.setHeader('Cross-Origin-Opener-Policy','same-origin'); r.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  r.writeHead(200, {'Content-Type': MIME[path.extname(p)] || 'application/octet-stream'}); r.end(d); } catch { if (!r.headersSent) r.writeHead(404); r.end(); } });
await new Promise(res => server.listen(0, '127.0.0.1', res));

const S = (o = {}) => ({sliders: o.sliders || {}, toggles: o.toggles || {}, selects: {'sel-lut': '', 'sel-print': '', ...(o.selects || {})}});
const lut = k => ({'sel-lut': 'p:' + k});
const FINAL_LOOK = 'a_beach_preset';
const G = a => ({grain: true, sl: {'grain-a': String(a), 'grain-sz': '3'}, sel: {'sel-grain-fmt': '65mm'}});
const H = a => ({hal: true, sl: {'hal-a': String(a), 'hal-r': '30', 'hal-p': '20'}});
const combo = (look, g, h) => S({selects: {...lut(look), ...(g ? G(g).sel : {})},
  toggles: {...(g != null ? {grain: true} : {}), ...(h != null ? {hal: true} : {})},
  sliders: {...(g != null ? G(g).sl : {}), ...(h != null ? H(h).sl : {})}});

const SRC = {
  beach: {file: path.join(ROOT, 'site/assets/story/main1-2400.webp'), crop: 0, width: 2400},
  pier: {file: path.join(LIB, 'lib13.webp'), crop: .035, width: 2400},
  train: {file: path.join(LIB, 'lib07.webp'), crop: .035, width: 1600},
  car: {file: path.join(LIB, 'lib22.webp'), crop: .035, width: 1600},
  lifebuoy: {file: path.join(LIB, 'lib12.webp'), crop: .035, width: 1600},
  dog: {file: path.join(LIB, 'lib01.webp'), crop: .035, width: 1600},
  // placeholder imagery, Unsplash License (see web/CREDITS.md)
  neon: {file: path.join(here, 'web/neon.jpg'), crop: 0, width: 2400},
  sunset: {file: path.join(here, 'web/sunset.jpg'), crop: 0, width: 1600},
};
const HOOK_LOOKS = ['kodachrome_64_radiance_iii', 'trix_400_polymax_grade_3', 'vision3_500t_2383', 'instax_color_fujiflex_new',
  'velvia_50_ilfochrome_m', 'eterna_bleach_bypass_composed', 'aerocolor_endura_premier', 'portra_400_endura_premier'];
const jobs = [['beach', 'raw', S()]];
for (const k of [...HOOK_LOOKS, FINAL_LOOK]) jobs.push(['beach', 'look_' + k, S({selects: lut(k)})]);
for (let i = 0; i <= 4; i++) jobs.push(['beach', 'grain_' + i, combo(FINAL_LOOK, 10 * i)]);       // 65mm, Amount 0..40
jobs.push(['beach', 'final', combo(FINAL_LOOK, 40, 100)]);                                          // + halation 100
jobs.push(['pier', 'pier_raw', S()]);
for (let i = 0; i <= 4; i++) jobs.push(['pier', 'pier_hal_' + i, combo('portra_400_endura_premier', null, 25 * i)]);
for (const [src, look] of [['train', 'kodachrome_64_radiance_iii'], ['car', 'vision3_500t_2383'], ['lifebuoy', 'trix_400_polymax_grade_3'], ['dog', 'instax_color_fujiflex_new']]) {
  jobs.push([src, src + '_raw', S()]); jobs.push([src, src + '_look', S({selects: lut(look)})]);
}

jobs.push(['neon', 'neon_raw', S()]);
for (let i = 0; i <= 4; i++) jobs.push(['neon', 'neon_hal_' + i, combo('vision3_500t_2383', null, 25 * i)]);
{ const x = combo('vision3_500t_2383', null, 100); x.toggles['hal-extreme'] = true; jobs.push(['neon', 'neon_hal_x', x]);
  const w = combo('vision3_500t_2383', null, 100); w.toggles['hal-white'] = true; jobs.push(['neon', 'neon_hal_w', w]); }
jobs.push(['sunset', 'sunset_raw', S()]); jobs.push(['sunset', 'sunset_look', S({selects: lut('portra_400_endura_premier')})]);
const browser = await chromium.launch({args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11']});
try {
  const page = await browser.newPage({viewport: {width: 1400, height: 1000}});
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  page.on('console', x => { if (x.type() === 'error' && /GLSL|LINK/i.test(x.text())) console.error('[glsl]', x.text()); });
  await page.addInitScript(() => { let s = 0xC0FFEE; window.__reseed = () => { s = 0xC0FFEE; }; Math.random = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; });
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, {waitUntil: 'load'});
  await page.waitForFunction(() => typeof window.processToCanvas === 'function' && typeof window.loadFXImages === 'function', null, {timeout: 60000});
  let loaded = null;
  for (const [src, name, snap] of jobs) {
    if (only && !only.test(name)) continue;
    if (loaded !== src) {
      const {file, crop, width} = SRC[src];
      const b64 = (await readFile(file)).toString('base64');
      // crop inside the baked-in border and scale to the working width, then load through the app's own file path
      await page.evaluate(async ({b64, crop, width, n, file}) => {
        const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
        const bmp = await createImageBitmap(new Blob([a], {type: file.endsWith('.jpg') ? 'image/jpeg' : 'image/webp'}));
        const sx = bmp.width * crop, sy = bmp.height * crop, sw = bmp.width - 2 * sx, sh = bmp.height - 2 * sy;
        const w = Math.min(width, Math.round(sw)), h = Math.round(sh * w / sw);
        const c = new OffscreenCanvas(w, h); c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
        const blob = await c.convertToBlob({type: 'image/png'});
        if (typeof fxImages !== 'undefined') fxImages.length = 0;
        await window.loadFXImages([new File([blob], n + '.png', {type: 'image/png'})]);
      }, {b64, crop, width, n: src, file});
      await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length > 0, null, {timeout: 20000});
      loaded = src;
    }
    const png = await page.evaluate(async snap => {
      window.applyUISnapshot({...snap, colors: {}}); window.fxUpdate && window.fxUpdate();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const want = snap.selects['sel-lut'], t0 = Date.now();
      while ((want ? !fxState.lut : !!fxState.lut) && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 30));
      if (want ? !fxState.lut : !!fxState.lut) throw new Error('lut not settled ' + want);
      await new Promise(r => setTimeout(r, 200));
      const it = typeof curItem === 'function' ? curItem() : fxImages[fxImages.length - 1];
      fxState.artSeed = 7.7; window.__reseed();
      const src = window.geomCanvas ? window.geomCanvas(it) : it.img;
      const cv = await window.processToCanvas(window.getFXParams(it.adjustOverride || undefined), src, src.naturalWidth || src.width, src.naturalHeight || src.height);
      const b = await new Promise(r => cv.toBlob(r, 'image/png')); const u = new Uint8Array(await b.arrayBuffer());
      let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return [btoa(s), cv.width, cv.height];
    }, snap);
    await writeFile(path.join(OUT, name + '.png'), Buffer.from(png[0], 'base64')); console.log('ok', name, png[1] + 'x' + png[2]);
  }
} finally { await browser.close(); server.close(); }
