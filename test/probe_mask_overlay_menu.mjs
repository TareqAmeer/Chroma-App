#!/usr/bin/env node
// Overlay modes menu ("..." on the Show overlay row): six radio modes, the "Show Overlay for New Masks" pref
// (OFF by default - adding a mask must not switch the overlay on unasked), and the user's stored style
// "Image on B&W" (selection in full colour over a B&W backdrop): persists, never resets, and an EMPTY mask leaves
// the photo in colour (no overlay frame at all) until something is selected.
import assert from 'node:assert/strict';
import { openMaskPage } from './lib_mask_probe.mjs';
const { page, errors, close } = await openMaskPage();
try {
  await page.evaluate(() => { fxSection('local'); document.getElementById('tg-local')?.classList.add('on'); fxState.masks.length = 0; mskSel = -1; mskAdd('brush'); mskSel = 0; mskRebuild(); });
  const r = await page.evaluate(async () => {
    const wait = (ms) => new Promise((x) => setTimeout(x, ms)); const out = {};
    const btn = document.getElementById('btn-msk-overlay-menu'); out.btnVisible = btn.getBoundingClientRect().width > 0;
    out.haspopup = btn.getAttribute('aria-haspopup');
    btn.click(); await wait(40);
    const menu = document.querySelector('.msk-overlay-menu');
    out.role = menu.getAttribute('role'); out.expanded = btn.getAttribute('aria-expanded');
    out.modes = [...menu.querySelectorAll('[role=menuitemradio]')].map((b) => b.textContent.replace('\u2713', '').trim());
    out.checks = [...menu.querySelectorAll('[role=menuitemcheckbox]')].map((b) => b.textContent.replace('✓', '').trim());
    menu.querySelector('[data-mode="imgbw"]').click(); await wait(60);
    out.style = mskSelViewStyle; out.on = mskPreviewMode; out.menuClosed = !document.querySelector('.msk-overlay-menu');
    out.stored = JSON.parse(localStorage.getItem(MSK_SELVIEW_PREF_KEY));
    out.emptyIdx = mskShowSelIdx();                       // empty brush + image-on-B&W => no overlay frame
    const m = fxState.masks[0]; m.px[1000] = 255; m.px[1001] = 255;
    out.paintedIdx = mskShowSelIdx();
    m.px.fill(0); mskSetSelViewStyle('color'); out.colorEmptyIdx = mskShowSelIdx();   // colour overlay on an empty mask is unchanged
    mskSetSelViewStyle('imgbw');
    // never resets: add / paint / erase / invert / delete / rebuild
    mskAdd('radial'); mskSel = 1; mskRebuild(); mskInvert(); mskSel = 0; mskRebuild(); fxState.masks.pop(); mskSel = 0; mskRebuild(); mskPaintStop(); mskRebuild();
    out.styleAfterOps = mskSelViewStyle; out.storedAfter = JSON.parse(localStorage.getItem(MSK_SELVIEW_PREF_KEY)).style;
    // for-new pref: default off; opt in
    out.forNewDefault = mskOverlayForNew; mskSetPreviewMode('off'); mskAdd('linear'); out.afterAddOff = mskPreviewMode;
    mskOverlayForNewToggle(); mskAdd('linear'); out.afterAddOn = mskPreviewMode; out.storedForNew = JSON.parse(localStorage.getItem(MSK_SELVIEW_PREF_KEY)).forNew;
    mskOverlayForNewToggle();
    // keyboard: Esc closes and returns focus
    btn.focus(); btn.click(); await wait(40);
    document.querySelector('.msk-overlay-menu').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(30);
    out.escClosed = !document.querySelector('.msk-overlay-menu'); out.focusBack = document.activeElement === btn;
    return out;
  });
  assert.ok(r.btnVisible && r.haspopup === 'menu' && r.role === 'menu' && r.expanded === 'true');
  assert.deepEqual(r.modes, ['Color Overlay', 'Color Overlay on B&W', 'Image on B&W', 'Image on Black', 'Image on White', 'White on Black']);
  assert.ok(r.checks.includes('Show Overlay for New Masks') && r.checks.length === 5 && r.checks.includes('Spotlight') && r.checks.includes('Edge only'), JSON.stringify(r.checks));
  assert.equal(r.style, 'imgbw'); assert.equal(r.on, 'select'); assert.ok(r.menuClosed); assert.equal(r.stored.style, 'imgbw');
  assert.equal(r.emptyIdx, -1, 'empty mask + Image on B&W leaves the photo in colour');
  assert.equal(r.paintedIdx, 0, 'a painted selection shows (colour inside, B&W outside)');
  assert.equal(r.colorEmptyIdx, 0, 'colour overlay unchanged on an empty mask');
  assert.equal(r.styleAfterOps, 'imgbw'); assert.equal(r.storedAfter, 'imgbw');
  assert.equal(r.forNewDefault, false); assert.equal(r.afterAddOff, 'off', 'adding a mask does not turn the overlay on by default');
  assert.equal(r.afterAddOn, 'select'); assert.equal(r.storedForNew, true);
  assert.ok(r.escClosed && r.focusBack);
  if (errors.length) throw new Error(errors.join(' | '));
  console.log('PASS overlay menu: 6 modes, for-new pref, imgbw persists + empty mask stays colour');
} finally { await close(); }
