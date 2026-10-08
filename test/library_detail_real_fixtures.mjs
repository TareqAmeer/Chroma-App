// CHR-268 current-main source-detail behavior with actual image fixtures in the real Library UI.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '');
    if (pathname.endsWith('coi-serviceworker.min.js')) { res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(''); return; }
    if (pathname.endsWith('favicon.ico')) { res.writeHead(204).end(); return; }
    const source = pathname === 'desktop/dist/library-ui.js' ? 'desktop/library-ui.js' : pathname;
    const body = await readFile(path.join(root, source));
    res.writeHead(200, { 'Content-Type': /\.html$/.test(source) ? 'text/html' : /\.(?:m?js)$/.test(source) ? 'text/javascript' : 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('set_sidecar failed')) errors.push(`${m.text()} (${m.location().url})`); });
  await page.addInitScript(() => localStorage.setItem('chromasmith-tour-seen-v1', '1'));
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=10`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__libEnterSurvey === 'function' && typeof window.__libOpenFolder === 'function');
  await page.evaluate(() => document.querySelectorAll('button').forEach(b => { if (['Got it', 'Skip for now'].includes(b.textContent.trim())) b.click(); }));
  await page.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });
  await page.evaluate(() => window.__libOpenFolder('/test/Photos'));
  await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length >= 8);
  const paths = await page.locator('#lib-grid .lib-card').evaluateAll(cards => cards.map(c => c.dataset.path).filter(p => /\.RW2$/i.test(p)).slice(0, 8));
  assert.equal(paths.length, 8);
  await page.evaluate(async paths => {
    const files = ['portrait.png', 'chart.png', 'orientation_portrait.png', 'orientation_panorama.png'];
    window.__libtestFileBytes = Object.create(null);
    for (let i = 0; i < paths.length; i++) window.__libtestFileBytes[paths[i]] = await (await fetch(`/test/fixtures/${files[i % files.length]}`)).arrayBuffer();
    paths.forEach(p => window.__libSelect(p));
    await window.__libEnterSurvey();
  }, paths);
  await page.waitForFunction(() => [...document.querySelectorAll('#lib-survey .lib-survey-cell')].length === 8 && [...document.querySelectorAll('#lib-survey .lib-survey-cell')].every(e => +e.dataset.sourceWidth > 0));
  const initial = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('#lib-survey .lib-survey-cell')];
    const signatures = cells.map(e => { const c=e.querySelector('canvas'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let s=0; for(let i=0;i<p.length;i+=31)s=(s+p[i]*(i+1))>>>0; return s; });
    return { count: cells.length, columns: getComputedStyle(document.getElementById('lib-survey-grid')).gridTemplateColumns.split(' ').length,
      sources: cells.map(e=>[+e.dataset.sourceWidth,+e.dataset.sourceHeight]), signatures };
  });
  assert.equal(initial.count, 8); assert.equal(initial.columns, 4);
  assert.ok(new Set(initial.signatures).size >= 4, `renders distinct real fixture pixels: ${initial.signatures}`);
  const cells = page.locator('#lib-survey .lib-survey-cell');
  await cells.nth(0).locator('[data-survey-action="pick"]').click();
  await page.waitForFunction(() => document.querySelector('.lib-survey-cell[data-survey-idx="0"] [data-survey-action="pick"]')?.classList.contains('on'));
  await cells.nth(1).locator('[data-survey-action="reject"]').click();
  await page.waitForFunction(() => document.querySelector('.lib-survey-cell[data-survey-idx="1"] [data-survey-action="reject"]')?.classList.contains('on'));
  await cells.nth(2).locator('[data-survey-action="favorite"]').click();
  await page.waitForFunction(() => document.querySelector('.lib-survey-cell[data-survey-idx="2"] [data-survey-action="favorite"]')?.classList.contains('on'));
  await cells.nth(3).focus(); await page.keyboard.press('5');
  await page.waitForFunction(() => document.querySelector('.lib-survey-cell[data-survey-idx="3"] .lib-cmp-chrome span')?.textContent === '5★');
  await page.locator('#lib-survey [data-detail="native"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#lib-survey .lib-survey-cell')].every(e => +e.dataset.detailScale === 1));
  const native = await page.locator('#lib-survey .lib-survey-cell').evaluateAll(cells => cells.map(e=>({source:[+e.dataset.sourceWidth,+e.dataset.sourceHeight],crop:[+e.dataset.detailWidth,+e.dataset.detailHeight],scale:+e.dataset.detailScale})));
  assert.ok(native.every(v=>v.scale===1 && v.crop[0]<=v.source[0] && v.crop[1]<=v.source[1]));
  const before = await cells.evaluateAll(es => es.map(e=>[e.dataset.detailX,e.dataset.detailY]));
  const wrap = cells.nth(0).locator('.lib-cmp-canvas-wrap'), box = await wrap.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+35,box.y+box.height/2+24); await page.mouse.up();
  await page.waitForFunction(old => [...document.querySelectorAll('#lib-survey .lib-survey-cell')].every((e,i)=>e.dataset.detailX!==old[i][0]||e.dataset.detailY!==old[i][1]), before);
  const linked = await cells.evaluateAll(es=>es.map(e=>[(+e.dataset.detailX + +e.dataset.detailWidth/2)/+e.dataset.sourceWidth,(+e.dataset.detailY + +e.dataset.detailHeight/2)/+e.dataset.sourceHeight]));
  assert.ok(linked.every(v=>Math.abs(v[0]-linked[0][0])<0.002&&Math.abs(v[1]-linked[0][1])<0.002),`100% pan is linked in normalized source coordinates: ${JSON.stringify(linked)}`);
  await page.locator('#lib-survey [data-detail="link"]').click();
  const unlinkedBefore = await cells.evaluateAll(es=>es.slice(1).map(e=>[(+e.dataset.detailX + +e.dataset.detailWidth/2)/+e.dataset.sourceWidth,(+e.dataset.detailY + +e.dataset.detailHeight/2)/+e.dataset.sourceHeight]));
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down();
  await page.mouse.move(box.x+box.width/2-28,box.y+box.height/2+12); await page.mouse.up();
  await page.waitForTimeout(250);
  const unlinkedAfter = await cells.evaluateAll(es=>es.slice(1).map(e=>[(+e.dataset.detailX + +e.dataset.detailWidth/2)/+e.dataset.sourceWidth,(+e.dataset.detailY + +e.dataset.detailHeight/2)/+e.dataset.sourceHeight]));
  assert.ok(unlinkedAfter.every((v,i)=>Math.abs(v[0]-unlinkedBefore[i][0])<0.002&&Math.abs(v[1]-unlinkedBefore[i][1])<0.002),'unlinked pan leaves the other seven photos unchanged');
  await page.locator('#lib-survey [data-detail="meta"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#lib-survey .lib-detail-meta')].length === 8 && [...document.querySelectorAll('#lib-survey .lib-detail-meta')].every(e=>!e.hidden));
  await page.locator('#lib-survey [data-detail="meta"]').click();
  assert.equal(await page.locator('#lib-survey .lib-detail-meta:not([hidden])').count(),0,'metadata strips toggle off');
  assert.deepEqual(errors,[],`browser errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ photos: initial.count, columns: initial.columns, distinctFixtureRenders: new Set(initial.signatures).size, sourceSizes: initial.sources, nativeRois: native.map(v=>v.crop), linkedPanCenter: linked[0], unlinkPreservedSeven: true, picks:1, rejects:1, favorites:1, keyboardRating:'5★', metadataStrips:8, metadataToggleOff:true, errors }));
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
