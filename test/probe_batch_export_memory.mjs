// Regression: a desktop batch export (Library "Export N photos" / Quick export) ran the WebKit
// WebContent process into its 8 GB kill threshold (system log: "Unable to shrink memory footprint
// ... Killed", ~700 MB retained per exported RAW). Three retention paths + one re-entrancy hole:
//  A. exportFX's export-time full cleanup swapped every batch item's editor canvas to full-res
//     pixels (+ HDR float stash) in place and never released them.
//  B. Phase 1 kept EVERY encoded output (PNG for a RAW source by default) alive until Phase 2 saved
//     them all at the end — on the desktop shell each file can be written as soon as it renders.
//  C. Quick export read every selected RAW fully into JS memory (read_file_bytes) instead of the
//     path-backed head read the batch-open path already uses.
//  F. (real-app timing, 8 RAWs) Quick export loaded the whole selection into the editor first —
//     an interactive decode of every RAW (~35 s before any progress) — then decoded each AGAIN
//     at export quality. It now hands exportFX lazy items that decode once, when reached.
//  D. libExportPaths had no in-flight guard: a second click (the app was unresponsive, so users
//     click again) re-read and reloaded the whole batch into the editor under the running export.
//  E. (the one that actually OOMed a 23:22 re-test) every RAW loaded into the editor kept its native
//     decoder shim alive via canvas._filmRaw, and the shim kept its WHOLE decode response
//     (_buf / _cachedPixels: ~120 MB per 24MP frame) — so loading a batch of a few dozen RAWs for
//     export grew ~170 MB/s of reachable ArrayBuffers until WebKit killed the page.
// Part 1 (A+B+E) drives the real exportFX / loadRw2 in Chromium; part 2 (C+D) runs the real
// libExportPaths source in a vm with IPC mocks.
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
  const reads = [], exports = [], toasts = [], loads = [], cleanups = [];
  const releases = [];
  const winMock = { __TAURI__: {}, chromasmithApplyFullCleanup: async (it, p) => { cleanups.push(p); it.img.width = 40; it.img.height = 30; return { applied: true }; } };
  const ctx = vm.createContext({
    window: winMock, console, performance,
    document: { body: { classList: { contains: () => false } }, createElement: () => ({ width: 300, height: 150 }) },
    state: {}, RAW_EXT_RE: /\.(rw2|nef|dng)$/i, ADJ_FIELDS: [], baseName: (p) => p.split('/').pop(), defGeom: () => ({}),
    toast: (m) => toasts.push(m),
    invoke: async (cmd) => { if (cmd === 'peek_raw_camera_path') return { make: 'Panasonic', model: 'DC-S9', lens: '' }; throw Error('unexpected ' + cmd); },
    readPathsAsFiles: async (paths, opts) => { reads.push(opts || null); const f = paths.map((p) => ({ name: p, size: 1, __csSourcePath: p })); f.okPaths = paths; return f; },
    prepareBatchRawFiles: async () => {},
    libLoadFX: async () => { loads.push('editor'); },
    loadFXImages: async () => { loads.push('private'); return [{ img: { width: 4, height: 4 } }]; },
    getSidecar: async () => ({}), snapshotFromB64: () => null,
    getUISnapshot: () => ({}), applyUISnapshot: async () => {}, applyRawDefaults: () => {},
    fxImages: [],
    setExportScope: () => {},
    exportFX: (opts) => { exports.push(opts); return new Promise((r) => { releases.push(r); }); },
  });
  vm.runInContext(src.slice(start, b) + '\nglobalThis.libExportPaths = libExportPaths;', ctx);
  const p1 = ctx.libExportPaths(['/x/A.RW2', '/x/B.RW2']);
  await new Promise((r) => setTimeout(r, 10));
  const p2 = ctx.libExportPaths(['/x/A.RW2', '/x/B.RW2']); // the "double click"
  await new Promise((r) => setTimeout(r, 10));
  check(reads.length > 0 && reads.every((o) => o && o.pathBackedRaw), `C: Quick export reads RAWs path-backed (got options ${JSON.stringify(reads)})`);
  check(exports.length === 1 && reads.length === 2, `D: second click during a running export does not re-read/reload the batch (reads=${reads.length}, exports=${exports.length})`);
  const items = exports[0] && exports[0].items;
  check(!loads.length && !cleanups.length && Array.isArray(items) && items.length === 2 && items.every((it) => typeof it._exportLoad === 'function' && it._srcPath),
    `F: Quick export decodes nothing up front and leaves the editor alone — every photo is a lazy export item (editor/private loads=${JSON.stringify(loads)}, decodes=${cleanups.length}, items=${items && items.length})`);
  if (items) {
    const first = await items[0]._exportLoad();
    check(cleanups.length === 1 && cleanups[0] === '/x/A.RW2' && first._fullCleanupApplied && first.img.width === 40 && first.exif && first.exif.make === 'Panasonic' && first._srcPath === '/x/A.RW2',
      `F: a lazy RAW decodes once, at export quality, with its camera identity, when the export reaches it (${JSON.stringify({ cleanups, w: first.img.width, exif: first.exif })})`);
  }
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
// F (browser): exportFX({items}) with lazy loaders — each photo loads only when reached, after the
// previous one was written, and renders the same pixels as the eager (editor-loaded) export above.
const lazy = await pg.evaluate(async (b64) => {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const ev = [], hashes = [];
  const hash = async (u) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', u))).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  const items = [0, 1, 2].map((i) => ({ img: Object.assign(document.createElement('canvas'), { width: 1, height: 1 }), name: `L${i}`, ext: 'png', dpi: 240, bytes: null, _srcPath: `/lib/L${i}.png`, geom: defGeom(),
    _exportLoad: async () => { ev.push('load:' + i); const e = await loadFXImages([new File([bin], `L${i}.png`, { type: 'image/png' })], { privateEntries: true }); return { ...e[0], _srcPath: `/lib/L${i}.png`, geom: defGeom() }; } }));
  window.saveFilesNative = async (rs) => { for (const r of rs) { ev.push('save:' + r.fname); hashes.push(await hash(r.content)); } return rs.map((r) => ({ ok: true, path: '/out/' + r.fname })); };
  window.chromasmithApplyFullCleanup = undefined;
  await exportFX({ items });
  return { ev, hashes, fxCount: fxImages.length };
}, png);
console.log('lazy events:', lazy.ev.join(' | '));
{ let loads = 0, saves = 0, maxAhead = 0; for (const e of lazy.ev) { if (e.startsWith('load:')) loads++; else saves++; maxAhead = Math.max(maxAhead, loads - saves); }
  const order = lazy.ev.filter((e) => e.startsWith('load:')).join(',');
  check(order === 'load:0,load:1,load:2' && maxAhead === 2 && lazy.ev.indexOf('load:1') < lazy.ev.findIndex((e) => e.startsWith('save:')),
    `F: lazy items load as the export reaches them, the next one prefetched while the current renders — never more than one ahead (${lazy.ev.join(' ')})`); }
