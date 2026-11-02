// Batch-export benchmark: the real exportFX pipeline (geometry → tiled WebGL render → borders/
// resample → encode → metadata splice → save) over N full-size photos, in headless Chromium on the
// machine's real GPU (ANGLE Metal on macOS — the same GPU path WKWebView's WebGL uses).
//
//   node test/export_bench.mjs                       # 10 synthetic 6000x4000 frames on WebKit, budget check
//   node test/export_bench.mjs --engine chromium     # same on Chromium + peak memory
//   node test/export_bench.mjs --n 2 --hashes        # per-photo pixel + encoded-byte hashes (identity check)
//   node test/export_bench.mjs --dir ~/Pictures/x    # real JPEGs instead (first --n files)
//   node test/export_bench.mjs --n 4 --json          # machine-readable result
//
// Per photo it records render / encode / splice(+other) time; overall it records total wall
// clock, the longest main-thread stall (a 16ms rAF heartbeat — what the user feels as "the app
// stopped responding"), and peak JS+ArrayBuffer memory (CDP) and peak RSS of every browser
// process. NOT covered (Chromium can't run them): the native RAW decode (decode_raw_v2,
// ~1.6-1.8 s per 24MP RW2 in the desktop log) and the native file write — those are stubbed.
// The look comes from test/fixtures/export_bench_recipe.json (a real edit: LUT, grain,
// halation + white glow, bloom, borders, colour NR, sharpening).
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const N = +arg('n', 10), W = +arg('w', 6000), H = +arg('h', 4000), DIR = arg('dir', ''), FMT = arg('fmt', 'jpg');
const JSON_OUT = process.argv.includes('--json');
// --engine webkit: Playwright's WebKit (same WebCore/JSC canvas + encode code as the desktop app's
// WKWebView — the closer stand-in for wall-clock and main-thread numbers; the default).
// --engine chromium also measures peak memory (CDP + process RSS; WebKit's processes are XPC
// services this script can't attribute, so its RSS reads as n/a).
const ENGINE = arg('engine', 'webkit');
// --hashes: seed Math.random and hash every rendered frame's pixels (pre-encode) — for proving a
// performance change left the output pixel-identical. Adds a readback per photo; don't time with it.
const HASHES = process.argv.includes('--hashes');
// Budgets (Intel Iris Plus 645 dev Mac, synthetic 6000x4000, bench recipe). Generous on purpose:
// they catch a regression of the kind fixed here, not run-to-run noise. Measured 2026-11-02, 10 photos:
//   webkit   before: 5.5-6.2 s/photo, UI blocked 91-94% of the export, longest stall 6.0-7.6 s
//            after (fence-polled GPU readback): 5.5 s/photo, UI blocked ~78%, longest stall 3.3-3.5 s
//            (tried + rejected: JPEG/PNG encode in a worker — blocked 48-58% but +1.6 s/photo)
//   chromium unchanged path: 4.2 s/photo, peak RSS ~1.5 GB flat over the batch
const BUDGET = { msPerPhoto: +arg('budget-ms', 9000), peakRssMB: +arg('budget-rss', 4500), maxStallMs: +arg('budget-stall', 5000), blockedFraction: +arg('budget-blocked', ENGINE === 'webkit' ? 0.86 : 1) };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.cube': 'text/plain', '.css': 'text/css' };
const server = await new Promise((r) => { const s = createServer(async (rq, rs) => { try { const p = path.join(ROOT, decodeURIComponent(rq.url.split('?')[0])); const d = await readFile(p); rs.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); rs.setHeader('Cross-Origin-Embedder-Policy', 'require-corp'); rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); rs.end(d); } catch { rs.writeHead(404); rs.end(); } }); s.listen(0, '127.0.0.1', () => r(s)); });
const gpuArgs = process.platform === 'darwin' ? ['--use-angle=metal'] : [];
// Persistent context with a private profile dir: every Chromium process carries that path on its
// command line, which is how the RSS sampler finds the whole browser process tree.
const profileDir = await mkdtemp(path.join(os.tmpdir(), 'cs-export-bench-'));
const ctx = ENGINE === 'webkit'
  ? await webkit.launchPersistentContext(profileDir, { viewport: { width: 1400, height: 900 } })
  : await chromium.launchPersistentContext(profileDir, { args: gpuArgs, viewport: { width: 1400, height: 900 } });
