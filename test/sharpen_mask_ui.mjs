// CHR-249 real-photo regression for global sharpening mask and Alt preview.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE = process.env.CHROMA_SHARPEN_FIXTURE || path.join(ROOT, 'test/fixtures/chart.png');
const IMAGE_MIME = /\.jpe?g$/i.test(IMAGE) ? 'image/jpeg' : 'image/png';
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: [process.platform==='win32'?'--use-gl=angle':'--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 });
  const pageErrors = [], glErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error' && /GLSL compile error/i.test(msg.text())) glErrors.push(msg.text()); });
  await page.goto(pathToFileURL(path.join(ROOT, 'chromasmith-22.html')).href, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof window.loadFXImages === 'function' && typeof FX!=='undefined' && FX.ok);
  const image = (await readFile(IMAGE)).toString('base64');
  await page.evaluate(async ({b64,mime}) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const bitmap=await createImageBitmap(new Blob([bytes],{type:mime}));
    const source=document.createElement('canvas');source.width=720;source.height=Math.round(720*bitmap.height/bitmap.width);
    source.getContext('2d').drawImage(bitmap,0,0,source.width,source.height);
    const resized=await new Promise(resolve=>source.toBlob(resolve,'image/jpeg',0.96));
    await loadFXImages([new File([resized], 'sharpen-mask-review.jpg', { type: 'image/jpeg' })]);
    document.body.classList.add('fx-single');
    document.getElementById('panel-fx')?.classList.add('active');
    if (typeof fxSection === 'function') fxSection('nr');
    const toggle = document.getElementById('tg-adjust');
    if (toggle && !toggle.classList.contains('on')) toggle.click();
    window.__sharpMaskPixels = Object.create(null);
    window.__sharpMaskCapture = key => {
      const w=FX.cv.width,h=FX.cv.height,c=document.createElement('canvas');c.width=w;c.height=h;
      const x=c.getContext('2d');x.drawImage(FX.cv,0,0);const p=x.getImageData(0,0,w,h).data;
      window.__sharpMaskPixels[key]=new Uint8Array(p);return {width:w,height:h};
    };
    window.__sharpMaskDiff = (a,b) => {
      const x=window.__sharpMaskPixels[a],y=window.__sharpMaskPixels[b];let changed=0,sum=0,max=0;
      for(let i=0;i<x.length;i+=4)for(let c=0;c<3;c++){const d=Math.abs(x[i+c]-y[i+c]);if(d){changed++;sum+=d;max=Math.max(max,d);}}
      return {changed,sum,max};
    };
    window.__sharpMaskRange = key => {
      const p=window.__sharpMaskPixels[key];let min=255,max=0,nonGray=0;
      for(let i=0;i<p.length;i+=4){min=Math.min(min,p[i]);max=Math.max(max,p[i]);if(p[i]!==p[i+1]||p[i]!==p[i+2])nonGray++;}
      return {min,max,nonGray};
    };
  }, { b64:image, mime:IMAGE_MIME });
  const skipGuide=page.getByRole('button',{name:/Skip guide/i});
  if(await skipGuide.count())await skipGuide.click();
  await page.evaluate(()=>renderPreview());
  await page.waitForTimeout(300);
  const mask = page.locator('#sl-adj-sharp-mask');
  assert.equal(await mask.count(), 1, 'real sharpening mask slider is present');
  const maskState=await mask.evaluate(el=>{const a=[];for(let n=el;n&&n!==document.documentElement;n=n.parentElement)a.push({id:n.id,cls:n.className,display:getComputedStyle(n).display,visibility:getComputedStyle(n).visibility,rect:n.getBoundingClientRect().toJSON()});return a;});
  assert.ok(await mask.isVisible(), `sharpening mask slider is visible in Detail: ${JSON.stringify(maskState)}`);
  const set = async (id, value) => {
    await page.locator(`#sl-${id}`).evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));},value);
    await page.evaluate(()=>renderPreview());
    await page.waitForTimeout(80);
  };
  const capture = key => page.evaluate(k=>window.__sharpMaskCapture(k),key);
  await set('adj-sharp',0); await set('adj-sharp-mask',0); await capture('zero');
  await set('adj-sharp-mask',100); await capture('zeroMasked');
  const exactIdentity = await page.evaluate(()=>window.__sharpMaskDiff('zero','zeroMasked'));
  assert.equal(exactIdentity.max,0,'mask amount alone leaves sharpening at zero byte-identical');
  await set('adj-sharp-mask',0); await set('adj-sharp',100); await capture('sharp');
  await set('adj-sharp-mask',100); await capture('masked');
  assert.equal((await page.locator('#vl-adj-sharp-mask').textContent()).trim(),'100%','mask value label follows the live slider');
  const unmaskedChange = await page.evaluate(()=>window.__sharpMaskDiff('zero','sharp'));
  const maskedChange = await page.evaluate(()=>window.__sharpMaskDiff('zero','masked'));
  assert.ok(unmaskedChange.changed>0,`sharpen amount changes ${unmaskedChange.changed} RGB channel samples`);
  assert.ok(maskedChange.sum<unmaskedChange.sum,`edge mask protects smooth areas (${maskedChange.sum} vs ${unmaskedChange.sum} absolute channel delta)`);
  await page.keyboard.down('Alt'); await page.evaluate(()=>renderPreview()); await page.waitForTimeout(80); await capture('maskPreview');
  const preview = await page.evaluate(()=>window.__sharpMaskRange('maskPreview'));
  assert.equal(preview.nonGray,0,'Alt preview is a grayscale edge mask');
  assert.ok(preview.min<24 && preview.max>220,`Alt preview exposes protected and sharpened regions (${preview.min}..${preview.max})`);
  await page.keyboard.up('Alt'); await page.evaluate(()=>renderPreview()); await page.waitForTimeout(80); await capture('released');
  const previewRestore = await page.evaluate(()=>window.__sharpMaskDiff('masked','released'));
  assert.equal(previewRestore.max,0,'releasing Alt restores the edited photo exactly');
  const snapshot = await page.evaluate(()=>getUISnapshot());
  assert.equal(snapshot.sliders['adj-sharp-mask'],'100','per-photo snapshot includes the sharpening mask value');
  await set('adj-sharp-mask',0);
  await page.evaluate(s=>applyUISnapshot(s),snapshot);
  await page.evaluate(()=>renderPreview()); await page.waitForTimeout(80); await capture('recipeRestored');
  assert.equal(await mask.inputValue(),'100','snapshot restores the mask slider');
  const recipeParity = await page.evaluate(()=>window.__sharpMaskDiff('masked','recipeRestored'));
  assert.equal(recipeParity.max,0,'snapshot restore re-renders identical masked pixels');
  assert.deepEqual(pageErrors,[],`no browser runtime errors: ${pageErrors.join('; ')}`);
  assert.deepEqual(glErrors,[],`no shader compile errors: ${glErrors.join('; ')}`);
  console.log(JSON.stringify({unmaskedChange,maskedChange,exactIdentity,preview,previewRestore,recipeParity,canvas:await capture('final')}));
} finally { await browser.close(); }
