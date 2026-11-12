// Regression: a Library batch export applied the noise-reduction tier (Off/Fast/High), High
// strength and demosaic of whichever photo the EDITOR had open to every RAW in the batch. Each
// batch item now carries its own saved values (_rawNr/_rawNrHighStrength/_demosaicAlgo, see
// libExportPathsInner). Drives the real exportFX with the native decode/denoise calls stubbed, and
// checks that swapping each photo's recipe onto the controls never re-decodes the editor's photo.
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
  await page.goto('http://127.0.0.1:' + server.address().port + '/chromasmith-22.html');
  await page.waitForFunction(() => typeof exportFX === 'function' && typeof _fxPristineDefault !== 'undefined' && _fxPristineDefault, null, { timeout: 120000 });
  const r = await page.evaluate(async () => {
    document.getElementById('cs-modal-ov')?.remove();
    const blob = await (await fetch('/test/fixtures/orientation_panorama.png')).blob();
    await loadFXImages([new File([blob], 'Base.png', { type: 'image/png' })]);
    await new Promise((res, rej) => { const t = Date.now(), poll = () => curItem()?.img?.width ? res() : Date.now() - t > 30000 ? rej(Error('load')) : setTimeout(poll, 25); poll(); });
    const outs = [], cleanups = [], highs = []; let reloads = 0;
    window.__TAURI__ = { core: { invoke: async (cmd, args, opts) => {
      if (cmd === 'set_export_dir') return args.path; if (cmd !== 'save_export_file_raw') return undefined;
      outs.push(atob(opts.headers['x-filename'])); return { path: '/out/' + outs.length, bytes: 1 };
    } } };
    window.chromasmithApplyFullCleanup = async (it, p, o) => { cleanups.push({ name: it.name, rawNr: o && o.rawNr, dem: o && o.demosaicAlgo }); return { applied: true }; };
    window.chromasmithDenoiseHigh = async (it, prog, tok, over) => { highs.push({ name: it.name, strength: over && over.highStrength, dem: over && over.demosaicAlgo }); };
    window.chromasmithReloadCurrentPhoto = () => { reloads++; return Promise.resolve(); };
    localStorage.setItem('cs-export-dir', '/out');
    document.getElementById('sel-exp-fmt').value = 'png'; document.getElementById('sel-exp-size').value = '1080';
    // The editor's open photo is on High with a finished High pass.
    window.chromasmithRawNr = 'high'; window.chromasmithRawNrHighStrength = 90; window.chromasmithDemosaicAlgo = '';
    const editorItem = curItem(); editorItem._nrHighApplied = true;
    const src = editorItem;
    const per = [{ nr: 'off', dem: 'ahd' }, { nr: 'fast', dem: '' }, { nr: 'high', dem: 'vng', strength: 40 }];
    const items = per.map((p, i) => {
      const snap = structuredClone(_fxPristineDefault); snap.rawNr = p.nr; snap.demosaicAlgo = p.dem; if (p.strength !== undefined) snap.rawNrHighStrength = p.strength;
      return { img: src.img, name: 'R' + i, ext: 'png', dpi: 240, bytes: null, _srcPath: '/lib/R' + i + '.rw2', geom: defGeom(),
        rawFile: new File([new Uint8Array(4)], 'R' + i + '.rw2'), _rawNr: p.nr, _demosaicAlgo: p.dem, _rawNrHighStrength: p.strength,
        _applyRecipe: async () => { await applyUISnapshot(_fxPristineDefault, { skipRender: true, noRawReload: true }); await applyUISnapshot(snap, { skipRender: true, noRawReload: true }); } };
    });
    await exportFX({ items });
    return { outs: outs.length, cleanups, highs, reloads, editorHigh: !!editorItem._nrHighApplied };
  });
  console.log(JSON.stringify(r));
  check(r.outs === 3, 'batch wrote 3 files');
  const c = n => r.cleanups.find(x => x.name === n);
  check(c('R0') && c('R0').rawNr === 'off' && c('R0').dem === 'ahd', 'Off photo decoded with Off + its own demosaic');
  check(c('R1') && c('R1').rawNr === 'fast', 'Fast photo decoded with Fast');
  check(!c('R2'), 'High photo skips the Fast cleanup pass');
  check(r.highs.length === 1 && r.highs[0].name === 'R2' && r.highs[0].strength === 40 && r.highs[0].dem === 'vng', 'only the High photo gets the High pass, at its own strength/demosaic');
  check(r.reloads === 0, 'per-photo recipe swaps never re-decode the editor photo (' + r.reloads + ')');
  check(r.editorHigh, "editor photo keeps its finished High pass");
} finally { await browser.close(); server.close(); }
if (fails.length) { console.log(`\n${fails.length} FAIL`); process.exit(1); } else console.log('\nALL PASS');
