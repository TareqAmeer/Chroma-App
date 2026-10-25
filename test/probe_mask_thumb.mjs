#!/usr/bin/env node
// Mask row thumbnail is live: it changes after a brush stroke ends (and not per pointermove).
import assert from 'node:assert/strict';
import { openMaskPage } from './lib_mask_probe.mjs';
const { page, close } = await openMaskPage();
try {
  await page.evaluate(() => { fxSection('local'); document.getElementById('tg-local')?.classList.add('on'); fxState.masks.length = 0; mskSel = -1; mskAdd('brush'); mskRebuild(); mskPaintToggle(); });
  const sig = () => page.evaluate(() => { const c = document.querySelector('#local-list canvas'); if (!c) return null; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] - d[i + 2]; return s; });
  const a = await sig(); assert.notEqual(a, null, 'no thumbnail canvas in the mask row');
  await page.evaluate(() => FX.cv.scrollIntoView({ block: 'center' }));
  const r = await page.evaluate(() => { const r = FX.cv.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.move(r.x + r.w * .2, r.y + r.h * .5); await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(r.x + r.w * (.2 + .05 * i), r.y + r.h * .5);
  const mid = await sig(); await page.mouse.up(); await page.waitForTimeout(300);
  const b = await sig();
  assert.equal(mid, a, 'thumbnail must not rebuild per pointermove');
  assert.ok(b > a, `thumbnail did not update after stroke end (${a} -> ${b})`);
  console.log('PASS mask thumbnail updates at stroke end only', a, '->', b);
} finally { await close(); }
