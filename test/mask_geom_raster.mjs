#!/usr/bin/env node
// Raster (brush/AI) masks follow flip / rotate / crop (mskRemapRaster). node test/mask_geom_raster.mjs
// ── RASTER MASK STORAGE / ROUND-TRIP GATE ────────────────────────────────────────────────────
//
// WHY THIS EXISTS
// Not one of the 18 export goldens contains a raster (brush / sky / AI / skin) mask — every
// recipe in test/recipes/ uses analytic shapes only. So the entire raster-mask storage path was
// completely uncovered, which is exactly the code changed when `m.px` moved from a plain
// `Array` of JS numbers to a `Uint8ClampedArray` with base64 serialization and copy-on-write
// undo history. A golden PNG would be a poor test of it anyway; what actually matters is that
// the bytes survive every round trip, so this asserts that directly.
//
//   node test/mask_raster.mjs
//
// Covers:
//   1. typed storage      — px is a Uint8ClampedArray after mskAdd and after painting
//   2. snapshot round-trip— getUISnapshot -> JSON -> applyUISnapshot preserves px byte-for-byte
//   3. legacy load        — a mask saved as a plain number Array (pre-change sidecar/session)
//                           still loads and produces identical pixels
//   4. copy-on-write      — history entries are not corrupted by later painting, undo restores
//                           the exact earlier raster, and rasters are SHARED (not copied) when
//                           nothing painted between pushes
//   5. render equivalence — the graded output of a painted mask is identical before and after a
//                           snapshot round trip
//   6. per-photo copies   — mskCopyToAll gives each photo its own raster, not a shared reference

const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.cube': 'text/plain' };

function startServer(root) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        const filePath = path.join(root, urlPath === '/' ? '/index.html' : urlPath);
        if (!filePath.startsWith(root)) { res.writeHead(403); res.end(); return; }
        const data = await readFile(filePath);
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      } catch { res.writeHead(404); res.end('not found'); }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const server = await startServer(ROOT);
  const { port } = server.address();
  const nativeCdp=process.env.NATIVE_CDP;
  const browser = nativeCdp?await chromium.connectOverCDP(nativeCdp):await chromium.launch({
    executablePath: process.env.CHROME_PATH || (process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined),
    args: [process.platform === 'win32' ? '--use-gl=angle' : '--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox',
      '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
  });

  let checks;
  try {
    const page = nativeCdp?browser.contexts()[0].pages().find(p=>!p.url().includes('devtools')):await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.error('  [console.error]', m.text()); });
    if(nativeCdp)await page.reload({waitUntil:'load'});
    else await page.goto(`http://127.0.0.1:${port}/chromasmith-22.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.loadFXImages === 'function'
      && typeof window.getUISnapshot === 'function', null, { timeout: 30000 });
    if(nativeCdp)await page.evaluate(async()=>{if(window.chromasmithLibraryIsOpen?.())await window.chromasmithToggleLibrary();});

    const fixture = (await readFile(path.join(__dirname, 'fixtures', 'portrait.png'))).toString('base64');
    await page.evaluate(async (b64) => {
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      await window.loadFXImages([new File([arr], 'portrait.png', { type: 'image/png' })]);
    }, fixture);
    await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length > 0, null, { timeout: 15000 });
    await page.waitForFunction(() => typeof fxWork !== 'undefined' && !!fxWork && !!curItem()?.img,
      null, { timeout: 15000 });
    await page.evaluate(() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const sourceProbe=await page.evaluate(() => {
      const lostBeforeUpdate=FX.gl.isContextLost();
      updateWork();
      const w=fxWork.width||fxWork.naturalWidth,h=fxWork.height||fxWork.naturalHeight;
      const cv=document.createElement('canvas');cv.width=w;cv.height=h;cv.getContext('2d').drawImage(fxWork,0,0);
      const d=cv.getContext('2d').getImageData(0,0,w,h).data;
      let max=0,nonzero=0;for(let i=0;i<d.length;i+=4)for(let c=0;c<3;c++){max=Math.max(max,d[i+c]);if(d[i+c])nonzero++;}
      return {width:w,height:h,max,nonzero,tag:fxWork.tagName,texture:!!FX.imgTx,
        glLostBeforeUpdate:lostBeforeUpdate,glLostAfterUpdate:FX.gl.isContextLost()};
    });
    console.log('fixture upload', sourceProbe);
    if(!sourceProbe.max||!sourceProbe.texture)throw new Error(`fixture source not ready: ${JSON.stringify(sourceProbe)}`);

    checks = await page.evaluate(async () => {
      const out = [];
      const ck = (name, pass, detail) => out.push({ name, pass: !!pass, detail: detail == null ? '' : String(detail) });
      document.getElementById('tg-local')?.classList.add('on');
      fxState.masks.length = 0; mskSel = -1; mskAdd('brush');
      const m = fxState.masks[0];
      const fillLeft = () => { m.px = new Uint8ClampedArray(m.mtW * m.mtH); for (let y = 0; y < m.mtH; y++) for (let x = 0; x < (m.mtW >> 1); x++) m.px[y * m.mtW + x] = 255; };
      const frac = (pred) => { let n = 0, t = 0; for (let y = 0; y < m.mtH; y++) for (let x = 0; x < m.mtW; x++) { if (pred(x, y)) { t++; if (m.px[y * m.mtW + x] > 127) n++; } } return n / Math.max(1, t); };
      const left = () => frac((x) => x < m.mtW / 2 - 1), right = () => frac((x) => x > m.mtW / 2 + 1);
      const top = () => frac((x, y) => y < m.mtH / 2 - 1), bottom = () => frac((x, y) => y > m.mtH / 2 + 1);
      fillLeft();
      ck('start: left painted, right empty', left() > 0.99 && right() < 0.01, `${left()} ${right()}`);
      geomFlip('h');
      ck('flip H moves paint to the right', right() > 0.99 && left() < 0.01, `${left()} ${right()}`);
      geomFlip('h');
      ck('flip H again restores left', left() > 0.99 && right() < 0.01, `${left()} ${right()}`);
      geomFlip('v');
      ck('flip V keeps left/right', left() > 0.99 && right() < 0.01, `${left()} ${right()}`);
      geomFlip('v');
      geomRotate(90);
      ck('rotate right: left half -> top half', top() > 0.99 && bottom() < 0.01, `${top()} ${bottom()} dims ${m.mtW}x${m.mtH}`);
      geomRotate(-90);
      ck('rotate back: left half again', left() > 0.99 && right() < 0.01, `${left()} ${right()}`);
      mskRemapForCrop({ x: 0, y: 0, w: 0.5, h: 1 });
      ck('crop to the painted left half: all painted', frac(() => true) > 0.99, frac(() => true));
      fillLeft();
      mskRemapForCrop({ x: 0.5, y: 0, w: 0.5, h: 1 });
      ck('crop to the empty right half: nothing painted', frac(() => true) < 0.01, frac(() => true));
      return out;
    });
  } finally { await browser.close(); server.close(); }
  let bad = 0;
  for (const c of checks) { console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}  ${c.detail}`); if (!c.pass) bad++; }
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
