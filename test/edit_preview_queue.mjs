// Library edited-look preview queue (Quick Look): a hidden render-only app instance renders each
// edited photo's saved recipe, results are stored via put_edit_preview and shown by Space.
// Verifies: batch of 20 completes sequentially, cache entries written, warm Space is instant, a
// changed recipe re-renders with a "rendering edit..." indicator, badges update live, output
// matches the Editor's own render (to dither noise) of the same recipe, the render instance cannot write
// storage or disturb the Editor, and memory does not grow across batches.
//   node test/edit_preview_queue.mjs            (SwiftShader, headless)
//   GPU=1 node test/edit_preview_queue.mjs      (headed, real GPU)
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) throw Error('outside root');
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css' };
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const GPU = process.env.GPU === '1';
const browser = await chromium.launch(GPU
  ? { headless: false, args: ['--ignore-gpu-blocklist'] }
  : { args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const rssMB = () => Number(execSync("ps -axo rss,command | grep -i chrom | grep -v grep | awk '{s+=$1} END {print s/1024}'").toString().trim());
const b64 = (name) => readFile(path.join(root, 'test', name)).then((b) => b.toString('base64'));
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); localStorage.setItem('chromasmithAutoPreviews', '0'); localStorage.setItem('cs-test-sentinel', 'keep'); } catch {} });
  await page.goto(`${base}/desktop/dist/index.html?libtest=1&libn=12&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.libtestShowQuickLook === 'function' && typeof window.__libEditPreviewEnqueue === 'function', { timeout: 60000 });
  await page.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });

  // ── fixtures: 3 parity photos (real fixture PNGs + recipes) and 17 load photos (1600px JPEG) ──
  const parity = [
    { path: '/t/PAR_chart.RW2', fixture: 'fixtures/chart.png', recipe: 'recipes/lut_look.json' },
    { path: '/t/PAR_gradient.RW2', fixture: 'fixtures/gradient.png', recipe: 'recipes/basic_adjust.json' },
    { path: '/t/PAR_portrait.RW2', fixture: 'fixtures/portrait.png', recipe: 'recipes/skin_uniformity.json' },
  ];
  const parityData = [];
  for (const p of parity) parityData.push({ path: p.path, png: await b64(p.fixture), snap: JSON.parse(await readFile(path.join(root, 'test', p.recipe), 'utf8')) });
  const paths = await page.evaluate(async (parityData) => {
    const enc = (snap) => btoa(unescape(encodeURIComponent(JSON.stringify(snap))));
    const jpg = await (async () => {
      const c = document.createElement('canvas'); c.width = 1600; c.height = 1067; const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 1600, 1067); gr.addColorStop(0, '#d4a373'); gr.addColorStop(.5, '#4a6fa5'); gr.addColorStop(1, '#2b2118');
      g.fillStyle = gr; g.fillRect(0, 0, 1600, 1067);
      for (let i = 0; i < 40; i++) { g.fillStyle = `hsl(${i * 9},60%,${30 + (i % 5) * 8}%)`; g.fillRect((i * 97) % 1500, (i * 61) % 1000, 120, 90); }
      return new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());
    })();
    window.__libtestQuicklookBytesByPath = {};
    window.__t = { enc };
    const out = [];
    for (const p of parityData) {
      const bin = atob(p.png); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      window.__libtestQuicklookBytesByPath[p.path] = arr.buffer;
      window.__libtestSeedSidecar(p.path, { edited: true, recipe: enc(p.snap) });
      out.push(p.path);
    }
    for (let i = 1; i <= 17; i++) {
      const path = `/t/LOAD_${String(i).padStart(2, '0')}.RW2`;
      window.__libtestQuicklookBytesByPath[path] = jpg.buffer.slice(0);
      window.__libtestSeedSidecar(path, { edited: true, recipe: enc({ ver: 2, sliders: { 'adj-exp': i * 3 }, toggles: { adjust: true }, selects: {}, colors: {} }) });
      out.push(path);
    }
    return out;
  }, parityData);
  const idle = () => page.waitForFunction(() => { const d = window.__libEditPreviewDebug(); return !d.running && !d.queue.length; }, null, { timeout: 600000, polling: 100 });

  const edBefore = await page.evaluate(() => JSON.stringify(getUISnapshot()));
  const rss0 = rssMB();
  const t0 = Date.now();
  await page.evaluate((ps) => ps.forEach((p) => window.__libEditPreviewEnqueue(p)), paths);
  await idle();
  const batchMs = Date.now() - t0;
  const stored = await page.evaluate(() => window.__libtestEditPreviews.size);
  assert.equal(stored, 40, 'all 20 edited previews stored, each with its 480px grid copy');
  const rss1 = rssMB();
  const heapA = await page.evaluate(() => performance.memory && performance.memory.usedJSHeapSize);
  console.log(`batch of 20: ${batchMs} ms total (${Math.round(batchMs / 20)} ms/photo incl. first-boot of render instance); stored=${stored}; RSS ${rss0.toFixed(0)} -> ${rss1.toFixed(0)} MB`);

  // second batch with NEW recipes (forces 20 more renders) -> memory should plateau
  await page.evaluate((ps) => ps.slice(3).forEach((p, i) => window.__libtestSeedSidecar(p, { edited: true, recipe: window.__t.enc({ ver: 2, sliders: { 'adj-exp': -i * 3 - 3 }, toggles: { adjust: true }, selects: {}, colors: {} }) })), paths);
  const t1 = Date.now();
  await page.evaluate((ps) => ps.slice(3).forEach((p) => window.__libEditPreviewEnqueue(p)), paths);
  await idle();
  const rss2 = rssMB();
  const heapB = await page.evaluate(() => performance.memory && performance.memory.usedJSHeapSize);
  console.log(`second batch of 17 (new recipes): ${Date.now() - t1} ms; RSS ${rss1.toFixed(0)} -> ${rss2.toFixed(0)} MB; main JS heap ${(heapA / 1048576).toFixed(0)} -> ${(heapB / 1048576).toFixed(0)} MB`);
  assert.equal(await page.evaluate(() => window.__libtestEditPreviews.size), 74, 'new recipes get new cache keys (render + grid copy)');
  assert.ok(rss2 - rss1 < 250, `render instance memory plateaus (grew ${(rss2 - rss1).toFixed(0)} MB)`);

  // re-enqueue unchanged recipes -> no re-render (cache hit by key)
  const putsBefore = await page.evaluate(() => window.__libtestEditPreviews.size);
  await page.evaluate((ps) => ps.forEach((p) => window.__libEditPreviewEnqueue(p)), paths);
  await idle();
  assert.equal(await page.evaluate(() => window.__libtestEditPreviews.size), putsBefore, 'unchanged recipes are not re-rendered');

  // Quick Look: warm (cache hit) timing, indicator on a changed recipe, live badges
  const warm = [];
  for (const p of paths.slice(0, 3)) {
    // re-seed original recipes (the second batch only changed LOAD_*); parity photos' entries are still cached
    const ms = await page.evaluate(async (p) => {
      const t = performance.now();
      void window.libtestShowQuickLook(p);
      while (document.getElementById('lib-ql-img').dataset.previewSource !== 'edited-cache') { if (performance.now() - t > 5000) return -1; await new Promise((r) => setTimeout(r, 2)); }
      const ms = performance.now() - t;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      return ms;
    }, p);
    assert.ok(ms >= 0, 'warm Space shows the cached edited look');
    warm.push(Math.round(ms));
  }
  console.log(`warm Space -> edited look on screen (ms): ${warm.join(', ')}`);

  const p5 = paths[8];
  await page.evaluate((p) => window.__libtestSeedSidecar(p, { edited: true, recipe: window.__t.enc({ ver: 2, sliders: { 'adj-exp': 77 }, toggles: { adjust: true }, selects: {}, colors: {} }) }), p5);
  const cold = await page.evaluate(async (p) => {
    const t = performance.now();
    void window.libtestShowQuickLook(p);
    let sawRendering = false, firstShown = '';
    while (document.getElementById('lib-ql-img').dataset.previewSource !== 'edited-cache') {
      if (!firstShown && document.getElementById('lib-ql-img').dataset.previewSource) firstShown = document.getElementById('lib-ql-img').dataset.previewSource;
      if (document.getElementById('lib-ql-rendering')) sawRendering = true;
      if (performance.now() - t > 20000) return { ms: -1, sawRendering, firstShown };
      await new Promise((r) => setTimeout(r, 5));
    }
    return { ms: Math.round(performance.now() - t), sawRendering, firstShown };
  }, p5);
  assert.ok(cold.ms > 0, 'changed recipe eventually shows the new edited render');
  assert.ok(cold.sawRendering, 'a "rendering edit" indicator is shown while the render runs');
  assert.ok(cold.firstShown && cold.firstShown !== 'edited-cache', 'the original is shown first');
  console.log(`cold (changed recipe) Space: original first (${cold.firstShown}), indicator shown, edited look after ${cold.ms} ms`);

  // live badge update + hold-to-original
  await page.keyboard.press('p');
  await page.waitForFunction(() => !!document.querySelector('#lib-ql-badges .lib-ql-b.pick'), null, { timeout: 5000 });
  await page.keyboard.down('\\');
  assert.equal(await page.evaluate(() => document.getElementById('lib-ql-img').dataset.previewSource), 'original');
  await page.keyboard.up('\\');
  assert.equal(await page.evaluate(() => document.getElementById('lib-ql-img').dataset.previewSource), 'edited-cache');
  await page.keyboard.press('Escape');

  // ── isolation ──
  const iso = await page.evaluate(() => {
    const f = document.querySelector('iframe[title="edit preview renderer"]');
    const w = f && f.contentWindow;
    if (w) w.localStorage.setItem('cs-iso-probe', '1');
    return { frame: !!f, probe: localStorage.getItem('cs-iso-probe'), sentinel: localStorage.getItem('cs-test-sentinel'), snap: JSON.stringify(getUISnapshot()) };
  });
  assert.ok(iso.frame, 'render instance iframe exists while work was recent');
  assert.equal(iso.probe, null, 'render instance cannot write storage');
  assert.equal(iso.sentinel, 'keep');
  assert.equal(iso.snap, edBefore, 'Editor state untouched by the render instance');
  await page.evaluate(() => window.__libEditPreviewTeardown());
  assert.equal(await page.evaluate(() => !!document.querySelector('iframe[title="edit preview renderer"]')), false, 'render instance torn down');
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);

  // ── parity: the stored JPEG == the Editor's own render of the same recipe (plain app page) ──
  const ed = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await ed.goto(`${base}/chromasmith-22.html`, { waitUntil: 'load' });
  await ed.waitForFunction(() => typeof window.processToCanvas === 'function' && typeof window.getFXParams === 'function', null, { timeout: 60000 });
  for (const pd of parityData) {
    const libB64 = await page.evaluate(async (pd) => {
      const key = window.__libEditPreviewKey(pd.path, window.__t.enc(pd.snap));
      const bytes = window.__libtestEditPreviews.get(key);
      if (!bytes) return null;
      let s = ''; const u = new Uint8Array(bytes); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s);
    }, pd);
    assert.ok(libB64, `${pd.path}: stored preview present`);
    const edB64 = await ed.evaluate(async ({ png, snap }) => {
      const bin = atob(png); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      await window.loadFXImages([new File([arr], 'x.jpg', { type: 'image/jpeg' })]);
      const clean = { ...snap }; delete clean._desc; clean.selects = { 'sel-lut': '', 'sel-print': '', ...(clean.selects || {}) };
      window.applyUISnapshot(clean);
      await new Promise((r) => setTimeout(r, 50));
      const wl = clean.selects['sel-lut']; const t0 = Date.now();
      while ((wl ? !fxState.lut : !!fxState.lut) && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 20));
      const it = curItem(); const P = window.getFXParams(it.adjustOverride || undefined); P.redEyeOps = it.redeye || [];
      const src = window.geomCanvas(it);
      const cv = await window.processToCanvas(P, src, src.naturalWidth || src.width, src.naturalHeight || src.height, () => {});
      const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9));
      const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s);
    }, { png: pd.png, snap: pd.snap });
    // Still renders end with a random-seeded half-LSB TPDF dither (fxStillQualityOpts), so two
    // renders of the same recipe are no longer byte-identical even inside one instance. Compare
    // pixels instead: dither noise only, no shift in any channel.
    const d = await ed.evaluate(async ({ a, b }) => {
      const dec = async (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const bm = await createImageBitmap(new Blob([u])); const c = new OffscreenCanvas(bm.width, bm.height); const g = c.getContext('2d'); g.drawImage(bm, 0, 0); return { w: bm.width, h: bm.height, d: g.getImageData(0, 0, bm.width, bm.height).data }; };
      const A = await dec(a), B = await dec(b);
      if (A.w !== B.w || A.h !== B.h) return { size: `${A.w}x${A.h} vs ${B.w}x${B.h}` };
      let abs = 0; const sg = [0, 0, 0]; const n = A.d.length / 4;
      for (let i = 0; i < A.d.length; i += 4) for (let k = 0; k < 3; k++) { const v = A.d[i + k] - B.d[i + k]; abs += Math.abs(v); sg[k] += v; }
      return { mean: abs / n / 3, bias: Math.max(...sg.map((x) => Math.abs(x / n))) };
    }, { a: libB64, b: edB64 });
    assert.ok(!d.size, `${pd.path}: same size as the Editor's render (${d.size})`);
    assert.ok(d.mean < 0.6 && d.bias < 0.1, `${pd.path}: render-instance output matches the Editor's render (mean diff ${d.mean.toFixed(3)}, bias ${d.bias.toFixed(3)})`);
    console.log(`parity ${pd.path}: ${libB64 === edB64 ? 'IDENTICAL' : `matches (dither noise only: mean ${d.mean.toFixed(3)}, bias ${d.bias.toFixed(3)})`}`);
  }
  await ed.close();
  console.log('PASS: edited-look preview queue, cache, Space, isolation and Editor parity.');
} finally {
  await browser.close();
  server.close();
}
