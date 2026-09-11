// T48 (editor_ux_spec.json): HiDPI/Retina (deviceScaleFactor 2/3) rendering check. Icons, 1px
// hairline borders, and canvas-drawn UI (histogram, curve editor, colour wheels) can all render
// blurry or misaligned at a scale factor no current test sets (ui_audit.mjs et al run at 1x).
//
// Approach: reload the Editor at deviceScaleFactor 1, 2, and 3, and for each canvas-based control
// listed in CANVAS_IDS assert its backing-store resolution (canvas.width/height, the actual pixel
// buffer) scales with the emulated DPR relative to its CSS box size (canvas.clientWidth/Height) —
// a canvas whose backing store DOESN'T scale up at 2x/3x is exactly what renders blurry, since
// the browser then upscales a 1x-resolution bitmap to fill a larger CSS box.
import { bootEditor } from './editor_state_harness.mjs';

const CANVAS_IDS = ['fx-hist', 'cv-curve', 'cv-wheel-lift', 'cv-wheel-gamma', 'cv-wheel-gain', 'fx-canvas'];

function readCanvasBacking(ids) {
  const out = {};
  for (const id of ids) {
    const cv = document.getElementById(id);
    if (!cv) { out[id] = null; continue; }
    const rect = cv.getBoundingClientRect();
    out[id] = { cssW: rect.width, cssH: rect.height, bufW: cv.width, bufH: cv.height, visible: rect.width > 0 && rect.height > 0 };
  }
  return out;
}

const b = await bootEditor();
const { page } = b;

// Baseline at 1x.
await page.evaluate(() => { if (typeof renderPreview === 'function') renderPreview(); if (typeof drawHistogram === 'function') drawHistogram(); });
await page.waitForTimeout(300);
const base = await page.evaluate(readCanvasBacking, CANVAS_IDS);

const findings = [];
for (const dpr of [2, 3]) {
  const client = await page.context().newCDPSession(page);
  const vp = page.viewportSize() || { width: 1440, height: 900 };
  await client.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: dpr, mobile: false });
  await page.waitForTimeout(300);
  // Nudge a redraw the way a real resize/DPR-change would (best-effort; not every canvas
  // redraws on a pure CDP override without a real resize event).
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(300);

  const after = await page.evaluate(readCanvasBacking, CANVAS_IDS);
  for (const id of CANVAS_IDS) {
    const b0 = base[id], a = after[id];
    if (!a || !a.visible) { findings.push({ dpr, id, kind: 'MISSING', detail: 'not present/visible to check' }); continue; }
    if (a.cssW === 0 || a.cssH === 0) continue;
    const expectedRatio = dpr; // capped at 2 in-browser, 3 native per the app's own Math.min(...,capNative()?3:2)
    const actualRatioW = a.bufW / a.cssW;
    // Accept anything >= ~1.5x of the RESTING (1x) buffer ratio scaled proportionally — the app
    // caps browser DPR handling at 2x (chromasmith-22.html's own `Math.min(dpr,2)` for non-native
    // canvases), so at emulated 3x a browser-only canvas topping out at 2x backing resolution is
    // EXPECTED, not a bug. Flag only a canvas that didn't scale AT ALL (still ~1x buffer ratio).
    if (actualRatioW < 1.4) {
      findings.push({ dpr, id, kind: 'NOT-SCALED', detail: `backing store ratio ${actualRatioW.toFixed(2)}x at emulated ${dpr}x DPR (buf ${a.bufW}x${a.bufH} / css ${Math.round(a.cssW)}x${Math.round(a.cssH)}) — will render blurry, upscaled from a low-res buffer` });
    }
  }
  await client.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
}

await b.close();

console.log(`editor:hidpi-check — ${CANVAS_IDS.length} canvas element(s) checked at 2x/3x deviceScaleFactor`);
if (findings.length) {
  console.log(`\n${findings.length} finding(s):`);
  for (const f of findings) console.log(`  [${f.dpr}x/${f.kind}] #${f.id}: ${f.detail}`);
  console.log('\nADVISORY: a CDP-emulated DPR override may not trigger every canvas\'s own resize-observer redraw path the way a real display-move would — a MISSING/NOT-SCALED finding here is a signal to verify manually on real HiDPI hardware, not an automatic confirmed bug. Run with --strict to fail on any finding.');
  if (process.argv.includes('--strict')) process.exit(1);
} else {
  console.log('PASS: every checked canvas\'s backing-store resolution scales with emulated DPR.');
}