const br = { close: async () => { await ctx.close(); await rm(profileDir, { recursive: true, force: true }); } };
const pg = ctx.pages()[0] || await ctx.newPage();
pg.on('pageerror', (e) => console.error('[pageerror]', e.message));
pg.on('console', (m) => { if (m.type() === 'error') console.error('[console.error]', m.text().slice(0, 300)); });
const cdp = ENGINE === 'webkit' ? null : await ctx.newCDPSession(pg);
await pg.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof loadFXImages === 'function' && typeof exportFX === 'function', null, { timeout: 60000 });

// Inputs: real JPEGs from --dir, else deterministic synthetic frames (gradient + fine noise, so the
// encoder sees photo-like entropy rather than a flat field).
let inputs = null;
if (DIR) {
  const dir = DIR.replace(/^~/, process.env.HOME);
  const names = (await readdir(dir)).filter((f) => /\.jpe?g$/i.test(f)).sort().slice(0, N);
  inputs = await Promise.all(names.map(async (n) => ({ name: n, b64: (await readFile(path.join(dir, n))).toString('base64') })));
}
const recipe = JSON.parse(await readFile(path.join(ROOT, 'test/fixtures/export_bench_recipe.json'), 'utf8'));
await pg.evaluate(async ({ N, W, H, inputs, recipe, FMT }) => {
  let files;
  if (inputs) files = inputs.map((f) => new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: 'image/jpeg' }));
  else {
    files = [];
    for (let i = 0; i < N; i++) {
      const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, `hsl(${i * 37 % 360},45%,22%)`); g.addColorStop(1, `hsl(${(i * 37 + 140) % 360},55%,78%)`);
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      const n = x.createImageData(512, 512); let s = 1234 + i;
      for (let k = 0; k < n.data.length; k += 4) { s = (s * 1103515245 + 12345) >>> 0; const v = s >>> 24; n.data[k] = n.data[k + 1] = n.data[k + 2] = v; n.data[k + 3] = 28; }
      const t = document.createElement('canvas'); t.width = t.height = 512; t.getContext('2d').putImageData(n, 0, 0);
      x.fillStyle = x.createPattern(t, 'repeat'); x.fillRect(0, 0, W, H);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92)); c.width = c.height = 0;
      files.push(new File([blob], `BENCH_${String(i + 1).padStart(2, '0')}.jpg`, { type: 'image/jpeg' }));
    }
  }
  await loadFXImages(files);
  applyUISnapshot(recipe);
  for (const id of ['sel-exp-fmt', 'sel-exp-size', 'sel-exp-sharp', 'sel-exp-sr']) { const e = document.getElementById(id); if (e) e.value = id === 'sel-exp-fmt' ? FMT : '0'; }
  const q = document.getElementById('sl-exp-q'); if (q) q.value = 100;
  await new Promise((r) => setTimeout(r, 1500)); // let the look/LUT textures land
}, { N, W, H, inputs, recipe, FMT });

// Peak memory sampling: JS heap + ArrayBuffer backing (CDP) and RSS of every Chromium process.
const pidTree = () => { let out = []; try { out = execFileSync('pgrep', ['-f', profileDir]).toString().trim().split('\n').filter(Boolean).map(Number); } catch { return []; } for (let i = 0; i < out.length; i++) { try { for (const c of execFileSync('pgrep', ['-P', String(out[i])]).toString().trim().split('\n').filter(Boolean).map(Number)) if (!out.includes(c)) out.push(c); } catch {} } return out; };
let peakJs = 0, peakRss = 0, sampling = true;
const sampler = (async () => { while (sampling) { try { if (cdp) { const u = await cdp.send('Runtime.getHeapUsage'); peakJs = Math.max(peakJs, u.usedSize + (u.backingStorageSize || 0)); } const pids = pidTree(); if (pids.length) { const rss = execFileSync('ps', ['-o', 'rss=', '-p', pids.join(',')]).toString().trim().split('\n').reduce((a, b) => a + (+b || 0), 0) * 1024; peakRss = Math.max(peakRss, rss); } } catch {} await new Promise((r) => setTimeout(r, 150)); } })();

