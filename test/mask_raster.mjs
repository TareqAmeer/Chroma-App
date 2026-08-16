#!/usr/bin/env node
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

import { chromium } from 'playwright';
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
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox',
      '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
  });

  let checks;
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.error('  [console.error]', m.text()); });
    await page.goto(`http://127.0.0.1:${port}/chromasmith-22.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.loadFXImages === 'function'
      && typeof window.getUISnapshot === 'function', null, { timeout: 30000 });

    const fixture = (await readFile(path.join(__dirname, 'fixtures', 'portrait.png'))).toString('base64');
    await page.evaluate(async (b64) => {
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      await window.loadFXImages([new File([arr], 'portrait.png', { type: 'image/png' })]);
    }, fixture);
    await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length > 0, null, { timeout: 15000 });

    checks = await page.evaluate(async () => {
      const out = [];
      const ck = (name, pass, detail) => out.push({ name, pass: !!pass, detail: detail == null ? '' : String(detail) });
      const digest = (px) => { let h = 2166136261 >>> 0; for (let i = 0; i < px.length; i++) { h ^= px[i]; h = Math.imul(h, 16777619) >>> 0; } return h.toString(16); };
      const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
      const renderHash = () => {
        const P = getFXParams();
        FX.render(P, 128, 96, { glowScale: 1, seed: 3.25 });
        const { px } = FX.getPixels();
        return digest(px);
      };

      // ── setup: one brush mask with a deterministic painted pattern ──
      fxState.masks.length = 0; mskSel = -1;
      mskAdd('brush');
      const m = fxState.masks[0];
      m.exp = 40; m.sat = -30;                         // make the mask visibly affect the render
      const px = m.px;
      for (let i = 0; i < px.length; i++) px[i] = (i * 7 + ((i / m.mtW) | 0) * 3) & 255;
      _mskTexDirty = true;
      const original = Uint8ClampedArray.from(px);
      const origHash = digest(original);

      ck('1. px is a Uint8ClampedArray', px instanceof Uint8ClampedArray, px.constructor.name);
      ck('1. px length matches mtW*mtH', px.length === m.mtW * m.mtH, `${px.length} vs ${m.mtW * m.mtH}`);

      const renderBefore = renderHash();

      // ── 2. snapshot -> JSON -> apply round trip ──
      const snap = getUISnapshot();
      const wire = JSON.parse(JSON.stringify(snap));   // exactly what a sidecar/session stores
      ck('2. snapshot carries pxb64', typeof wire.masks[0].pxb64 === 'string' && wire.masks[0].pxb64.length > 0);
      ck('2. snapshot has no raw px', wire.masks[0].px === undefined);
      applyUISnapshot(wire);
      const after = fxState.masks[0].px;
      ck('2. px survives round trip byte-for-byte', same(original, after), `${origHash} vs ${digest(after)}`);
      ck('2. round-tripped px is typed', after instanceof Uint8ClampedArray, after.constructor.name);
      _mskTexDirty = true;
      ck('5. render identical after round trip', renderHash() === renderBefore);

      // ── 3. legacy plain-Array mask still loads ──
      const legacy = JSON.parse(JSON.stringify(wire));
      delete legacy.masks[0].pxb64;
      legacy.masks[0].px = Array.from(original);       // the pre-change on-disk shape
      applyUISnapshot(legacy);
      const fromLegacy = fxState.masks[0].px;
      ck('3. legacy Array px loads', fromLegacy instanceof Uint8ClampedArray, fromLegacy.constructor.name);
      ck('3. legacy px is byte-identical', same(original, fromLegacy));
      _mskTexDirty = true;
      ck('5. render identical from legacy form', renderHash() === renderBefore);

      // ── 4. copy-on-write + undo ──
      fxHistory = []; fxHistIdx = -1; _fxHistLocked = false;
      fxHistoryPush();                                  // entry 0 holds the current raster
      const e0 = fxHistory[0].rasters[0];
      ck('4. history holds the raster by reference', e0 === fxState.masks[0].px);

      fxState.artSeed = 1.5; fxHistoryPush();           // a non-paint edit
      ck('4. unpainted pushes SHARE one raster',
        fxHistory[1].rasters[0] === fxHistory[0].rasters[0]);

      const beforePaint = Uint8ClampedArray.from(fxState.masks[0].px);
      mskPaintAt(fxState.masks[0], 0.5, 0.5);           // now paint — must copy-on-write
      ck('4. painting does not mutate the history raster', same(beforePaint, fxHistory[1].rasters[0]));
      ck('4. painting swapped in a new array', fxState.masks[0].px !== fxHistory[1].rasters[0]);
      const painted = Uint8ClampedArray.from(fxState.masks[0].px);
      ck('4. paint actually changed pixels', !same(beforePaint, painted));

      fxHistoryPush();                                  // entry 2 = painted state
      ck('4. paint produced a new history entry', fxHistory.length === 3);
      // fxUndo/fxRedo became async (they now await applyUISnapshot's in-flight LUT-load promise
      // before _fxHistoryRestore reattaches the shared rasters) — an un-awaited call here reads
      // fxState.masks[0].px BEFORE the reattachment runs, so px is still undefined at that point
      // (the raster-less JSON restore hasn't had its raster put back yet). Not a flaky timing
      // window: it failed the same way on every run once fxUndo/fxRedo picked up their await.
      await fxUndo();
      ck('4. undo restores the pre-paint raster', same(beforePaint, fxState.masks[0].px), fxState.masks[0].px?digest(fxState.masks[0].px):'undefined');
      await fxRedo();
      ck('4. redo restores the painted raster', same(painted, fxState.masks[0].px));

      // ── 6. mskCopyToAll gives each photo its OWN raster ──
      if (fxImages.length === 1) {
        fxImages.push({ ...fxImages[0], masks: [] });   // a second photo, enough for the copy path
      }
      fxImages[fxCurIdx].masks = fxState.masks;
      mskCopyToAll();
      const other = fxImages.find((_, i) => i !== fxCurIdx);
      const copied = other && other.masks && other.masks[0];
      ck('6. copy-to-all copied the mask', !!copied && copied.px && copied.px.length === fxState.masks[0].px.length);
      ck('6. copied raster is a SEPARATE array', copied && copied.px !== fxState.masks[0].px);
      ck('6. copied raster is byte-identical', copied && same(fxState.masks[0].px, copied.px));

      return out;
    });
  } finally {
    await browser.close();
    server.close();
  }

  let fail = 0;
  console.log('\nraster mask storage / round-trip');
  console.log('-------------------------------------------------------------------------');
  for (const c of checks) {
    if (!c.pass) fail++;
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '   [' + c.detail + ']' : ''}`);
  }
  console.log('-------------------------------------------------------------------------');
  console.log(`${checks.length - fail}/${checks.length} PASS`);
  console.log(`\nRESULT: ${fail ? 'FAIL' : 'PASS'}`);
  return fail ? 1 : 0;
}

main().then(c => process.exit(c)).catch((e) => { console.error('FATAL:', e); process.exit(1); });
