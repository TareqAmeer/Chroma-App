// node appfx.mjs <repo-root> — runs every base/*.png through the REAL Chromasmith app (chromasmith-22.html)
// with that frame's halation/grain settings from params.json, writing fx/*.png. Same render path as an export
// (applyUISnapshot -> getFXParams -> processToCanvas), as used by test/export_harness.mjs.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir, readdir} from 'node:fs/promises';
import {extname, resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir = dirname(fileURLToPath(import.meta.url)), repo = resolve(process.argv[2]);
const MIME = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.css': 'text/css', '.cube': 'text/plain'};
const server = createServer(async (q, r) => { try {
  const u = decodeURIComponent(q.url.split('?')[0]); const p = u.startsWith('/__frames/') ? join(dir, 'base', u.slice(10)) : join(repo, u);
  r.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); r.setHeader('Cross-Origin-Embedder-Policy', 'require-corp'); r.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  r.writeHead(200, {'Content-Type': MIME[extname(p)] || 'application/octet-stream'}); r.end(await readFile(p)); } catch { r.writeHead(404); r.end(); } }).listen(0, '127.0.0.1');
const params = JSON.parse(await readFile(join(dir, 'params.json'), 'utf8'));
const files = (await readdir(join(dir, 'base'))).filter(f => f.endsWith('.png')).sort();
await mkdir(join(dir, 'fx'), {recursive: true});
const browser = await chromium.launch({headless: true, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11']});
try {
  const page = await browser.newPage({viewport: {width: 1400, height: 1000}});
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  page.on('console', m => { if (m.type() === 'error' && /GLSL|LINK/.test(m.text())) console.error(m.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, {waitUntil: 'load'});
  await page.waitForFunction(() => typeof window.applyUISnapshot === 'function' && typeof window.processToCanvas === 'function' && typeof window.getFXParams === 'function', null, {timeout: 60000});
  // the app wants an image loaded before its FX state is fully live: load the first frame through the real drop path
  await page.evaluate(async (url) => { const b = await (await fetch(url)).blob(); await window.loadFXImages([new File([b], 'f.png', {type: 'image/png'})]); }, '/__frames/' + files[0]);
  await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length > 0, null, {timeout: 15000});
  for (const [i, f] of files.entries()) {
    const P = params[i];
    const b64 = await page.evaluate(async ({url, P, i}) => {
      window.applyUISnapshot({
        sliders: {'hal-a': String(P.hal), 'hal-r': String(P.rad), 'hal-p': '0', 'grain-a': '9', 'grain-sz': '18'},
        toggles: {hal: P.hal > 0, 'hal-noremjet': !!P.noremjet, 'hal-white': !!P.white, 'hal-extreme': false, grain: !!P.grain},
        selects: {'sel-lut': '', 'sel-print': '', 'sel-grain-fmt': '35mm'}, colors: {}});
      if (typeof window.fxUpdate === 'function') window.fxUpdate();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const img = new Image(); img.src = url; await img.decode();
      fxState.artSeed = 7.7;
      const canvas = await window.processToCanvas(window.getFXParams(), img, img.naturalWidth, img.naturalHeight);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      const bytes = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
      return btoa(s);
    }, {url: '/__frames/' + f, P, i});
    await writeFile(join(dir, 'fx', f), Buffer.from(b64, 'base64'));
    if (i % 48 === 0) console.log(`${i}/${files.length}`);
  }
} finally { await browser.close(); server.close(); }
console.log('done');
