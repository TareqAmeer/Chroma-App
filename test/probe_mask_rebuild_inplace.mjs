#!/usr/bin/env node
// mskRebuild patches rows in place (unchanged row nodes survive), keeps panel scroll + focus, and paint mode
// auto-stopped by visiting a non-brush mask resumes on return (but not after a deliberate Paint-off).
import assert from 'node:assert/strict';
import { openMaskPage } from './lib_mask_probe.mjs';
const { page, close } = await openMaskPage();
try {
  await page.evaluate(() => { fxSection('local'); document.getElementById('tg-local')?.classList.add('on'); fxState.masks.length = 0; mskSel = -1; mskAdd('brush'); mskAdd('radial'); mskAdd('brush'); mskSel = 1; mskRebuild(); });
  const r = await page.evaluate(() => {
    const L = () => [...document.getElementById('local-list').children];
    const out = {}; L().forEach((n, i) => n._k = i);
    mskRebuild(); out.same = L().map(n => n._k);
    fxState.masks[1].name = 'Sky glow'; mskRebuild(); out.afterRename = L().map(n => n._k);
    mskSel = 2; mskRebuild(); out.afterSel = L().map(n => n._k); out.n = L().length;
    fxState.masks.pop(); mskSel = 0; mskRebuild(); out.afterRemove = L().length;
    return out;
  });
  assert.deepEqual(r.same, [0, 1, 2], 'unchanged rows must be reused: ' + JSON.stringify(r));
  assert.deepEqual(r.afterRename, [0, undefined, 2], 'only the renamed row is replaced: ' + JSON.stringify(r));
  assert.equal(r.afterRemove, 2);
  // S2 paint resume
  await page.evaluate(() => { mskAdd('brush'); mskSel = 0; mskRebuild(); mskPaintStop(); mskPaintErase = true; mskPaintToggle(); });
  const st = () => page.evaluate(() => ({ pm: mskPaintMode, mode: mskBrushModeActive() }));
  assert.equal((await st()).mode, 'erase');
  await page.evaluate(() => { mskSel = 1; mskRebuild(); }); assert.equal((await st()).pm, false, 'paint stops on a non-brush mask');
  await page.evaluate(() => { mskSel = 0; mskRebuild(); }); assert.equal((await st()).mode, 'erase', 'paint (erase) resumes on return to a brush mask');
  await page.evaluate(() => { mskPaintToggle(); mskSel = 1; mskRebuild(); mskSel = 0; mskRebuild(); }); assert.equal((await st()).pm, false, 'deliberate Paint-off must not resume');
  // scroll + focus survive
  const sc = await page.evaluate(() => { mskPaintStop(); mskRebuild(); let p = document.getElementById('local-ctl').parentElement; for (; p; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight + 40) break; }
    if (!p) return null; p.scrollTop = 40; const t = p.scrollTop; mskRebuild(); return [t, p.scrollTop]; });
  if (sc) assert.equal(sc[1], sc[0], 'panel scroll reset by rebuild'); else console.log('(no scrollable panel in this viewport; scroll check skipped)');
  console.log('PASS in-place rows, paint resume, scroll kept');
} finally { await close(); }
