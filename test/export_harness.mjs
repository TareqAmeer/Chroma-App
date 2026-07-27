#!/usr/bin/env node
// Headless export gate harness for Chromasmith.
//
// Loads the REAL, unmodified chromasmith-22.html in a Playwright/Chromium page
// (served over plain http:// so RW2/COI script paths behave normally), drives it
// through the app's own snapshot API (getUISnapshot/applyUISnapshot) with a set of
// recipe JSON files against a set of fixture PNGs, and calls the app's own
// processToCanvas()/getFXParams() render path to produce PNG bytes — the same code
// path a real export uses, minus the save-file/share-sheet UI.
//
// Usage:
//   node test/export_harness.mjs            # renders into test/output/
//   node test/export_harness.mjs --golden   # renders into test/golden/ (regenerate goldens)
//
// Deterministic by construction: chromium is launched with the software (SwiftShader)
// GL/ANGLE backends so WebGL2 output doesn't depend on the host GPU driver, and every
// recipe/fixture pair is rendered with a fixed random seed override (see below) so grain/
// artifact placement (which chromasmith seeds from Math.random() at export time) is
// reproducible across runs.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const RECIPES_DIR = path.join(__dirname, 'recipes');
const GOLDEN = process.argv.includes('--golden');
const OUT_DIR = path.join(__dirname, GOLDEN ? 'golden' : 'output');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json',
  '.css': 'text/css', '.cube': 'text/plain' };

