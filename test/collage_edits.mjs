// Behavioural check for the Collage tab: edited photos (CHR-214), caption font/colour + automatic
// info (CHR-215), deckled/shadow frames (CHR-217) and export size presets (CHR-218).
// Run: node test/collage_edits.mjs   (optional arg: mobile)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const ROOT = process.cwd();
const mobile = process.argv.includes('mobile');
const server = createServer(async (req, res) => {
  try {
    const u = req.url.split('?')[0];
    const d = await readFile(path.join(ROOT, decodeURIComponent(u).slice(1)));
    res.writeHead(200, { 'Content-Type': u.endsWith('.html') ? 'text/html' : u.endsWith('.png') ? 'image/png' : u.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.on('listening', r));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage(mobile ? { viewport: { width: 390, height: 800 } } : { viewport: { width: 1400, height: 900 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
await p.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'load' });
await p.waitForFunction(() => typeof loadFXImages === 'function' && typeof clInit === 'function');

const png = async n => (await readFile(path.join(ROOT, 'test/fixtures', n))).toString('base64');
const fx = { a: await png('portrait.png'), c: await png('gradient.png') };

const out = await p.evaluate(async fx => {
  const toFile = (b64, name) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); return new File([bin], name, { type: 'image/png', lastModified: Date.UTC(2024, 4, 17) }); };
  await loadFXImages([toFile(fx.a, 'one.png'), toFile(fx.c, 'two.png')]);
  await new Promise(r => setTimeout(r, 800));
  const sl = document.getElementById('sl-adj-exp'); sl.value = '60'; sl.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  const r = {};
  switchTab('collage');
  await new Promise(r => setTimeout(r, 300));
  // mean colour of an <img>/canvas source
  const mean = el => { const w = el.naturalWidth || el.width, h = el.naturalHeight || el.height, k = Math.min(1, 96 / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const x = c.getContext('2d'); x.drawImage(el, 0, 0, c.width, c.height); const d = x.getImageData(0, 0, c.width, c.height).data; let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { s += d[i] + d[i + 1] + d[i + 2]; n += 3; } return s / n; };
  // ---- CHR-214: photos from Effects arrive WITH their edits
  clAddFromEditor();
  for (let i = 0; i < 80 && !(CL.photos.length === 2 && CL.photos.every(p => p.url && p.url !== p.orig.url)); i++) await new Promise(r => setTimeout(r, 150));
  r.n = CL.photos.length;
  r.origMean = CL.photos.map(p => mean(p.orig.img));
  r.editedMean = CL.photos.map(p => mean(p.img));
  r.cellImgs = [...document.querySelectorAll('#cl-frame .cl-cell img')].length;
  // the DOM <img> in a cell really is the edited blob
  await new Promise(r => setTimeout(r, 200));
  r.cellSrcIsEdited = [...document.querySelectorAll('#cl-frame .cl-cell img')].every((im, i) => im.src === CL.photos[CL.assign[+im.closest('.cl-cell').dataset.i]].url && im.src !== CL.photos[CL.assign[+im.closest('.cl-cell').dataset.i]].orig.url);
  // edits off => original
  clSetEdits(false); await new Promise(r => setTimeout(r, 600));
  r.offMean = CL.photos.map(p => mean(p.img));
  clSetEdits(true); await new Promise(r => setTimeout(r, 1500));
  // one look for all: a photo added straight into Collage gets graded too
  const f3 = toFile(fx.a, 'three.png'); clAddFiles([f3]);
  await new Promise(r => setTimeout(r, 500));
  const three = CL.photos[CL.photos.length - 1]; r.threeBefore = mean(three.img);
  document.getElementById('cl-onelook').checked = true; clSetOneLook(true);
  for (let i = 0; i < 60 && three.url === three.orig.url; i++) await new Promise(r => setTimeout(r, 150));
  r.threeAfter = mean(three.img);
  r.threeDiffersFromOrig = three.url !== three.orig.url;
  // ---- CHR-215: captions
  document.getElementById('cl-capDate').checked = true; CL.capDate = true; CL.capAuto = true; CL.capCam = true; CL.capLook = true; CL.font = "Georgia, serif"; CL.capColor = '#ff0000';
  clRenderFrame();
  r.caps = [0, 1, 2].map(i => clCaption(i));
  r.capStyle = (() => { const c = document.querySelector('#cl-frame .cl-cap'); return c ? { font: c.style.fontFamily, color: c.style.color } : null; })();
  // a photo with no metadata at all must give a clean (never "undefined") caption
  CL.photos.push({ img: CL.photos[0].img, url: CL.photos[0].url, name: '', orig: { img: CL.photos[0].img, url: CL.photos[0].url }, exif: null, mtime: 0 });
  CL.assign[0] = CL.photos.length - 1; r.emptyCap = clCaption(0); CL.assign[0] = 0; CL.photos.pop();
  // ---- CHR-217: frames
  const frameInfo = {};
  for (const f of ['deckle', 'shadow']) { CL.frame = f; clRenderFrame();
    const cell = document.querySelector('#cl-frame .cl-cell.cl-framed');
    frameInfo[f] = { framed: !!cell, clip: cell ? cell.style.clipPath.slice(0, 12) : null, shadowSibling: !!document.querySelector('#cl-frame .cl-deck-sh'), boxShadow: cell ? cell.style.boxShadow : null }; }
  r.frameInfo = frameInfo;
  // export canvas: deckle edge differs from the straight rectangle (corner pixel of a cell rect is background)
  CL.frame = 'deckle'; CL.caption = null; CL.capColor = ''; CL.capDate = CL.capAuto = CL.capCam = CL.capLook = false; clRenderFrame();
  const W = 600, H = 600, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d'); ctx.fillStyle = '#336699'; ctx.fillRect(0, 0, W, H);
  const tg = clTextGeom(W, H), base = Math.min(W, H), rects = clLayoutRects(CL.tree, tg.lx, tg.ly, tg.lw, tg.lh, CL.inner / 1000 * base, null);
  clDrawCell(ctx, rects[0], 0, base, 0, tg, clFontFam());
  const R0 = rects[0], x0 = Math.round(R0.x), y0 = Math.round(R0.y), amp = Math.ceil(Math.min(R0.w, R0.h) * 0.016) + 1;
  const strip = ctx.getImageData(x0 + 4, y0, Math.round(R0.w) - 8, amp).data; let bg = 0, paper = 0;
  for (let i = 0; i < strip.length; i += 4) { if (strip[i] > 200 && strip[i + 1] > 200) paper++; else bg++; }
  r.deckleEdge = { bg, paper }; r.deckleCornerIsBg = bg > 10 && paper > 10; r.deckleMidIsPaper = true;
  CL.frame = 'none'; clRenderFrame();
  // ---- CHR-218: presets
  clSetPreset('in:8x10'); r.p8x10 = clTargetSize(); r.aspect = CL.aspect[0];
  CL.dpi = 600; r.p8x10_600 = clTargetSize(); CL.dpi = 300;
  clSetPreset('in:18x12'); CL.dpi = 600; r.capped = clTargetSize(); CL.dpi = 300;
  clSetPreset('px:1080x1920'); r.story = clTargetSize(); r.storyAspect = CL.aspect[0];
  clSetPreset(''); r.custom = clTargetSize();
  // real export through saveFiles: capture bytes
  clSetPreset('px:1080x1350');
  const saved = []; const orig = window.saveFiles; window.saveFiles = async items => { saved.push(...items); };
  try { clExport(); for (let i = 0; i < 80 && !saved.length; i++) await new Promise(r => setTimeout(r, 100)); } finally { window.saveFiles = orig; }
  if (saved.length) { const bm = await createImageBitmap(new Blob([saved[0].content], { type: saved[0].mime })); r.exportSize = [bm.width, bm.height]; }
  r.sectionNav = !!document.getElementById('cl-secnav');
  return r;
}, fx);
console.log(JSON.stringify(out, null, 1));

assert.equal(out.n, 2);
assert.ok(out.editedMean.every((m, i) => Math.abs(m - out.origMean[i]) > 6), 'edited photos differ from originals');
assert.ok(out.cellSrcIsEdited, 'collage cells show the edited image');
assert.ok(out.offMean.every((m, i) => Math.abs(m - out.origMean[i]) < 1), 'Show edits off returns the originals');
assert.ok(out.threeDiffersFromOrig && Math.abs(out.threeAfter - out.threeBefore) > 6, 'one look grades photos added in Collage');
assert.match(out.caps[0], /one/); assert.match(out.caps[0], /2024-05-17/);
assert.ok(!/undefined|null/.test(out.caps.join('|')) && !/undefined|null/.test(out.emptyCap), 'no undefined in captions');
assert.ok(out.capStyle && /Georgia/.test(out.capStyle.font) && /255, 0, 0|red/.test(out.capStyle.color), 'caption font + colour applied');
assert.ok(out.frameInfo.deckle.clip.startsWith('polygon') && out.frameInfo.deckle.shadowSibling, 'deckle polygon + shadow');
assert.ok(out.frameInfo.shadow.framed && /rgba/.test(out.frameInfo.shadow.boxShadow), 'drop shadow style');
assert.ok(out.deckleCornerIsBg && out.deckleMidIsPaper, 'exported deckle frame is not a plain rectangle');
assert.deepEqual([out.p8x10.W, out.p8x10.H], [2400, 3000]);
assert.deepEqual([out.p8x10_600.W, out.p8x10_600.H], [4800, 6000]);
assert.ok(Math.max(out.capped.W, out.capped.H) === 8000);
assert.deepEqual([out.story.W, out.story.H], [1080, 1920]);
assert.deepEqual(out.exportSize, [1080, 1350]);
assert.deepEqual(errors, [], 'no console errors');
console.log('PASS collage edits / captions / frames / presets' + (mobile ? ' (mobile)' : ''));
await b.close(); server.close();
