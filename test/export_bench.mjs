#!/usr/bin/env node
// Export speed bench: times synthetic 24MP and 45MP exports through the app's own
// processToCanvas -> fxEncodeExportCanvas path, split into render / readback / encode, with
// halation+bloom off and on, both un-tiled (desktop default below 80MP) and forced-tiled
// (what >80MP desktop and every phone export takes). Software GL (SwiftShader), so absolute
// numbers are CPU-GL; use it for before/after on the same machine, not as a GPU benchmark.
//   node test/export_bench.mjs [--quick] [--tiled-only]   # --quick: 24MP only
// Writes test/output/export_bench.json (gitignored). EXPORT_BENCH_HTML=<file> benches another copy.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const APP = process.env.EXPORT_BENCH_HTML || 'chromasmith-22.html';
const QUICK = process.argv.includes('--quick');
const TILED_ONLY = process.argv.includes('--tiled-only');   // skip the un-tiled cases (the ones tile changes cannot affect)
const SIZES = [['24MP', 6000, 4000], ...(QUICK ? [] : [['45MP', 8000, 5600]])];
const server = createServer(async (req, res) => {
  try {
    const file = path.resolve(ROOT, '.' + decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(ROOT + path.sep)) throw new Error('outside root');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/${APP}`);
  await page.waitForFunction(() => typeof processToCanvas === 'function' && typeof getFXParams === 'function' && typeof fxPrepareExportRenderer === 'function');
  const rows = [];
  for (const [label, W, H] of SIZES) for (const tiled of TILED_ONLY ? [true] : [false, true]) for (const glow of [false, true]) {
    const r = await page.evaluate(async ({ W, H, tiled, glow }) => {
      const src = document.createElement('canvas'); src.width = W; src.height = H;
      const x = src.getContext('2d'), g = x.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#0d3547'); g.addColorStop(.5, '#bc9778'); g.addColorStop(1, '#fff2d9');
      x.fillStyle = g; x.fillRect(0, 0, W, H); x.fillStyle = '#fff'; for (let i = 0; i < 60; i++) x.fillRect((i * 997) % W, (i * 577) % H, 120, 120);
      const renderer = fxPrepareExportRenderer(), P = structuredClone(getFXParams());
      P.grain.enabled = false; P.redEyeOps = []; P.adjust.enabled = true; P.adjust.exposure = .2;
      P.halation.enabled = P.bloom.enabled = glow;
      const T = { render: 0, readback: 0 }, restore = [];
      const wrap = (obj, name, key) => { const f = obj[name]; obj[name] = function (...a) { const t = performance.now(); const v = f.apply(this, a); T[key] += performance.now() - t; return v; }; restore.push(() => { obj[name] = f; }); };
      wrap(renderer, 'render', 'render'); wrap(renderer, 'getPixels', 'readback');
      const rf = window.fxReadExportTile; if (rf) { window.fxReadExportTile = function (...a) { const t = performance.now(); const v = rf.apply(this, a); T.readback += performance.now() - t; return v; }; restore.push(() => { window.fxReadExportTile = rf; }); }
      const st = shouldTile; if (tiled) shouldTile = () => true; else shouldTile = () => false;
      let tiles = 0;
      try {
        const t0 = performance.now();
        const c = await processToCanvas(P, src, W, H, (n) => { tiles = n; }, renderer);
        const tRender = performance.now() - t0, t1 = performance.now();
        const blob = await fxEncodeExportCanvas(c, 'image/jpeg', .92);
        const encode = performance.now() - t1;
        c.width = c.height = 0;
        return { process_ms: Math.round(tRender), render_ms: Math.round(T.render), readback_ms: Math.round(T.readback), other_ms: Math.round(tRender - T.render - T.readback), encode_ms: Math.round(encode), tiles, bytes: blob.size, total_ms: Math.round(tRender + encode) };
      } catch (e) { return { error: String(e && e.message || e) }; }
      finally { shouldTile = st; restore.forEach(f => f()); src.width = src.height = 0; }
    }, { W, H, tiled, glow });
    rows.push({ size: label, tiled, glow, ...r });
    console.log(JSON.stringify(rows.at(-1)));
  }
  console.log('\nsize  tiled glow | process render readback other(wait/copy) | encode | total | tiles');
  for (const r of rows) console.log(r.error ? `${r.size} ${r.tiled} ${r.glow} ERROR ${r.error}` :
    `${r.size.padEnd(5)} ${String(r.tiled).padEnd(5)} ${String(r.glow).padEnd(5)}| ${String(r.process_ms).padStart(7)} ${String(r.render_ms).padStart(7)} ${String(r.readback_ms).padStart(8)} ${String(r.other_ms).padStart(8)} | ${String(r.encode_ms).padStart(6)} | ${String(r.total_ms).padStart(6)} | ${r.tiles}`);
  const out = path.join(__dirname, 'output'); await mkdir(out, { recursive: true });
  const f = path.join(out, process.env.EXPORT_BENCH_OUT || 'export_bench.json');
  await writeFile(f, JSON.stringify({ app: APP, when: new Date().toISOString(), rows }, null, 2)); console.log('\nwrote', path.relative(ROOT, f));
} finally { await browser?.close(); server.close(); }
