#!/usr/bin/env node
// Live Chrome checks for compact mask layout persistence and sky refinement controls.
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const mime = { '.html': 'text/html', '.png': 'image/png', '.js': 'text/javascript', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('not found'); }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox',
    '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
let completed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => console.error('[pageerror]', error.message));
  await page.addInitScript(() => localStorage.removeItem('cs.maskSliderLayout'));
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.loadFXImages === 'function' && typeof window.fxSection === 'function');
  const bytes = await readFile(path.join(here, 'fixtures', 'portrait.png'));
  const b64 = bytes.toString('base64');
  await page.evaluate(async encoded => {
    const raw = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    await loadFXImages([
      new File([raw], 'mask-layout-a.png', { type: 'image/png' }),
      new File([raw], 'mask-layout-b.png', { type: 'image/png' }),
    ]);
  }, b64);
  await page.waitForFunction(() => fxImages?.length === 2 && !!curItem()?.img);
  await page.evaluate(() => { fxSection('local', true); fxHistoryPush(); mskAdd('sky'); });
  await page.waitForFunction(() => document.querySelectorAll('.msk-refine-controls input[type=range]').length === 2);

  const result = await page.evaluate(async () => {
    const digest = px => { let h=2166136261>>>0; for(const v of px){h^=v;h=Math.imul(h,16777619)>>>0;} return h.toString(16); };
    const out = [];
    const ck = (name, ok, detail='') => { out.push({name,pass:!!ok,detail}); if(!ok)throw new Error(`${name}: ${detail}`); };
    ck('standard layout default', !mskCompactLayoutGet() && !document.getElementById('local-ctl').classList.contains('msk-compact'));
    const sky = fxState.masks[mskSel];
    ck('sky Feather and Edge controls present', sky.origin==='sky' && document.querySelectorAll('.msk-refine-controls input[type=range]').length===2);
    sky.refineFeather=65; sky.refineEdge=-45; mskRebuild(); fxHistoryPush();
    const beforeRaster=sky.px, beforePx=digest(beforeRaster), beforeAdjust=JSON.stringify(fxImages[fxCurIdx].adjustOverride||fxState.sharedAdjust||{});
    mskSkyRedetect(sky);
    ck('sky re-detect resets derived settings', sky.refineFeather===0 && sky.refineEdge===0);
    ck('sky re-detect replaces source identity', sky.px!==beforeRaster && digest(sky.px)===beforePx);
    await fxUndo();
    const restored=fxState.masks[mskSel];
    if(!restored)throw new Error(`undo lost sky mask: mskSel=${mskSel}, masks=${fxState.masks.length}, hist=${fxHistIdx}/${fxHistory.length}`);
    ck('undo restores prior sky parameters and pixels', restored.refineFeather===65 && restored.refineEdge===-45 && digest(restored.px)===beforePx);
    document.querySelector('.msk-layout-toggle').click();
    ck('compact preference is pressed and applied', mskCompactLayoutGet() && document.getElementById('local-ctl').classList.contains('msk-compact')
      && document.querySelector('.msk-layout-toggle').getAttribute('aria-pressed')==='true');
    ck('layout toggle leaves photo adjustment values alone', JSON.stringify(fxImages[fxCurIdx].adjustOverride||fxState.sharedAdjust||{})===beforeAdjust);
    fxSelectImage(1);
    ck('layout preference survives photo switch', mskCompactLayoutGet() && document.getElementById('local-ctl').classList.contains('msk-compact'));
    mskAdd('sky');
    fxSelectImage(0);
    ck('preference returns with first photo mask set', mskCompactLayoutGet() && document.getElementById('local-ctl').classList.contains('msk-compact'));
    return out;
  });

  for (const width of [1440, 900, 700, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => mskCompactLayoutToggle());
    const standard = await page.evaluate(() => { const e=document.querySelector('.msk-rowbar'); return {width:e.clientWidth,scroll:e.scrollWidth}; });
    assert.ok(standard.scroll<=standard.width+1, `standard rowbar spills at ${width}px: ${JSON.stringify(standard)}`);
    await page.evaluate(() => mskCompactLayoutToggle());
    const geometry = await page.evaluate(() => {
      const bar=document.querySelector('.msk-rowbar'), ctl=document.getElementById('local-ctl');
      const panel=document.querySelector('.fx-panel'), toggle=document.querySelector('.msk-layout-toggle');
      if(!bar||!ctl||!panel||!toggle)return {missing:true};
      const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
      const children=[...bar.children].filter(e=>rect(e).width>0&&rect(e).height>0);
      const overlaps=[];
      for(let i=0;i<children.length;i++)for(let j=i+1;j<children.length;j++){
        const a=rect(children[i]),b=rect(children[j]);
        if(a.x<b.right-1&&a.right>b.x+1&&a.y<b.bottom-1&&a.bottom>b.y+1)overlaps.push([children[i].className,children[j].className]);
      }
      const sliders=[...document.querySelectorAll('.msk-refine-controls input[type=range]')].map(e=>rect(e));
      const cr=rect(ctl),pr=rect(panel),tr=rect(toggle);
      return {barWidth:bar.clientWidth,barScrollWidth:bar.scrollWidth,overlaps,sliders,
        controlWithinPanel:cr.x>=pr.x-1&&cr.right<=pr.right+1,
        toggleWithinBar:tr.x>=rect(bar).x-1&&tr.right<=rect(bar).right+1};
    });
    assert.ok(!geometry.missing, `mask panel missing at ${width}px`);
    assert.equal(geometry.overlaps.length, 0, `mask rowbar children overlap at ${width}px`);
    assert.ok(geometry.barScrollWidth<=geometry.barWidth+1, `mask rowbar spills at ${width}px: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.controlWithinPanel && geometry.toggleWithinBar, `mask controls escape at ${width}px`);
    assert.ok(geometry.sliders.length===2 && geometry.sliders.every(r=>r.height>=28), `refinement targets are under 28px at ${width}px`);
    result.push({name:`compact controls fit ${width}px`,pass:true,detail:`2 slider targets >=28px; no overlap/spill`});
    if(width===900){await mkdir(path.join(here,'output'),{recursive:true});await page.locator('.msk-refine-controls').screenshot({path:path.join(here,'output','mask-refinement-compact.png')});}
  }
  console.log(`mask refinement browser: ${result.length} checks PASS`);
  result.forEach(check=>console.log(`  PASS ${check.name}${check.detail?` — ${check.detail}`:''}`));
  completed = true;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  if (!completed) process.exitCode = 1;
}
