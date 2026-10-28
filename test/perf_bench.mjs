#!/usr/bin/env node
// ── PERFORMANCE BUDGET GATE ──────────────────────────────────────────────────────────────────
// Times four hot paths in the REAL chromasmith-22.html and fails if any exceeds its budget.
// Every budget below is anchored to a measurement taken against the pre-optimisation code, so
// the numbers are real rather than aspirational.
//
//   node test/perf_bench.mjs               # PASS/FAIL table, exit 1 over budget
//   node test/perf_bench.mjs --baseline    # record current timings, assert nothing
//
// WHAT IS MEASURED AND WHY
//
//  refine_edges   `_boxFilterJS` is documented in-file as an O(w*h) prefix sum but was written
//                 as a naive O(w*h*r) window sum (it even computed a row total into `acc` and
//                 never used it). The guided filter calls it SIX times. Measured before the fix
//                 at 2048x1365 r=8: 911ms per call, ~5.5s of blocked main thread per press of
//                 "Refine edges".
//
//  history_push   getUISnapshot() deep-cloned every mask INCLUDING its full `px` raster, then
//                 JSON.stringify'd the lot, ×20 retained history entries, on a 400ms debounce
//                 after every slider drag. Measured 0.42MB per entry at a 512x384 mask; a real
//                 24MP photo stores masks at 2048x1365 (14x the pixels).
//
//  drag_renders   fxUpdate() debounced renderPreview by 400ms with no interim frame, so moving
//                 a slider produced ZERO visual feedback until 400ms after release.
//
//  snapshot       getUISnapshot() on its own, with a brush mask present.
//
//  looks_*        The preset library grew 11 -> 113 without the gallery changing, so
//                 buildLookGallery queued one requestAnimationFrame per preset — ~113 frames of
//                 thumbnail work on every photo load, crop apply and geometry undo, nearly all
//                 of it below the fold — and _presetLutCache was an unbounded object holding a
//                 431KB Float32Array per look (48.7MB once "All" had been scrolled). Both are
//                 now bounded: cells render only when in view, and the cache is LRU-capped.
//                 These two budgets are what stops the next preset drop from undoing that.
//
// Timings vary with machine load, so budgets are set with generous headroom — they exist to
// catch an order-of-magnitude regression, not to police a few percent.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// See ui_audit.mjs — test/output/ is gitignored, so baselines must not live there.
const OUT_DIR = path.join(__dirname, 'baselines');
const BASELINE = path.join(OUT_DIR, 'perf_baseline.json');
const WRITE_BASELINE = process.argv.includes('--baseline');
// --large-only: just section 7 (development loop for the zoom/pan budgets). PERF_HTML=<file>
// points the bench at another copy of the app (e.g. the previous commit, for before/after).
const LARGE_ONLY = process.argv.includes('--large-only');
const APP_HTML = process.env.PERF_HTML || 'chromasmith-22.html';
const LARGE_KEYS = ['drag_frame_ms', 'drag_buf_allocs', 'first_1to1_ms', 'pan_settle_ms', 'proxy_zoom_ms', 'tile_max_err', 'loupe_swap_jump_px'];

