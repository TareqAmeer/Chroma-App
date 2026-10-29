#!/usr/bin/env node
// Brush cursor + overlay + busy pill: while Paint/Scribble is armed the pointer is the ring only (no grab hand on the zoom wrap),
// the selection overlay comes on unless the user switched it off, and a running AI job shows an on-canvas pill with Cancel.
import assert from 'node:assert/strict';
import { openMaskPage } from './lib_mask_probe.mjs';
const { page, errors, close } = await openMaskPage();
try {
  await page.evaluate(() => { fxSection('local'); document.getElementById('tg-local')?.classList.add('on'); fxState.masks.length = 0; mskSel = -1; mskSetPreviewMode('select'); mskPreviewMode = 'off'; mskOverlayUserOff = false; mskAdd('brush'); mskRebuild(); if (mskPaintMode) mskPaintStop(); });
  const cur = () => page.evaluate(() => ({ cls: document.body.classList.contains('msk-brushing'), cursor: getComputedStyle(document.getElementById('fx-zoom-wrap')).cursor, pm: mskPreviewMode }));
  let s = await cur(); assert.ok(!s.cls && s.cursor === 'grab', 'idle: ' + JSON.stringify(s));
  await page.evaluate(() => mskPaintToggle()); s = await cur();
  assert.ok(s.cls && s.pm === 'select', 'paint armed shows overlay: ' + JSON.stringify(s));
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#fx-zoom-wrap *')).cursor), 'none', 'ring only over the photo');
  await page.evaluate(() => mskPaintStop()); s = await cur(); assert.ok(!s.cls && s.cursor === 'grab', 'stopped: ' + JSON.stringify(s));
  await page.evaluate(() => { mskSetPreviewMode('off'); }); await page.evaluate(() => mskPaintToggle()); s = await cur();
  assert.equal(s.pm, 'off', 'explicit overlay-off is respected');
  await page.evaluate(() => mskPaintStop());
  const pill = await page.evaluate(async () => { const j = mskAiBusy('Selecting subject'); await new Promise(r => setTimeout(r, 250)); const el = document.getElementById('msk-ai-busy-cv'); const o = { on: el.classList.contains('on'), txt: el.textContent, cancel: !!el.querySelector('button') }; j.done(); o.after = document.getElementById('msk-ai-busy-cv').classList.contains('on'); return o; });
  assert.ok(pill.on && /Selecting subject/.test(pill.txt) && pill.cancel && !pill.after, JSON.stringify(pill));
  assert.deepEqual(errors.filter(e => !/favicon/.test(e)), []);
  console.log('probe_mask_brush_cursor: PASS');
} finally { await close(); }
