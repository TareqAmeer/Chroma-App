// Visual contract for the Editor photo reveal (desktop/library-ui.js, `const reveal`).
// The previous version of this test only checked that event NAMES were logged, and passed while
// the effect was visibly broken. This one freezes the running animations at fixed points and
// samples real screen pixels + the frame's real geometry:
//   exit 50%   → top of the old photo still visible, bottom half already background, frame on the OLD rect
//   morph      → starts only after the exit has finished
//   fill 50%   → frame on the NEW canvas rect (±1px), top half new photo, bottom half background
//   settled    → frame invisible, canvas fully visible, no clip/hold left behind
//   rapid 5×   → the last photo wins, no stale-path fill after its begin
//   pref OFF / reduced motion → no frame, canvas never hidden
//   cancel     → everything cleared at once
// Uses ?libshapes=1: odd photos are red 3:2 landscapes, even photos blue 2:3 portraits.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
    const ext = path.extname(name), types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm' };
    const body = await readFile(path.join(root, name));
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const fail = (msg) => { failures.push(msg); console.error(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);
const LAB = { exit: 1200, morph: 1200, fill: 1200, settle: 800, speedup: 1, ease: 'linear', edge: 'hard', waiting: 'still', strength: 0.6 };

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((lab) => { try { localStorage.setItem('chromasmithRevealLab', JSON.stringify(lab)); localStorage.setItem('chromasmithPhotoTransitions', '1'); } catch (_) {} }, LAB);
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=7&deskx=1&libshapes=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__chromasmithReveal && document.querySelectorAll('#lib-grid .lib-card').length > 4, null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 5 && await page.evaluate(() => !!document.querySelector('#cs-modal-ov')); i++) {
    await page.evaluate(() => { document.querySelectorAll('#cs-modal-ov button, button').forEach((b) => { if (/^(Got it|OK|Close|Not now|Skip)$/i.test(b.textContent.trim())) b.click(); }); });
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  }

  const card = (n) => page.locator(`#lib-grid .lib-card[data-path$="IMG_${1000 + n}.RW2"]`);
  const phase = () => page.evaluate(() => window.__chromasmithReveal.phase());
  const waitPhase = (p, timeout = 15000) => page.waitForFunction((want) => window.__chromasmithReveal.phase() === want, p, { timeout, polling: 'raf' });
  // Pause the RUNNING reveal animations at a fraction of their duration (finished ones — e.g. the
  // frame's completed glide, held by fill:forwards — are left alone, or they'd be rewound).
  const freezeAt = (frac) => page.evaluate((f) => {
    const list = document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && (a.effect.target.closest('#fx-reveal') || a.effect.target.id === 'fx-zoom-wrap'));
    list.forEach((a) => { a.pause(); const d = a.effect.getComputedTiming().duration; a.currentTime = d * f; });
    return list.length;
  }, frac);
  const resume = () => page.evaluate(() => document.getAnimations().forEach((a) => { if (a.playState === 'paused') a.play(); }));
  const geom = () => page.evaluate(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
    const lines = [...document.querySelectorAll('#fx-reveal .fx-reveal-line')].map(r);
    const frame = lines.length === 4 ? { x: lines[0].x, y: lines[0].y, w: lines[0].w, h: lines[2].h } : null;
    const wrap = document.getElementById('fx-wrap').getBoundingClientRect();
    return { frame, zoom: r(document.getElementById('fx-zoom-wrap')), snap: r(document.querySelector('#fx-reveal .fx-reveal-snap')), bgAt: { x: wrap.left + 4, y: wrap.top + 4 } };
  });
  const shot = async () => PNG.sync.read(await page.screenshot());
  const px = (img, x, y) => { const i = (Math.round(y) * img.width + Math.round(x)) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
  const near = (a, b, tol = 40) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= tol;
  const RED = [192, 57, 43], BLUE = [46, 134, 222];
  const rectNear = (a, b, tol = 1.5) => a && b && ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) <= tol);
  const fmt = (r) => r ? `${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.w.toFixed(0)}×${r.h.toFixed(0)}` : 'none';

  console.log('1. First open (red landscape)');
  await card(1).dblclick();
  await page.waitForFunction(() => typeof FX !== 'undefined' && FX.w > 0, null, { timeout: 15000 });
  await waitPhase('idle');
  const g1 = await geom();
  let img = await shot();
  if (near(px(img, g1.zoom.x + g1.zoom.w / 2, g1.zoom.y + g1.zoom.h * 0.6), RED)) ok(`landscape visible at ${fmt(g1.zoom)}`); else fail(`landscape not visible after first open (centre pixel ${px(img, g1.zoom.x + g1.zoom.w / 2, g1.zoom.y + g1.zoom.h * 0.6)})`);

  console.log('2. Landscape → portrait (step mode: each animation starts paused)');
  await page.evaluate(() => { window.__rawPerfLog = []; window.__revealStep = true; });
  // Reveal animations currently paused by step mode.
  const paused = () => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'paused' && a.effect?.target?.closest && (a.effect.target.closest('#fx-reveal') || a.effect.target.id === 'fx-zoom-wrap')).map((a) => a.effect.target.className || a.effect.target.id));
  const seek = (frac) => page.evaluate((f) => document.getAnimations().forEach((a) => { if (a.playState === 'paused' && a.effect?.target?.closest && (a.effect.target.closest('#fx-reveal') || a.effect.target.id === 'fx-zoom-wrap')) a.currentTime = a.effect.getComputedTiming().duration * f; }), frac);
  const finishPaused = () => page.evaluate(() => document.getAnimations().forEach((a) => { if (a.playState === 'paused' && a.effect?.target?.closest && (a.effect.target.closest('#fx-reveal') || a.effect.target.id === 'fx-zoom-wrap')) a.finish(); }));
  const logHas = (ev) => page.evaluate((e) => (window.__rawPerfLog || []).some((x) => x.event === e), ev);
  await card(2).dblclick();
  await waitPhase('exiting', 5000);
  let names = await paused();
  if (names.length === 1 && /fx-reveal-snap/.test(names[0])) ok('exit: only the old-photo snapshot animates (frame not moving yet)'); else fail(`exit: expected only the snapshot animating, got ${names.join(',')}`);
  await seek(0.5);
  let g = await geom(); img = await shot();
  const bg = px(img, g.bgAt.x, g.bgAt.y);
  const oldR = g1.zoom;
  const topOld = px(img, oldR.x + oldR.w / 2, oldR.y + oldR.h * 0.3), botOld = px(img, oldR.x + oldR.w / 2, oldR.y + oldR.h * 0.8);
  if (!near(topOld, RED, 140)) fail(`exit 50%: top of old photo should still show (fading) red, got ${topOld}`); else ok(`exit 50%: top of old photo still showing (${topOld})`);
  if (!near(botOld, bg)) fail(`exit 50%: bottom of old photo should already be background ${bg}, got ${botOld}`); else ok('exit 50%: bottom edge has risen');
  if (rectNear(g.frame, oldR)) ok(`exit: frame holds the old rect ${fmt(g.frame)}`); else fail(`exit: frame should stay on old rect ${fmt(oldR)}, is ${fmt(g.frame)}`);
  await finishPaused();
  await waitPhase('morphing', 3000);
  names = await paused();
  if (names.length === 4 && names.every((n) => /fx-reveal-line/.test(n))) ok('morph: starts only after the exit finished, frame lines animate'); else fail(`morph: expected 4 frame-line animations, got ${names.join(',')}`);
  await seek(0.5);
  g = await geom();
  if (g.frame && g.frame.w < oldR.w && g.frame.h > oldR.h) ok(`morph 50%: frame between shapes ${fmt(g.frame)}`); else fail(`morph 50%: frame should be between landscape and portrait, is ${fmt(g.frame)}`);
  // Advance (finishing any glide) until the fill sweep exists.
  for (let i = 0; i < 20 && !(await logHas('reveal-fill')); i++) { await finishPaused(); await page.waitForTimeout(100); }
  await seek(0.5);
  g = await geom(); img = await shot();
  if (rectNear(g.frame, g.zoom)) ok(`fill: frame matches the new canvas ${fmt(g.zoom)}`); else fail(`fill: frame ${fmt(g.frame)} should match canvas ${fmt(g.zoom)}`);
  if (g.zoom.h > g.zoom.w) ok('fill: new canvas is portrait'); else fail(`fill: canvas should be portrait, is ${fmt(g.zoom)}`);
  const topNew = px(img, g.zoom.x + g.zoom.w / 2, g.zoom.y + g.zoom.h * 0.3), botNew = px(img, g.zoom.x + g.zoom.w / 2, g.zoom.y + g.zoom.h * 0.8);
  if (near(topNew, BLUE, 60)) ok('fill 50%: top half shows the new photo'); else fail(`fill 50%: top half should be blue, got ${topNew}`);
  if (near(botNew, bg)) ok('fill 50%: bottom half still empty'); else fail(`fill 50%: bottom half should be background ${bg}, got ${botNew}`);
  await finishPaused(); await page.waitForTimeout(50);
  if ((await phase()) === 'settling') ok('settle: border fades after the fill'); else fail(`expected settling after fill, got ${await phase()}`);
  await finishPaused();
  await page.evaluate(() => { window.__revealStep = false; });
  await waitPhase('idle', 8000);
  const settled = await page.evaluate(() => {
    const z = document.getElementById('fx-zoom-wrap'), cs = getComputedStyle(z), fr = document.querySelector('#fx-reveal .fx-reveal-frame');
    return { hold: document.body.classList.contains('lib-reveal-hold'), host: !!document.querySelector('#fx-reveal.on'), clip: cs.clipPath, op: cs.opacity, frameOp: fr ? getComputedStyle(fr).opacity : '0' };
  });
  if (!settled.hold && !settled.host && settled.clip === 'none' && settled.op === '1' && +settled.frameOp < 0.05) ok('settled: frame gone, canvas fully visible, nothing left behind');
  else fail(`settled state wrong: ${JSON.stringify(settled)}`);
  img = await shot(); g = await geom();
  if (near(px(img, g.zoom.x + g.zoom.w / 2, g.zoom.y + g.zoom.h * 0.8), BLUE, 60)) ok('settled: portrait fully visible'); else fail('settled: portrait not fully visible');

  console.log('3. Rapid navigation (5 opens in <1s)');
  await page.evaluate(() => { window.__rawPerfLog = []; });
  for (const n of [3, 4, 5, 1, 2]) { await card(n).dblclick({ delay: 0 }); await page.waitForTimeout(120); }
  await page.waitForFunction(() => window.__chromasmithReveal.phase() === 'idle' && document.querySelector('.lib-card.sel')?.dataset.path.endsWith('IMG_1002.RW2'), null, { timeout: 30000 });
  img = await shot(); g = await geom();
  const stale = await page.evaluate(() => {
    const l = window.__rawPerfLog, lastBegin = l.map((e) => e.event === 'reveal-begin' && e.path.endsWith('IMG_1002.RW2')).lastIndexOf(true);
    return l.slice(lastBegin + 1).filter((e) => e.event === 'reveal-fill' && !e.path.endsWith('IMG_1002.RW2')).map((e) => e.path);
  });
  if (!stale.length) ok('no stale-path fill after the final click'); else fail(`stale fills: ${stale.join(', ')}`);
  if (near(px(img, g.zoom.x + g.zoom.w / 2, g.zoom.y + g.zoom.h * 0.8), BLUE, 60) && g.zoom.h > g.zoom.w) ok('final photo (portrait #2) is the one shown'); else fail(`final canvas wrong: ${fmt(g.zoom)} ${px(img, g.zoom.x + g.zoom.w / 2, g.zoom.y + g.zoom.h * 0.8)}`);

  const neverHidden = async (label, n) => {
    await page.evaluate(() => { window.__revealWatch = { hold: false, host: false }; const tick = () => { if (!window.__revealWatch) return; if (document.body.classList.contains('lib-reveal-hold')) window.__revealWatch.hold = true; if (document.querySelector('#fx-reveal.on')) window.__revealWatch.host = true; requestAnimationFrame(tick); }; tick(); });
    await card(n).dblclick();
    await page.waitForTimeout(1500);
    const w = await page.evaluate(() => { const r = window.__revealWatch; window.__revealWatch = null; return r; });
    if (!w.hold && !w.host) ok(`${label}: instant swap, canvas never hidden`); else fail(`${label}: reveal still ran ${JSON.stringify(w)}`);
  };
  console.log('4. Preference OFF');
  await page.evaluate(() => { window.chromasmithPhotoTransitions = false; });
  await neverHidden('Photo transitions off', 1);
  await page.evaluate(() => { window.chromasmithPhotoTransitions = true; });
  console.log('5. Reduced motion');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await neverHidden('Reduced motion', 2);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  console.log('6. Cancel (error path) and Replay');
  const cancelled = await page.evaluate(async () => {
    const r = window.__chromasmithReveal; r.begin('/test/missing.RW2', 1.5); r.cancel('/test/missing.RW2');
    return { phase: r.phase(), hold: document.body.classList.contains('lib-reveal-hold'), host: !!document.querySelector('#fx-reveal.on') };
  });
  if (cancelled.phase === 'idle' && !cancelled.hold && !cancelled.host) ok('cancel clears everything immediately'); else fail(`cancel left state: ${JSON.stringify(cancelled)}`);
  await page.evaluate(() => window.__chromasmithReveal.replay());
  await waitPhase('exiting', 2000);
  await waitPhase('idle', 10000);
  ok('replay runs the full sequence back to idle');
  console.log('7. Reveal lab on/off switch');
  const sw = await page.evaluate(() => {
    window.chromasmithRevealLab();
    const cb = document.querySelector('#fx-reveal-lab .rl-enable');
    cb.checked = false; cb.dispatchEvent(new Event('change'));
    const off = window.chromasmithPhotoTransitions === false && localStorage.getItem('chromasmithPhotoTransitions') === '0';
    cb.checked = true; cb.dispatchEvent(new Event('change'));
    const on = window.chromasmithPhotoTransitions === true && localStorage.getItem('chromasmithPhotoTransitions') === '1';
    document.getElementById('fx-reveal-lab').remove();
    return { off, on };
  });
  if (sw.off && sw.on) ok('lab switch turns photo transitions off and back on (same preference as the menu)'); else fail(`lab switch: ${JSON.stringify(sw)}`);
  if (errors.length) fail(`page errors: ${errors.join(' | ')}`);
  await page.close();
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
if (failures.length) { console.error(`FAIL: ${failures.length} reveal check(s) failed`); process.exit(1); }
console.log('PASS: photo reveal — exit, morph order, fill, settle, rapid navigation, preference, reduced motion, cancel, replay.');