check(lazy.fxCount === 3, `F: the editor's own photos are untouched by a lazy export (fxImages=${lazy.fxCount})`);
// E: real loadRw2 with a stand-in native shim (same interface as desktop-native.js's NativeLibRawShim).
const shimSrc = await readFile(path.join(ROOT, 'desktop/desktop-native.js'), 'utf8');
const rel = /\n\s*releasePixels\(\)\s*\{([^}]*)\}/.exec(shimSrc);
check(!!rel && /_buf\s*=\s*null/.test(rel[1]) && /_cachedPixels\s*=\s*null/.test(rel[1]) && !/_bytes/.test(rel[1]),
  `E: NativeLibRawShim.releasePixels drops _buf/_cachedPixels but keeps _bytes for refine/film (${rel ? rel[0].trim() : 'missing'})`);
const e = await pg.evaluate(async () => {
  const W = 600, H = 400; const shims = [];
  class Shim {
    constructor() { shims.push(this); }
    async open() { this._buf = new ArrayBuffer(24 + W * H * 4); this._bytes = new Uint8Array(8); }
    async metadata() { return { make: 'Panasonic', model: 'DC-S9' }; }
    async imageData() { return { width: W, height: H, colors: 4, bits: 8, rgba: true, data: new Uint8ClampedArray(this._buf, 24, W * H * 4) }; }
    get worker() { return { terminate() {} }; }
    async filmBase() {} async filmDevelop() {}
    releasePixels() { this._buf = null; this._cachedPixels = null; }
    releaseDecodeBuffers() { this._buf = null; this._cachedPixels = null; this._bytes = null; }
  }
  const prevGet = window.getLibRaw, prevT = window.__TAURI__;
  window.getLibRaw = async () => Shim; window.__TAURI__ = {};
  try {
    const r = await loadRw2(new File([new Uint8Array(16)], 'x.RW2'));
    const s = shims[0];
    return { kept: r.canvas._filmRaw === s, buf: !!s._buf, bytes: !!s._bytes, w: r.canvas.width };
  } finally { window.getLibRaw = prevGet; window.__TAURI__ = prevT; }
});
check(e.kept && e.w === 600, `E: loadRw2 still keeps the shim for film develops (${JSON.stringify(e)})`);
check(!e.buf && e.bytes, `E: a loaded RAW no longer pins the shim's full decode buffer (buf held=${e.buf}, bytes kept=${e.bytes})`);
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
