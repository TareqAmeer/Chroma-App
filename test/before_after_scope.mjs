// CHR-270 criteria 5+6: split compare is view-only. With crop + film grain + a mask active, at fit
// and 1:1 zoom, in both themes, for every baseline kind, the full-res export bytes and the recipe
// must be identical to the same state with split OFF, and the split must actually render.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => {
    localStorage.setItem('chromasmith-tour-seen-v1', '1');
    // Grain is seeded from Math.random() at export time; pin it (same LCG as export_harness.mjs)
    // and reseed before every export so equal states compare byte-equal.
    const SEED = 0xC0FFEE; let s = SEED;
    window.__reseed = () => { s = SEED; };
    Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  });
  await page.goto(pathToFileURL(path.join(ROOT, 'chromasmith-22.html')).href, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof window.loadFXImages === 'function');
  await page.addStyleTag({ content: '#cs-modal-ov{display:none!important}' });
  const photo = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
  await page.evaluate(async b64 => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    await loadFXImages([new File([bytes], 'portrait.png', { type: 'image/png' })]);
    document.body.classList.add('fx-single'); document.getElementById('panel-fx')?.classList.add('active');
    // crop + film grain + one mask with its own adjustment, then two history states
    const it = curItem(); it.geom = { rot: 0, flipH: false, flipV: false, angle: 0, crop: { x: .1, y: .1, w: .8, h: .8 } };
    toggleFX('grain');
    fxState.masks.length = 0; mskSel = -1; mskAdd('radial');
    const s0 = getUISnapshot(); const s1 = structuredClone(s0); s1.toggles.adjust = true; s1.sliders['adj-exp'] = '40';
    applyUISnapshot(s1);
    fxHistory = [
      { j: JSON.stringify(s0), rasters: [], label: 'Start', ts: Date.now() - 1000 },
      { j: JSON.stringify(s1), rasters: [], label: 'Exposure', ts: Date.now() },
    ]; fxHistIdx = 1; renderPreview();
  }, photo);
  await page.waitForTimeout(300);

  const digest = v => createHash('sha256').update(v).digest('hex');
  const state = () => page.evaluate(async () => {
    window.__reseed();
    const src = fxWork || fxImg, w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
    const exp = (await processToCanvas(getFXParams(), src, w, h, undefined, fxPrepareExportRenderer())).toDataURL();
    return { recipe: JSON.stringify(getUISnapshot()), exp, len: fxHistory.length, idx: fxHistIdx };
  });

  const combos = [];
  for (const theme of ['dark', 'light']) for (const zoom of [1, 4]) for (const src of ['orig', 'prev', { hist: 0 }]) combos.push({ theme, zoom, src });
  for (const c of combos) {
    const label = `${c.theme}/zoom${c.zoom}/${JSON.stringify(c.src)}`;
    await page.evaluate(({ theme, zoom }) => {
      document.body.classList.toggle('light', theme === 'light');
      if (fxSplit) toggleSplit();
      fxZoom = zoom; renderPreview();
    }, c);
    await page.waitForTimeout(120);
    const off = await state();
    const off2 = await state();
    assert.equal(digest(off2.exp), digest(off.exp), `${label}: export is deterministic with split off (baseline sanity)`);
    await page.evaluate(src => { fxSplitSrc = src; if (!fxSplit) toggleSplit(); else renderPreview(); }, c.src);
    await page.waitForTimeout(250);
    const on = await state();
    assert.equal(digest(on.exp), digest(off.exp), `${label}: export bytes identical with split on`);
    assert.equal(on.recipe, off.recipe, `${label}: recipe unchanged by split`);
    assert.equal(on.len, off.len, `${label}: history length unchanged`);
    assert.equal(on.idx, off.idx, `${label}: history cursor unchanged`);
    assert.ok(!/fxSplit|fx-base-val/.test(on.recipe), `${label}: split state not serialized`);
    // The split view must actually be rendering (not silently skipped) at fit zoom.
    if (c.zoom === 1) {
      const view = await page.evaluate(() => ({ orig: document.getElementById('fx-canvas-orig')?.style.display, clip: FX.cv.style.clipPath }));
      assert.equal(view.orig, 'block', `${label}: before canvas is shown`);
      assert.ok(view.clip, `${label}: current canvas is clipped by the divider`);
    }
  }
  assert.deepEqual(errors, [], `zero browser errors: ${errors.join(' | ')}`);
  console.log(`CHR-270 split scope PASS: ${combos.length} combos (2 themes x fit/zoom x 3 baselines) with crop+grain+mask: export bytes, recipe and history unchanged`);
} finally { await browser.close(); }
