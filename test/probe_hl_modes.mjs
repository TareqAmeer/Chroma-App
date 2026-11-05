#!/usr/bin/env node
// CHR-288 evidence probe: what does the browser LibRaw (libraw-wasm) decode do to clipped highlights
// under each `highlight` mode? Decodes each CC0 sample (test/fixtures/raw-samples, fetched by
// tools/scripts/fetch-raw-samples.mjs) half-size, in the DCP path's linear camera-RGB settings, with
// highlight = 0 (clip, the app's current default), 1 (unclip), 2 (blend), and reports per channel:
// maximum value, % of pixels at 65535, mean. Usage: node test/probe_hl_modes.mjs [file ...]
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let files = process.argv.slice(2);
if (!files.length) files = (await readdir(path.join(root, 'test/fixtures/raw-samples')).catch(() => [])).filter((f) => !f.startsWith('.'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    const f = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(root)) throw 0;
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Type', mime[path.extname(f)] || 'application/octet-stream');
    res.end(await readFile(f));
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const f of files) {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`);
    await page.waitForFunction(() => typeof getLibRaw === 'function', null, { timeout: 60000 });
    const r = await page.evaluate(async (rel) => {
      const LibRaw = await getLibRaw();
      const buf = new Uint8Array(await (await fetch('/test/fixtures/raw-samples/' + rel)).arrayBuffer());
      const out = {};
      for (const hl of [0, 1, 2]) {
        const raw = new LibRaw();
        await raw.open(buf.slice(), { halfSize: true, useCameraWb: true, outputColor: 0, outputBps: 16, gamm: [1, 1], noAutoBright: true, userQual: 3, userFlip: -1, highlight: hl });
        const m = await raw.metadata();
        const img = await raw.imageData();
        try { raw.worker.terminate(); } catch (_) {}
        const d = img.data, n = d.length / 3, mx = [0, 0, 0], at = [0, 0, 0], mean = [0, 0, 0];
        for (let i = 0; i < d.length; i += 3) for (let c = 0; c < 3; c++) { const v = d[i + c]; if (v > mx[c]) mx[c] = v; if (v >= 65535) at[c]++; mean[c] += v / n; }
        out['hl' + hl] = { max: mx, pctClip: at.map((x) => +(100 * x / n).toFixed(3)), mean: mean.map(Math.round) };
        if (hl === 0) out.metaKeys = Object.keys(m).filter((k) => /mul|max|black|white|sat/i.test(k)).map((k) => k + '=' + JSON.stringify(m[k])).join(' ');
      }
      return out;
    }, f).catch((e) => ({ error: String(e) }));
    console.log(f, JSON.stringify(r));
    await page.close();
  }
} finally { await browser.close(); server.close(); }