function startServer(root) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        let filePath = path.join(root, urlPath === '/' ? '/index.html' : urlPath);
        if (!filePath.startsWith(root)) { res.writeHead(403); res.end(); return; }
        const data = await readFile(filePath);
        const ext = path.extname(filePath);
        // COOP/COEP so crossOriginIsolated is true, matching the GitHub Pages COI-shim path
        // and letting the RAW/SharedArrayBuffer-adjacent code paths behave the same as prod.
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      } catch (e) {
        res.writeHead(404); res.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const fixtureFiles = (await readdir(FIXTURES_DIR)).filter(f => f.endsWith('.png')).sort();
  const recipeFiles = (await readdir(RECIPES_DIR)).filter(f => f.endsWith('.json')).sort();
  if (!fixtureFiles.length) throw new Error('No fixture PNGs found in test/fixtures/');
  if (!recipeFiles.length) throw new Error('No recipe JSONs found in test/recipes/');

  console.log(`Fixtures: ${fixtureFiles.join(', ')}`);
  console.log(`Recipes:  ${recipeFiles.join(', ')}`);
  console.log(`Output:   ${path.relative(ROOT, OUT_DIR)}/`);

  const server = await startServer(ROOT);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({
    args: [
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--disable-gpu-sandbox',
      '--disable-dev-shm-usage',
      '--enable-unsafe-swiftshader', // chromium refuses --use-gl=swiftshader without this flag
    ],
  });

  const results = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
    page.on('console', (msg) => { if (msg.type() === 'error') console.error('  [console.error]', msg.text()); });

    // Determinism fix: the FX render pipeline calls Math.random() directly for the grain
    // uniform whenever processToCanvas()/render() isn't given an explicit opts.seed (see
    // `gl.uniform1f(ul('seed'),(opts&&opts.seed!=null)?opts.seed:Math.random()*100)` in
    // chromasmith-22.html) — the single-shot (non-tiled) render path used here never passes
    // one, so every render draws a fresh random grain placement by design (real film grain
    // is meant to differ export-to-export; there's no app-level "pin the grain seed" knob
    // the way there is for fxState.artSeed). For a reproducible regression harness we replace
    // Math.random with a small seeded LCG via addInitScript BEFORE the app's own script runs —
    // this only affects what happens inside this Playwright page, chromasmith-22.html on disk
    // is untouched. Reset once per page here (not per-render) so the SAME fixed sequence of
    // draws is consumed by fixtures/recipes in a fixed order — reproducible across separate
    // harness invocations (golden vs test) as long as the combo order is identical, which it
    // is (fixtures/recipes are both sorted before iterating).
    await page.addInitScript(() => {
      let s = 0xC0FFEE;
      Math.random = () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
      };
    });

    await page.goto(`${baseUrl}/chromasmith-22.html`, { waitUntil: 'load' });
    // Wait for the app's own init to finish — FX/getUISnapshot/loadFXImages are all defined
    // on window only after the main <script> body has executed.
    await page.waitForFunction(() => typeof window.getUISnapshot === 'function'
      && typeof window.applyUISnapshot === 'function'
      && typeof window.loadFXImages === 'function'
      && typeof window.processToCanvas === 'function'
      && typeof window.getFXParams === 'function', null, { timeout: 30000 });

    const crossOriginIsolated = await page.evaluate(() => window.crossOriginIsolated);
    console.log(`crossOriginIsolated: ${crossOriginIsolated}`);

    for (const fixtureFile of fixtureFiles) {
      const fixtureBytes = await readFile(path.join(FIXTURES_DIR, fixtureFile));
      const fixtureB64 = fixtureBytes.toString('base64');

      // Load the fixture into fxImages[] via the app's real File-drop path (loadFXImages),
      // same as a user dropping a PNG onto the page.
      await page.evaluate(async ({ name, b64 }) => {
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const file = new File([arr], name, { type: 'image/png' });
        await window.loadFXImages([file]);
      }, { name: fixtureFile, b64: fixtureB64 });

      // fxImages/fxState/fxCurIdx are page-script `let`/`const` globals, not `window.*`
      // properties (classic <script> top-level let/const doesn't attach to window) — but they
      // ARE visible to further page.evaluate calls in the same realm, same as devtools console.
      await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length > 0, null, { timeout: 15000 });

      for (const recipeFile of recipeFiles) {
        const recipeName = recipeFile.replace(/\.json$/, '');
        const recipe = JSON.parse(await readFile(path.join(RECIPES_DIR, recipeFile), 'utf8'));
        const outName = `${fixtureFile.replace(/\.png$/, '')}__${recipeName}.png`;
        const label = `${fixtureFile} x ${recipeName}`;
        process.stdout.write(`Rendering ${label} ... `);

        const pngB64 = await page.evaluate(async (snap) => {
          // Strip the informational-only field before feeding to the app's own applyUISnapshot,
          // which iterates known slider/toggle/select ids and ignores anything unrecognized —
          // but keep it out just to be tidy.
          const clean = { ...snap }; delete clean._desc;
          window.applyUISnapshot(clean);
          if (typeof window.fxUpdate === 'function') window.fxUpdate();
          // Let a frame settle so any deferred UI-triggered rebakes (HSL/curves) run before render.
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          // applyUISnapshot fires selectLUT()/selectPrint() as fire-and-forget async calls (it
          // doesn't await them) — wait for fxState.lut/fxState.print to actually reflect the
          // requested selection before rendering, or a look LUT recipe would silently render as
          // identity (the bug this comment documents having hit during harness development).
          const wantLut = clean.selects && clean.selects['sel-lut'];
          const wantPrint = clean.selects && clean.selects['sel-print'];
          const lutReady = () => (!wantLut ? !fxState.lut : !!fxState.lut);
          const printReady = () => (!wantPrint ? !fxState.print : fxState.print === wantPrint);
          const t0 = Date.now();
          while ((!lutReady() || !printReady()) && Date.now() - t0 < 5000) {
            await new Promise(r => setTimeout(r, 30));
          }

          const it = typeof curItem === 'function' ? curItem() : fxImages[fxCurIdx || 0];
          // Fixed artifact/grain seed so the render is reproducible across harness runs —
          // exportFX() normally draws a fresh Math.random() seed per export; pin it here.
          fxState.artSeed = 7.7;
          const P = window.getFXParams(it.adjustOverride || undefined);
          const src = window.geomCanvas ? window.geomCanvas(it) : it.img;
          const iw = src.naturalWidth || src.width, ih = src.naturalHeight || src.height;
          const canvas = await window.processToCanvas(P, src, iw, ih);
          const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png'));
          const buf = await blob.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let bin = '';
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          return btoa(bin);
        }, recipe);

        const outPath = path.join(OUT_DIR, outName);
        await writeFile(outPath, Buffer.from(pngB64, 'base64'));
        console.log(`ok (${path.relative(ROOT, outPath)})`);
        results.push(outName);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\nDone. Wrote ${results.length} PNG(s) to ${path.relative(ROOT, OUT_DIR)}/`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
