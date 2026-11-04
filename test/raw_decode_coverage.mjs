#!/usr/bin/env node
// CHR-250: measure browser (LibRaw WASM) RAW decode coverage against the real CC0 camera samples
// in test/fixtures/raw-samples.json. Drives the app's own loadRw2() in Chromium on a COOP/COEP
// server (SharedArrayBuffer is required). Fetch the samples first:
//   NODE_USE_ENV_PROXY=1 node tools/scripts/fetch-raw-samples.mjs
// Usage: node test/raw_decode_coverage.mjs [--json out.json] [--half] [--only id,id] [--thumbs dir]
// Records per sample: suffix accepted by FMT_RAW_WEB, decode OK / error, output size, orientation,
// colour path taken (bundled DCP vs LibRaw sRGB fallback), decode time. It does NOT test the
// native Rust (rawler) desktop path. Exits 1 only if no sample file is present.
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const half = args.includes('--half');
const ji = args.indexOf('--json');
const ti = args.indexOf('--thumbs');
const thumbs = ti >= 0 ? args[ti + 1] : null;
const oi = args.indexOf('--only');
const only = oi >= 0 ? new Set(args[oi + 1].split(',')) : null;
const manifest = JSON.parse(await readFile(path.join(root, 'test/fixtures/raw-samples.json'), 'utf8'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const f = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname));
    if (!f.startsWith(root)) throw 0;
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Type', mime[path.extname(f)] || 'application/octet-stream');
    res.end(await readFile(f));
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'] });
const results = [];
let present = 0;
try {
  for (const s of manifest.samples) {
    if (only && !only.has(s.id)) continue;
    const rel = 'test/fixtures/raw-samples/' + s.file;
    const st = await stat(path.join(root, rel)).catch(() => null);
    if (!st) { results.push({ id: s.id, format: s.format, status: 'missing', error: 'sample not fetched' }); continue; }
    present++;
    // Fresh page per sample: a crashed/OOM worker or leaked wasm memory can't bleed into the next one.
    const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
    const logs = [];
    page.on('console', (m) => logs.push(m.text()));
    try {
      await page.goto(`http://127.0.0.1:${port}/chromasmith-22.html`, { waitUntil: 'load' });
      await page.waitForFunction(() => typeof loadRw2 === 'function' && typeof rawSharedMemoryOk === 'function', null, { timeout: 60000 });
      const r = await page.evaluate(async ({ rel, name, half, thumbs }) => {
        const ext = name.split('.').pop().toLowerCase();
        const out = { suffixAccepted: FMT_RAW_WEB.includes(ext), crossOriginIsolated, sharedMemoryOk: rawSharedMemoryOk() };
        const msgs = [];
        const origLog = window.log;
        if (typeof origLog === 'function') window.log = (m, k) => { msgs.push(String(m)); try { return origLog(m, k); } catch (_) {} };
        const buf = await (await fetch('/' + rel)).arrayBuffer();
        const file = new File([buf], name);
        const t0 = performance.now();
        try {
          const res = await loadRw2(file, half ? { half: true } : undefined);
          const m = res.meta || {};
          Object.assign(out, {
            ok: true, width: res.canvas.width, height: res.canvas.height, ms: Math.round(performance.now() - t0), decodeMs: res.ms,
            make: m.make, model: m.model, metaWidth: m.width, metaHeight: m.height,
            // libraw-wasm's metadata() exposes no flip/orientation field; LibRaw applies the EXIF
            // orientation itself (userFlip:-1). A 90/270 turn is visible as swapped dims vs metadata
            // width/height; a 180 turn is NOT detectable from here.
            orientation: res.canvas.width >= res.canvas.height ? 'landscape' : 'portrait',
            rotated90: m.width !== m.height && res.canvas.width === (half ? m.height >> 1 : m.height) && res.canvas.height === (half ? m.width >> 1 : m.width), iso: m.iso_speed,
            colourPath: msgs.find((x) => /colour profile|LibRaw sRGB/.test(x)) || 'bundled DCP / default',
          });
          // Cheap "is it a real picture" check: mean + spread of a downscaled copy.
          const c = document.createElement('canvas'); c.width = 64; c.height = Math.max(1, Math.round(64 * res.canvas.height / res.canvas.width));
          const g = c.getContext('2d'); g.drawImage(res.canvas, 0, 0, c.width, c.height);
          const d = g.getImageData(0, 0, c.width, c.height).data; let sum = 0, sq = 0, n = 0;
          for (let i = 0; i < d.length; i += 4) { const y = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += y; sq += y * y; n++; }
          out.meanLuma = +(sum / n).toFixed(1); out.stdLuma = +Math.sqrt(sq / n - (sum / n) ** 2).toFixed(1);
          if (thumbs) { const t = document.createElement('canvas'); t.width = 480; t.height = Math.round(480 * res.canvas.height / res.canvas.width); t.getContext('2d').drawImage(res.canvas, 0, 0, t.width, t.height); out.thumb = t.toDataURL('image/jpeg', 0.8); }
        } catch (e) {
          Object.assign(out, { ok: false, ms: Math.round(performance.now() - t0), error: String(e && e.message || e) });
        } finally { if (origLog) window.log = origLog; }
        return out;
      }, { rel, name: s.file, half, thumbs: !!thumbs });
      if (r.thumb) { await mkdir(thumbs, { recursive: true }); await writeFile(path.join(thumbs, s.id + '.jpg'), Buffer.from(r.thumb.split(',')[1], 'base64')); delete r.thumb; }
      results.push({ id: s.id, maker: s.maker, model: s.model, format: s.format, sizeMB: +(s.size / 1e6).toFixed(1), ...r });
    } catch (e) {
      results.push({ id: s.id, format: s.format, ok: false, error: 'probe failure: ' + String(e && e.message || e), consoleTail: logs.slice(-5) });
    } finally { await page.close().catch(() => {}); }
    const last = results[results.length - 1];
    console.log(`${last.ok ? 'OK  ' : 'FAIL'} ${s.format.padEnd(4)} ${(s.maker + ' ' + s.model).padEnd(42)} ${last.ok ? `${last.width}x${last.height} ${last.orientation}${last.rotated90 ? ' (rotated 90)' : ''} ${last.ms}ms  ${last.colourPath}` : last.error}`);
  }
} finally { await browser.close(); server.close(); }
const report = { generated: new Date().toISOString(), path: 'browser LibRaw WASM via loadRw2 (Chromium, Playwright)', mode: half ? 'half-size' : 'full-size', results };
if (ji >= 0) await writeFile(args[ji + 1], JSON.stringify(report, null, 2) + '\n');
console.log(`\n${results.filter((r) => r.ok).length}/${present} present samples decoded (${results.length - present} missing)`);
if (!present) { console.error('No RAW samples present - run tools/scripts/fetch-raw-samples.mjs first'); process.exit(1); }
