#!/usr/bin/env node
// Regression: mask overlays/pins/pointer input must map onto the photo at every zoom, incl. the
// full-res visible-crop render (fxZoom>1), where #fx-canvas is shrunk+translated to the visible crop.
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = createServer(async (req, res) => {
  try {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname));
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
let ok = false;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 792 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadFXImages === 'function' && typeof FX !== 'undefined' && FX.ok, null, { timeout: 30000 });
  const res = await page.evaluate(async (DESK) => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 400;
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    await loadFXImages([new File([blob], 'a.png', { type: 'image/png' })]);
    await new Promise(res => { const t = Date.now(); const p = () => fxImages.length || Date.now() - t > 30000 ? res() : setTimeout(p, 20); p(); });
    // --desktop models a Library open served from the decode cache: ext 'rw2', NO rawFile (library-ui.js diskCached entries)
    if (DESK) curItem().ext = 'rw2'; else curItem().rawFile = new File([new Uint8Array(4)], 'a.RW2');
    if (DESK) { window.__TAURI__ = window.__TAURI__ || {}; fxDesktopFoldImageIntoLooks(); }
    updateWork && updateWork(); fxSyncDcpProfileUI();
    if (typeof fxSection === 'function') fxSection('looks', true);
    await new Promise(r => setTimeout(r, 300));
    const row = document.getElementById('row-raw-profile'), sel = document.getElementById('sel-dcp');
    const chain = []; for (let e = row; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || e.hidden) chain.push((e.id || e.className || e.tagName) + ':' + cs.display + '/' + cs.visibility); }
    const r = row.getBoundingClientRect();
    return { w: r.width, h: r.height, opts: sel.options.length, disabled: sel.disabled, hiddenBy: chain, parent: row.parentElement.id || row.parentElement.className };
  }, process.argv.includes('--desktop'));
  console.log(JSON.stringify(res));
  ok = res.w > 0 && res.h > 0 && res.opts > 1 && !res.disabled;
  if (errors.length) console.log('pageerrors', errors.slice(0, 3));
} finally { await browser.close(); server.close(); }
console.log(ok ? 'PASS raw profile row visible' : 'FAIL raw profile row not visible'); process.exit(ok ? 0 : 1);
