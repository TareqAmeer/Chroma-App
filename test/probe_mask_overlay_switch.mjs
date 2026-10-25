#!/usr/bin/env node
// Explicit Show-overlay switch + colour dot: state persists across every mask action, O toggles it, hold-backslash peeks the matte.
import assert from 'node:assert/strict';
import { openMaskPage } from './lib_mask_probe.mjs';
const { page, close } = await openMaskPage();
try {
  await page.evaluate(() => { fxSection('local'); document.getElementById('tg-local')?.classList.add('on'); fxState.masks.length = 0; mskSel = -1; mskSetSelViewStyle('color'); mskSetPreviewMode('select'); mskAdd('brush'); mskRebuild(); });
  const st = () => page.evaluate(() => ({ on: document.getElementById('ck-msk-overlay').checked, vis: document.getElementById('msk-overlay-row').style.display !== 'none', dot: !!document.getElementById('msk-selview-color').offsetParent, pm: mskPreviewMode, style: mskSelViewStyle, idx: mskShowSelIdx(), saved: JSON.parse(localStorage.getItem('chromasmith.mask-selection-view.v1')) }));
  let s = await st(); assert.ok(s.vis && s.dot && s.on && s.idx === 0, JSON.stringify(s));
  await page.click('#ck-msk-overlay'); s = await st(); assert.ok(!s.on && s.pm === 'off' && s.idx === -1 && s.saved.on === false, 'switch off ' + JSON.stringify(s));
  // persists across every action while off
  for (const act of ['add', 'rebuild', 'paintStart', 'erase', 'select', 'style']) {
    await page.evaluate(a => { if (a === 'add') { mskAdd('brush'); mskSel = 0; mskRebuild(); } if (a === 'rebuild') mskRebuild(); if (a === 'paintStart') mskPaintToggle(); if (a === 'erase') { mskPaintErase = true; mskPaintErase_sync(); } if (a === 'select') { mskSel = 1; mskRebuild(); } if (a === 'style') { mskUpdateSelViewControls(); } }, act);
    s = await st(); assert.ok(!s.on && s.pm === 'off' && s.idx === -1, `overlay came back after ${act}: ` + JSON.stringify(s));
  }
  await page.evaluate(() => { mskPaintStop(); });
  await page.click('#ck-msk-overlay'); s = await st(); assert.ok(s.on && s.idx >= 0 && s.style === 'color' && s.saved.on === true, JSON.stringify(s));
  // O key toggles, same state as the switch
  await page.keyboard.press('o'); s = await st(); assert.ok(!s.on && s.pm === 'off'); await page.keyboard.press('o'); s = await st(); assert.ok(s.on && s.pm === 'select');
  // hold backslash: matte while held (even if overlay off), restore on release
  for (const start of ['select', 'off']) {
    await page.evaluate(m => mskSetPreviewMode(m), start);
    await page.keyboard.down('\\'); s = await st(); assert.ok(s.style === 'wob' && s.pm === 'select' && s.idx >= 0, 'peek ' + JSON.stringify(s));
    await page.keyboard.up('\\'); s = await st(); assert.ok(s.style === 'color' && s.pm === start && s.saved.style === 'color', 'restore ' + JSON.stringify(s));
  }
  // colour dot changes colour and persists
  await page.evaluate(() => mskSelViewColorInput('#22aa44')); s = await st(); assert.equal(s.saved.color, '#22aa44');
  await page.evaluate(() => mskSelViewColorInput('#ff2626'));
  console.log('PASS overlay switch: persistence, O key, backslash peek, colour dot');
} finally { await close(); }
