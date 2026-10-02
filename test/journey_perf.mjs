// journey:perf — docs/test-everything-plan.md Layer 5 (CHR-232). Timing budgets for the user
// journeys perf_bench.mjs (Editor hot paths) and library_perf.mjs (grid DOM/open cost) don't
// cover: boot to a usable grid, Gallery -> Editor open, scrolling a 5,000-photo catalog, and heap
// growth across repeated open/close. Runs in ?libtest=1, so it measures the frontend only; the
// Rust side's cost is measured live by npm run real:sweep + tools/diagnostics.
//
// Budgets are anchored to the first measurement on this machine (Intel Mac, swiftshader) with
// ~3x headroom (first run 2026-10-02: 1223ms, 590ms, 17ms, 0.7MB): they catch an order-of-magnitude regression, not a few percent.
//
//   node test/journey_perf.mjs
import { chromium } from 'playwright';
import { startServer } from './editor_state_harness.mjs';

const BUDGETS = {
  boot_to_grid_ms: { budget: 4000, cmp: 'lt', label: 'page load -> 24 Gallery thumbnails painted' },
  open_from_gallery_ms: { budget: 2000, cmp: 'lt', label: 'Gallery double-click -> photo in the Editor' },
  scroll_5k_p95_frame_ms: { budget: 60, cmp: 'lt', label: 'p95 frame gap scrolling a 5,000-photo catalog' },
  open_close_heap_growth_mb: { budget: 15, cmp: 'lt', label: 'JS heap growth over 15 open/close cycles (after GC)' },
};

const { server, port } = await startServer();
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc'] });
const url = (q) => `http://127.0.0.1:${port}/desktop/dist/index.html?${q}`;
const newPage = async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p.addInitScript(() => { try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); } catch (_) {} });
  return p;
};
const m = {};

{ // boot -> grid
  const p = await newPage();
  const t0 = Date.now();
  await p.goto(url('libtest=1&libn=24&deskx=1'), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => document.querySelectorAll('[data-path] img.loaded').length >= 24, null, { timeout: 60000 });
  m.boot_to_grid_ms = Date.now() - t0;
  // Gallery -> Editor (the reveal animation is part of what the user waits for)
  await p.keyboard.press('Escape');
  const t1 = Date.now();
  await p.locator('[data-path]').first().dblclick();
  await p.waitForFunction(() => typeof FX !== 'undefined' && FX.w > 0, null, { timeout: 60000 });
  m.open_from_gallery_ms = Date.now() - t1;
  await p.close();
}

{ // scroll a 5k catalog: worst-ish frame gap while wheel-scrolling the virtualised grid
  const p = await newPage();
  await p.addInitScript(() => localStorage.setItem('chromasmith_lib_last_view_v2', JSON.stringify({ kind: 'catalog', scope: 'all' })));
  await p.goto(url('libtest=1&libcat=1&libn=5000&deskx=1&librestoreview=1'), { waitUntil: 'load' });
  await p.waitForTimeout(3000); await p.keyboard.press('Escape');
  await p.mouse.move(800, 500);
  await p.evaluate(() => { window.__gaps = []; let last = performance.now(); const tick = (t) => { window.__gaps.push(t - last); last = t; if (window.__gaps.length < 400) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  for (let i = 0; i < 60; i++) { await p.mouse.wheel(0, 600); await p.waitForTimeout(16); }
  await p.waitForTimeout(500);
  const gaps = (await p.evaluate(() => window.__gaps)).slice(2).sort((a, b) => a - b);
  m.scroll_5k_p95_frame_ms = Math.round(gaps[Math.floor(gaps.length * 0.95)] || 0);
  await p.close();
}

{ // heap growth across open/close
  const p = await newPage();
  await p.goto(url('libtest=1&libn=12&deskx=1'), { waitUntil: 'load' });
  await p.waitForTimeout(2000); await p.keyboard.press('Escape');
  const cdp = await p.context().newCDPSession(p);
  const heap = async () => { await p.evaluate(() => window.gc && window.gc()); await p.waitForTimeout(300); return (await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576; };
  const cycle = async (i) => {
    await p.evaluate((n) => window.chromasmithOpenInEditor(`/test/AllPhotos/IMG_${1001 + (n % 10)}.RW2`), i);
    await p.waitForFunction(() => typeof FX !== 'undefined' && FX.w > 0, null, { timeout: 30000 });
    await p.evaluate(() => window.chromasmithToggleLibrary && window.chromasmithToggleLibrary());
    await p.waitForTimeout(200);
  };
  await cycle(0); await cycle(1); // warm caches before the first reading
  const h0 = await heap();
  for (let i = 2; i < 17; i++) await cycle(i);
  m.open_close_heap_growth_mb = +((await heap()) - h0).toFixed(1);
  await p.close();
}

await browser.close(); server.close();
let fail = false;
console.log('metric                       budget   measured  status');
for (const [k, b] of Object.entries(BUDGETS)) {
  const v = m[k], ok = v != null && (b.cmp === 'lt' ? v <= b.budget : v >= b.budget);
  if (!ok) fail = true;
  console.log(`${k.padEnd(28)} ${String(b.budget).padStart(6)} ${String(v).padStart(10)}  ${ok ? 'PASS' : 'FAIL'}   ${b.label}`);
}
console.log(fail ? 'journey:perf — FAIL' : 'journey:perf — PASS');
process.exit(fail ? 1 : 0);
