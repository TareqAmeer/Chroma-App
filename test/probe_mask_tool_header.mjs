#!/usr/bin/env node
// Brush tool header (Brush/Eraser title, Invert), erase-floor Density label, and the preview-only "hide all masks" eye.
import assert from 'node:assert/strict';
import { openMaskPage } from './lib_mask_probe.mjs';
const { page, close } = await openMaskPage();
try {
  await page.evaluate(() => { fxSection('local'); document.getElementById('tg-local')?.classList.add('on'); fxState.masks.length = 0; mskSel = -1; mskAdd('brush'); mskRebuild(); mskPaintToggle(); });
  const g = () => page.evaluate(() => ({ t: document.getElementById('msk-tool-title').textContent, d: document.getElementById('msk-density-label').textContent, inv: document.getElementById('btn-msk-invert').getAttribute('aria-pressed'), mi: fxState.masks[mskSel].invert }));
  let s = await g(); assert.equal(s.t, 'Brush'); assert.equal(s.d, 'Density');
  await page.click('#btn-msk-erase'); s = await g(); assert.equal(s.t, 'Eraser'); assert.match(s.d, /erase floor/i);
  await page.click('#btn-msk-paint'); s = await g(); assert.equal(s.t, 'Brush'); assert.equal(s.d, 'Density');
  await page.click('#btn-msk-invert'); s = await g(); assert.equal(s.mi, true); assert.equal(s.inv, 'true');
  await page.click('#btn-msk-invert'); s = await g(); assert.equal(s.mi, false);
  // hide-all eye: preview option only, off by default, not saved in the recipe
  const e = () => page.evaluate(() => ({ p: document.getElementById('btn-msk-hideall').getAttribute('aria-pressed'), opt: mskPreviewRenderOptions().hideMasks, rec: JSON.stringify(getUISnapshot()).includes('hideMasks') || JSON.stringify(getUISnapshot()).includes('hideAll') }));
  let v = await e(); assert.equal(v.p, 'false'); assert.equal(v.opt, false);
  await page.click('#btn-msk-hideall'); v = await e(); assert.equal(v.p, 'true'); assert.equal(v.opt, true); assert.equal(v.rec, false);
  // pixels: a full-strength exposure mask changes the render; hiding it restores the unmasked pixels; export path ignores the flag
  const px = () => page.evaluate(async () => { await new Promise(r => setTimeout(r, 400)); const c = document.createElement('canvas'); c.width = 8; c.height = 8; const x = c.getContext('2d'); x.drawImage(FX.cv, FX.cv.width / 2 - 4, FX.cv.height / 2 - 4, 8, 8, 0, 0, 8, 8); const d = x.getImageData(0, 0, 8, 8).data; let t = 0; for (let i = 0; i < d.length; i += 4) t += d[i] + d[i + 1] + d[i + 2]; return t / 64 / 3; });
  await page.click('#btn-msk-hideall'); // show
  await page.evaluate(() => { mskPaintStop(); const m = fxState.masks[mskSel]; m.px.fill(255); m.exp = 2; m.invert = false; _mskTexDirty = true; mskSetPreviewMode('off'); fxUpdate(); });
  const on = await px();
  await page.click('#btn-msk-hideall'); const hid = await px();
  await page.click('#btn-msk-hideall'); const on2 = await px();
  assert.ok(Math.abs(on - hid) > 3, `hiding masks did not change the render (${on} vs ${hid})`);
  assert.ok(Math.abs(on - on2) < 1.5, `showing again must restore the masked render (${on} vs ${on2})`);
  console.log('PASS tool header, erase-floor label, preview-only hide-all eye');
} finally { await close(); }
