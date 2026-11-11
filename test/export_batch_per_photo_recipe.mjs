// Regression: a Library batch export rendered every photo with the FIRST photo's look (LUT,
// colour, curves...) — only flip/crop, masks and Basic Adjustments were per-photo — and an
// unedited photo picked up the previous photo's look. Each batch item now applies its own saved
// recipe right before it renders (item._applyRecipe, see libExportPathsInner). This drives the real
// exportFX: every batch output must match a single-photo export of that same recipe.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
const root = path.resolve(import.meta.dirname, '..');
const server = createServer((req, res) => { try { const p = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0])); res.setHeader('Content-Type', p.endsWith('.html') ? 'text/html' : p.endsWith('.js') ? 'text/javascript' : p.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'); res.end(fs.readFileSync(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const fails = []; const check = (ok, m) => { console.log((ok ? 'PASS ' : 'FAIL ') + m); if (!ok) fails.push(m); };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on('pageerror', e => console.log('[pageerror]', String(e)));
  page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
  await page.goto('http://127.0.0.1:' + server.address().port + '/chromasmith-22.html');
  await page.waitForFunction(() => typeof exportFX === 'function' && typeof _fxPristineDefault !== 'undefined' && _fxPristineDefault && document.getElementById('sel-lut') && document.getElementById('sel-lut').options.length > 3, null, { timeout: 120000 });
  const r = await page.evaluate(async () => {
    document.getElementById('cs-modal-ov')?.remove();
    const blob = await (await fetch('/test/fixtures/orientation_panorama.png')).blob();
    await loadFXImages([new File([blob], 'Base.png', { type: 'image/png' })]);
    await new Promise((res, rej) => { const t = Date.now(), poll = () => curItem()?.img?.width ? res() : Date.now() - t > 30000 ? rej(Error('load')) : setTimeout(poll, 25); poll(); });
    const outs = [];
    window.__TAURI__ = { core: { invoke: async (cmd, args, opts) => {
      if (cmd === 'set_export_dir') return args.path; if (cmd !== 'save_export_file_raw') return undefined;
      const bm = await createImageBitmap(new Blob([new Uint8Array(args)])); const c = new OffscreenCanvas(8, 8), g = c.getContext('2d');
      g.drawImage(bm, 0, 0, 8, 8); bm.close(); outs.push({ name: atob(opts.headers['x-filename']), px: [...g.getImageData(0, 0, 8, 8).data] }); return { path: '/out/' + outs.length, bytes: 1 };
    } } };
    localStorage.setItem('cs-export-dir', '/out');
    document.getElementById('sel-exp-fmt').value = 'png'; document.getElementById('sel-exp-size').value = '1080';
    const luts = [...document.getElementById('sel-lut').options].map(o => o.value).filter(v => v && v.startsWith('p:'));
    const pristine = structuredClone(_fxPristineDefault);
    const mk = (lut, extra) => { const s = structuredClone(pristine); s.selects = { ...(s.selects || {}), 'sel-lut': lut }; Object.assign(s.sliders = s.sliders || {}, extra || {}); return s; };
    const recipes = [
      { snap: mk(luts[0], { 'sl-sat': 160 }), geom: defGeom() },
      { snap: null, geom: { ...defGeom(), flipH: true } },
      { snap: mk(luts[Math.min(luts.length - 1, 7)], { 'sl-sat': 30 }), geom: { ...defGeom(), flipH: true } },
    ];
    const src = curItem();
    const itemFor = (i, rec, withApply) => {
      const it = { img: src.img, name: 'P' + i, ext: 'png', dpi: 240, bytes: null, _srcPath: '/lib/P' + i + '.png', geom: structuredClone(rec.geom) };
      if (withApply) it._applyRecipe = async () => { await applyUISnapshot(_fxPristineDefault, { skipRender: true }); if (rec.snap) await applyUISnapshot(rec.snap, { skipRender: true }); };
      return it;
    };
    // References: one single-photo export per recipe, with that recipe on the controls.
    const refs = [];
    for (let i = 0; i < recipes.length; i++) {
      await applyUISnapshot(_fxPristineDefault); if (recipes[i].snap) await applyUISnapshot(recipes[i].snap);
      outs.length = 0; await exportFX({ items: [itemFor(i, recipes[i], false)] }); refs.push(outs[0] && outs[0].px);
    }
    // Batch: controls hold recipe 0 (what libExportPathsInner seeds), each item applies its own.
    await applyUISnapshot(_fxPristineDefault); await applyUISnapshot(recipes[0].snap);
    outs.length = 0; await exportFX({ items: recipes.map((rec, i) => itemFor(i, rec, true)) });
    const batch = outs.map(o => o.px);
    // Old behaviour, for contrast: no per-item recipe.
    await applyUISnapshot(_fxPristineDefault); await applyUISnapshot(recipes[0].snap);
    outs.length = 0; await exportFX({ items: recipes.map((rec, i) => itemFor(i, rec, false)) });
    const old = outs.map(o => o.px);
    const diff = (a, b) => { if (!a || !b) return 999; let m = 0; for (let k = 0; k < a.length; k++) if (k % 4 !== 3) m = Math.max(m, Math.abs(a[k] - b[k])); return m; };
    return { n: batch.length, d: refs.map((rf, i) => diff(rf, batch[i])), dOld: refs.map((rf, i) => diff(rf, old[i])), dRefs: diff(refs[0], refs[2]), luts: [luts[0], luts[Math.min(luts.length - 1, 7)]] };
  });
  console.log(JSON.stringify(r));
  check(r.n === 3, 'batch wrote 3 files');
  check(r.dRefs > 20, 'the two looks really differ (' + r.dRefs + ')');
  r.d.forEach((d, i) => check(d <= 6, `batch photo ${i + 1} matches its own single export (max diff ${d})`));
  check(r.dOld.some(d => d > 20), 'without per-photo recipes the batch differs (proves the test sees the bug): ' + r.dOld.join(','));
} finally { await browser.close(); server.close(); }
if (fails.length) { console.log(`\n${fails.length} FAIL`); process.exit(1); } else console.log('\nALL PASS');
