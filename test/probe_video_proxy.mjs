#!/usr/bin/env node
// Regression probe: preview-proxy for video (fxVideoProxyBuild). Asserts a short-GOP downscaled proxy is
// built, used for scrub/play seeks (correct frame luma), while the ORIGINAL sink stays what export reads.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.mp4': 'video/mp4', '.png': 'image/png', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try { const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]) === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]));
    const d = await readFile(p); res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.on('listening', r));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'] });
let fail = 0; const check = (l, c, d) => { if (c) console.log('  ok   ' + l); else { fail++; console.error('  FAIL ' + l + (d ? ' - ' + d : '')); } };
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('console', m => { if (['warning','error'].includes(m.type())) console.error('  [console]', m.text().slice(0,300)); });
  page.on('pageerror', e => console.error('  [pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.loadFXImages === 'function', null, { timeout: 30000 });
  const r = await page.evaluate(async () => {
    const blob = await (await fetch('/test/fixtures/video_tiny.mp4')).blob();
    await window.loadFXImages([new File([blob], 'video_tiny.mp4', { type: 'video/mp4' })]);
    await new Promise(r => setTimeout(r, 300));
    const it = curItem(); const out = {};
    out.hasBuild = typeof window.fxVideoProxyBuild === 'function';
    if (!out.hasBuild) return out;
    const orig = it._mbSampleSink;
    out.ok = await fxVideoProxyBuild(it, { force: true, long: 80, noCache: true });
    out.pvReady = !!it._pvSink; out.origKept = it._mbSampleSink === orig && it._pvSink !== orig;
    out.pvW = it._pvInfo && it._pvInfo.w; out.pvH = it._pvInfo && it._pvInfo.h;
    out.luma = {};
    for (const f of [0, 3, 6, 9]) { it._shownFrame = -1; await fxVideoSeekTo(it, f); out.luma[f] = it.img.getContext('2d').getImageData(80, 60, 1, 1).data[0]; }
    // cache round trip: rebuild from IndexedDB after dropping the in-memory proxy; must still decode
    const it2 = it; it2._pvSink = null; it2._pvTried = false;
    const ok1 = await fxVideoProxyBuild(it2, { force: true, long: 80 }); // writes cache
    it2._pvSink = null; const t0 = performance.now();
    const ok2 = await fxVideoProxyBuild(it2, { force: true, long: 80 }); // reads cache
    await new Promise(r => setTimeout(r, 1500));
    it2._shownFrame = -1; await fxVideoSeekTo(it2, 6);
    out.cache = { ok1, ok2, ms: performance.now() - t0, luma: it2.img.getContext('2d').getImageData(80, 60, 1, 1).data[0] };
    out.usedProxy = fxVideoPvSink(it) === it._pvSink;
    fxFullResPreviewToggle(); out.fullUsesOrig = fxVideoPvSink(it) === it._mbSampleSink; fxFullResPreviewToggle();
    return out;
  });
  check('fxVideoProxyBuild exists', r.hasBuild);
  if (r.hasBuild) {
    check('build resolved true', r.ok === true, String(r.ok));
    check('proxy sink ready, original sink untouched', r.pvReady && r.origKept);
    check('proxy downscaled to long edge 80', r.pvW === 80 && r.pvH === 60, `${r.pvW}x${r.pvH}`);
    for (const f of [0, 3, 6, 9]) check(`proxy frame ${f} luma ~= ${(f * 20) % 255}`, Math.abs(r.luma[f] - (f * 20) % 255) <= 14, String(r.luma[f]));
    check('proxy rebuilt from IndexedDB cache decodes frame 6', r.cache.ok1 && r.cache.ok2 && Math.abs(r.cache.luma - 120) <= 14, JSON.stringify(r.cache));
    check('preview uses proxy sink', r.usedProxy);
    check('Full-res preview falls back to original sink', r.fullUsesOrig);
  }
} finally { await browser.close(); server.close(); }
process.exit(fail ? 1 : 0);
