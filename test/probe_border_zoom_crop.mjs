#!/usr/bin/env node
// Bordered photo zoomed past Fit: the sharp visible-region tile (FX.cv over the composite underlay) must sit exactly where the whole-frame
// render puts the photo (parity vs window.__fxNoBorderCrop), and edits must not render the whole frame at zoom-tier density.
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { openMaskPage } from './lib_mask_probe.mjs';
const { page, errors, close } = await openMaskPage({ width: 1400, height: 1000 });
const settle = () => page.evaluate(async () => { renderPreview(); await new Promise(r => setTimeout(r, 6000)); });
const shot = async () => PNG.sync.read(await page.locator('#fx-wrap').screenshot());
try {
  await page.evaluate(async () => { document.getElementById('tg-borders').classList.add('on'); const t = document.getElementById('sl-b1-t'); t.value = 4; fxUpdate(); await new Promise(r => setTimeout(r, 500)); });
  for (const [z, px, py] of [[2, 0, 0], [3, 40, -30]]) {
    await page.evaluate(([z, px, py]) => { fxZoom = z; fxPanX = px; fxPanY = py; _applyZoom(false, true); window.__fxNoBorderCrop = false; }, [z, px, py]);
    await settle();
    const st = await page.evaluate(() => ({ crop: !!window.__fxBorderCrop, pos: FX.cv.style.position, vis: FX.cv.style.display, pe: FX.cv.style.pointerEvents, bd: document.getElementById('fx-canvas-bd').style.display, map: !!_fxDisplayMap }));
    assert.ok(st.crop && st.pos === 'absolute' && st.vis === 'block' && st.pe === 'none' && st.bd === 'block', 'overlay active at zoom ' + z + ' ' + JSON.stringify(st));
    const a = await shot();
    await page.evaluate(() => { window.__fxNoBorderCrop = true; }); await settle();
    assert.ok(!(await page.evaluate(() => window.__fxBorderCrop)), 'old path leaves the overlay');
    const b = await shot();
    assert.equal(a.width, b.width); assert.equal(a.height, b.height);
    let sum = 0, n = 0; for (let i = 0; i < a.data.length; i += 4) { sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]); n += 3; }
    const mad = sum / n; console.log(`zoom ${z}: mean abs diff vs whole-frame render = ${mad.toFixed(2)}/255`);
    assert.ok(mad < 6, 'tile misaligned or wrong colours: ' + mad);
  }
  await page.evaluate(() => { fxZoom = 1; _applyZoom(false, true); window.__fxNoBorderCrop = false; }); await settle();
  assert.ok(await page.evaluate(() => !window.__fxBorderCrop && FX.cv.style.position === '' && FX.cv.style.pointerEvents === ''), 'overlay cleared at Fit');
  assert.deepEqual(errors.filter(e => !/favicon/.test(e)), []);
  console.log('probe_border_zoom_crop: PASS');
} finally { await close(); }