const res = await pg.evaluate(async (HASHES) => {
  if (HASHES) { let z = 42; Math.random = () => { z = (z * 1664525 + 1013904223) >>> 0; return z / 4294967296; }; }
  const pixHashes = [];
  const T = {}; const per = []; let cur = null; let phase = 'start'; const marks = []; const gaps = [];
  const setPhase = (p) => { phase = p; marks.push([performance.now(), p]); };
  const wrap = (name, key) => { const f = window[name]; if (typeof f !== 'function') return; window[name] = async function (...a) { const t = performance.now(); setPhase(key); try { return await f.apply(this, a); } finally { setPhase('after-' + key); if (cur) cur[key] = (cur[key] || 0) + performance.now() - t; } }; };
  const wrapSync = (name, key) => { const f = window[name]; if (typeof f !== 'function') return; window[name] = function (...a) { const t = performance.now(); const prev = phase; setPhase(key); try { return f.apply(this, a); } finally { setPhase(prev); if (cur) cur[key] = (cur[key] || 0) + performance.now() - t; } }; };
  for (const n of ['drawBorderLayers', 'applyWatermark', 'injectMetadata', 'embedSRGBTag', 'injectDPI', 'injectRecipeXmp', 'geomCanvas']) wrapSync(n, n);
  if (typeof FXR !== 'undefined') for (const m of ['setImage', 'render', 'getPixels']) { const f = FXR.prototype[m]; if (typeof f === 'function') FXR.prototype[m] = function (...a) { const t = performance.now(); const prev = phase; setPhase('gl.' + m); try { return f.apply(this, a); } finally { setPhase(prev); if (cur) cur['gl.' + m] = (cur['gl.' + m] || 0) + performance.now() - t; } }; }
  wrap('processToCanvas', 'render');
  if (HASHES) { const f = window.fxEncodeExportCanvas; window.fxEncodeExportCanvas = async function (...a) { const b = await f.apply(this, a); const u = new Uint8Array(await b.arrayBuffer()); pixHashes.push('enc:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', u))).slice(0, 8).map((x) => x.toString(16).padStart(2, '0')).join('') + ':' + u.length); return b; }; }
  if (HASHES) { const f = window.processToCanvas; window.processToCanvas = async function (...a) { const c = await f.apply(this, a); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; pixHashes.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', d))).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('') + '@' + c.width + 'x' + c.height); return c; }; } wrap('fxEncodeExportCanvas', 'encode'); wrap('exportResample', 'resample');
  window.chromasmithGetOpenedPaths = () => fxImages.map((_, i) => `/bench/${i}.jpg`);
  window.tauriNative = () => true;
  let t0 = 0, last = 0, bytes = 0;
  window.saveFilesNative = async (items) => { const now = performance.now(); for (const r of items) { bytes += r.content.length; cur.hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', r.content))).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join(''); cur.total = now - last; cur.bytes = r.content.length; per.push(cur); last = performance.now(); cur = { name: "" }; } return items.map((r) => ({ ok: true, path: '/out/' + r.fname })); };
  // Main-thread responsiveness: longest gap between animation frames during the export.
  let stall = 0, stallAt = '', lastF = performance.now(), on = true;
  const beat = () => { const n = performance.now(); if (n - lastF > stall) { stall = n - lastF; stallAt = phase + ' / ' + ((document.getElementById('fx-export-prog-txt') || {}).textContent || ''); } lastF = n; if (on) requestAnimationFrame(beat); }; requestAnimationFrame(beat);
  // Event-loop latency (input/click handling), separate from frame gaps (which also reflect a busy GPU).
  let loopLag = 0, loopAt = '', lastT = performance.now();
  const lagBy = {}; const tick = setInterval(() => { const n = performance.now(); if (n - lastT - 16 > 50) gaps.push([lastT, n]); if (n - lastT - 16 > loopLag) { loopLag = n - lastT - 16; loopAt = phase + ' / ' + ((document.getElementById('fx-export-prog-txt') || {}).textContent || ''); } lastT = n; }, 16);
  setExportScope('all'); cur = { name: '' }; t0 = last = performance.now();
  await exportFX();
  on = false; clearInterval(tick);
  for (const [a, b] of gaps) { for (let i = 0; i < marks.length; i++) { const s0 = Math.max(a, marks[i][0]), e0 = Math.min(b, i + 1 < marks.length ? marks[i + 1][0] : Infinity); if (e0 > s0) lagBy[marks[i][1]] = (lagBy[marks[i][1]] || 0) + e0 - s0; } }
  return { lagBy, pixHashes, loopLag, loopAt, total: performance.now() - t0, per, bytes, stall, stallAt, n: fxImages.length };
}, HASHES);
sampling = false; await sampler;
await br.close(); server.close();
const msPerPhoto = res.total / Math.max(1, res.per.length);
const blockedMs = Object.values(res.lagBy).reduce((a, b) => a + b, 0);
const out = { blockedFraction: +(blockedMs / res.total).toFixed(2), blockedMsByPhase: Object.fromEntries(Object.entries(res.lagBy).map(([k, v]) => [k, Math.round(v)])), pixHashes: res.pixHashes, engine: ENGINE, photos: res.n, saved: res.per.length, totalMs: Math.round(res.total), msPerPhoto: Math.round(msPerPhoto), maxStallMs: Math.round(res.loopLag), stallAt: res.loopAt, maxFrameGapMs: Math.round(res.stall), frameGapAt: res.stallAt, peakJsMB: Math.round(peakJs / 1e6), peakRssMB: ENGINE === 'webkit' ? null : Math.round(peakRss / 1e6), outMB: Math.round(res.bytes / 1e6),
  perPhoto: res.per.map((p) => ({ detail: Object.fromEntries(Object.entries(p).filter(([k, v]) => typeof v === 'number' && !['total', 'render', 'resample', 'encode', 'bytes', 'hash'].includes(k) && v > 5).map(([k, v]) => [k, Math.round(v)])), total: Math.round(p.total), render: Math.round(p.render || 0), resample: Math.round(p.resample || 0), encode: Math.round(p.encode || 0), other: Math.round(p.total - (p.render || 0) - (p.resample || 0) - (p.encode || 0)), hash: p.hash, MB: +(p.bytes / 1e6).toFixed(1) })) };
if (JSON_OUT) console.log(JSON.stringify(out));
else {
  console.log(`[${ENGINE}] photos ${out.saved}/${out.photos}  total ${out.totalMs} ms  per photo ${out.msPerPhoto} ms  UI blocked ${Math.round(out.blockedFraction * 100)}% of the time, longest stall ${out.maxStallMs} ms (${out.stallAt})  longest frame gap ${out.maxFrameGapMs} ms (${out.frameGapAt})  peak JS ${out.peakJsMB} MB  peak RSS ${out.peakRssMB == null ? 'n/a' : out.peakRssMB + ' MB'}  output ${out.outMB} MB`);
  console.log('main thread blocked (ms, >50ms gaps, attributed to the phase running during each gap): ' + JSON.stringify(out.blockedMsByPhase));
  if (HASHES) console.log('pixels ' + out.pixHashes.join(' '));
  out.perPhoto.forEach((p, i) => console.log(`  #${i + 1}  total ${p.total}  render ${p.render}  resample ${p.resample}  encode ${p.encode}  other ${p.other}  (${p.MB} MB) ${p.hash} ${JSON.stringify(p.detail)}`));
}
const fails = [];
if (out.saved !== out.photos) fails.push(`only ${out.saved}/${out.photos} photos exported`);
if (out.msPerPhoto > BUDGET.msPerPhoto) fails.push(`per-photo ${out.msPerPhoto} ms > budget ${BUDGET.msPerPhoto}`);
if (out.peakRssMB != null && out.peakRssMB > BUDGET.peakRssMB) fails.push(`peak RSS ${out.peakRssMB == null ? 'n/a' : out.peakRssMB + ' MB'} > budget ${BUDGET.peakRssMB}`);
if (out.blockedFraction > BUDGET.blockedFraction) fails.push(`UI blocked ${Math.round(out.blockedFraction * 100)}% of the export > budget ${Math.round(BUDGET.blockedFraction * 100)}%`);
if (out.maxStallMs > BUDGET.maxStallMs) fails.push(`UI stall ${out.maxStallMs} ms > budget ${BUDGET.maxStallMs}`);
if (fails.length) { console.error('BUDGET FAIL: ' + fails.join('; ')); process.exit(1); }
if (!JSON_OUT) console.log('within budget');
