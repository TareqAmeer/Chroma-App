// Regression probe: the Library Survey/Cull preview must render each photo's saved film look
// (sel-lut from its sidecar recipe), not whatever look the Editor currently holds, and its grain
// must be sized against the export width (as the Editor's Fit preview is), not the small preview.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
    if (pathname.endsWith('coi-serviceworker.min.js') || pathname.endsWith('service-worker.js')) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(''); return; }
    const sourcePath = pathname === 'desktop/dist/library-ui.js' ? 'desktop/library-ui.js' : pathname;
    const body = await readFile(path.join(root, sourcePath));
    const type = sourcePath.endsWith('.html') ? 'text/html' : /\.m?js$/.test(sourcePath) ? 'text/javascript' : sourcePath.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
try {
  let page;
  const errors = [];
  const newPage = async () => { if (page) await page.context().close(); page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  if (process.env.PROBE_VERBOSE) page.on('console', (m) => console.log('[page]', m.type(), m.text().slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' && /GLSL/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => { try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); } catch {} }); };
  const boot = async () => {
    await newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=6`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => typeof window.__libEnterSurvey === 'function' && typeof window.__libOpenFolder === 'function', { timeout: 60000 });
    await page.evaluate(() => document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); }));
    await page.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });
    await page.evaluate(() => window.__libOpenFolder('/test/Photos'));
    await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length >= 3, { timeout: 30000 });
  };
  let paths = [];

  // Render the survey for [A, B] and return per-cell mean RGB + a grain measure (mean |pixel - 3x3 box blur| luma).
  const survey = async (seedB, bigB = false) => {
    await boot();
    paths = await page.locator('#lib-grid .lib-card').evaluateAll((cards) => cards.map((c) => c.dataset.path).filter((p) => /\.RW2$/i.test(p)).slice(0, 2));
    await page.evaluate(async ([ps, big]) => { window.__libtestFileBytes = Object.create(null); for (const p of ps) window.__libtestFileBytes[p] = await (await fetch('/test/fixtures/portrait.png')).arrayBuffer();
      if (big) { // a camera-sized smooth frame, so the preview is ~10x smaller than the export
        const c = document.createElement('canvas'); c.width = 4800; c.height = 3200; const g = c.getContext('2d');
        const gr = g.createLinearGradient(0, 0, 4800, 3200); gr.addColorStop(0, '#c89a70'); gr.addColorStop(.5, '#7f8a96'); gr.addColorStop(1, '#3a3028');
        g.fillStyle = gr; g.fillRect(0, 0, 4800, 3200);
        window.__libtestFileBytes[ps[1]] = window.__bigBytes = await (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer();
      } }, [paths, bigB]);
    await page.evaluate(([a, b, ra, rb]) => { window.__libtestSeedSidecar(a, { edited: true, recipe: ra }); window.__libtestSeedSidecar(b, { edited: true, recipe: rb }); }, [paths[0], paths[1], enc(plain), enc(seedB)]);
    await page.evaluate((sel) => { sel.forEach((p) => window.__libSelect(p)); }, paths);
    await page.evaluate(() => window.__libEnterSurvey());
    await page.waitForFunction(() => { const c = [...document.querySelectorAll('#lib-survey .lib-survey-cell canvas')]; return c.length === 2 && c.every((e) => e.width > 8) && [...document.querySelectorAll('#lib-survey .lib-survey-cell')].every((e) => +e.dataset.sourceWidth > 8); }, null, { timeout: 60000 }).catch(async (e) => { console.error('DIAG', await page.evaluate(() => JSON.stringify({ st: window.__libSurveyState(), html: document.getElementById('lib-survey')?.innerHTML.slice(0, 600), cv: [...document.querySelectorAll('#lib-survey canvas')].map((c) => c.width), ds: [...document.querySelectorAll('.lib-survey-cell')].map((c) => JSON.stringify(c.dataset) + (c.querySelector('.lib-detail-error')?.textContent || '')), fx: typeof fxImages !== 'undefined' ? fxImages.length : -1 }))); throw e; });
    await page.waitForTimeout(1500);
    const out = await page.evaluate(() => [...document.querySelectorAll('#lib-survey .lib-survey-cell canvas')].map((cv) => {
      const g = cv.getContext('2d'), w = cv.width, h = cv.height, d = g.getImageData(0, 0, w, h).data;
      let r = 0, gg = 0, b = 0, n = w * h, hf = 0, hn = 0;
      const L = (x, y) => { const i = (y * w + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
      for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) { let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += L(x + dx, y + dy); hf += Math.abs(L(x, y) - s / 9); hn++; }
      return { w, h, mean: [r / n, gg / n, b / n].map((v) => +v.toFixed(2)), hf: +(hf / hn).toFixed(3) };
    }));
    if (bigB) out.ref = await page.evaluate(async (snapB64) => {
      // Reference: the full-res export render of B with the same grain, downscaled to the cell size.
      const cell = document.querySelectorAll('#lib-survey .lib-survey-cell canvas')[1], cw = cell.width, ch = cell.height;
      const bmp = await createImageBitmap(new Blob([window.__bigBytes]));
      const live = getUISnapshot(); applyUISnapshot(JSON.parse(decodeURIComponent(escape(atob(snapB64)))), { skipRender: true });
      const P = getFXParams(); applyUISnapshot(live, { skipRender: true });
      const r = new FXR(document.createElement('canvas')); r.setImage(bmp); r.render(P, bmp.width, bmp.height, { glowScale: 1, seed: 3 });
      let src = r.cv, w = bmp.width, h = bmp.height;
      while (w / 2 >= cw) { const c = document.createElement('canvas'); c.width = Math.round(w / 2); c.height = Math.round(h / 2); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); src = c; w = c.width; h = c.height; }
      const c = document.createElement('canvas'); c.width = cw; c.height = ch; const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, cw, ch);
      const d = g.getImageData(0, 0, cw, ch).data; let hf = 0, hn = 0;
      const L = (x, y) => { const i = (y * cw + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
      for (let y = 1; y < ch - 1; y += 2) for (let x = 1; x < cw - 1; x += 2) { let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += L(x + dx, y + dy); hf += Math.abs(L(x, y) - s / 9); hn++; }
      return { w: cw, h: ch, hf: +(hf / hn).toFixed(3) };
    }, enc(seedB));
    await page.locator('#lib-survey .lib-survey-cell').first().focus();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__libSurveyState().active, null, { timeout: 10000 });
    return out;
  };
  const enc = (snap) => Buffer.from(unescape(encodeURIComponent(JSON.stringify(snap))), 'binary').toString('base64');
  const plain = { ver: 2, sliders: {}, toggles: {}, selects: { 'sel-lut': '' }, colors: {} };
  const look = { ver: 2, sliders: {}, toggles: {}, selects: { 'sel-lut': 'p:classic_neg' }, colors: {} };
  const grain = { ver: 2, sliders: { 'grain-a': 60, 'grain-sz': 5 }, toggles: { grain: true }, selects: { 'sel-lut': '' }, colors: {} };

  const base = await survey(plain);
  const withLook = await survey(look);
  const editorLutAfter = await page.evaluate(() => ({ sel: document.getElementById('sel-lut').value, lut: !!fxState.lut }));
  const plainBig = await survey(plain, true);
  const withGrain = await survey(grain, true);
  console.log(JSON.stringify({ base, withLook, withGrain }));
  console.log('editor sel-lut after survey:', JSON.stringify(editorLutAfter));

  const dLook = Math.max(...withLook[1].mean.map((v, i) => Math.abs(v - base[1].mean[i])));
  console.log('look delta on B (max channel mean shift):', dLook.toFixed(2), ' control delta on A:', Math.max(...withLook[0].mean.map((v, i) => Math.abs(v - base[0].mean[i]))).toFixed(2));
  try { assert.ok(dLook > 3, `B's saved look (classic_neg) not visible in the survey preview: mean shift ${dLook.toFixed(2)}`); } catch (e) { failed = true; console.error('FAIL', e.message); }
  try { assert.equal(editorLutAfter.lut, false, 'rendering a survey cell must not leave the cell\'s look in the Editor'); } catch (e) { failed = true; console.error('FAIL', e.message); }
  const cellGrain = withGrain[1].hf - plainBig[1].hf, refGrain = withGrain.ref.hf - plainBig[1].hf;
  console.log(`grain (hf above the plain frame) on a 4800px photo at ${withGrain[1].w}px: survey cell ${cellGrain.toFixed(3)} vs export-downscaled ${refGrain.toFixed(3)} (ratio ${(cellGrain / refGrain).toFixed(2)})`);
  try { assert.ok(cellGrain / refGrain < 1.6, `survey grain ${(cellGrain / refGrain).toFixed(2)}x stronger than the export at the same size`); } catch (e) { failed = true; console.error('FAIL', e.message); }
  if (errors.length) { failed = true; console.error('page errors', errors); }
} finally { await browser.close(); server.close(); }
if (failed) process.exit(1);
console.log('PASS probe_cull_look');
