// Regression: Library multi-photo Export opened the export drawer, then loaded the whole selection
// into the editor (slow), the drawer showed whatever the editor last held (video controls after a
// video, the previous batch's count), and every photo but the first lost its own saved flip/crop.
// The drawer now only picks settings for the batch; its button runs the lazy per-photo export.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const server = createServer(async (req, res) => { try { const u = req.url.split('?')[0]; const d = await readFile(path.join(ROOT, decodeURIComponent(u).slice(1)));
  res.writeHead(200, { 'Content-Type': u.endsWith('.html') ? 'text/html' : u.endsWith('.js') || u.endsWith('.mjs') ? 'text/javascript' : u.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' }); res.end(d); } catch (e) { res.writeHead(404); res.end(); } });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const fails = []; const check = (ok, m) => { console.log((ok ? 'PASS ' : 'FAIL ') + m); if (!ok) fails.push(m); };
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('pageerror', e => console.log('[pageerror]', e.message));
  await p.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=12`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction(() => document.querySelectorAll('.lib-card,[data-path]').length >= 4 && typeof window.chromasmithLibExportPaths === 'function', null, { timeout: 120000 });
  const r = await p.evaluate(async () => {
    const calls = []; window.chromasmithLibExportPaths = (ps) => { calls.push(ps); };
    document.body.classList.add('fx-cur-video'); // editor last held a video
    const paths = [...new Set([...document.querySelectorAll('[data-path]')].map(e => e.dataset.path))].slice(0, 3);
    const fxBefore = fxImages.length;
    const open = (ps) => { sk2ExportOpen({ libPaths: ps }); };
    open(paths);
    const sh = document.getElementById('sk2-export'), vis = (sel) => { const e = sh.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none'; };
    const o1 = { label: sh.querySelector('.sk2x-btn').textContent.trim(), vid: vis('.sk2x-cap.fx-vid-only'), still: vis('.sk2x-opts[data-sel="sel-exp-fmt"]'), proof: vis('.sk2x-proof'), open: document.body.classList.contains('sk2-exp-open') };
    sh.querySelector('.sk2x-btn').click();
    const afterClick = { open: document.body.classList.contains('sk2-exp-open'), vidRestored: document.body.classList.contains('fx-cur-video') };
    open(paths.slice(0, 2));
    const label2 = sh.querySelector('.sk2x-btn').textContent.trim();
    sk2ExportClose();
    // Videos: a video batch shows VIDEO settings, a mix shows both (the batch used to always show photo settings).
    const vids = ['/lib/clipA.MP4', '/lib/clipB.mov'];
    open(vids);
    const ov = { label: sh.querySelector('.sk2x-btn').textContent.trim(), vid: vis('.sk2x-cap.fx-vid-only'), still: vis('.sk2x-opts[data-sel="sel-exp-fmt"]') };
    sk2ExportClose();
    open([paths[0], vids[0]]);
    const om = { label: sh.querySelector('.sk2x-btn').textContent.trim(), vid: vis('.sk2x-cap.fx-vid-only'), still: vis('.sk2x-opts[data-sel="sel-exp-fmt"]') };
    sk2ExportClose();
    const mixedCleared = !document.body.classList.contains('sk2-lib-mixed');
    return { o1, afterClick, label2, calls, fxBefore, fxAfter: fxImages.length, ov, om, mixedCleared };
  });
  console.log(JSON.stringify(r));
  check(r.o1.open, 'drawer opens');
  check(!r.o1.vid && r.o1.still, 'still-photo options, not video, even after a video was current');
  check(!r.o1.proof, 'no stale editor preview in batch mode');
  check(r.o1.label === 'Export 3 photos →', 'button counts the batch: ' + r.o1.label);
  check(r.calls.length === 1 && r.calls[0].length === 3, 'button runs the lazy Library export with the batch paths');
  check(!r.afterClick.open && r.afterClick.vidRestored, 'drawer closes, editor video state restored');
  check(r.label2 === 'Export 2 photos →', 'second batch shows its own count: ' + r.label2);
  check(r.fxAfter === r.fxBefore, 'nothing loaded into the editor');
  check(r.ov.vid && !r.ov.still && r.ov.label === 'Export 2 videos →', 'video batch shows video settings: ' + r.ov.label);
  check(r.om.vid && r.om.still && r.om.label === 'Export 1 photo + 1 video →', 'mixed batch shows both: ' + r.om.label);
  check(r.mixedCleared, 'closing the drawer clears the mixed state');
} finally { await b.close(); server.close(); }
if (fails.length) { console.log(`\n${fails.length} FAIL`); process.exit(1); } else console.log('\nALL PASS');
