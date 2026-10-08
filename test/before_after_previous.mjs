// CHR-270 previous-step held compare: real keyboard input and actual preview/export renderers.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// For natural-photo validation set CHROMASMITH_COMPARE_FIXTURE to a local photo path. CI falls
// back to the repository portrait fixture so the regression remains self-contained.
const PHOTO = process.env.CHROMASMITH_COMPARE_FIXTURE || path.join(ROOT, 'test/fixtures/portrait.png');
const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const file = path.resolve(ROOT, `.${urlPath.replaceAll('/', path.sep)}`);
    if (!file.startsWith(`${ROOT}${path.sep}`)) { res.writeHead(403).end(); return; }
    const body = await readFile(file), ext = path.extname(file).toLowerCase();
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const browser = await chromium.launch({ args: [process.platform === 'win32' ? '--use-gl=angle' : '--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  page.on('crash', () => console.error('Chromium page renderer crashed'));
  await page.addInitScript(() => localStorage.setItem('chromasmith-tour-seen-v1', '1'));
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof loadFXImages === 'function');
  const photo = (await readFile(PHOTO)).toString('base64');
  await page.evaluate(async b64 => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const mime = bytes[0] === 0xFF && bytes[1] === 0xD8 ? 'image/jpeg' : 'image/png';
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 384;
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height); bmp.close();
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    await loadFXImages([new File([blob], 'compare-photo.png', { type: 'image/png' })]);
    document.body.classList.add('fx-single'); document.getElementById('panel-fx')?.classList.add('active');
    const before = getUISnapshot(), after = structuredClone(before);
    after.toggles.adjust = true; after.sliders['adj-exp'] = '60';
    applyUISnapshot(after);
    fxHistory = [
      { j: JSON.stringify(before), rasters: [], label: 'Start', ts: Date.now() - 1000 },
      { j: JSON.stringify(after), rasters: [], label: 'Exposure', ts: Date.now() },
    ]; fxHistIdx = 1; renderPreview();
  }, photo);
  await page.waitForTimeout(250);
  const currentState = await page.evaluate(() => ({ recipe: JSON.stringify(getUISnapshot()), length: fxHistory.length, index: fxHistIdx }));
  const readCurrent = async () => page.evaluate(async () => {
    const w=FX.cv.width,h=FX.cv.height,raw=new Uint8Array(w*h*4);
    FX.gl.readPixels(0,0,w,h,FX.gl.RGBA,FX.gl.UNSIGNED_BYTE,raw);
    const sum=await crypto.subtle.digest('SHA-256',raw);
    return Array.from(new Uint8Array(sum),b=>b.toString(16).padStart(2,'0')).join('');
  });
  const currentPixelHash = await readCurrent();
  const currentExport = await page.evaluate(async () => {
    const src=fxWork||fxImg,w=src.naturalWidth||src.width,h=src.naturalHeight||src.height;
    return (await processToCanvas(getFXParams(),src,w,h,undefined,fxPrepareExportRenderer())).toDataURL();
  });
  await page.keyboard.down('Shift'); await page.keyboard.down('Space');
  await page.waitForFunction(() => fxComparePreviousSnapshot !== null && document.getElementById('fx-canvas-orig').style.display === 'block');
  const heldState = await page.evaluate(() => ({ active: fxComparePreviousSnapshot !== null, recipe: JSON.stringify(getUISnapshot()), length: fxHistory.length, index: fxHistIdx }));
  const comparePixels = await page.evaluate(() => {
    const cv=FX.cv,gl=FX.gl,w=cv.width,h=cv.height,current=new Uint8Array(w*h*4);
    gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,current);
    const before=document.getElementById('fx-canvas-orig').getContext('2d').getImageData(0,0,w,h).data;
    let changed=0,absolute=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const a=(y*w+x)*4,b=((h-1-y)*w+x)*4;
      if(current[b]!==before[a]||current[b+1]!==before[a+1]||current[b+2]!==before[a+2])changed++;
      absolute+=Math.abs(current[b]-before[a])+Math.abs(current[b+1]-before[a+1])+Math.abs(current[b+2]-before[a+2]);
    }
    return {changed,mae:absolute/(w*h*3),width:w,height:h};
  });
  const heldExport = await page.evaluate(async () => {
    const src=fxWork||fxImg,w=src.naturalWidth||src.width,h=src.naturalHeight||src.height;
    return (await processToCanvas(getFXParams(),src,w,h,undefined,fxPrepareExportRenderer())).toDataURL();
  });
  const heldPixelHash = await readCurrent();
  const digest = v => createHash('sha256').update(v).digest('hex');
  assert.equal(heldState.active, true, 'Shift+Space displays the previous history entry');
  assert.ok(comparePixels.changed > 0 && comparePixels.mae > 0.5, `before/current pixel difference ${JSON.stringify(comparePixels)}`);
  assert.equal(heldPixelHash, currentPixelHash, 'holding compare preserves the current canvas pixels');
  assert.equal(digest(heldExport), digest(currentExport), 'full-resolution export pixels are byte-identical while held');
  assert.equal(heldState.recipe, currentState.recipe, 'hold does not apply or save the previous recipe');
  assert.equal(heldState.length, currentState.length, 'hold does not add history');
  assert.equal(heldState.index, currentState.index, 'hold does not move the history cursor');
  await page.keyboard.up('Space'); await page.keyboard.up('Shift');
  await page.waitForFunction(() => fxComparePreviousSnapshot === null);
  await page.waitForTimeout(150);
  const restoredPixels = await readCurrent();
  assert.equal(restoredPixels, currentPixelHash, 'keyup restores the processed current image');
  assert.deepEqual(errors, [], `zero browser errors: ${errors.join(' | ')}`);
  const action = await page.evaluate(() => window.chromasmithShortcutRegistry.actions().find(x => x.id === 'editor.compare-previous'));
  assert.equal(action.binding, 'Shift+Space', 'previous-step hold is available in the rebindable shortcut registry');
  console.log(`CHR-270 previous-step compare PASS: real photo 512x384; before/current delta ${comparePixels.changed} pixels, MAE ${comparePixels.mae.toFixed(2)}; export SHA ${digest(currentExport).slice(0,12)} unchanged while held; recipe/history unchanged; keyup restored; zero console/page errors.`);
} finally { await browser.close(); server.close(); }
