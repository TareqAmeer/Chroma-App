#!/usr/bin/env node
// Behavioural gate (real Chromium, real pointer/keyboard input) for CHR-246's editable Heal/Clone
// work plus three small editor fixes shipped with it:
//   1. spot list/count, select, edit size/feather/opacity/mode, delete (button + Delete key), undo,
//      draggable SOURCE and DESTINATION handles, brush strokes, snapshot (session/copy-paste) round trip
//   2. export (processToCanvas at 3000px, with rotate+straighten+crop) matches the preview geometry
//   3. "Visualise spots" dust overlay is preview-only: export pixels are identical with it on or off
//   4. typing into a desktop slider readout maps DISPLAY units (EV, deg, px, %) back to the raw slider
//      value, and an unedited focus/blur is a no-op
//   5. Texture is a distinct, stronger control than Sharpen
// Usage: node test/heal_editor_gaps.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.cube': 'text/plain' };
const server = createServer(async (req, res) => {
  try { const u = decodeURIComponent(req.url.split('?')[0]); const d = await readFile(path.join(ROOT, u.slice(1)));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); res.end(d); } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.on('listening', r));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && /GLSL|shader/i.test(m.text())) errors.push(m.text()); });
await page.addInitScript(() => { try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); localStorage.setItem('chromasmith-first-edit-stage-v1', 'done'); } catch (e) {} });
await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof healApply === 'function');
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) fails++; };

