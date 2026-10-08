import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = createServer(async (req, res) => {
  try {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    const body = await readFile(file);
    const type=file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.on('listening', resolve));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof clSetMode === 'function' && typeof clExport === 'function');
  await page.evaluate(() => localStorage.setItem('chromasmith-collage-layouts-v1', JSON.stringify([{
    name: 'CHR-216 saved test layout', n: 2,
    tree: { dir: 'row', size: 1, children: [{ leaf: true, size: 1 }, { leaf: true, size: 1 }] },
    opts: { aspect: '1:1', bg: '#203040', inner: 8, outer: 0, radius: 0, frame: 'none', titlePos: 'bottom', titleSize: 45, capSize: 28 },
  }])));
  await page.evaluate(() => switchTab('collage'));
  await page.waitForTimeout(350);
  await page.evaluate(() => document.getElementById('cs-modal-ov')?.remove());
  await page.locator('#cl-dz input[type=file]').setInputFiles([
    path.join(ROOT, 'test/fixtures/portrait.png'), path.join(ROOT, 'test/fixtures/gradient.png'),
  ]);
  await page.waitForFunction(() => CL.photos.length === 2 && CL.templates.some(t => t._saved === 'CHR-216 saved test layout'));

  const savedTemplateIndex = await page.evaluate(() => CL.templates.findIndex(t => t._saved === 'CHR-216 saved test layout'));
  await page.locator('#cl-shapes .cl-shape').nth(savedTemplateIndex).click();
  const gridBefore = await page.evaluate(() => JSON.stringify({ tree: CL.tree, assign: CL.assign, cells: CL.cells }));
  assert.ok(savedTemplateIndex >= 2, 'custom saved layout remains available after built-in grids');
  await page.locator('#cl-mode-free').click();
  await page.waitForFunction(() => document.querySelectorAll('#cl-frame .cl-free-item').length === 2);
  assert.equal(await page.locator('#cl-shapes').isVisible(), false, 'grid picker yields to scrapbook controls in freeform mode');

  // Move the first real fixture photo on the stage with the pointer.
  const frame = await page.locator('#cl-frame').boundingBox();
  const firstBefore = await page.evaluate(() => ({ ...CL.freeItems.find(x => x.photo === 0) }));
  await page.mouse.move(frame.x + frame.width * firstBefore.x / 100, frame.y + frame.height * firstBefore.y / 100);
  await page.mouse.down(); await page.mouse.move(frame.x + frame.width * (firstBefore.x + 8) / 100, frame.y + frame.height * (firstBefore.y + 6) / 100, { steps: 5 }); await page.mouse.up();
  const firstAfter = await page.evaluate(() => ({ ...CL.freeItems.find(x => x.photo === 0) }));
  assert.ok(firstAfter.x > firstBefore.x + 5 && firstAfter.y > firstBefore.y + 3, 'drag places a photo at a new freeform position');

  // Select the second photo and resize it with its canvas-edge handle.
  await page.locator('#cl-frame .cl-free-item[data-i="1"]').click({ position: { x: 12, y: 12 } });
  const widthBefore = await page.evaluate(() => CL.freeItems.find(x => x.photo === 1).w);
  const handle = await page.locator('#cl-frame .cl-free-item.sel .cl-free-resize').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2 + 55, handle.y + handle.height / 2 + 30, { steps: 4 }); await page.mouse.up();
  const widthAfter = await page.evaluate(() => CL.freeItems.find(x => x.photo === 1).w);
  assert.ok(widthAfter > widthBefore + 5, 'corner handle resizes the selected photo');

  // Rotate through the visible selected-photo control and drag the second photo over the first.
  await page.locator('#cl-frame .cl-free-item[data-i="1"]').click({ position: { x: 10, y: 10 } });
  await page.locator('#cl-free-rotation').evaluate(el => { el.value = '32'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.evaluate(() => CL.freeItems.find(x => x.photo === 1).rotation), 32);
  const positions = await page.evaluate(() => ({ a: CL.freeItems.find(x => x.photo === 0), b: CL.freeItems.find(x => x.photo === 1) }));
  const x0 = frame.x + frame.width * positions.b.x / 100, y0 = frame.y + frame.height * positions.b.y / 100;
  const x1 = frame.x + frame.width * positions.a.x / 100, y1 = frame.y + frame.height * positions.a.y / 100;
  await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 6 }); await page.mouse.up();
  const overlap = await page.evaluate(() => { const [a,b]=CL.freeItems; return Math.abs(a.x-b.x)<1 && Math.abs(a.y-b.y)<1; });
  assert.ok(overlap, 'independent photos can overlap on the canvas');
  await page.locator('#cl-free-forward').click();
  assert.equal(await page.evaluate(() => CL.freeItems.at(-1).photo), 1, 'layer control changes which overlapping photo is on top');

  // Switching modes is non-destructive to saved templates, grid geometry, and photo assignment.
  await page.locator('#cl-mode-grid').click();
  assert.equal(await page.evaluate(() => JSON.stringify({ tree: CL.tree, assign: CL.assign, cells: CL.cells })), gridBefore);
  assert.equal(await page.locator('#cl-shapes .cl-shape').count(), await page.evaluate(() => CL.templates.length));
  await page.locator('#cl-mode-free').click();
  await page.locator('#cl-preset').selectOption('px:1080x1080');
  await page.locator('#cl-fmt').selectOption('png');
  await page.evaluate(() => { window.__freeExport = null; window.saveFiles = async items => { window.__freeExport = items; }; });
  await page.locator('#cl-export').click();
  await page.waitForFunction(() => window.__freeExport?.length === 1);

  const pixels = await page.evaluate(async () => {
    const item=window.__freeExport[0],blob=new Blob([item.content],{type:item.mime}),bitmap=await createImageBitmap(blob);
    const actual=document.createElement('canvas');actual.width=bitmap.width;actual.height=bitmap.height;const ax=actual.getContext('2d',{willReadFrequently:true});ax.drawImage(bitmap,0,0);
    const expected=document.createElement('canvas');expected.width=bitmap.width;expected.height=bitmap.height;const ex=expected.getContext('2d');ex.fillStyle=CL.bg;ex.fillRect(0,0,expected.width,expected.height);
    for(const it of CL.freeItems){const photo=CL.photos[it.photo],w=it.w/100*expected.width,h=it.h/100*expected.height;ex.save();ex.translate(it.x/100*expected.width,it.y/100*expected.height);ex.rotate(it.rotation*Math.PI/180);ex.drawImage(photo.img,-w/2,-h/2,w,h);ex.restore();}
    const a=ax.getImageData(0,0,actual.width,actual.height).data,e=ex.getImageData(0,0,expected.width,expected.height).data;let diff=0,max=0;
    for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-e[i]);if(d){diff++;if(d>max)max=d;}}
    const top=CL.photos[CL.freeItems.at(-1).photo].img,c=document.createElement('canvas');c.width=c.height=80;const cx=c.getContext('2d');cx.drawImage(top,0,0,80,80);
    const sample=cx.getImageData(40,40,1,1).data,center=ax.getImageData(Math.round(CL.freeItems.at(-1).x/100*actual.width),Math.round(CL.freeItems.at(-1).y/100*actual.height),1,1).data;
    return { size:[bitmap.width,bitmap.height],diff,max,center:[...center],sample:[...sample],mode:CL.mode };
  });
  assert.deepEqual(pixels.size, [1080,1080], 'freeform exports at the selected pixel dimensions');
  assert.equal(pixels.diff, 0, 'export pixels match an independent redraw in position, rotation, and z-order');
  assert.ok(pixels.sample.slice(0,3).every((v,i)=>Math.abs(v-pixels.center[i])<=4), `top scrapbook layer is visible at the shared center pixel (source ${pixels.sample}, output ${pixels.center})`);
  assert.equal(pixels.mode, 'freeform');
  assert.deepEqual(errors, [], 'no page or console errors');
  console.log(`PASS CHR-216 scrapbook: drag/resize/rotate/overlap/layer order, saved grid retained, ${pixels.size.join('×')} PNG pixel match, zero runtime errors`);
} finally {
  await browser.close(); server.close();
}
