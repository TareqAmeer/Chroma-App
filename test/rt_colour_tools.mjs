// CHR-291 / CHR-290 behavioural regression: drive the live Channel mixer, Lab adjustments and
// Colour toning sliders on a real photo and compare pixels from the production preview, 1:1 loupe,
// full export and 128px tiled export. Also checks exact identity at defaults and that the tools are
// hidden on phones.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.wasm': 'application/wasm', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep)) throw new Error('outside test root');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const browser = await chromium.launch({ args: [process.platform === 'win32' ? '--use-gl=angle' : '--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });

const IDS = ['mix-rr', 'mix-rg', 'mix-rb', 'mix-gr', 'mix-gg', 'mix-gb', 'mix-br', 'mix-bg', 'mix-bb', 'lab-l', 'lab-con', 'lab-chroma', 'tone-sa', 'tone-sb', 'tone-ha', 'tone-hb'];
const DEF = { 'mix-rr': 100, 'mix-gg': 100, 'mix-bb': 100 };

try {
  const fixture = await readFile(path.join(root, 'test/fixtures/portrait.png'));
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const pageErrors = [], glErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  // Same seeded Math.random as test/export_harness.mjs, so the still-export dither repeats exactly.
  await page.addInitScript(() => {
    const SEED = 0xC0FFEE; let s = SEED;
    window.__reseed = () => { s = SEED; };
    Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  });
  page.on('console', m => { if (/GLSL|compile error|link error/i.test(m.text())) glErrors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof renderTiled === 'function');
  await page.evaluate(async b64 => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    await loadFXImages([new File([bytes], 'rt-colour-photo.png', { type: 'image/png' })]);
  }, fixture.toString('base64'));
  await page.waitForFunction(() => fxImages.length === 1 && !!curItem()?.img?.naturalWidth, { timeout: 30000 });
  await page.waitForTimeout(500);

  // Pixels travel as base64: a plain number array of a whole frame through page.evaluate
  // exhausts the Node heap in this sandbox.
  const px = async fn => { const r = await page.evaluate(fn); r.pixels = Buffer.from(r.pixels, 'base64'); return r; };
  await page.evaluate(({ IDS, DEF }) => {
    window.__b64 = a => { let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
    window.__rtSet = (values, enabled = true) => {
      document.getElementById('tg-adjust').classList.toggle('on', enabled);
      for (const id of IDS) {
        const input = document.getElementById('sl-adj-' + id);
        input.value = String(values[id] ?? DEF[id] ?? 0);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      fxUpdate();
    };
    window.__rtRender = async tiled => {
      window.__reseed && window.__reseed();
      const item = curItem(), src = geomCanvas(item), w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
      const params = getFXParams(item.adjustOverride || undefined);
      const saved = window.fxExportTileSize;
      if (tiled) window.fxExportTileSize = () => 128;
      let canvas;
      try { canvas = tiled ? await renderTiled(params, src, w, h) : await processToCanvas(params, src, w, h); }
      finally { window.fxExportTileSize = saved; }
      return { w: canvas.width, h: canvas.height, rt: params.adjust.rtColour, pixels: window.__b64(canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data) };
    };
    window.__rtView = async loupe => {
      fxLoupe = loupe; fxZoom = 1; loupeCX = 0.5; loupeCY = 0.5;
      renderPreview();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const { px, w, h } = FX.getPixels();
      return { w, h, pixels: window.__b64(px) };
    };
  }, { IDS, DEF });


  const diff = (a, b) => { let n = 0, max = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d) { n++; if (d > max) max = d; } } return { n, max, len: a.length === b.length }; };
  const noDiff = (a, b, msg) => { const d = diff(a, b); assert.ok(d.len && d.n === 0, `${msg}: ${JSON.stringify(d)}`); };
  // The live preview varies by up to 1 level between two identical renders (measured: ~4000 values,
  // max 1, with no slider moved), so preview/loupe are held to 1 level and export to exact.
  const within1 = (a, b, msg) => { const d = diff(a, b); assert.ok(d.len && d.max <= 1, `${msg}: ${JSON.stringify(d)}`); };

  // Identity. Turning the Tone card on is not itself a byte-exact no-op (its existing exposure/WB
  // stage round-trips through linear light), so the baseline is "Tone on, all defaults": the new
  // stages must be gated off there, and moving the new sliders then returning them to default must
  // give back the same pixels. Byte-exactness against main is the export harness goldens' job
  // (the basic_adjust recipe has Tone on).
  await page.evaluate(() => window.__rtSet({}, true));
  const gates = await page.evaluate(() => rtColourUniforms(getFXParams().adjust.rtColour, true));
  assert.equal(gates.rtMixOn, 0, 'default mixer is gated off'); assert.equal(gates.rtLabOn, 0, 'default Lab/toning is gated off');
  const offPreview = await px(() => window.__rtView(false));
  const off = await px(() => window.__rtRender(false));
  assert.deepEqual(off.rt.mix, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  await page.evaluate(() => window.__rtSet({ 'mix-rg': 50, 'lab-chroma': 60, 'tone-hb': 40 }, true));
  await px(() => window.__rtView(false));
  await page.evaluate(() => window.__rtSet({}, true));
  within1((await px(() => window.__rtView(false))).pixels, offPreview.pixels, 'preview returns to default');
  noDiff((await px(() => window.__rtRender(false))).pixels, off.pixels, 'export returns exactly to default');

  const cases = [
    { name: 'mixer red-from-green', v: { 'mix-rr': 0, 'mix-rg': 100 } },
    { name: 'mixer blend', v: { 'mix-rr': 70, 'mix-rb': 30, 'mix-bb': 120 } },
    { name: 'lab lightness', v: { 'lab-l': 50 } },
    { name: 'lab contrast', v: { 'lab-con': 40 } },
    { name: 'lab chroma -100', v: { 'lab-chroma': -100 } },
    { name: 'toning', v: { 'tone-sb': -60, 'tone-hb': 60, 'tone-ha': 20 } },
  ];
  // Pass 1: Fit preview and full export. Pass 2: 1:1 loupe. Pass 3: 128px tiled export, LAST,
  // because a Fit preview rendered after a 128px tiled export under a different recipe keeps a
  // stale ~140px centre region (one tile plus halo) in this setup. Reproduced with only the
  // existing Temp/Exposure sliders moved, so it predates these tools; reported separately.
  const results = [], fulls = {};
  for (const c of cases) {
    await page.evaluate(v => window.__rtSet(v), c.v);
    const preview = await px(() => window.__rtView(false));
    const full = await px(() => window.__rtRender(false));
    assert.equal(full.w, off.w); assert.equal(full.h, off.h); assert.equal(preview.w, full.w); assert.equal(preview.h, full.h);
    let changed = 0, maxGrey = 0, maxRfromG = 0;
    for (let i = 0; i < full.pixels.length; i++) {
      if (full.pixels[i] !== off.pixels[i]) changed++;
      if (i % 4 === 0) {
        const [r, g, b] = [full.pixels[i], full.pixels[i + 1], full.pixels[i + 2]];
        maxGrey = Math.max(maxGrey, Math.abs(r - g), Math.abs(g - b));
        maxRfromG = Math.max(maxRfromG, Math.abs(r - off.pixels[i + 1]), Math.abs(g - off.pixels[i + 1]), Math.abs(b - off.pixels[i + 2]));
      }
    }
    const maxPrev = diff(full.pixels, preview.pixels).max;
    assert.ok(changed > 1000, `${c.name}: must change the photo (changed ${changed})`);
    assert.ok(maxPrev <= 1, `${c.name}: preview within 1 level of full render; got ${maxPrev}`);
    // Independent numeric expectations (no shared code with the shader).
    if (c.name === 'lab chroma -100') assert.ok(maxGrey <= 2, `chroma -100 must give neutral pixels; max channel spread ${maxGrey}`);
    if (c.name === 'mixer red-from-green') assert.ok(maxRfromG <= 1, `R<-G must copy green into red and leave G/B; max error ${maxRfromG}`);
    fulls[c.name] = full;
    results.push({ case: c.name, changed, maxPrev,...(c.name === 'lab chroma -100' ? { maxGrey } : {}), ...(c.name === 'mixer red-from-green' ? { maxRfromG } : {}) });
  }
  // Pass 2: 1:1 loupe against the same full renders.
  for (const c of cases) {
    await page.evaluate(v => window.__rtSet(v), c.v);
    const loupe = await px(() => window.__rtView(true));
    assert.equal(loupe.w, fulls[c.name].w);
    const maxLoupe = diff(fulls[c.name].pixels, loupe.pixels).max;
    assert.ok(maxLoupe <= 1, `${c.name}: loupe within 1 level of full render; got ${maxLoupe}`);
    results.find(r => r.case === c.name).maxLoupe = maxLoupe;
  }
  await page.evaluate(() => { fxLoupe = false; });
  for (const c of cases) {
    await page.evaluate(v => window.__rtSet(v), c.v);
    const tiled = await px(() => window.__rtRender(true));
    const maxTile = diff(fulls[c.name].pixels, tiled.pixels).max;
    assert.ok(maxTile <= 1, `${c.name}: 128px tiled export within 1 level of full render; got ${maxTile}`);
    results.find(r => r.case === c.name).maxTile = maxTile;
  }

  // Stored per-photo/snapshot values round-trip; a legacy recipe restores the identity mixer.
  await page.evaluate(() => window.__rtSet({ 'mix-gb': 35, 'lab-chroma': 20, 'tone-sa': -15 }));
  const stored = await page.evaluate(() => { const v = domAdjustVals(); window.__rtSet({}); applyAdjustVals(v); fxUpdate(); return getFXParams().adjust.rtColour; });
  assert.equal(stored.mix[5], 0.35); assert.equal(stored.lab.chroma, 0.2); assert.equal(stored.tone.sa, -0.15);
  const legacy = await page.evaluate(() => { applyAdjustVals({ exp: 0 }); fxUpdate(); return getFXParams().adjust.rtColour.mix; });
  assert.deepEqual(legacy, [1, 0, 0, 0, 1, 0, 0, 0, 1], 'a legacy recipe without mixer keys restores the identity mixer');

  // Phones: the block stays in the DOM but is hidden.
  const phoneHidden = await page.evaluate(() => { document.body.classList.add('mobile-fx'); const d = getComputedStyle(document.getElementById('adj-rt-colour')).display; document.body.classList.remove('mobile-fx'); return d; });
  assert.equal(phoneHidden, 'none', 'desktop-only colour tools are hidden on phones');

  assert.deepEqual(glErrors, [], 'no GLSL compile/link errors');
  assert.deepEqual(pageErrors, [], 'no browser runtime errors');
  console.log(`CHR-291/CHR-290 colour tools: default identity; ${JSON.stringify(results)}; zero page errors.`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
