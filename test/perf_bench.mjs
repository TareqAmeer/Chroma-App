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

  let m;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
    page.on('console', (msg) => { if (msg.type() === 'error') console.error('  [console.error]', msg.text()); });

    await page.goto(`http://127.0.0.1:${port}/chromasmith-22.html?deskx=1`, { waitUntil: 'load' });
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
    const v = m[k];
    const ok = b.cmp === 'lt' ? v <= b.budget : v >= b.budget;
    if (!ok) fail = true;
    console.log(`${k.padEnd(21)} ${(b.cmp === 'lt' ? '<=' : '>=') + fmt(k, b.budget)}`.padEnd(35)
      + `${fmt(k, v)}`.padEnd(12)
      + `${base && base[k] != null ? fmt(k, base[k]) : '—'}`.padEnd(11)
      + (ok ? 'PASS' : 'FAIL'));
  }
  console.log('---------------------------------------------------------------------');

  // Correctness guard travels with the perf gate: a faster box filter that returns different
  // numbers would silently change every Refine-edges result.
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
  console.log(`context: mask ${m.mask_dims} (${m.mask_px} px), ${m.history_entries} history entries`);
  console.log(`\nRESULT: ${fail ? 'FAIL' : 'PASS'}`);
  return fail ? 1 : 0;
}

main().then(c => process.exit(c)).catch((e) => { console.error('FATAL:', e); process.exit(1); });
