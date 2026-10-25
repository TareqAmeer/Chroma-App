#!/usr/bin/env node
// Hovering a mask row tints that mask on the canvas (even with the overlay off) and highlights its pin; hovering a pin highlights its row;
// leaving restores. One-click Subject/Sky/Background entries sit at the top of the add menu (Sky everywhere, AI ones desktop-only).
import assert from 'node:assert/strict';
import { openMaskPage } from './lib_mask_probe.mjs';
const { page, close } = await openMaskPage();
try {
  await page.evaluate(() => { fxSection('local'); document.getElementById('tg-local')?.classList.add('on'); fxState.masks.length = 0; mskSel = -1; mskAdd('radial'); mskAdd('linear'); mskSel = 0; mskSetPreviewMode('off'); mskRebuild(); mskPinSync && mskPinSync(); });
  const idx = () => page.evaluate(() => ({ s: mskShowSelIdx(), h: mskHoverIdx, rows: [...document.getElementById('local-list').children].map(r => r.classList.contains('msk-hover')), pins: [...document.querySelectorAll('#msk-pin-layer .msk-pin')].map(p => p.classList.contains('hov')) }));
  let s = await idx(); assert.equal(s.s, -1);
  await page.evaluate(() => document.getElementById('local-list').children[1].scrollIntoView());
  await page.hover('#local-list > *:nth-child(2)'); s = await idx();
  assert.equal(s.s, 1, 'row hover tints mask 1: ' + JSON.stringify(s)); assert.deepEqual(s.rows, [false, true]);
  const pins = await page.$$('#msk-pin-layer .msk-pin');
  if (pins.length) assert.deepEqual(s.pins, [false, true]);
  await page.mouse.move(2, 2); await page.waitForTimeout(200); s = await idx(); assert.equal(s.s, -1, 'restored after leaving'); assert.deepEqual(s.rows, [false, false]);
  // a rebuild while hovering keeps the hovered row node and class
  await page.hover('#local-list > *:nth-child(1)'); await page.evaluate(() => { document.getElementById('local-list').children[0]._k = 7; mskRebuild(); });
  const kept = await page.evaluate(() => document.getElementById('local-list').children[0]._k); assert.equal(kept, 7, 'hovered row node survives rebuild');
  // pin -> row
  if (pins.length) { await page.mouse.move(2, 2); await page.hover('#msk-pin-layer .msk-pin:nth-child(2)'); s = await idx(); assert.deepEqual(s.rows, [false, true], 'pin hover highlights its row'); assert.equal(s.s, 1); }
  // add menu: one-click entries first
  const menu = await page.evaluate(() => { mskAddMenu({ stopPropagation() {}, currentTarget: document.body }); return [...document.querySelectorAll('.msk-more-menu .msk-more-hd, .msk-more-menu .msk-more-it span')].map(e => e.textContent).slice(0, 4).join('|'); });
  assert.match(menu, /^(.*\|)?One click\|(Subject\|)?Sky/, menu);
  console.log('PASS hover tint + pin link + one-click entries:', menu, '(pins in this layout:', pins.length + ')');
} finally { await close(); }
