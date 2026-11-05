#!/usr/bin/env node
// CHR-245 real-photo gate: red-eye correction on REAL flash photos, driven by a real mouse drag.
//
// Samples come from test/fixtures/public-samples.json (fetch first:
//   NODE_USE_ENV_PROXY=1 node tools/scripts/fetch-public-samples.mjs --ticket CHR-245).
// For every annotated eye the test drags an ellipse with page.mouse over the editor canvas (the
// real pointer handlers, not a seeded op), renders through the export path, and measures:
//   1. the drag created exactly one op centred on the eye,
//   2. pupil redness (R - max(G,B), over the red pixels) drops by >= 70 %,
//   3. pixels outside the dragged ellipse are byte-identical (skin, lids, glasses untouched),
//   4. non-red pixels inside the ellipse (iris, sclera, catchlight) move < 4 levels on average,
//   5. a photo with NO red-eye changes < 2 levels on average inside the ellipse,
//   6. tiled export matches the single-shot render, and no GLSL error.
// Missing samples -> SKIP (exit 0) with the fetch command, never a silent pass of checks.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = path.join(ROOT, 'test/fixtures/public-samples/redeye');
// Eye centres and drag half-size in ORIGINAL pixels (annotated by hand, refined to the red centroid).
const PHOTOS = [
  { file: 'two-boys.jpg', red: true, eyes: [[356, 330, 12], [429, 331, 12], [519, 254, 12], [586, 216, 12]] },
  { file: 'closeup.jpg', red: true, eyes: [[535, 646, 80], [1439, 646, 80]] },
  { file: 'small-pupils.jpg', red: true, eyes: [[246, 85, 14], [382, 90, 14]] },
  { file: 'no-redeye.jpg', red: false, eyes: [[343, 195, 12], [395, 195, 12]] },
];
for (const p of PHOTOS) {
  if (!(await stat(path.join(SAMPLES, p.file)).catch(() => null))) {
    console.log(`SKIP: ${p.file} missing. Run: NODE_USE_ENV_PROXY=1 node tools/scripts/fetch-public-samples.mjs --ticket CHR-245`);
    process.exit(0);
  }
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
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
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
let failures = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`); if (!ok) failures++; };
const glsl = [];
try {
  for (const photo of PHOTOS) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    page.on('pageerror', (e) => { console.error('[pageerror]', e.message); failures++; });
    page.on('console', (m) => { if (m.type() === 'error' && /GLSL compile error|LINK FAILED/i.test(m.text())) glsl.push(m.text()); });
    await page.goto(`http://127.0.0.1:${port}/chromasmith-22.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.loadFXImages === 'function' && typeof window.processToCanvas === 'function', null, { timeout: 30000 });
    const b64 = (await readFile(path.join(SAMPLES, photo.file))).toString('base64');
    await page.evaluate(async (b) => {
      const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
      await window.loadFXImages([new File([bytes], 'photo.jpg', { type: 'image/jpeg' })]);
    }, b64);
    await page.waitForFunction(() => typeof fxWork !== 'undefined' && fxWork && fxImages.length > 0, null, { timeout: 20000 });
    await page.waitForTimeout(800);
      await page.evaluate(() => {
        window.__render = async (tiled) => {
          window.__reseed && window.__reseed();
          const it = curItem(), src = geomCanvas(it), iw = src.naturalWidth || src.width, ih = src.naturalHeight || src.height;
          const P = getFXParams(it.adjustOverride || undefined), saved = window.fxExportTileSize;
          if (tiled) window.fxExportTileSize = () => 160;
          let c; try { c = tiled ? await renderTiled(P, src, iw, ih) : await processToCanvas(P, src, iw, ih); } finally { window.fxExportTileSize = saved; }
          return { w: c.width, h: c.height, d: Array.from(c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data) };
        };
      });
    const base = await page.evaluate(() => window.__render(false));
    await page.evaluate(() => { if (!redeyeMode) redeyeToggle(); });
    for (const [ex, ey, r] of photo.eyes) {
      // image px -> screen px via the displayed canvas rectangle (fit view, no geometry)
      const box = await page.evaluate(({ ex, ey, r }) => {
        const cv = document.getElementById('fx-canvas'), rc = cv.getBoundingClientRect();
        const W = fxWork.naturalWidth || fxWork.width, H = fxWork.naturalHeight || fxWork.height;
        return { x0: rc.left + (ex - r) / W * rc.width, y0: rc.top + (ey - r) / H * rc.height, x1: rc.left + (ex + r) / W * rc.width, y1: rc.top + (ey + r) / H * rc.height };
      }, { ex, ey, r });
      await page.mouse.move(box.x0, box.y0); await page.mouse.down();
      await page.mouse.move((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, { steps: 4 });
      await page.mouse.move(box.x1, box.y1, { steps: 4 }); await page.mouse.up();
    }
    const ops = await page.evaluate(() => (curItem().redeye || []).map((o) => ({ ...o })));
    const W = base.w, H = base.h;
    check(`${photo.file}: one dragged op per eye`, ops.length === photo.eyes.length, `${ops.length} ops for ${photo.eyes.length} eyes`);
    const centred = ops.every((o, i) => { const [ex, ey, r] = photo.eyes[i]; return Math.abs(o.x * W - ex) < r * 0.3 + 2 && Math.abs(o.y * H - ey) < r * 0.3 + 2; });
    check(`${photo.file}: drag ops are centred on the eyes`, centred, ops.map((o) => `${(o.x * W).toFixed(0)},${(o.y * H).toFixed(0)} r${(o.rx * W).toFixed(1)}`).join(' '));
    const after = await page.evaluate(() => window.__render(false));
    const inAny = (x, y) => ops.some((o) => { const dx = (x + 0.5 - o.x * W) / (o.rx * W), dy = (y + 0.5 - o.y * H) / (o.ry * H); return dx * dx + dy * dy < 1.0001; });
    let outsideMax = 0, redBefore = 0, redAfter = 0, nRed = 0, otherSum = 0, nOther = 0, allSum = 0, nAll = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, a = base.d, b = after.d;
      const diff = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      if (!inAny(x, y)) { outsideMax = Math.max(outsideMax, diff); continue; }
      const dsum = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
      allSum += dsum; nAll++;
      const isRed = a[i] > 100 && a[i] > 1.6 * a[i + 1] && a[i] > 1.4 * a[i + 2];
      if (isRed) { redBefore += a[i] - Math.max(a[i + 1], a[i + 2]); redAfter += Math.max(0, b[i] - Math.max(b[i + 1], b[i + 2])); nRed++; }
      else { otherSum += dsum; nOther++; }
    }
    check(`${photo.file}: pixels outside the ellipses are byte-identical`, outsideMax === 0, `max diff ${outsideMax}`);
    if (photo.red) {
      const drop = nRed ? 1 - redAfter / redBefore : 0;
      check(`${photo.file}: pupil redness drops >= 70 %`, nRed > 20 && drop >= 0.7, `${nRed} red px, redness ${(redBefore / Math.max(1, nRed)).toFixed(0)} -> ${(redAfter / Math.max(1, nRed)).toFixed(0)} (${(drop * 100).toFixed(0)} %)`);
      const m = otherSum / Math.max(1, nOther);
      check(`${photo.file}: iris/sclera/catchlight inside the ellipse barely move (< 4 levels)`, m < 4, `mean ${m.toFixed(2)} over ${nOther} non-red px`);
    } else {
      const m = allSum / Math.max(1, nAll);
      check(`${photo.file}: no-red-eye photo barely changes inside the ellipse (< 2 levels)`, m < 2, `mean ${m.toFixed(2)} over ${nAll} px, ${nRed} red px`);
    }
    const tiled = await page.evaluate(() => window.__render(true));
    let tmax = 0; for (let i = 0; i < tiled.d.length; i++) tmax = Math.max(tmax, Math.abs(tiled.d[i] - after.d[i]));
    check(`${photo.file}: tiled export matches single-shot`, tmax === 0, `max diff ${tmax}`);
    await page.close();
  }
  check('no GLSL compile/link error', glsl.length === 0, glsl[0] || '');
} finally { await browser.close(); server.close(); }
console.log(failures ? `\nFAIL: ${failures} check(s) failed` : '\nPASS: red-eye on real photos');
process.exit(failures ? 1 : 0);
