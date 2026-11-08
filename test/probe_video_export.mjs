#!/usr/bin/env node
// Probe: video export through the REAL UI entry (exportFX), with audio, default settings.
// Usage: node test/probe_video_export.mjs <clip.mp4> [out.mp4]
// Fails loudly with the page's own error/log text if the export doesn't produce a file.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clip = process.argv[2], outPath = process.argv[3];
if (!clip) { console.error('usage: probe_video_export.mjs <clip> [out]'); process.exit(2); }
const clipBytes = await readFile(clip);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    if (u === '/__clip') { res.writeHead(200, { 'Content-Type': 'video/mp4' }); res.end(clipBytes); return; }
    const d = await readFile(path.join(ROOT, u === '/' ? '/index.html' : u));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); res.end(d);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'] });
let fail = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || /Video export|export|probe/i.test(m.text())) console.error('[console.' + m.type() + ']', m.text().slice(0, 300)); });
  await page.goto(`${base}/chromasmith-22.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.loadFXImages === 'function' && typeof window.videoSupported === 'function', null, { timeout: 30000 });
  const r = await page.evaluate(async () => {
    const b = await (await fetch('/__clip')).blob();
    const T = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT ' + what)), ms))]);
    console.log('[probe] loading');
    await T(window.loadFXImages([new File([b], 'clip.mp4', { type: 'video/mp4' })]), 60000, 'loadFXImages');
    console.log('[probe] loaded');
    await new Promise((r) => setTimeout(r, 1500));
    const it = curItem();
    const info = { kind: it && it.kind, w: it && it.img.width, h: it && it.img.height, hasAudio: !!(it && it._mbAudioTrack), btnDisabled: document.getElementById('btn-fx-export').disabled };
    let saved = null; window.saveFile = async (c, f) => { saved = { f, bytes: Array.from(new Uint8Array(await c.arrayBuffer ? await c.arrayBuffer() : c)) }; };
    let err = null; try { await T(exportFX(), 240000, 'exportFX'); } catch (e) { err = String(e && e.stack || e); }
    return { info, err, f: saved && saved.f, size: saved && saved.bytes.length, bytes: saved && saved.bytes };
  });
  console.log(JSON.stringify(r.info), 'size', r.size, 'err', r.err);
  if (r.err || !r.size || r.size < 1000) { fail++; console.error('FAIL: no usable export'); }
  else if (outPath) await writeFile(outPath, Buffer.from(r.bytes));
} finally { await browser.close(); server.close(); }
process.exit(fail ? 1 : 0);