// Textured photo with two dark blemishes and a thin dark "wire"; deterministic.
async function loadPhoto(w, h, wire) {
  await page.evaluate(async ({ w, h, wire }) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    let seed = 3; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const im = x.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) { const i = (y * w + xx) * 4; const t = (rnd() - .5) * 14 + Math.sin(xx * .05) * 10; im.data[i] = 170 + t; im.data[i + 1] = 140 + t; im.data[i + 2] = 120 + t; im.data[i + 3] = 255; }
    x.putImageData(im, 0, 0); x.fillStyle = '#2a1a14';
    for (const [fx, fy] of [[.25, .333], [.667, .556]]) { x.beginPath(); x.arc(fx * w, fy * h, w * .0117, 0, 6.3); x.fill(); }
    if (wire) { x.strokeStyle = '#2a1a14'; x.lineWidth = w * .006; x.beginPath(); x.moveTo(w * .17, h * .22); x.lineTo(w * .5, h * .44); x.stroke(); }
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await loadFXImages([new File([blob], 'dust.png', { type: 'image/png' })]);
    await new Promise(r => setTimeout(r, 1200));
  }, { w, h, wire });
  await page.waitForTimeout(500);
}
// Mean luminance of a small square, in SOURCE-fraction coords, read from the preview canvas.
const probe = (fx, fy, rr) => page.evaluate(async ({ fx, fy, rr }) => {
  renderPreview();
  const o = document.createElement('canvas'); o.width = FX.cv.width; o.height = FX.cv.height; const g = o.getContext('2d', { willReadFrequently: true }); g.drawImage(FX.cv, 0, 0);
  const R = Math.round(rr * o.width), d = g.getImageData(Math.round(fx * o.width) - R, Math.round(fy * o.height) - R, 2 * R, 2 * R).data; let s = 0;
  for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3; return s / (d.length / 4);
}, { fx, fy, rr });
// Screen point of a normalised point on the displayed photo.
const screenPt = (nx, ny) => page.evaluate(({ nx, ny }) => { const r = FX.cv.getBoundingClientRect(); return { x: r.left + nx * r.width, y: r.top + ny * r.height }; }, { nx, ny });
const ops = () => page.evaluate(() => JSON.parse(JSON.stringify(healOps())));

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 1. spot list / selection / editing / deletion / handles / strokes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
await loadPhoto(1200, 900, true);
await page.evaluate(() => { document.querySelector('.rail button[aria-label="Texture"],[aria-label="Texture"]').click(); });
await page.waitForFunction(() => document.getElementById('ff-retouch').offsetParent !== null);
await page.locator('#btn-heal-paint').scrollIntoViewIfNeeded();
await page.click('#btn-heal-paint');
check('retouch armed', await page.evaluate(() => healMode));
const dark = await probe(.25, .333, .008), ref = await probe(.45, .8, .008);
check('blemish present before repair', dark < ref - 60, `dark=${dark.toFixed(0)} ref=${ref.toFixed(0)}`);
let p = await screenPt(.25, .333); await page.mouse.click(p.x, p.y);
check('click adds one spot + list row + count', (await ops()).length === 1 && await page.locator('#heal-list [data-heal-id]').count() === 1 && /1 spot/.test(await page.textContent('#heal-count')));
check('blemish removed by spot', Math.abs(await probe(.25, .333, .008) - ref) < 30);
check('new spot is selected with overlay handles', await page.evaluate(() => healSelIdx() === 0 && !!document.querySelector('#fx-heal-overlay [data-heal-src]') && !!document.querySelector('#fx-heal-overlay [data-heal-dst]')));
// second spot on the other blemish, then edit ONLY the selected one
p = await screenPt(.667, .556); await page.mouse.click(p.x, p.y);
const before = await ops();
check('second spot added and selected', before.length === 2);
await page.evaluate(() => { const s = document.getElementById('sl-heal-size'); s.value = 7; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(250);
let now = await ops();
check('size edit applies to the selected spot only', now[1].r === .07 && now[0].r === before[0].r);
await page.evaluate(() => { const s = document.getElementById('sl-heal-feather'); s.value = 0; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); const o = document.getElementById('sl-heal-opacity'); o.value = 60; o.dispatchEvent(new Event('input', { bubbles: true })); o.dispatchEvent(new Event('change', { bubbles: true })); const m = document.getElementById('sel-heal-mode'); m.value = 'clone'; m.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(250);
now = await ops();
check('feather 0 (hard edge), opacity and mode edit the selected spot', now[1].feather === 0 && Math.abs(now[1].opacity - .6) < 1e-6 && now[1].mode === 'clone' && now[0].mode === 'heal');
await page.click('#heal-list [data-heal-id]:first-child');
check('selecting a row loads its values into the controls', await page.evaluate(() => healSelIdx() === 0 && +document.getElementById('sl-heal-size').value === +(healOps()[0].r * 100).toFixed(1) && document.getElementById('sel-heal-mode').value === 'heal'));
// drag SOURCE handle with the mouse
const o0 = (await ops())[0];
const sh = await page.evaluate(() => { const e = document.querySelector('#fx-heal-overlay [data-heal-src]').getBoundingClientRect(); return { x: e.left + e.width / 2, y: e.top + e.height / 2 }; });
const tgt = await screenPt(.8, .2);
await page.mouse.move(sh.x, sh.y); await page.mouse.down(); await page.mouse.move((sh.x + tgt.x) / 2, (sh.y + tgt.y) / 2, { steps: 4 }); await page.mouse.move(tgt.x, tgt.y, { steps: 4 }); await page.mouse.up();
let o1 = (await ops())[0];
check('dragging the source handle moves the donor only', Math.abs(o1.sx - .8) < .03 && Math.abs(o1.sy - .2) < .03 && o1.x === o0.x && o1.y === o0.y, `src=${o1.sx.toFixed(2)},${o1.sy.toFixed(2)}`);
check('moved donor still removes the blemish', Math.abs(await probe(.25, .333, .008) - ref) < 30);
// drag DESTINATION handle off the blemish -> blemish returns; drag back -> removed
const dh = await page.evaluate(() => { const e = document.querySelector('#fx-heal-overlay [data-heal-dst]').getBoundingClientRect(); return { x: e.left + e.width / 2, y: e.top + e.height / 2 }; });
const away = await screenPt(.4, .75);
await page.mouse.move(dh.x, dh.y); await page.mouse.down(); await page.mouse.move(away.x, away.y, { steps: 6 }); await page.mouse.up();
o1 = (await ops())[0];
check('dragging the destination handle moves the spot', Math.abs(o1.x - .4) < .03 && Math.abs(o1.y - .75) < .03);
check('blemish reappears once the spot is moved away', await probe(.25, .333, .008) < ref - 60);
await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
check('undo restores the previous drag', Math.abs((await ops())[0].x - .25) < .01);
// delete with the keyboard
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.keyboard.press('Delete'); await page.waitForTimeout(300);
const afterDel = await ops();
check('Delete key removes the selected spot', afterDel.length === 1 && await page.locator('#heal-list [data-heal-id]').count() === 1 && /1 spot/.test(await page.textContent('#heal-count')));
await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
check('undo restores a deleted spot', (await ops()).length === 2);
await page.click('#heal-list [data-heal-id]:first-child'); await page.click('#btn-heal-del'); await page.waitForTimeout(300);
check('Delete spot button removes the selected spot', (await ops()).length === 1);
await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
// snapshot round trip (what session save / copy-paste / sidecar serialise)
const snapOps = await page.evaluate(async () => { const s = JSON.parse(JSON.stringify(getUISnapshot())); const it = curItem(); it.heal = []; await applyUISnapshot(s); return JSON.parse(JSON.stringify(healOps())); });
check('snapshot round trip preserves ids, geometry, edits', snapOps.length === 2 && snapOps.every(o => o.id) && snapOps[1].mode === 'clone' && snapOps[1].feather === 0);
// brush stroke along the wire
await page.evaluate(() => { healClear(); healSel = null; const s = document.getElementById('sl-heal-size'); s.value = 3; s.dispatchEvent(new Event('input', { bubbles: true })); const m = document.getElementById('sel-heal-mode'); m.value = 'heal'; m.dispatchEvent(new Event('change', { bubbles: true })); });
const wireProbe = async () => { let m = 0; for (const t of [.2, .35, .5, .65, .8]) m += await probe(.17 + .33 * t, .22 + .22 * t, .004); return m / 5; };
await page.evaluate(() => { document.getElementById('btn-heal-paint').classList.contains('on') || healToggle(); });
check('wire visible before the stroke', await wireProbe() < ref - 50);
const a = await screenPt(.17 + .33 * .02, .22 + .22 * .02), b = await screenPt(.17 + .33 * .98, .22 + .22 * .98);
await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 8 }); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(300);
const st = (await ops())[0];
check('dragging in Retouch draws a brush stroke op', st && st.pts && st.pts.length >= 3);
check('stroke removes the wire along its length', Math.abs(await wireProbe() - ref) < 25, `wire=${(await wireProbe()).toFixed(0)} ref=${ref.toFixed(0)}`);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 2 + 3. export parity at 3000px and preview-only dust overlay â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
await loadPhoto(3000, 2250, false);
await page.evaluate(() => { const it = curItem(); it.heal = [{ id: 'a', x: .25, y: .333, r: .02, feather: .5, opacity: 1, mode: 'heal', sx: .4, sy: .6 }, { id: 'b', x: .667, y: .556, r: .02, feather: 0, opacity: 1, mode: 'clone', sx: .2, sy: .8, pts: [[.667, .556], [.7, .6]] }]; it.geom = Object.assign(defGeom(), { rot: 90, angle: 3, crop: { x: .1, y: .1, w: .8, h: .8 } }); updateWork(); renderPreview(); healSyncUI(); });
await page.waitForTimeout(600);
const exp = (dust) => page.evaluate(async (dust) => {
  if (dust !== healDust) healDustToggle();
  const it = curItem(), src = geomCanvas(it), iw = src.width, ih = src.height;
  const P = getFXParams(); const c = await processToCanvas(P, src, iw, ih);
  const px = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261; for (let i = 0; i < px.length; i += 7) h = Math.imul(h ^ px[i], 16777619) >>> 0;
  return { w: c.width, h: c.height, hash: h, px: Array.from(px.slice(0, 0)) };
}, dust);
const e0 = await exp(false), shown = await page.evaluate(() => { const c = document.getElementById('fx-canvas-dust'); return c.style.display; });
const e1 = await exp(true), shown1 = await page.evaluate(() => document.getElementById('fx-canvas-dust').style.display);
check('export size follows geometry (rot90, crop, straighten)', e0.w > 0 && e0.h > 0 && e0.w < e0.h * 1.0 + 1, `${e0.w}x${e0.h}`);
check('dust overlay renders on screen when toggled', shown1 === 'block' && shown !== 'block', `off=${shown} on=${shown1}`);
check('dust overlay never changes export pixels', e0.hash === e1.hash && e0.w === e1.w && e0.h === e1.h, `hash ${e0.hash} vs ${e1.hash}`);
await page.evaluate(() => { if (healDust) healDustToggle(); });
// preview vs export geometry: spots land on the same pixels (compare downsampled export against the preview canvas)
const parity = await page.evaluate(async () => {
  const it = curItem(), src = geomCanvas(it), iw = src.width, ih = src.height, P = getFXParams();
  const full = await processToCanvas(P, src, iw, ih);
  renderPreview();
  const pv = FX.cv, sc = document.createElement('canvas'); sc.width = pv.width; sc.height = pv.height;
  const g = sc.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(full, 0, 0, sc.width, sc.height);
  const a = g.getImageData(0, 0, sc.width, sc.height).data, o = document.createElement('canvas'); o.width = pv.width; o.height = pv.height;
  const og = o.getContext('2d', { willReadFrequently: true }); og.drawImage(pv, 0, 0); const b = og.getImageData(0, 0, o.width, o.height).data;
  let s = 0, n = 0; for (let i = 0; i < a.length; i += 16) { s += Math.abs(a[i] - b[i]); n++; }
  return { mad: s / n, w: full.width, h: full.height, pw: pv.width, ph: pv.height, aspectErr: Math.abs(full.width / full.height - pv.width / pv.height) };
});
check('3000px export matches preview geometry (same aspect, low mean abs diff)', parity.aspectErr < .01 && parity.mad < 6, `mad=${parity.mad.toFixed(2)} export=${parity.w}x${parity.h} preview=${parity.pw}x${parity.ph}`);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 4. slider readout typing: display units -> raw â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// The repair must land where the overlay says it does, through rotate + straighten + crop: diff the export with and
// without the spot and require the changed pixels to centre on _healFwd(spot) at export resolution.
const loc = await page.evaluate(async () => {
  const it = curItem(), P = getFXParams(), saved = it.heal;
  const render = async () => { const s = geomCanvas(it); const c = await processToCanvas(P, s, s.width, s.height); const g = c.getContext('2d', { willReadFrequently: true }); return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data }; };
  it.heal = [saved[0]]; const withSpot = await render(); it.heal = []; const without = await render(); it.heal = saved;
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < withSpot.h; y += 2) for (let x = 0; x < withSpot.w; x += 2) { const i = (y * withSpot.w + x) * 4; if (Math.abs(withSpot.d[i] - without.d[i]) + Math.abs(withSpot.d[i + 1] - without.d[i + 1]) > 40) { sx += x; sy += y; n++; } }
  const f = _healFwd(saved[0].x, saved[0].y);
  return { n, cx: sx / n / withSpot.w, cy: sy / n / withSpot.h, ex: f.nx, ey: f.ny };
});
check('repair lands where the overlay maps it (rot90 + straighten + crop)', loc.n > 20 && Math.abs(loc.cx - loc.ex) < .02 && Math.abs(loc.cy - loc.ey) < .02, `changed centre ${loc.cx.toFixed(3)},${loc.cy.toFixed(3)} expected ${loc.ex.toFixed(3)},${loc.ey.toFixed(3)} n=${loc.n}`);
await loadPhoto(512, 384, false); // small photo: every slider input below re-renders, and a 3000px software-GL render per input is needlessly slow
await page.evaluate(() => { const st = document.createElement('style'); st.textContent = '.ff-off,.fx-fields,.fx-ctrl{display:block!important}.fx-panel,#fx-panel{overflow:visible!important}'; document.head.appendChild(st); });
const ids = await page.evaluate(() => Object.keys(CS_CONTROL_UNIT_SPECS).filter(id => id.startsWith('sl-') && document.getElementById(id) && document.getElementById('vl-' + id.slice(3))));
let covered = 0; const bad = [];
for (const id of ids) {
  const r = await Promise.race([new Promise(res => setTimeout(() => res({ skip: false, raw: 0, noop: false, retyped: -1, shown: 'TIMEOUT ' + id, tol: 0 }), 8000)), page.evaluate(async id => {
    const sl = document.getElementById(id), el = document.getElementById('vl-' + id.slice(3)), min = +sl.min, max = +sl.max, step = +sl.step || 1;
    const raw = Math.round((min + (max - min) * .75) / step) * step; sl.value = raw; sl.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 30));
    el.scrollIntoView(); el.click(); el.focus(); if (document.activeElement !== el) return { skip: true };
    const shown = el.textContent; el.blur(); await new Promise(r => setTimeout(r, 30));
    const noop = +sl.value === raw;                                   // unedited focus/blur leaves the raw value
    el.click(); el.focus(); el.textContent = shown; el.blur(); await new Promise(r => setTimeout(r, 30));
    const retyped = +sl.value;                                         // typing the displayed text back maps to the same raw value
    return { skip: false, raw, noop, retyped, shown, tol: step * 1.01 + (CS_CONTROL_UNIT_SPECS[id].scale ? 0 : 0) };
  }, id)]);
  if (r.skip) continue; covered++;
  if (!r.noop || Math.abs(r.retyped - r.raw) > Math.max(r.tol, Math.abs(r.raw) * .02 + 1)) bad.push(`${id}: raw=${r.raw} shown="${r.shown}" retyped=${r.retyped} noop=${r.noop}`);
}
check(`typed display units map back to raw for ${covered} unit-bearing controls`, covered >= 20 && bad.length === 0, bad.join(' | '));
const ev = await page.evaluate(async () => { const sl = document.getElementById('sl-adj-exp'), el = document.getElementById('vl-adj-exp'); sl.value = 40; sl.dispatchEvent(new Event('input', { bubbles: true })); el.click(); el.focus(); el.textContent = '1'; el.blur(); await new Promise(r => setTimeout(r, 50)); return { raw: +sl.value, shown: el.textContent }; });
check('typing "1" into Exposure (EV) sets raw 20', ev.raw === 20 && /1\.00 EV/.test(ev.shown), JSON.stringify(ev));

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ 5. Texture is distinct from, and stronger than, Sharpen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
await page.evaluate(() => { for (const s of document.querySelectorAll('input[id^="sl-adj-"]')) { s.value = s.getAttribute('value') || 0; s.dispatchEvent(new Event('input', { bubbles: true })); } });
await loadPhoto(512, 384, false);
const tex = await page.evaluate(async () => {
  const set = (id, v) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); };
  const snap = async () => { renderPreview(); const o = document.createElement('canvas'); o.width = FX.cv.width; o.height = FX.cv.height; const g = o.getContext('2d', { willReadFrequently: true }); g.drawImage(FX.cv, 0, 0); const d = g.getImageData(0, 0, o.width, o.height).data, L = new Float32Array(d.length / 4); for (let i = 0; i < L.length; i++) L[i] = d[i * 4] * .3 + d[i * 4 + 1] * .6 + d[i * 4 + 2] * .1; return L; };
  const tgA = document.getElementById('tg-adjust'); if (tgA && !tgA.classList.contains('on')) toggleFX('adjust');
  set('sl-adj-sharp', 0); set('sl-adj-texture', 0); await new Promise(r => setTimeout(r, 400)); await snap(); await new Promise(r => setTimeout(r, 200)); const base = await snap(), res = {};
  for (const [k, sh, tx] of [['sharp', 100, 0], ['tex', 0, 100], ['texNeg', 0, -100], ['tex0Sharp0', 0, 0]]) { set('sl-adj-sharp', sh); set('sl-adj-texture', tx); await new Promise(r => setTimeout(r, 150)); const L = await snap(); const dl = new Float32Array(L.length); let s = 0; for (let i = 0; i < L.length; i++) { dl[i] = L[i] - base[i]; s += Math.abs(dl[i]); } res[k] = { mad: s / L.length, dl }; }
  const corr = (a, b) => { let sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0; const n = a.length; for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; sab += a[i] * b[i]; saa += a[i] * a[i]; sbb += b[i] * b[i]; } return (sab / n - sa / n * sb / n) / Math.sqrt((saa / n - (sa / n) ** 2) * (sbb / n - (sb / n) ** 2)); };
  return { sharp: res.sharp.mad, tex: res.tex.mad, texNeg: res.texNeg.mad, zero: res.tex0Sharp0.mad, corrST: corr(res.sharp.dl, res.tex.dl), corrPN: corr(res.tex.dl, res.texNeg.dl) };
});
check('Texture at 100 is much stronger than Sharpen at 100', tex.tex > tex.sharp * 3, `tex=${tex.tex.toFixed(2)} sharp=${tex.sharp.toFixed(2)}`);
check('Texture and Sharpen are not the same operation', tex.corrST < .9, `corr=${tex.corrST.toFixed(2)}`);
check('negative Texture does the opposite (smooths)', tex.corrPN < -.8 && tex.texNeg > 0.5, `corr=${tex.corrPN.toFixed(2)}`);
check('Texture 0 is a no-op', tex.zero < .05, `mad=${tex.zero.toFixed(3)}`);

check('no page errors / GLSL errors', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll checks passed');
process.exit(fails ? 1 : 0);




