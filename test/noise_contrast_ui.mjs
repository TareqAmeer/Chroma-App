// CHR-249 regression: luminance-NR contrast retention changes rendered pixels and snapshots.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE = path.join(ROOT, 'test/fixtures/portrait.png');
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: [process.platform==='win32'?'--use-gl=angle':'--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 });
  const pageErrors = [], glErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error' && /GLSL compile error/i.test(msg.text())) glErrors.push(msg.text()); });
  await page.goto(pathToFileURL(path.join(ROOT, 'chromasmith-22.html')).href, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof window.loadFXImages === 'function' && typeof FX!=='undefined' && FX.ok);
  const image = (await readFile(IMAGE)).toString('base64');
  await page.evaluate(async b64 => {
    const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
    const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
    const file=new File([new Blob([bytes],{type:'image/png'})],'noise-contrast-fixture.png',{type:'image/png'});
    await loadFXImages([file]);
    document.body.classList.add('fx-single');
    document.getElementById('panel-fx')?.classList.add('active');
    if(typeof fxSection==='function')fxSection('nr');
    window.__nrContrastPixels=Object.create(null);
    window.__nrContrastCapture=key=>{
      const c=document.createElement('canvas');c.width=FX.cv.width;c.height=FX.cv.height;
      const ctx=c.getContext('2d');ctx.drawImage(FX.cv,0,0);
      window.__nrContrastPixels[key]=ctx.getImageData(0,0,c.width,c.height).data;
    };
    window.__nrContrastDiff=(a,b)=>{
      const x=window.__nrContrastPixels[a],y=window.__nrContrastPixels[b];
      let changed=0,sum=0,max=0;
      for(let i=0;i<x.length;i+=4)for(let ch=0;ch<3;ch++){
        const d=Math.abs(x[i+ch]-y[i+ch]);if(d){changed++;sum+=d;max=Math.max(max,d);}
      }
      return{changed,sum,max};
    };
  },image);
  const skipGuide=page.getByRole('button',{name:/Skip guide/i});
  if(await skipGuide.count())await skipGuide.click();
  const slider=page.locator('#sl-nr-con');
  assert.equal(await slider.count(),1,'luminance NR Contrast slider exists');
  assert.ok(await slider.isVisible(),'Contrast is available in the Detail panel');
  const set=async(id,value)=>{
    await page.locator(`#sl-${id}`).evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));},value);
    await page.evaluate(()=>renderPreview());await page.waitForTimeout(100);
    await page.evaluate(v=>window.__nrContrastCapture(v),`${id}-${value}`);
  };
  await page.evaluate(()=>renderPreview());await page.waitForTimeout(100);
  await page.evaluate(()=>window.__nrContrastCapture('source'));
  await set('nr-lum',90);await set('nr-con',0);
  const standard=await page.evaluate(()=>window.__nrContrastDiff('source','nr-con-0'));
  assert.ok(standard.changed>0,`luminance NR changes ${standard.changed} RGB samples`);
  await set('nr-con',50);
  const retained=await page.evaluate(()=>window.__nrContrastDiff('source','nr-con-50'));
  assert.ok(retained.sum>0&&retained.sum<standard.sum,`50% Contrast retains more local luminance detail (${retained.sum} vs ${standard.sum} absolute delta from source)`);
  await set('nr-con',100);
  const fullRetention=await page.evaluate(()=>window.__nrContrastDiff('source','nr-con-100'));
  assert.equal(fullRetention.max,0,'100% Contrast preserves source luminance exactly when color NR is off');
  const snapshot=await page.evaluate(()=>getUISnapshot());
  assert.equal(snapshot.sliders['nr-con'],'100','contrast is stored in the per-photo snapshot');
  await set('nr-con',0);
  await page.evaluate(s=>applyUISnapshot(s),snapshot);
  await page.evaluate(()=>renderPreview());await page.waitForTimeout(100);
  await page.evaluate(()=>window.__nrContrastCapture('restored'));
  const recipeParity=await page.evaluate(()=>window.__nrContrastDiff('nr-con-100','restored'));
  assert.equal(recipeParity.max,0,'snapshot restore reproduces the same pixels');
  await page.evaluate(()=>resetNR());
  assert.equal(await slider.inputValue(),'0','Detail reset returns Contrast to its default');
  assert.deepEqual(pageErrors,[],`no browser runtime errors: ${pageErrors.join('; ')}`);
  assert.deepEqual(glErrors,[],`no shader compile errors: ${glErrors.join('; ')}`);
  console.log(JSON.stringify({standard,retained,fullRetention,recipeParity}));
} finally { await browser.close(); }
