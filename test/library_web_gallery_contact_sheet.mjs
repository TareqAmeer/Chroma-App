// CHR-239 + CHR-177 browser check, through the production Library code in desktop/dist (run
// `node tools/scripts/build-desktop.mjs` first). Drives:
//  - Web gallery: graded JPEG assets (an edited photo really is graded, an unedited one is not),
//    long-edge size, watermark, index.html from static-gallery.mjs with captions/palette, the
//    manifest, an incremental re-export (nothing re-rendered), a recipe change (one re-rendered),
//    a dropped photo reported stale, a caption-only change (no re-render), and the preview
//    iframe showing the exported bytes at desktop and phone widths.
//  - Contact sheet: 5 photos on a fixed 2x2 grid -> one 2-page PDF (validated with pdfinfo when
//    present) and 2 PNG pages; template save/load through the settings dialog.
// Run: node test/library_web_gallery_contact_sheet.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
    const body = await readFile(path.join(root, pathname));
    const type = pathname.endsWith('.html') ? 'text/html' : /\.m?js$/.test(pathname) ? 'text/javascript' : pathname.endsWith('.png') ? 'image/png' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));

const fixtures = {
  edited: (await readFile(path.join(root, 'test/fixtures/portrait.png'))).toString('base64'),
  plain: (await readFile(path.join(root, 'test/fixtures/gradient.png'))).toString('base64'),
};
let browser;
try {
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libcat=1&libn=6&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => typeof window.__libtestCreateWebGallery === 'function' && typeof window.getUISnapshot === 'function' && typeof loadFXImages === 'function', null, { timeout: 60000 });
  await page.addStyleTag({ content: '#cs-modal-ov{display:none!important;pointer-events:none!important}' });

  const gallery = await page.evaluate(async (fx) => {
    const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const A = '/test/Gallery/edited one.png', B = '/test/Gallery/plain.png', C = '/test/Gallery/extra.png';
    window.__libtestFileBytes = { [A]: bytes(fx.edited).buffer, [B]: bytes(fx.plain).buffer, [C]: bytes(fx.plain).buffer };
    // A real recipe: the editor's own snapshot with exposure pushed well up.
    await loadFXImages([new File([bytes(fx.edited)], 'seed.png', { type: 'image/png' })]);
    await new Promise((r) => setTimeout(r, 600));
    const sl = document.getElementById('sl-adj-exp'); sl.value = '80'; sl.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    const enc = (snap) => btoa(unescape(encodeURIComponent(JSON.stringify(snap))));
    const recipe = enc(window.getUISnapshot());
    sl.value = '0'; sl.dispatchEvent(new Event('input', { bubbles: true }));
    window.__libtestSeedSidecar(A, { recipe, edited: true, rating: 4 });
    window.__libtestSeedSidecar(B, { rating: 0 });
    window.__libtestSeedSidecar(C, { rating: 2 });

    const files = new Map(); // path -> bytes, the "disk"
    const writes = () => (window.__libtestCalls || []).filter(([c]) => c === 'write_file_bytes');
    const flush = () => { for (const [, a] of writes()) files.set(a.path, Uint8Array.from(atob(a.dataB64), (c) => c.charCodeAt(0))); window.__libtestCalls = []; };
    const disk = () => { window.__libtestFileBytes = { ...window.__libtestFileBytes }; for (const [p, b] of files) window.__libtestFileBytes[p] = b.buffer.slice(0); };
    const mean = async (b) => { const bm = await createImageBitmap(new Blob([b], { type: 'image/jpeg' })); const c = document.createElement('canvas'); c.width = 64; c.height = 48; const x = c.getContext('2d'); x.drawImage(bm, 0, 0, 64, 48);
      const d = x.getImageData(0, 0, 64, 48).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return { mean: s / (d.length / 4 * 3), w: bm.width, h: bm.height }; };
    const srcMean = async (b64) => { const bm = await createImageBitmap(new Blob([bytes(b64)], { type: 'image/png' })); const c = document.createElement('canvas'); c.width = 64; c.height = 48; const x = c.getContext('2d'); x.drawImage(bm, 0, 0, 64, 48);
      const d = x.getImageData(0, 0, 64, 48).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4 * 3); };
    const settings = { title: 'Trip <b>&', collectionTitle: 'Coast', contact: 'me@example.test', palette: 'dark', template: 'grid', columns: 2, size: 400, quality: 90, watermark: '', captionFilename: true, captionRating: true, copyright: '© Tester', captionCopyright: true };
    const r = {};
    window.__libtestCalls = [];
    const first = await window.__libtestCreateWebGallery([A, B, C], { settings, dir: '/out/site' });
    flush(); disk();
    r.first = { rendered: first.rendered, reused: first.reused, files: [...files.keys()].sort() };
    const html = new TextDecoder().decode(files.get('/out/site/index.html'));
    r.html = { palette: /data-palette="dark"/.test(html), title: /Trip &lt;b&gt;&amp;/.test(html), stars: /edited one\.png\n★★★★/.test(html), copyright: /© Tester/.test(html), noAbs: !/\/test\/Gallery/.test(html), dims: /width="400" height="300"/.test(html) };
    const manifest = JSON.parse(new TextDecoder().decode(files.get('/out/site/chromasmith-gallery.json')));
    r.manifestNoPaths = !JSON.stringify(manifest).includes('/test/Gallery');
    const fileFor = (p) => first.rendered.find((f) => f.startsWith(p));
    r.edited = await mean(files.get('/out/site/' + fileFor('edited-one')));
    r.plain = await mean(files.get('/out/site/' + fileFor('plain')));
    r.plainBytes = files.get('/out/site/' + fileFor('plain'));
    r.srcEdited = await srcMean(fx.edited); r.srcPlain = await srcMean(fx.plain);
    // Unchanged re-export: nothing rendered, index + manifest rewritten.
    const again = await window.__libtestCreateWebGallery([A, B, C], { settings, dir: '/out/site' });
    r.again = { rendered: again.rendered.length, reused: again.reused.length, writes: writes().map(([, a]) => a.path.split('/').pop()).sort() };
    flush(); disk();
    // Caption-only change: still nothing rendered.
    const captions = await window.__libtestCreateWebGallery([A, B, C], { settings: { ...settings, captionRating: false, title: 'Renamed' }, dir: '/out/site' });
    r.captionOnly = captions.rendered.length;
    flush(); disk();
    // Recipe change on A, C dropped: one re-render, C reported stale.
    window.__libtestSeedSidecar(A, { recipe: recipe + ' ', edited: true, rating: 4 });
    const changed = await window.__libtestCreateWebGallery([A, B], { settings, dir: '/out/site' });
    r.changed = { rendered: changed.rendered, stale: changed.stale };
    flush(); disk();
    // Watermark changes pixels and forces re-render of both.
    const wm = await window.__libtestCreateWebGallery([A, B], { settings: { ...settings, watermark: 'WATERMARK TEST', watermarkOpacity: 100 }, dir: '/out/site' });
    r.wmRendered = wm.rendered.length;
    flush(); disk();
    const plainFile = wm.rendered.find((f) => f.startsWith('plain'));
    // Bottom-right corner, where applyWatermark draws: mean absolute difference vs the unmarked export.
    const corner = async (b) => { const bm = await createImageBitmap(new Blob([b], { type: 'image/jpeg' })); const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const x = c.getContext('2d'); x.drawImage(bm, 0, 0); return x.getImageData(bm.width - 200, bm.height - 30, 200, 30).data; };
    const [wmPx, noPx] = [await corner(files.get('/out/site/' + plainFile)), await corner(r.plainBytes)];
    let diff = 0; for (let i = 0; i < wmPx.length; i++) diff += Math.abs(wmPx[i] - noPx[i]);
    r.plainWmDiff = diff / wmPx.length;
    // Preview: same HTML, images resolved to the written bytes, phone width honoured.
    const dlg = await window.__libtestWebGalleryPreview(wm, 390);
    const frame = dlg.querySelector('iframe');
    for (let i = 0; i < 100 && !(frame.contentDocument && frame.contentDocument.querySelectorAll('figure img').length && [...frame.contentDocument.querySelectorAll('figure img')].every((im) => im.complete && im.naturalWidth > 0 && im.src.startsWith('blob:'))); i++) await new Promise((res) => setTimeout(res, 100));
    const doc = frame.contentDocument;
    r.preview = { sameHtml: frame.srcdoc === wm.html, imgs: [...doc.querySelectorAll('figure img')].map((im) => [im.naturalWidth, im.src.startsWith('blob:')]), width: frame.getBoundingClientRect().width, cols: getComputedStyle(doc.querySelector('.photos')).gridTemplateColumns.split(' ').length };
    dlg.querySelector('[data-close]').click();
    delete r.plainBytes;
    return r;
  }, fixtures);
  console.log(JSON.stringify(gallery));
  assert.equal(gallery.first.rendered.length, 3, 'first export renders every photo');
  assert.deepEqual(gallery.first.files.filter((f) => !f.endsWith('.jpg')), ['/out/site/chromasmith-gallery.json', '/out/site/index.html']);
  assert.ok(Object.values(gallery.html).every(Boolean), `index.html content: ${JSON.stringify(gallery.html)}`);
  assert.ok(gallery.manifestNoPaths, 'manifest does not publish source paths');
  assert.deepEqual([gallery.edited.w, gallery.edited.h], [400, 300], 'long edge = image size');
  assert.ok(gallery.edited.mean - gallery.srcEdited > 15, `edited photo exported graded (${gallery.edited.mean} vs source ${gallery.srcEdited})`);
  assert.ok(Math.abs(gallery.plain.mean - gallery.srcPlain) < 4, `unedited photo exported ungraded (${gallery.plain.mean} vs ${gallery.srcPlain})`);
  assert.deepEqual([gallery.again.rendered, gallery.again.reused], [0, 3], 'unchanged re-export renders nothing');
  assert.deepEqual(gallery.again.writes, ['chromasmith-gallery.json', 'index.html'], 'unchanged re-export rewrites only the page and manifest');
  assert.equal(gallery.captionOnly, 0, 'caption/title edits do not re-render images');
  assert.equal(gallery.changed.rendered.length, 1, 'recipe change re-renders only that photo');
  assert.ok(gallery.changed.rendered[0].startsWith('edited-one-'));
  assert.equal(gallery.changed.stale.length, 1, 'dropped photo reported stale');
  assert.ok(gallery.changed.stale[0].startsWith('extra-'));
  assert.equal(gallery.wmRendered, 2, 'watermark change re-renders');
  assert.ok(gallery.plainWmDiff > 1, `watermark is drawn into the pixels (corner diff ${gallery.plainWmDiff})`);
  assert.ok(gallery.preview.sameHtml, 'preview uses the exported HTML string');
  assert.ok(gallery.preview.imgs.length === 2 && gallery.preview.imgs.every(([w, blob]) => w > 0 && blob), 'preview shows the exported image bytes');
  assert.ok(Math.abs(gallery.preview.width - 390) < 2 && gallery.preview.cols === 1, `phone-width preview collapses the grid (${gallery.preview.cols} cols)`);

  // ---- Contact sheet: pagination + PDF + PNG pages + template save/load through the dialog.
  const sheetResult = await page.evaluate(async (fx) => {
    const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const paths = Array.from({ length: 5 }, (_, i) => `/test/Sheet/p${i + 1}.png`);
    for (const p of paths) { window.__libtestFileBytes[p] = bytes(fx.plain).buffer; window.__libtestSeedSidecar(p, { rating: 3 }); }
    const saved = [];
    const orig = window.saveFiles;
    window.saveFiles = async (items) => { saved.push(...items); return items.map(() => ({ ok: true })); };
    const out = {};
    try {
      await window.__libtestCreateContactSheet(paths, { format: 'pdf', columns: 2, rows: 2, paper: 'letter', orientation: 'portrait', title: 'Sheet' });
      out.pdf = saved.splice(0).map((s) => ({ fname: s.fname, mime: s.mime, b64: btoa(Array.from(s.content, (c) => String.fromCharCode(c)).join('')) }));
      await window.__libtestCreateContactSheet(paths, { format: 'png', columns: 2, rows: 2 });
      out.png = [];
      for (const s of saved.splice(0)) { const bm = await createImageBitmap(new Blob([s.content], { type: s.mime })); out.png.push({ fname: s.fname, w: bm.width, h: bm.height }); }
      // Template save/load through the real settings dialog.
      localStorage.removeItem('cs-contact-sheet-templates');
      const prompt = window.prompt; window.prompt = () => 'Proof 3x3';
      const run = window.__libtestCreateContactSheet(paths.slice(0, 1));
      await new Promise((r) => setTimeout(r, 50));
      let dlg = document.getElementById('lib-contact-sheet-modal');
      dlg.querySelector('[name="grid"]').value = 'fixed'; dlg.querySelector('[name="grid"]').dispatchEvent(new Event('change', { bubbles: true }));
      dlg.querySelector('[name="columns"]').value = '3'; dlg.querySelector('[name="rows"]').value = '3';
      dlg.querySelector('[name="paper"]').value = 'letter'; dlg.querySelector('[name="orientation"]').value = 'landscape';
      dlg.querySelector('[name="columns"]').dispatchEvent(new Event('input', { bubbles: true }));
      out.summary = dlg.querySelector('[data-summary]').textContent;
      dlg.querySelector('[data-preset-save]').click();
      window.prompt = prompt;
      out.templates = JSON.parse(localStorage.getItem('cs-contact-sheet-templates'));
      dlg.querySelector('[data-cancel]').click();
      await run;
      const run2 = window.__libtestCreateContactSheet(paths.slice(0, 1));
      await new Promise((r) => setTimeout(r, 50));
      dlg = document.getElementById('lib-contact-sheet-modal');
      dlg.querySelector('[name="grid"]').value = 'auto'; dlg.querySelector('[name="paper"]').value = 'a4';
      const sel = dlg.querySelector('[data-preset]'); sel.value = 'Proof 3x3'; sel.dispatchEvent(new Event('change'));
      out.loaded = { grid: dlg.querySelector('[name="grid"]').value, cols: dlg.querySelector('[name="columns"]').value, paper: dlg.querySelector('[name="paper"]').value, orientation: dlg.querySelector('[name="orientation"]').value };
      dlg.querySelector('[data-cancel]').click();
      await run2;
    } finally { window.saveFiles = orig; }
    return out;
  }, fixtures);
  assert.equal(sheetResult.pdf.length, 1);
  assert.equal(sheetResult.pdf[0].fname, 'p1-contact-sheet.pdf');
  assert.equal(sheetResult.pdf[0].mime, 'application/pdf');
  const pdf = Buffer.from(sheetResult.pdf[0].b64, 'base64');
  assert.equal(pdf.subarray(0, 8).toString('latin1'), '%PDF-1.4');
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page /g) || []).length, 2, '5 photos on a 2x2 grid = 2 PDF pages');
  let pdfinfo = 'pdfinfo not installed — structure checked by test/contact_sheet_layout.mjs only';
  try {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-sheet-'));
    await writeFile(path.join(dir, 'sheet.pdf'), pdf);
    pdfinfo = execFileSync('pdfinfo', [path.join(dir, 'sheet.pdf')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(pdfinfo, /Pages:\s+2/);
    assert.match(pdfinfo, /Page size:\s+612 x 792 pts \(letter\)/);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  assert.deepEqual(sheetResult.png.map((p) => [p.fname, p.w, p.h]), [['p1-contact-sheet-p01.png', 2480, 3508], ['p1-contact-sheet-p02.png', 2480, 3508]]);
  assert.equal(sheetResult.summary, '1 photo → 1 page');
  assert.deepEqual(sheetResult.templates['Proof 3x3'] && [sheetResult.templates['Proof 3x3'].columns, sheetResult.templates['Proof 3x3'].rows, sheetResult.templates['Proof 3x3'].paper, sheetResult.templates['Proof 3x3'].orientation], [3, 3, 'letter', 'landscape']);
  assert.deepEqual(sheetResult.loaded, { grid: 'fixed', cols: '3', paper: 'letter', orientation: 'landscape' }, 'saved template loads back into the dialog');
  assert.deepEqual(errors, [], 'no console errors');
  console.log(pdfinfo.trim().split('\n').filter((l) => /Pages|Page size/.test(l)).join(' | '));
  console.log('PASS web gallery (graded assets, incremental, stale, watermark, preview) + contact sheet (pagination, PDF, PNG pages, templates)');
} finally {
  await browser?.close();
  server.close();
}
