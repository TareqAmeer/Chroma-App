// Regression: a desktop batch export (Library "Export N photos" / Quick export) ran the WebKit
// WebContent process into its 8 GB kill threshold (system log: "Unable to shrink memory footprint
// ... Killed", ~700 MB retained per exported RAW). Three retention paths + one re-entrancy hole:
//  A. exportFX's export-time full cleanup swapped every batch item's editor canvas to full-res
//     pixels (+ HDR float stash) in place and never released them.
//  B. Phase 1 kept EVERY encoded output (PNG for a RAW source by default) alive until Phase 2 saved
//     them all at the end — on the desktop shell each file can be written as soon as it renders.
//  C. Quick export read every selected RAW fully into JS memory (read_file_bytes) instead of the
//     path-backed head read the batch-open path already uses.
//  D. libExportPaths had no in-flight guard: a second click (the app was unresponsive, so users
//     click again) re-read and reloaded the whole batch into the editor under the running export.
// Part 1 (A+B) drives the real exportFX in Chromium; part 2 (C+D) runs the real libExportPaths
// source in a vm with IPC mocks.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fails = [];
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails.push(msg); };

// ── Part 2 first (fast, no browser): libExportPaths ──
{
  const src = await readFile(path.join(ROOT, 'desktop/library-ui.js'), 'utf8');
  const a = src.indexOf('  async function libExportPaths(');
  const b = src.indexOf('  // Same target-resolution order the grid', a);
  assert.ok(a > 0 && b > a, 'libExportPaths seam');
  // Start at the in-flight guard declared just above libExportPaths when present (post-fix).
  const g = src.lastIndexOf('  let libExportBusy', a);
  const start = g > 0 && a - g < 2000 ? g : a;
  const reads = [], exports = [], toasts = [];
  const releases = [];
  const ctx = vm.createContext({
    window: { __TAURI__: {} }, document: { body: { classList: { contains: () => false } } },
    state: {}, console,
    toast: (m) => toasts.push(m),
    readPathsAsFiles: async (paths, opts) => { reads.push(opts || null); const f = paths.map((p) => ({ name: p })); f.okPaths = paths; return f; },
    prepareBatchRawFiles: async () => {},
    libLoadFX: async () => {},
    getSidecar: async () => ({}),
    fxImages: [],
    setExportScope: () => {},
    exportFX: () => { exports.push(1); return new Promise((r) => { releases.push(r); }); },
  });
  vm.runInContext(src.slice(start, b) + '\nglobalThis.libExportPaths = libExportPaths;', ctx);
  const p1 = ctx.libExportPaths(['/x/A.RW2', '/x/B.RW2']);
  await new Promise((r) => setTimeout(r, 10));
  const p2 = ctx.libExportPaths(['/x/A.RW2', '/x/B.RW2']); // the "double click"
  await new Promise((r) => setTimeout(r, 10));
  check(!!(reads[0] && reads[0].pathBackedRaw), `C: Quick export reads RAWs path-backed (got options ${JSON.stringify(reads[0])})`);
  check(reads.length === 1 && exports.length === 1, `D: second click during a running export does not re-read/reload the batch (reads=${reads.length}, exports=${exports.length})`);
  releases.forEach((r) => r());
  await Promise.all([p1, p2]);
}

// ── Part 1: real exportFX in Chromium ──
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.cube': 'text/plain' };
const server = await new Promise((r) => { const s = createServer(async (rq, rs) => { try { const p = path.join(ROOT, decodeURIComponent(rq.url.split('?')[0])); const d = await readFile(p); rs.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); rs.setHeader('Cross-Origin-Embedder-Policy', 'require-corp'); rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); rs.end(d); } catch { rs.writeHead(404); rs.end(); } }); s.listen(0, '127.0.0.1', () => r(s)); });
const br = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'] });
const pg = await br.newPage({ viewport: { width: 1200, height: 900 } });
pg.on('pageerror', (e) => console.error('[pageerror]', e.message));
pg.on('console', (m) => { if (m.type() === 'error') console.error('[console.error]', m.text()); });
await pg.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof loadFXImages === 'function' && typeof exportFX === 'function', null, { timeout: 60000 });
const png = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
const out = await pg.evaluate(async (b64) => {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const N = 3;
  await loadFXImages(Array.from({ length: N }, (_, i) => new File([bin], `P${i}.png`, { type: 'image/png' })));
  const before = fxImages.map((it) => { const im = it.img; return { w: im.naturalWidth || im.width, h: im.naturalHeight || im.height }; });
  const events = [];
  const paths = fxImages.map((_, i) => `/lib/P${i}.RW2`);
  window.chromasmithGetOpenedPaths = () => paths;
  // Mimic desktop-native.js's chromasmithApplyFullCleanup contract: re-decode at full resolution
  // INTO it.img (in place, or a fresh canvas when it.img is not one) plus the HDR float stash.
  window.chromasmithApplyFullCleanup = async (it) => {
    events.push('clean:' + it.name);
    let c = it.img;
    if (!c.getContext) { c = document.createElement('canvas'); it.img = c; }
    const w = before[0].w * 2, h = before[0].h * 2;
    c.width = w; c.height = h;
    const x = c.getContext('2d'); x.fillStyle = '#7a6050'; x.fillRect(0, 0, w, h);
    c._sceneLinear = { data: new Float32Array(w * h * 3), w, h };
    return { applied: true };
  };
  // Desktop shell save path, without a real Tauri bridge.
  window.tauriNative = () => true;
  const widths = [];
  window.saveFilesNative = async (items) => { items.forEach((r) => { events.push('save:' + r.fname); const d = new DataView(r.content.buffer, r.content.byteOffset); widths.push(d.getUint32(16)); }); return items.map((r) => ({ ok: true, path: '/out/' + r.fname })); };
  setExportScope('all');
  await exportFX();
  const after = fxImages.map((it) => { const im = it.img; return { w: im.naturalWidth || im.width, h: im.naturalHeight || im.height, hdr: !!im._sceneLinear }; });
  return { before, after, events, widths };
}, png);
await br.close(); server.close();
console.log('events:', out.events.join(' | '));
const cleans = out.events.filter((e) => e.startsWith('clean:')).length;
const saves = out.events.filter((e) => e.startsWith('save:')).length;
check(cleans === 3 && saves === 3, `export engaged the cleanup + native-save paths for all 3 photos (cleans=${cleans}, saves=${saves})`);
const retained = out.after.filter((a, i) => a.w !== out.before[i].w || a.h !== out.before[i].h || a.hdr);
check(retained.length === 0, `A: no photo keeps export-time full-res pixels after a batch export (before ${JSON.stringify(out.before)} after ${JSON.stringify(out.after)})`);
check(out.widths.length === 3 && out.widths.every((w) => w === out.before[0].w * 2), `the export rendered the full-res cleaned pixels (PNG widths ${out.widths})`);
const firstSave = out.events.findIndex((e) => e.startsWith('save:'));
const secondClean = out.events.findIndex((e, i) => e.startsWith('clean:') && out.events.slice(0, i).some((x) => x.startsWith('clean:')));
check(firstSave >= 0 && secondClean >= 0 && firstSave < secondClean, 'B: each rendered file is written before the next photo is processed (not all held to the end)');
if (fails.length) { console.error(`\n${fails.length} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
