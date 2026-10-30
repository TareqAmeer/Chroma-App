#!/usr/bin/env node
// Lightroom-style mask groups: a mask plus the components added / subtracted / intersected onto it
// is ONE mask with ONE set of adjustments, applied to the combined shape. Renders with the real
// GLSL and checks pixels, then drives the panel to prove a selected component edits the group.
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.join(ROOT, pathname === '/' ? 'chromasmith-22.html' : pathname.slice(1));
    const body = await readFile(file);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
let done = false;
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }), errors = [];
  page.on('console', msg => { if (msg.type() === 'error' && /GLSL compile error|LINK FAILED|SHADER_COMPILE/i.test(msg.text())) errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(`page error: ${err.message}`));
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FX !== 'undefined', null, { timeout: 30000 });

  const r = await page.evaluate(async () => {
    document.querySelector('[data-tour-action="close"]')?.click(); document.getElementById('cs-modal-ov')?.remove();
    const w = 800, h = 400, src = document.createElement('canvas'); src.width = w; src.height = h;
    const ctx = src.getContext('2d'); ctx.fillStyle = 'rgb(100,100,100)'; ctx.fillRect(0, 0, w, h);
    const blob = await new Promise(res => src.toBlob(res, 'image/png'));
    await loadFXImages([new File([blob], 'group.png', { type: 'image/png' })]);
    await new Promise(res => { const t0 = Date.now(); const poll = () => fxImages.length || Date.now() - t0 > 30000 ? res() : setTimeout(poll, 20); poll(); });
    if (!fxImages.length) throw new Error('fixture image did not load');
    const img = curItem().img, iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const fxr = new FXR(document.createElement('canvas'));
    const radial = (id, cx, cy, rx, ry, extra) => ({ id, name: id, type: 'radial', cx, cy, rx, ry, feather: 0.02, amount: 100, compositionMigrated: true,
      ..._mskAdjustDefaults(), ..._mskSkinDefaults(), ...extra });
    const lum = (masks, pts) => {
      const P = getFXParams();
      P.grain = { enabled: false }; P.halation = { enabled: false }; P.bloom = { enabled: false };
      P.adjust = { enabled: false }; P.lut = null; P.print = null; P.vignette = { enabled: false }; P.redEyeOps = [];
      P.masks = masks;
      fxr.setImage(img); fxr.render(P, iw, ih, { glowScale: 1, seed: 4.25 });
      const { px, w: rw } = fxr.getPixels();
      return pts.map(([x, y]) => { const X = Math.round(x * (rw - 1)), Y = Math.round(y * (px.length / 4 / rw - 1)); return px[(Y * rw + X) * 4 + 1]; });
    };
    const out = {};
    const pts = [[.25, .5], [.75, .5], [.5, .1]];      // left blob, right blob, untouched corner
    out.base = lum([], pts);
    // Add: Foreground-style root on the left carries the edit; the added component covers the right.
    out.add = lum([radial('root', .25, .5, .12, .25, { exp: 1.0 }), radial('c1', .75, .5, .12, .25, { composeOp: 'add', operandId: 'root' })], pts);
    // Subtract: a wide root minus a small component in its middle.
    const ptsSub = [[.5, .5], [.2, .5], [.5, .05]];
    out.subBase = lum([], ptsSub);
    out.sub = lum([radial('root', .5, .5, .45, .45, { exp: 1.0 }), radial('c1', .5, .5, .1, .2, { composeOp: 'subtract', operandId: 'root' })], ptsSub);
    // Intersect: only where both overlap.
    const ptsInt = [[.5, .5], [.3, .5], [.7, .5]];
    out.intBase = lum([], ptsInt);
    out.int = lum([radial('root', .38, .5, .2, .3, { exp: 1.0 }), radial('c1', .62, .5, .2, .3, { composeOp: 'intersect', operandId: 'root' })], ptsInt);
    // Chain of two components (what the + / − buttons now build): (root ∪ c1) − c2.
    const ptsChain = [[.25, .5], [.75, .5], [.75, .5]];
    out.chain = lum([radial('root', .25, .5, .12, .25, { exp: 1.0 }), radial('c1', .75, .5, .12, .25, { composeOp: 'add', operandId: 'root' }),
      radial('c2', .75, .5, .06, .1, { composeOp: 'subtract', operandId: 'c1' })], ptsChain);
    // Hiding a component (its eye) drops just that component; hiding the main mask hides the group.
    out.hiddenComp = lum([radial('root', .25, .5, .12, .25, { exp: 1.0 }), radial('c1', .75, .5, .12, .25, { composeOp: 'add', operandId: 'root', muted: true })], pts);
    out.hiddenRoot = lum([radial('root', .25, .5, .12, .25, { exp: 1.0, muted: true }), radial('c1', .75, .5, .12, .25, { composeOp: 'add', operandId: 'root' })], pts);
    // Legacy: a composed mask with its OWN adjustments keeps the old "self op operand" meaning.
    out.legacy = lum([radial('a', .25, .5, .12, .25, {}), radial('b', .75, .5, .12, .25, { exp: 1.0, composeOp: 'subtract', operandId: 'a' })], pts);

    // Panel: build root + component through the real compose path, select the component, move Exposure.
    fxState.masks = [radial('root', .25, .5, .12, .25, {})]; fxImages[fxCurIdx].masks = fxState.masks; mskSel = 0;
    const tg = document.getElementById('tg-local'); if (tg && !tg.classList.contains('on')) toggleFX('local');
    _mskGroupOpen.adjust = true; mskRebuild();
    mskComposeMenu({ stopPropagation() {}, currentTarget: document.body, target: document.body }, 'add'); document.querySelectorAll('.msk-more-menu').forEach(e => e.remove());
    mskAdd('radial');
    out.firstOperand = fxState.masks[1].operandId; // root selected again below: the next component still chains onto c1
    mskSel = 0; mskComposeMenu({ stopPropagation() {}, currentTarget: document.body, target: document.body }, 'subtract'); document.querySelectorAll('.msk-more-menu').forEach(e => e.remove());
    mskAdd('radial');
    out.secondOperand = fxState.masks[2].operandId === fxState.masks[1].id ? 'c1' : fxState.masks[2].operandId;
    mskSel = 1; mskRebuild();
    const exp = document.querySelector('#local-ctl input[data-k="exp"]');
    exp.value = '40'; mskSlide(exp);
    out.rootExp = fxState.masks[0].exp; out.compExp = fxState.masks[1].exp;
    out.panelTitle = document.querySelector('#local-ctl .msk-rowbar-nm')?.textContent;
    mskRebuild();
    out.sliderShows = document.querySelector('#local-ctl input[data-k="exp"]').value;
    out.depths = [...document.querySelectorAll('#local-list > button')].map(b => b.dataset.depth || '0');
    // Deleting the middle component keeps the rest of the group attached.
    const c2 = fxState.masks[2]; mskSel = 1; mskDelete();
    out.relinked = c2.operandId === fxState.masks[0].id;
    out.validAfterDelete = _mskCompositionPlan(fxState.masks).valid.every(Boolean);
    // Deleting the main mask deletes its components too.
    fxState.masks = [radial('root', .25, .5, .12, .25, { exp: 1 }), radial('c1', .75, .5, .12, .25, { composeOp: 'add', operandId: 'root' }), radial('other', .5, .1, .1, .1, { exp: .5 })];
    mskSel = 0; mskDelete(); out.afterRootDelete = fxState.masks.map(m => m.id);
    return out;
  });
  const d = (a, b) => a.map((v, i) => v - b[i]);
  const add = d(r.add, r.base), sub = d(r.sub, r.subBase), inter = d(r.int, r.intBase), chain = d(r.chain, r.base), legacy = d(r.legacy, r.base);
  console.log({ dAdd: add, dSub: sub, dInt: inter, dChain: chain, dLegacy: legacy, panel: r.panelTitle, depths: r.depths });
  assert.ok(add[0] > 20, 'Add: root area takes the group edit');
  assert.ok(add[1] > 20, 'Add: the added component takes the group edit');
  assert.ok(Math.abs(add[2]) <= 1, 'Add: outside both stays untouched');
  assert.ok(Math.abs(sub[0]) <= 1, 'Subtract: the subtracted hole is untouched');
  assert.ok(sub[1] > 20, 'Subtract: the rest of the root keeps the edit');
  assert.ok(Math.abs(sub[2]) <= 1, 'Subtract: outside the root stays untouched');
  assert.ok(inter[0] > 20, 'Intersect: the overlap takes the edit');
  assert.ok(Math.abs(inter[1]) <= 1 && Math.abs(inter[2]) <= 1, 'Intersect: non-overlapping parts are untouched');
  assert.ok(chain[0] > 20 && Math.abs(chain[1]) <= 1, 'Chain: (root + c1) - c2');
  const hc = d(r.hiddenComp, r.base), hr = d(r.hiddenRoot, r.base);
  assert.ok(hc[0] > 20 && Math.abs(hc[1]) <= 1, 'a hidden component drops out, the rest of the group keeps the edit');
  assert.ok(Math.abs(hr[0]) <= 1 && Math.abs(hr[1]) <= 1, 'hiding the main mask hides the whole group');
  assert.deepEqual(r.afterRootDelete, ['other'], 'deleting the main mask deletes its components');
  assert.ok(Math.abs(legacy[0]) <= 1 && legacy[1] > 20, 'Legacy component with its own adjustments keeps self-minus-operand');
  assert.equal(r.firstOperand, 'root');
  assert.equal(r.secondOperand, 'c1', 'a second component chains onto the group so the result is cumulative');
  assert.ok(r.rootExp > 0.1, 'a slider moved with a component selected edits the group (root)');
  assert.equal(r.compExp, 0, 'the component itself stays without adjustments');
  assert.equal(r.sliderShows, '40', 'the component shows the group adjustments');
  assert.deepEqual(r.depths, ['0', '1', '1']);
  assert.ok(r.relinked && r.validAfterDelete, 'deleting a middle component relinks the next one');
  assert.deepEqual(errors, []);
  done = true; console.log('PASS mask groups: one adjustment set on the combined add/subtract/intersect shape');
} finally { await browser.close(); server.close(); if (!done) process.exitCode = 1; }
