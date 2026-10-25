#!/usr/bin/env node
// Live-app probe for three mask bugs: (1) Paint/Erase are a radio pair, (2) strokes are continuous (no dots),
// (3) the selection view mode persists across paint/erase/add actions. Drives the REAL DOM with real pointer events.
import assert from 'node:assert/strict';
import { openMaskPage } from './lib_mask_probe.mjs';
const { page, errors, close } = await openMaskPage();
try {
  await page.evaluate(() => { fxSection('local'); document.getElementById('tg-local')?.classList.add('on'); fxState.masks.length = 0; mskSel = -1; mskAdd('brush'); mskRebuild(); });
  const state = () => page.evaluate(() => {
    const p = document.getElementById('btn-msk-paint'), e = document.getElementById('btn-msk-erase');
    const on = b => b.getAttribute('aria-pressed') === 'true';
    const cur = document.getElementById('msk-brush-cursor');
    return { paint: on(p), erase: on(e), pc: p.classList.contains('bsec'), ec: e.classList.contains('bsec'), mode: mskBrushModeActive(), pm: mskPaintMode, pe: mskPaintErase, curErase: cur ? cur.classList.contains('erase') : false };
  });
  // ---- 1. radio: every click sequence leaves at most one active, DOM == state
  const click = id => page.click('#' + id);
  const seqs = [['paint'], ['erase'], ['paint', 'erase'], ['erase', 'paint'], ['paint', 'paint'], ['erase', 'erase'], ['paint', 'erase', 'paint', 'erase', 'erase', 'paint']];
  for (const seq of seqs) {
    await page.evaluate(() => { mskPaintStop(); mskPaintErase = false; mskPaintErase_sync(); });
    for (const b of seq) { await click('btn-msk-' + b); const s = await state();
      assert.ok(!(s.paint && s.erase), `both active after ${seq.join(',')}: ${JSON.stringify(s)}`);
      assert.equal(s.paint, s.pc); assert.equal(s.erase, s.ec);
      assert.equal(s.paint, s.mode === 'paint'); assert.equal(s.erase, s.mode === 'erase');
      if (s.pm) assert.equal(s.paint || s.erase, true, 'painting but no mode shown');
      assert.equal(s.curErase || !s.pm, s.erase || !s.pm); }
  }
  // held-modifier temporary erase swaps the pair, release restores
  await page.evaluate(() => { mskPaintStop(); mskPaintErase = false; mskPaintToggle(); chromasmithBrushEraseHeld(true); });
  let s = await state(); assert.ok(s.erase && !s.paint, 'held erase -> erase only');
  await page.evaluate(() => chromasmithBrushEraseHeld(false)); s = await state(); assert.ok(s.paint && !s.erase, 'release -> paint only');
  // mask switch / rebuild keeps the pair consistent
  await page.evaluate(() => { mskPaintErase = true; mskRebuild(); }); s = await state(); assert.ok(!(s.paint && s.erase));
  console.log('PASS brush mode radio (7 sequences + held modifier + rebuild)');

  // ---- 2. continuous stroke: slow + fast, several sizes
  await page.evaluate(() => FX.cv.scrollIntoView({ block: 'center' })); // headless layout stacks the panel above the canvas
  let box;
  for (const cfg of [{ size: 20, flow: 60, feather: 100, steps: 60 }, { size: 20, flow: 60, feather: 100, steps: 4 }, { size: 8, flow: 30, feather: 40, steps: 6 }, { size: 40, flow: 100, feather: 0, steps: 3 }]) {
    await page.evaluate(c => { mskPaintStop(); mskPaintErase = false; const m = fxState.masks[mskSel]; m.px.fill(0); mskBrushSize = c.size; mskBrushFlow = c.flow; mskBrushFeather = c.feather; mskBrushDensity = 100; mskPaintToggle(); }, cfg);
    await page.evaluate(() => FX.cv.scrollIntoView({ block: 'center' }));
    box = await page.evaluate(() => { const r = FX.cv.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const y = box.y + box.h * 0.5, x0 = box.x + box.w * 0.2, x1 = box.x + box.w * 0.8;
    await page.mouse.move(x0, y); await page.mouse.down();
    for (let i = 1; i <= cfg.steps; i++) await page.mouse.move(x0 + (x1 - x0) * i / cfg.steps, y);
    await page.mouse.up();
    const prof = await page.evaluate(() => { const m = fxState.masks[mskSel], w = m.mtW, h = m.mtH, row = Math.round(h * 0.5);
      // centre-line alpha between 30% and 70% of width (well inside the stroke ends)
      const out = []; for (let x = Math.round(w * 0.3); x < Math.round(w * 0.7); x++) out.push(m.px[row * w + x]); return out; });
    const mx = Math.max(...prof), mn = Math.min(...prof);
    assert.ok(mx > 0, `nothing painted ${JSON.stringify(cfg)}`);
    assert.ok(mn >= mx * 0.97, `non-uniform stroke ${JSON.stringify(cfg)} min ${mn} max ${mx} (dots)`);
  }
  console.log('PASS stroke continuity: slow/fast/size/feather/flow centre-line uniform');
  // ---- 3. selection view persistence
  const view = () => page.evaluate(() => ({ pm: mskPreviewMode, st: mskSelViewStyle, sel: document.getElementById('msk-selview-style')?.value, idx: mskShowSelIdx(), outline: mskSelViewOutline }));
  for (const [pm, style] of [['off', 'color'], ['select', 'color'], ['select', 'imgbw'], ['select', 'colorbw']]) {
    await page.evaluate(([pm, style]) => { mskPaintStop(); mskSetSelViewStyle(style); mskSetPreviewMode(pm); }, [pm, style]);
    const before = await view();
    await page.evaluate(() => { mskPaintStop(); mskPaintErase = false; mskPaintToggle(); });
    for (const act of ['paint', 'erase', 'paintbtn', 'erasebtn', 'add']) {
      await page.evaluate(a => { if (a === 'paintbtn') mskPaintButton(); if (a === 'erasebtn') mskPaintErase_toggle(); if (a === 'add') { mskAdd('brush'); mskSel = 0; mskRebuild(); } }, act);
      if (act === 'paint' || act === 'erase') {
        await page.evaluate(a => { mskPaintErase = a === 'erase'; mskPaintErase_sync(); }, act);
        await page.evaluate(() => FX.cv.scrollIntoView({ block: 'center' })); box = await page.evaluate(() => { const r = FX.cv.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
        await page.mouse.move(box.x + box.w * .4, box.y + box.h * .4); await page.mouse.down(); await page.mouse.move(box.x + box.w * .5, box.y + box.h * .45); await page.mouse.up();
      }
      const after = await view();
      assert.equal(after.pm, before.pm, `preview mode changed on ${act}`); assert.equal(after.st, before.st, `style changed on ${act}`);
      assert.equal(after.idx >= 0, before.idx >= 0 || false, `overlay visibility changed on ${act} (${JSON.stringify(before)} -> ${JSON.stringify(after)})`);
    }
  }
  // every selection-view control from the live DOM exists and is not mutated by panel rebuild
  const ctrls = await page.evaluate(() => [...document.querySelectorAll('#ff-local [id^="msk-selview"],#ff-local [id^="ck-msk-"],#ff-local [id^="sl-msk-selview"]')].map(e => e.id));
  assert.ok(ctrls.includes('msk-selview-style') && ctrls.includes('ck-msk-selview-outline'), 'controls ' + ctrls);
  await page.evaluate(() => { mskSetSelViewStyle('imgbw'); mskSelViewOutlineToggle(true); mskRebuild(); });
  const v = await view(); assert.equal(v.st, 'imgbw'); assert.equal(v.outline, true);
  console.log('PASS selection view persists across paint/erase/add/rebuild; controls:', ctrls.join(','));
  assert.deepEqual(errors.filter(e => !/favicon/.test(e)), []);
  console.log('probe_mask_brush_ux: PASS');
} finally { await close(); }
