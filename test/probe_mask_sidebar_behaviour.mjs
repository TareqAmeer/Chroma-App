#!/usr/bin/env node
// Mask sidebar behaviours: group count pill + collapsed defaults + persisted open state, double-click label / Backspace
// resets a slider, Amount disabled until an adjustment exists, how-to line per tool, row right-click menu parity,
// empty-mask housekeeping (Delete Empty Masks / Delete All Masks, undoable).
import assert from 'node:assert/strict';
import { openMaskPage } from './lib_mask_probe.mjs';
const { page, errors, close } = await openMaskPage();
try {
  await page.evaluate(() => { fxSection('local'); document.getElementById('tg-local')?.classList.add('on'); mskGroupsResetDefaults(); fxState.masks.length = 0; mskSel = -1; mskAdd('radial'); mskSel = 0; mskRebuild(); });
  const q = (f) => page.evaluate(f);
  // Selection + Light open by default, counts, persistence
  let r = await q(() => ({ hd: [...document.querySelectorAll('#local-ctl .msk-group-hd')].map((b) => [b.textContent.trim(), b.getAttribute('aria-expanded')]), amountDisabled: document.querySelector('#local-ctl input[data-k=amount]').disabled, howto: document.querySelector('.msk-rowbar-nm')?.title }));
  assert.deepEqual(r.hd, [['Selection', 'true'], ['Light', 'true'], ['Color', 'false'], ['Effects', 'false'], ['Detail', 'false']]);
  assert.ok(r.amountDisabled, 'Amount is disabled with nothing adjusted'); assert.match(r.howto, /Drag the pin/);
  await q(() => { const m = fxState.masks[0]; m.exp = 0.4; m.hi = -0.2; m.sat = 0.1; mskRebuild(); });
  r = await q(() => ({ cnt: [...document.querySelectorAll('#local-ctl .msk-group-hd .msk-group-count')].map((b) => b.closest('.msk-group').dataset.grp + '=' + b.textContent), amountDisabled: document.querySelector('#local-ctl input[data-k=amount]').disabled }));
  assert.deepEqual(r.cnt, ['adjust=2', 'adjColor=1'], 'count pills only on groups holding non-default values'); assert.equal(r.amountDisabled, false, 'Amount enables once the mask has an adjustment');
  await page.click('#msk-ghd-adjust'); r = await q(() => ({ exp: document.getElementById('msk-ghd-adjust').getAttribute('aria-expanded'), stored: JSON.parse(localStorage.getItem('chromasmith_msk_groups2')).adjust, legacy: localStorage.getItem('chromasmith_msk_groups') }));
  assert.equal(r.exp, 'false'); assert.equal(r.stored, false); assert.equal(r.legacy, null);  // Light opens by default, a click collapses it
  await page.click('#msk-ghd-adjust'); assert.equal(await q(() => JSON.parse(localStorage.getItem('chromasmith_msk_groups2')).adjust), true, 'reopening persists');
  // reset by double-click on the label
  await page.dblclick('#local-ctl .fx-row:has(input[data-k=exp]) .fx-label');
  r = await q(() => ({ exp: fxState.masks[0].exp, hi: fxState.masks[0].hi, val: document.querySelector('#local-ctl input[data-k=exp]').value }));
  assert.equal(r.exp, 0); assert.equal(r.hi, -0.2, 'only that slider resets'); assert.equal(r.val, '0');
  // Backspace on the focused slider resets too, without deleting the mask
  await q(() => { document.querySelector('#local-ctl input[data-k=hi]').focus(); });
  await page.keyboard.press('Backspace');
  r = await q(() => ({ hi: fxState.masks[0].hi, n: fxState.masks.length })); assert.equal(r.hi, 0); assert.equal(r.n, 1);
  // geometry sliders never reset
  await q(() => { fxState.masks[0].cx = 0.2; mskRebuild(); });
  await page.dblclick('#local-ctl .fx-row:has(input[data-k=cx]) .fx-label'); assert.equal(await q(() => fxState.masks[0].cx), 0.2);
  // group eye: only on groups with values; turning it off keeps the values but the renderer sees zeros
  await q(() => { fxState.masks.length = 0; mskAdd('radial'); mskSel = 0; fxState.masks[0].exp = 0.5; fxState.masks[0].tex = 10; mskRebuild(); });
  r = await q(() => ({ eyes: [...document.querySelectorAll('#local-ctl .msk-group-eye')].map((b) => b.closest('.msk-group').dataset.grp), comp: document.querySelector('.msk-comp-row')?.textContent.replace(/\s+/g, ' ').trim(), compBeforeAdd: !!(document.querySelector('.msk-comp-row')?.nextElementSibling?.classList.contains('msk-compose-row')) }));
  assert.deepEqual(r.eyes, ['adjust', 'adjEffects']); assert.match(r.comp, /Radial Gradient/); assert.ok(r.compBeforeAdd, 'Add/Subtract directly under the component row');
  r = await q(() => { document.querySelector('#local-ctl [data-grp=adjust] .msk-group-eye').click(); const m = fxState.masks[0]; const kept = m.exp; let seen = null; const rs = _mskGrpOffApply([m]); seen = m.exp; rs(); return { kept, seen, after: m.exp, off: m.grpOffCsv, pressed: document.querySelector('#local-ctl [data-grp=adjust] .msk-group-eye').getAttribute('aria-pressed') }; });
  assert.equal(r.kept, 0.5); assert.equal(r.seen, 0, 'renderer sees zero while the group is off'); assert.equal(r.after, 0.5, 'value restored'); assert.equal(r.off, 'adjust'); assert.equal(r.pressed, 'true');
  // how-to per type
  const how = await q(() => { const o = {}; for (const t of ['brush', 'linear', 'color', 'lum', 'depth', 'sky', 'ai', 'skin', 'coat']) { fxState.masks.length = 0; mskAdd(t); mskSel = 0; mskRebuild(); o[t] = !!document.querySelector('.msk-rowbar-nm')?.title; } return o; });
  assert.ok(Object.values(how).every(Boolean), JSON.stringify(how));
  // row context menu + housekeeping
  r = await q(async () => {
    fxState.masks.length = 0; mskAdd('radial'); mskAdd('brush'); mskAdd('brush'); mskSel = 0; mskRebuild(); // two empty brush masks
    const row = document.querySelectorAll('#local-list > button')[0];
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    await new Promise((x) => setTimeout(x, 50));
    const menu = document.querySelector('.msk-more-menu'); const t = [...menu.querySelectorAll('.msk-more-it')].map((b) => b.textContent.trim());
    const out = { role: menu.getAttribute('role'), t };
    [...menu.querySelectorAll('.msk-more-it')].find((b) => /^Delete empty masks/.test(b.textContent.trim())).click();
    await new Promise((x) => setTimeout(x, 80));
    out.afterEmpty = fxState.masks.map((m) => m.type);
    mskAdd('brush'); const m = fxState.masks[0]; m.exp = 0.3; mskSel = 0; mskRebuild(); mskSettingsCopy(); fxState.masks[1].exp = 0; mskSel = 1; mskSettingsPaste(); out.pasted = fxState.masks[1].exp;
    mskDeleteAll(); out.afterAll = fxState.masks.length;
    return out;
  });
  for (const need of ['Rename…', 'Invert', 'Duplicate and Invert', 'Intersect with…', 'Duplicate', 'Mute', 'Delete mask', 'Copy mask settings', 'Paste mask settings', 'Delete empty masks (2)', 'Delete all masks']) assert.ok(r.t.some((x) => x.includes(need)), 'context menu lacks ' + need + ' in ' + JSON.stringify(r.t));
  assert.equal(r.role, 'menu'); assert.deepEqual(r.afterEmpty, ['radial'], 'only the empty brushes are removed'); assert.equal(r.pasted, 0.3); assert.equal(r.afterAll, 0);
  if (errors.length) throw new Error(errors.join(' | '));
  console.log('PASS sidebar behaviour: collapsed groups + counts, reset, Amount gating, how-to, context menu, housekeeping');
} finally { await close(); }
