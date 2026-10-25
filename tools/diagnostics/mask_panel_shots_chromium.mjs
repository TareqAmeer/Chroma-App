#!/usr/bin/env node
// Chromium twin of mask_panel_shots.py (same scenarios/themes/widths/scroll positions) - used for the BEFORE set, because the
// pre-redesign native build is gone once the new one is installed. Usage: CHROMASMITH_HTML=<old html> node mask_panel_shots_chromium.mjs OUTDIR TAG
import { openMaskPage } from '../../test/lib_mask_probe.mjs';
import { mkdirSync } from 'node:fs';
const [,, OUT, TAG] = process.argv; mkdirSync(OUT, { recursive: true });
const { page, close } = await openMaskPage({ width: 1500, height: 1000 });
await page.evaluate(() => { document.body.classList.add('deskx'); fxSection('local'); document.getElementById('tg-local')?.classList.add('on'); });
const CS = '[{rgb:[200,150,120],h:0.6,s:0.05,v:0.7},{rgb:[180,130,100],h:0.62,s:0.06,v:0.6}]';
const S = { empty: 'fxState.masks.length=0;mskSel=-1', brush: "fxState.masks.length=0;mskAdd('brush');mskSel=0", radial: "fxState.masks.length=0;mskAdd('radial');mskSel=0", linear: "fxState.masks.length=0;mskAdd('linear');mskSel=0", ai: "fxState.masks.length=0;mskAdd('ai');mskSel=0", skin: `fxState.masks.length=0;mskAdd('skin');mskSel=0;Object.assign(fxState.masks[0],{crOn:true,crSamples:${CS}})`, color: "fxState.masks.length=0;mskAdd('color');mskSel=0" };
for (const theme of ['dark', 'light']) for (const [wn, w] of [['min', 220], ['default', 320], ['max', 440]]) {
  await page.evaluate(([t, w]) => { document.body.classList.toggle('light', t === 'light'); document.body.style.setProperty('--panel-w-user', w + 'px'); window.dispatchEvent(new Event('resize')); }, [theme, w]);
  for (const [sc, code] of Object.entries(S)) {
    await page.evaluate((c) => { localStorage.removeItem('chromasmith_msk_groups'); localStorage.removeItem('chromasmith_msk_groups2'); if (typeof mskGroupsResetDefaults === 'function') mskGroupsResetDefaults(); else Object.assign(_mskGroupOpen, { selection: true, adjust: true, adjColor: true, adjEffects: false, adjDetail: false, skin: true, coattone: false }); eval(c); mskRebuild(); }, code);
    await page.waitForTimeout(250);
    for (const pos of ['top', 'bottom']) {
      await page.evaluate((p) => { const sp = _mskScrollParent(document.getElementById('local-ctl')); if (sp) sp.scrollTop = p === 'top' ? 0 : 1e6; }, pos);
      await page.waitForTimeout(120);
      await page.screenshot({ path: `${OUT}/${TAG}_${sc}_${theme}_${wn}_${pos}.png`, clip: { x: 1500 - w - 130, y: 0, width: w + 130, height: 1000 } });
    }
  }
}
await close(); console.log('done');