// name -> { budget, unit, cmp } — cmp 'lt' means lower is better, 'gt' means higher is better.
const BUDGETS = {
  // Budget sits between the fixed implementation (~650ms typical, ~1000ms on a loaded machine)
  // and the naive O(w*h*r) one it replaced (~2000ms), so it still catches a revert without
  // firing on scheduler noise. The measurement itself is a best-of-3 for the same reason.
  refine_edges_ms: { budget: 1400, unit: 'ms', cmp: 'lt', label: '_boxFilterJS x6 @2048x1365 (best of 3)' },
  history_bytes: { budget: 1_500_000, unit: 'B', cmp: 'lt', label: 'retained history, 20 pushes w/ brush mask' },
  drag_renders: { budget: 8, unit: 'frames', cmp: 'gt', label: 'renders during a 30-event slider drag' },
  snapshot_ms: { budget: 6, unit: 'ms', cmp: 'lt', label: 'getUISnapshot() w/ brush mask' },
  // Budgets are fractions of the preset count, not fixed numbers, so adding looks can never
  // silently make either of these pass by drifting the denominator.
  looks_rendered_frac: { budget: 0.5, unit: 'x', cmp: 'lt', label: 'looks painted on build / looks shown' },
  looks_cache_bytes: { budget: 16_000_000, unit: 'B', cmp: 'lt', label: 'retained _presetLutCache after touching every look' },
  // Longest gap between animation frames while a 65³ DCP LUT is baked. On the main thread this
  // was a visible freeze on every RAW load and every RAW-profile change — 1157ms measured in a
  // real browser, 237ms under this bench's SwiftShader build (the same run reports both, see
  // dcp_bake_stall_main_ms in the output). Through the worker it drops to ~18ms. The budget is
  // set between those two so a revert fails outright, while leaving ~5x headroom over frame
  // jitter so a loaded machine can't flake it.
  dcp_bake_stall_ms: { budget: 100, unit: 'ms', cmp: 'lt', label: 'worst frame gap during a 65³ DCP bake' },
  // ── Large-image zoom/pan (section 7, a 6000x4000 synthetic photo with grain + halation + bloom,
  // on the real GPU — see largeImageBench). Timings include the GPU (each measured render ends in
  // a 1px readPixels sync). Before/after on this machine's Intel Iris Plus 645 (2026-10-18):
  //  drag_frame_ms      median interim frame while a slider moves at Fit.       22 -> 18ms
  //  drag_buf_allocs    GPU buffers allocated over two drags (start/frames/settle/restart).
  //                     Every size or glow-scale change used to delete+realloc them all. 44 -> 0
  //  first_1to1_ms      zoom past Fit with Full res on -> first crisp crop on screen (incl. the
  //                     90ms zoom debounce). Was coarse-underlay render + canvas crop upload
  //                     + crop render; now GPU-copied crop + tiles, underlay on idle. 2523 -> ~310ms
  //  pan_settle_ms      release after a pan at Full res -> crisp frame (median of 3): only
  //                     newly exposed 1:1 tiles render now.                    199 -> ~10ms
  //  proxy_zoom_ms      zoom on a 2560px proxy whose full frame is still loading -> first zoomed
  //                     frame (12-tick wheel gesture + 150ms settle, must not wait). 710 -> ~470ms
  //  tile_max_err       tile-composited crisp view vs one direct render of the same region —
  //                     a cache that leaves seams or stale tiles fails this.
  // Without a hardware GPU (SwiftShader) the ms budgets are reported only.
  drag_frame_ms: { budget: 60, unit: 'ms', cmp: 'lt', label: '6000x4000: median frame during slider drag' },
  drag_buf_allocs: { budget: 10, unit: 'bufs', cmp: 'lt', label: '6000x4000: GPU buffer allocations over 2 drags' },
  first_1to1_ms: { budget: 1200, unit: 'ms', cmp: 'lt', label: '6000x4000: zoom -> first crisp 1:1 frame' },
  pan_settle_ms: { budget: 80, unit: 'ms', cmp: 'lt', label: '6000x4000: pan release -> crisp frame (median of 3)' },
  proxy_zoom_ms: { budget: 1200, unit: 'ms', cmp: 'lt', label: '2560 proxy, full frame pending: zoom -> first frame' },
  // 1:1 loupe on a 2560px proxy whose full frame lands later: the loupe's on-screen footprint and the
  // source area it shows (both in FULL-frame px, from the decode's known size) must not change when
  // the full frame replaces the proxy. Was ~60% of the visible width lost on the swap.
  loupe_swap_jump_px: { budget: 2, unit: 'px', cmp: 'lt', label: 'loupe: footprint/crop change when full frame replaces the proxy' },
  tile_max_err: { budget: 3, unit: 'lvl', cmp: 'lt', label: 'crisp view vs direct render, p99.9 8-bit error' },
};

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
  await mkdir(OUT_DIR, { recursive: true });
  const server = await startServer(ROOT);
  const { port } = server.address();
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox',
      '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
  });

  let m = {};
  try {
    if (!LARGE_ONLY) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
    page.on('console', (msg) => { if (msg.type() === 'error') console.error('  [console.error]', msg.text()); });

    await page.goto(`http://127.0.0.1:${port}/${APP_HTML}?deskx=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.loadFXImages === 'function'
      && typeof window.getUISnapshot === 'function', null, { timeout: 30000 });

    const fixture = (await readFile(path.join(__dirname, 'fixtures', 'portrait.png'))).toString('base64');
    await page.evaluate(async (b64) => {
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      await window.loadFXImages([new File([arr], 'portrait.png', { type: 'image/png' })]);
    }, fixture);
    await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length > 0, null, { timeout: 15000 });

    m = await page.evaluate(async () => {
      const res = {};

      // ── 1. refine_edges — the guided filter's six box-filter passes at real mask resolution.
      // Called directly rather than through mskRefineEdges so the number isolates the filter
      // itself (mskRefineEdges also does a canvas decode, which is not what we are budgeting).
      {
        const W = 2048, H = 1365, R = 8;
        const src = new Float32Array(W * H);
        let s = 12345;
        for (let i = 0; i < W * H; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; src[i] = s / 0x7fffffff; }
        // Best of 3. A single timing on a busy machine swings ~50% (measured 639 / 668 / 994ms
        // for identical code while a release build was running), which would make this gate
        // flaky — and a flaky gate gets ignored, which is worse than not having one.
        let best = Infinity;
        for (let run = 0; run < 3; run++) {
          const t0 = performance.now();
          for (let k = 0; k < 6; k++) _boxFilterJS(src, W, H, R);
          best = Math.min(best, performance.now() - t0);
        }
        res.refine_edges_ms = Math.round(best);

        // Correctness guard: the optimised filter must agree with a straightforward reference
        // implementation. A fast filter that returns different numbers is not a fix.
        const w = 61, h = 41, r = 5;
        const small = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; small[i] = s / 0x7fffffff; }
        const ref = (() => {   // naive separable box mean, clamped window — the documented intent
          const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
            let a = 0; for (let k = x0; k <= x1; k++) a += small[y * w + k];
            tmp[y * w + x] = a / (x1 - x0 + 1);
          }
          for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
            const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
            let a = 0; for (let k = y0; k <= y1; k++) a += tmp[k * w + x];
            out[y * w + x] = a / (y1 - y0 + 1);
          }
          return out;
        })();
        const got = _boxFilterJS(small, w, h, r);
        let maxErr = 0;
        for (let i = 0; i < w * h; i++) maxErr = Math.max(maxErr, Math.abs(got[i] - ref[i]));
        res.boxfilter_max_err = maxErr;
      }

      // ── 2/4. history + snapshot, with a brush mask holding real painted data.
      {
        mskAdd('brush');
        const mask = fxState.masks[fxState.masks.length - 1];
        for (let i = 0; i < mask.px.length; i += 3) mask.px[i] = i % 255;
        res.mask_px = mask.px.length;
        res.mask_dims = mask.mtW + 'x' + mask.mtH;

        const t0 = performance.now();
        for (let i = 0; i < 5; i++) getUISnapshot();
        res.snapshot_ms = +((performance.now() - t0) / 5).toFixed(2);

        // Retained history cost: push 20 distinct states, then measure what history holds.
        fxHistory = []; fxHistIdx = -1;
        _fxHistLocked = false;
        for (let i = 0; i < 20; i++) {
          mask.px[i * 97] = (i * 13) % 255;         // force a distinct snapshot each time
          fxState.artSeed = i + 0.5;
          fxHistoryPush();
        }
        let bytes = 0;
        for (const h of fxHistory) {
          bytes += (h.j ? h.j.length : 0);
          // After the copy-on-write change the raster lives outside the JSON string, so count
          // whatever the entry actually retains rather than assuming a representation.
          if (h.px) for (const p of Object.values(h.px)) bytes += (p && p.length) || 0;
        }
        res.history_entries = fxHistory.length;
        res.history_bytes = bytes;

        fxState.masks.length = 0; mskSel = -1;
        if (typeof mskRebuild === 'function') mskRebuild();
      }

      // ── 3. drag_renders — how many frames actually reach the screen while a slider moves.
      {
        let renders = 0;
        const orig = window.renderPreview;
        window.renderPreview = function (...a) { renders++; return orig.apply(this, a); };
        // Some call sites captured `renderPreview` lexically rather than off window; count the
        // GL draw as well so the measurement is not fooled by that.
        const origRender = FX.render.bind(FX);
        let glDraws = 0;
        FX.render = function (...a) { glDraws++; return origRender(...a); };

        const sl = document.getElementById('sl-adj-exp');
        for (let i = 0; i < 30; i++) {
          sl.value = String(-30 + i * 2);
          sl.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 16));      // ~60fps drag cadence
        }
        await new Promise(r => setTimeout(r, 700));        // let any trailing debounce fire
        window.renderPreview = orig; FX.render = origRender;
        res.drag_renders = Math.max(renders, glDraws);
        sl.value = '0'; sl.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // ── 5. Looks gallery — only what is on screen may render, and the decoded-LUT cache
      // must stay bounded no matter how many looks the user scrolls past.
      {
        fxSection('looks');
        fxLookCatFilter = 'All'; fxLookSearch = '';
        buildLookGallery();
        // Long enough for the in-view batch to drain (5 cells/frame) without being long enough
        // to hide a regression back to "render everything": eagerly rendering all 113 would
        // need ~23 frames, well inside this window.
        await new Promise(r => setTimeout(r, 1500));
        const cells = [...document.querySelectorAll('#fx-looks .look-cell')];
        const painted = cells.filter((c) => {
          const cv = c.querySelector('canvas');
          return cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 1, 1).data[3] !== 0;
        });
        res.looks_cells = cells.length;
        res.looks_painted = painted.length;
        res.looks_rendered_frac = +(painted.length / Math.max(1, cells.length)).toFixed(3);
        // A blank gallery would trivially "pass" the fraction budget, so assert the opposite
        // failure too: at least the first cell must have rendered.
        res.looks_any_painted = painted.length > 0;

        // Now touch every single look and confirm the cache still cannot grow without bound.
        for (const k of Object.keys(LUT_META)) await presetLut(k);
        res.looks_cache_entries = _presetLutCache.size;
        res.looks_cache_bytes = _presetLutCache.size * 33 * 33 * 33 * 3 * 4;
      }

      // ── 6. DCP bake — must not block the main thread, and the worker's answer must be
      // bit-identical to the main thread's. A faster bake that returns different numbers would
      // silently change RAW colour on every photo, which is exactly the class of bug the
      // stringify-the-real-function approach exists to prevent — so assert it, don't assume it.
      {
        const buf = await (await fetch('vendor/dcp/Panasonic DC-S9 Camera Standard.dcp')).arrayBuffer();
        const dcp = parseDCP(buf, 'Panasonic DC-S9 Camera Standard.dcp');
        const fit = dcpFit(200, 'Panasonic DC-S9');

        // requestAnimationFrame, not setTimeout: rAF is the honest "could the UI paint" signal,
        // and unlike timers it is not throttled differently in background tabs.
        const stallDuring = async (work) => {
          let last = performance.now(), worst = 0, run = true;
          const tick = () => { const n = performance.now(); worst = Math.max(worst, n - last); last = n; if (run) requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
          await work();
          await new Promise(r => requestAnimationFrame(r));  // let the frame AFTER the work land
          run = false;
          return Math.round(worst);
        };

        res.dcp_bake_stall_main_ms = await stallDuring(async () => { res._refLut = bakeDcpLUT(dcp, fit); });
        res.dcp_bake_stall_ms = await stallDuring(async () => { res._wrkLut = await _cpuRun('bakeDcpLUT', [dcp, fit]); });
        res.dcp_worker_used = !!_cpuGetWorker();

        let dmax = 0;
        const a = res._refLut.data, b = res._wrkLut.data;
        res.dcp_lut_len = [a.length, b.length].join('/');
        for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > dmax) dmax = d; }
        res.dcp_worker_max_err = dmax;
        delete res._refLut; delete res._wrkLut;      // don't ship 6MB of LUT back to node
      }

      return res;
    });
    }

    Object.assign(m, await largeImageBench(port));
  } finally {
    await browser.close();
    server.close();
  }

  const fmt = (k, v) => BUDGETS[k]?.unit === 'B' ? `${(v / 1048576).toFixed(2)}MB` : String(v);

  if (WRITE_BASELINE) {
    await writeFile(BASELINE, JSON.stringify(m, null, 2));
    console.log(`Baseline written to ${path.relative(ROOT, BASELINE)}\n`);
  }

  let base = null;
  if (existsSync(BASELINE) && !WRITE_BASELINE) base = JSON.parse(await readFile(BASELINE, 'utf8'));

  console.log('metric                budget      measured    baseline   status');
  console.log('---------------------------------------------------------------------');
  let fail = false;
  for (const [k, b] of Object.entries(BUDGETS)) {
    if (LARGE_ONLY && !LARGE_KEYS.includes(k)) continue;
    const v = m[k];
    const infoOnly = LARGE_KEYS.includes(k) && b.unit === 'ms' && !m.large_hw_gpu;
    const ok = infoOnly || (b.cmp === 'lt' ? v <= b.budget : v >= b.budget);
    if (!ok) fail = true;
    console.log(`${k.padEnd(21)} ${(b.cmp === 'lt' ? '<=' : '>=') + fmt(k, b.budget)}`.padEnd(35)
      + `${fmt(k, v)}`.padEnd(12)
      + `${base && base[k] != null ? fmt(k, base[k]) : '—'}`.padEnd(11)
      + (ok ? 'PASS' : 'FAIL'));
  }
  console.log('---------------------------------------------------------------------');

  // Correctness guard travels with the perf gate: a faster box filter that returns different
  // numbers would silently change every Refine-edges result.
  if (LARGE_ONLY) {
    console.log(`large image ${m.large_dims}: ${m.drag_frames} drag frames, settle ${m.drag_settle_ms}ms, pans ${m.pan_settle_all}ms, `
      + `GPU buffers ${m.gpu_buf_mb}MB fit / ${m.gpu_buf_mb_zoomed}MB zoomed, tile cache ${m.tile_cache_mb}MB, tile mean err ${m.tile_mean_err}, `
      + `full-res requests per zoom gesture ${m.proxy_zoom_full_req}, promoted ${m.proxy_promoted}, underlay ready ${m.underlay_ready_ms}ms after zoom`
      + `\nGPU: ${m.large_gpu}${m.large_hw_gpu ? '' : ' (software — ms budgets not enforced)'}; tile abs max err ${m.tile_abs_max_err}; loupe ${m.loupe_before} -> ${m.loupe_after}`);
    console.log(`\nRESULT: ${fail ? 'FAIL' : 'PASS'}`);
    return fail ? 1 : 0;
  }
  const errOk = m.boxfilter_max_err <= 1e-3;
  if (!errOk) fail = true;
  console.log(`_boxFilterJS vs reference implementation: max|Δ| = ${m.boxfilter_max_err.toExponential(2)}  ${errOk ? 'PASS' : 'FAIL (<=1e-3)'}`);
  // The "render only what's visible" budget is a ratio, so a gallery that renders NOTHING would
  // score a perfect 0. Lazy and broken look identical to that number — assert against it.
  if (!m.looks_any_painted) fail = true;
  console.log(`looks gallery painted ${m.looks_painted}/${m.looks_cells} on build, cache ${m.looks_cache_entries} entries`
    + `  ${m.looks_any_painted ? 'PASS' : 'FAIL (gallery rendered nothing at all)'}`);
  // Same guard as _boxFilterJS's: the worker copy of the DCP pipeline must agree exactly with
  // the main-thread one. (Both come from ONE definition, stringified — this proves it stayed
  // that way, and that nothing the function depends on failed to make it into the worker.)
  const dcpOk = m.dcp_worker_max_err === 0 && m.dcp_worker_used;
  if (!dcpOk) fail = true;
  console.log(`DCP bake in worker vs main thread: max|Δ| = ${m.dcp_worker_max_err} over ${m.dcp_lut_len} entries`
    + `, main-thread stall was ${m.dcp_bake_stall_main_ms}ms  ${dcpOk ? 'PASS' : (m.dcp_worker_used ? 'FAIL (worker disagrees)' : 'FAIL (no worker — ran inline)')}`);
  console.log(`large image ${m.large_dims}: ${m.drag_frames} drag frames, settle ${m.drag_settle_ms}ms, pans ${m.pan_settle_all}ms, `
    + `GPU buffers ${m.gpu_buf_mb}MB fit / ${m.gpu_buf_mb_zoomed}MB zoomed, tile cache ${m.tile_cache_mb}MB, tile mean err ${m.tile_mean_err}, `
    + `full-res requests per zoom gesture ${m.proxy_zoom_full_req}, promoted ${m.proxy_promoted}, underlay ready ${m.underlay_ready_ms}ms after zoom, tile abs max err ${m.tile_abs_max_err}`
    + `\nGPU: ${m.large_gpu}${m.large_hw_gpu ? '' : ' (software — ms budgets not enforced)'}`);
  const fqOk = m.proxy_zoom_full_req === 1 && m.proxy_promoted;
  if (!fqOk) fail = true;
  console.log(`proxy zoom: one full-quality request per gesture, full frame swapped in  ${fqOk ? 'PASS' : 'FAIL'}`);
  console.log(`context: mask ${m.mask_dims} (${m.mask_px} px), ${m.history_entries} history entries`);
  console.log(`\nRESULT: ${fail ? 'FAIL' : 'PASS'}`);
  return fail ? 1 : 0;
}

// ── 7. Large-image zoom/pan. Own page so the 24MP frame and its GPU buffers cannot skew the
// small-image budgets above.
// Runs on the machine's REAL GPU when headless Chromium can get one (ANGLE/Metal on macOS) — a
// 24MP frame through SwiftShader takes minutes per render and its timings swing 5x with machine
// load, which says nothing about zoom/pan feel. Without a hardware GPU the millisecond budgets
// below are reported but not enforced (counts and the tile error still are).
async function largeImageBench(port) {
  const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') console.error('  [console.error]', msg.text()); });
  try {
    await page.goto(`http://127.0.0.1:${port}/${APP_HTML}?deskx=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.loadFXImages === 'function', null, { timeout: 30000 });
    const [LW, LH] = (process.env.PERF_LARGE || '6000x4000').split('x').map(Number);
    return await page.evaluate(async ([W, H]) => {
      const res = {};
      { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl && gl.getExtension('WEBGL_debug_renderer_info');
        res.large_gpu = gl ? String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'none';
        res.large_hw_gpu = !/swiftshader|llvmpipe|software/i.test(res.large_gpu); }
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      // Smooth synthetic frame: gradients + soft bright discs (so halation/bloom have work) —
      // low-frequency on purpose, so the view-vs-direct comparison below is not dominated by
      // resampling differences on hard edges.
      const synth = (W, H) => {
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d');
        const g = x.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, '#203050'); g.addColorStop(0.5, '#a08060'); g.addColorStop(1, '#304020');
        x.fillStyle = g; x.fillRect(0, 0, W, H);
        for (let i = 0; i < 40; i++) {
          const cx = ((i * 7919) % 97) / 97 * W, cy = ((i * 104729) % 89) / 89 * H, r = W * (0.01 + (i % 5) * 0.006);
          const rg = x.createRadialGradient(cx, cy, 0, cx, cy, r);
          rg.addColorStop(0, 'rgba(255,250,235,1)'); rg.addColorStop(1, 'rgba(255,250,235,0)');
          x.fillStyle = rg; x.fillRect(cx - r, cy - r, 2 * r, 2 * r);
        }
        return c;
      };
      const toFile = (c, name) => new Promise(r => c.toBlob(b => r(new File([b], name, { type: 'image/png' })), 'image/png'));
      const sync = () => { const gl = FX.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); };
      // Time every renderPreview INCLUDING the GPU work it queued.
      const rec = [];
      const origRP = window.renderPreview;
      window.renderPreview = function (...a) {
        const inter = _fxPreviewInteracting, t = performance.now();
        const r = origRP.apply(this, a); sync();
        rec.push({ t0: t, t1: performance.now(), ms: performance.now() - t, inter });
        return r;
      };
      let allocs = 0;
      const origAlloc = FX._allocTex.bind(FX);
      FX._allocTex = function (...a) { allocs++; return origAlloc(...a); };
      const median = (a) => { const s = [...a].sort((p, q) => p - q); return s.length ? s[s.length >> 1] : NaN; };
      const full = synth(W, H);
      await window.loadFXImages([await toFile(full, 'large.png')]);
      await sleep(300);
      ['tg-grain', 'tg-hal', 'tg-bloom'].forEach(id => document.getElementById(id).classList.add('on'));
      fxUpdate(); await sleep(600);
      res.large_dims = `${fxWork.width}x${fxWork.height}`;

      // drag at Fit: two separate drags, so drag start/settle/restart all count.
      const sl = document.getElementById('sl-adj-exp');
      // Real allocations: the pooled renderer counts them itself (_allocTex is also called for
      // pool hits); the pre-pool renderer allocated on every _allocTex call.
      const realAllocs = () => (FX._bufStats ? FX._bufStats().allocs : allocs);
      allocs = 0; rec.length = 0; const a0 = realAllocs();
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < 8; i++) {
          sl.value = String(-20 + i * 3 + pass); sl.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(40);
        }
        await sleep(500);
      }
      const dragFrames = rec.filter(r => r.inter).map(r => r.ms), settles = rec.filter(r => !r.inter).map(r => r.ms);
      res.drag_frame_ms = Math.round(median(dragFrames));
      res.drag_frames = dragFrames.length;
      res.drag_settle_ms = Math.round(median(settles));
      res.drag_buf_allocs = realAllocs() - a0;
      res.gpu_buf_mb = FX._bufStats ? +(FX._bufStats().totalBytes / 1048576).toFixed(1) : null;

      // first crisp 1:1 at Full res.
      // Switch Full res on WITHOUT a Fit render (at Fit, Full res renders the whole 24MP frame).
      fxFullResPreview = true;
      const crisp = () => /translate/.test(FX.cv.style.transform || '');
      rec.length = 0;
      let t0 = performance.now();
      zoomSet(2.2);
      for (let i = 0; i < 200 && !(crisp() && rec.some(r => !r.inter)); i++) await sleep(20);
      await sleep(50);
      const firstCrisp = rec.find(r => !r.inter);
      res.first_1to1_ms = firstCrisp ? Math.round(firstCrisp.t1 - t0) : null;
      // The coarse underlay is built on idle after the crisp frame (it used to be rendered
      // synchronously BEFORE it). Wait for it so it doesn't land inside a pan measurement.
      const tb = performance.now();
      for (let i = 0; i < 1500 && document.getElementById('fx-canvas-fullbase').style.display !== 'block'; i++) await sleep(20);
      res.underlay_ready_ms = Math.round(performance.now() - t0);
      void tb; await sleep(300);

      // pan settle: drag the zoom wrapper, release, time the release -> crisp frame.
      const zw = document.getElementById('fx-zoom-wrap');
      const pans = [];
      for (let p = 0; p < 3; p++) {
        const r0 = zw.getBoundingClientRect();
        const x0 = 700, y0 = 450;
        const ev = (type, x, y) => zw.dispatchEvent(new PointerEvent(type, { pointerId: 7, bubbles: true, clientX: x, clientY: y, isPrimary: true }));
        zw.setPointerCapture = () => {};
        ev('pointerdown', x0, y0);
        for (let k = 1; k <= 6; k++) { ev('pointermove', x0 - k * 40, y0 - k * 15); await sleep(16); }
        rec.length = 0; t0 = performance.now();
        ev('pointerup', x0 - 240, y0 - 90);
        await sleep(60);
        const f = rec.find(r => !r.inter);
        pans.push(f ? f.t1 - t0 : NaN);
        await sleep(600);
        void r0;
      }
      res.pan_settle_ms = Math.round(median(pans));
      res.pan_settle_all = pans.map(Math.round).join('/');
      res.gpu_buf_mb_zoomed = FX._bufStats ? +(FX._bufStats().totalBytes / 1048576).toFixed(1) : null;
      res.tile_cache_mb = typeof _fxTileCacheStats === 'function' ? +(_fxTileCacheStats().bytes / 1048576).toFixed(1) : null;

      // crisp view vs one direct render of the same region (needs the view's geometry, which
      // the tile compositor publishes; absent before it existed).
      const v = window.__fxCrispView;
      if (v) {
        const P = getFXParams(), gl = FX.gl;
        const shown = new Uint8Array(v.outW * v.outH * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(0, 0, v.outW, v.outH, gl.RGBA, gl.UNSIGNED_BYTE, shown);
        const pad = v.refPad;    // source px, keeps pad*s integral
        const sx = Math.max(0, v.sx - pad), sy = Math.max(0, v.sy - pad);
        const ex = Math.min(v.iw, v.sx + v.sw + pad), ey = Math.min(v.ih, v.sy + v.sh + pad);
        const crop = document.createElement('canvas'); crop.width = ex - sx; crop.height = ey - sy;
        crop.getContext('2d').drawImage(fxWork, sx, sy, ex - sx, ey - sy, 0, 0, ex - sx, ey - sy);
        const rw = Math.round((ex - sx) * v.s), rh = Math.round((ey - sy) * v.s);
        FX.pushTempImage(crop);
        FX.render(P, rw, rh, mskPreviewRenderOptions({ ...(typeof fxZoomGlowOpts === 'function' ? fxZoomGlowOpts(v.iw, v.s) : { glowScale: 1, scOverride: v.iw / FXR.CAL.refWidth }), seed: v.seed, gamutWarn: fxClipCode(),
          uvOff: [sx / v.iw, (v.ih - ey) / v.ih], uvScale: [(ex - sx) / v.iw, (ey - sy) / v.ih] }));
        FX.popTempImage();
        const ref = new Uint8Array(rw * rh * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(0, 0, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, ref);
        // Both buffers are bottom-up. Shown pixel (x, y-from-bottom) == ref pixel offset by the pad.
        const ox = Math.round((v.sx - sx) * v.s), oyTop = Math.round((v.sy - sy) * v.s);
        const oyBot = rh - oyTop - v.outH;
        // Grain is a per-pixel hash of global uv: a region rendered at a different size computes
        // that uv with different float rounding, so a few isolated pixels legitimately differ
        // (renderTiled's export tiles behave the same). Seams or stale tiles move whole areas, so
        // the gate is the 99.9th-percentile error, with the max reported for context.
        const hist = new Uint32Array(256); let sum = 0, n = 0, maxErr = 0;
        for (let y = 0; y < v.outH; y += 3) for (let x = 0; x < v.outW; x += 3) {
          const a = (y * v.outW + x) * 4, b = ((y + oyBot) * rw + x + ox) * 4;
          for (let c = 0; c < 3; c++) { const d = Math.abs(shown[a + c] - ref[b + c]); hist[d]++; sum += d; n++; if (d > maxErr) maxErr = d; }
        }
        let acc = 0, p999 = 0; for (let d = 0; d < 256; d++) { acc += hist[d]; if (acc >= n * 0.999) { p999 = d; break; } }
        res.tile_max_err = p999; res.tile_abs_max_err = maxErr; res.tile_mean_err = +(sum / n).toFixed(3);
        renderPreview(); sync();
      }

      // proxy zoom: open a 2560px proxy whose "full frame" lands 1.5s after it is requested.
      zoomFit(); fxFullResPreview = false;
      await window.loadFXImages([await toFile(synth(2560, 1707), 'proxy.png')]);
      await sleep(300);
      ['tg-grain', 'tg-hal', 'tg-bloom'].forEach(id => document.getElementById(id).classList.add('on'));
      fxUpdate(); await sleep(600);
      let requested = 0, promoted = 0;
      window.chromasmithEnsureFullQuality = () => {
        requested++;
        if (!window.__promo) window.__promo = sleep(1500).then(() => {
          const it = curItem(); it.img = full; fxImg = full; updateWork(); renderPreview(); promoted = performance.now();
        });
        return window.__promo;
      };
      fxFullResPreview = true;
      rec.length = 0; t0 = performance.now();
      // A wheel gesture (12 ticks) instead of zoomSet, so "once per gesture" is exercised.
      const wrap = document.getElementById('fx-wrap');
      for (let i = 0; i < 12; i++) { wrap.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 700, clientY: 450, bubbles: true, cancelable: true })); await sleep(16); }
      for (let i = 0; i < 200 && !rec.some(r => !r.inter && r.t1 > t0); i++) await sleep(20);
      const pf = rec.find(r => !r.inter);
      res.proxy_zoom_ms = pf ? Math.round(pf.t1 - t0) : null;
      res.proxy_zoom_full_req = requested;
      for (let i = 0; i < 200 && !promoted; i++) await sleep(20);
      await sleep(400);
      res.proxy_promoted = !!promoted && fxWork.width === W;
      // loupe across the proxy -> full swap. The decode knows the full width (here stamped the way
      // loadRw2 / fxDisplayTierCanvas do); nothing may jump when the full frame lands.
      zoomFit(); fxFullResPreview = false;
      await window.loadFXImages([await toFile(synth(2560, 1707), 'proxy2.png')]);
      await sleep(300);
      curItem().img._csFullW = W;
      window.__promo = null; promoted = 0;
      window.chromasmithEnsureFullQuality = () => {
        if (!window.__promo) window.__promo = sleep(800).then(() => {
          const it = curItem(); it.img = full; fxImg = full; updateWork(); renderPreview(); promoted = performance.now();
        });
        return window.__promo;
      };
      // The source area the loupe shows, as a fraction of the whole frame (what the user sees), taken
      // from the crop the loupe actually asks the renderer for.
      let lastCrop = null; const origCrop = FX.pushTempCrop.bind(FX);
      FX.pushTempCrop = (src, ox, oy, cw, ch) => { lastCrop = { fx: cw / (src.naturalWidth || src.width), fy: ch / (src.naturalHeight || src.height) }; return origCrop(src, ox, oy, cw, ch); };
      const loupeState = () => ({ cw: parseFloat(FX.cv.style.width), ch: parseFloat(FX.cv.style.height),
        nw: lastCrop ? Math.round(lastCrop.fx * W) : 0, nh: lastCrop ? Math.round(lastCrop.fy * H) : 0 }); // crop extent in FULL-frame px
      toggleLoupe(); await sleep(300);
      const L0 = loupeState();
      for (let i = 0; i < 200 && !promoted; i++) await sleep(20);
      await sleep(500);
      const L1 = loupeState();
      res.loupe_before = JSON.stringify(L0); res.loupe_after = JSON.stringify(L1);
      res.loupe_swap_jump_px = (L0.nw && L1.nw) ? Math.round(Math.max(Math.abs(L0.cw - L1.cw), Math.abs(L0.ch - L1.ch), Math.abs(L0.nw - L1.nw), Math.abs(L0.nh - L1.nh))) : 9999;
      toggleLoupe(); await sleep(100); FX.pushTempCrop = origCrop;
      window.renderPreview = origRP; FX._allocTex = origAlloc;
      return res;
    }, [LW, LH]);
  } finally { await browser.close(); }
}

main().then(c => process.exit(c)).catch((e) => { console.error('FATAL:', e); process.exit(1); });
