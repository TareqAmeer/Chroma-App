#!/usr/bin/env node
// Mask shortcuts through the real keyboard + registry: Backspace/Delete delete (undoable), Cmd/Ctrl+D duplicate, I invert,
// Up/Down select prev/next mask, Shift+R/L/B add masks; add menu shows the letters; none fire inside a text field; rebindable.
import assert from 'node:assert/strict';
import { openMaskPage } from './lib_mask_probe.mjs';
const { page, close } = await openMaskPage();
try {
  await page.evaluate(() => { fxSection('local'); document.getElementById('tg-local')?.classList.add('on'); fxState.masks.length = 0; mskSel = -1; mskAdd('radial'); mskAdd('linear'); mskAdd('brush'); mskSel = 1; mskRebuild(); (document.activeElement||document.body).blur(); });
  const S = () => page.evaluate(() => ({ n: fxState.masks.length, sel: mskSel, inv: fxState.masks[mskSel]?.invert, types: fxState.masks.map(m => m.type).join() }));
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press('ArrowDown'); let s = await S(); assert.equal(s.sel, 2, 'ArrowDown selects next');
  await page.keyboard.press('ArrowDown'); s = await S(); assert.equal(s.sel, 2, 'clamped at the end');
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); s = await S(); assert.equal(s.sel, 0);
  await page.keyboard.press('i'); s = await S(); assert.equal(s.inv, true, 'I inverts'); await page.keyboard.press('i'); s = await S(); assert.equal(s.inv, false);
  await page.keyboard.press(mod + '+d'); s = await S(); assert.equal(s.n, 4, 'duplicate'); assert.equal(s.sel, 1);
  await page.keyboard.press('Backspace'); s = await S(); assert.equal(s.n, 3, 'Backspace deletes');
  await page.evaluate(() => fxUpdate()); await page.waitForTimeout(800);
  await page.keyboard.press('Delete'); s = await S(); assert.equal(s.n, 2, 'Delete deletes');
  await page.waitForTimeout(800); await page.evaluate(() => fxUndo()); await page.waitForTimeout(500); s = await S(); assert.equal(s.n, 3, 'delete is undoable: ' + JSON.stringify(s));
  await page.keyboard.press('Shift+R'); s = await S(); assert.equal(s.n, 4); assert.match(s.types, /radial$/);
  await page.keyboard.press('Shift+L'); s = await S(); assert.match(s.types, /linear$/);
  await page.keyboard.press('Shift+B'); s = await S(); assert.match(s.types, /brush$/);
  // not while typing
  const before = (await S()).n;
  await page.evaluate(() => { const i = document.createElement('input'); i.id = 'tmp-in'; document.body.appendChild(i); i.focus(); });
  await page.keyboard.press('Backspace'); await page.keyboard.press('i'); await page.keyboard.press('ArrowUp'); s = await S(); assert.equal(s.n, before, 'typing must not trigger mask shortcuts');
  await page.evaluate(() => document.getElementById('tmp-in').remove());
  // add menu shows letters; registry lists them as rebindable with no conflicts
  const menu = await page.evaluate(() => { mskAddMenu({ stopPropagation() {}, currentTarget: document.body, target: document.body, clientX: 50, clientY: 50 }); return [...document.querySelectorAll('.msk-more-menu kbd')].map(k => k.textContent).join('|'); });
  assert.match(menu, /R/); assert.match(menu, /L/); assert.match(menu, /B/);
  const reg = await page.evaluate(() => { const ids = ['mask-delete', 'mask-delete-alt', 'mask-duplicate', 'mask-invert', 'mask-prev', 'mask-next', 'mask-add-radial', 'mask-add-linear', 'mask-add-brush'].map(x => 'editor.' + x);
    const a = chromasmithShortcutRegistry.actions(); return ids.map(id => { const x = a.find(y => y.id === id); return x ? [id, x.binding, chromasmithShortcutRegistry.conflict(id, x.binding)] : [id, 'MISSING']; }); });
  for (const [id, b, c] of reg) { assert.notEqual(b, 'MISSING', id); assert.ok(!c, `${id} ${b} conflicts: ${JSON.stringify(c)}`); }
  console.log('PASS mask shortcuts; add-menu hints:', menu);
} finally { await close(); }
