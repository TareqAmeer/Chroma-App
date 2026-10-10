#!/usr/bin/env node
// Photo-bound depth preview: pixels/labels, modal accessibility, lifecycle and read-only state.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const HERE=path.dirname(fileURLToPath(import.meta.url)),ROOT=path.resolve(HERE,'..');
const MIME={'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm','.png':'image/png'};
const server=createServer(async(req,res)=>{try{const pathname=decodeURIComponent(req.url.split('?')[0]);const file=path.join(ROOT,pathname==='/'?'index.html':pathname.replace(/^\/+/,''));if(!file.startsWith(ROOT)){res.writeHead(403);res.end();return;}const data=await readFile(file);res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end('not found');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-gl=swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`,{waitUntil:'load'});
  await page.waitForFunction(()=>typeof loadFXImages==='function'&&typeof mskDepthPreviewOpen==='function');
  const fixture=(await readFile(path.join(HERE,'fixtures','chart.png'))).toString('base64');
  const setup=await page.evaluate(async b64=>{
    const bin=atob(b64),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    await loadFXImages([new File([bytes],'chart.png',{type:'image/png'})]);
    const item=fxImages[fxCurIdx||0];item.geom=defGeom();item.img._depthMap={data:Uint8Array.of(0,64,192,255),w:2,h:2};
    window.__TAURI__={};updateWork();
    fxSection('local',true);const panel=document.querySelector('.fx-ctrl[data-fxsec="local"]');if(panel?.classList.contains('fx-sec-collapsed'))fxSecToggle(panel);
    fxState.masks=[{type:'none',origin:'depth',depOn:true,depLo:.25,depHi:.75,refineFeather:0,refineEdge:0,amount:100,lumLo:0,lumHi:1}];
    mskSel=0;_mskEnsureIds(fxState.masks);mskRebuild();
    const trigger=document.getElementById('btn-msk-depth-preview');
    const before={snapshot:JSON.stringify(getUISnapshot()),params:JSON.stringify(getFXParams()),history:fxHistory.length,index:fxHistIdx,exportScope:fxExportScope};
    trigger.focus();trigger.click();
    const dialog=document.querySelector('.msk-depth-preview-dialog'),canvas=dialog&&dialog.querySelector('canvas'),close=dialog&&dialog.querySelector('button[aria-label="Close depth map preview"]');
    const pixels=canvas?Array.from(canvas.getContext('2d').getImageData(0,0,2,2).data):[];
    return{button:!!trigger,enabled:!!trigger&&!trigger.disabled,dialog:!!dialog&&dialog.open,role:dialog&&dialog.getAttribute('aria-labelledby'),canvasLabel:canvas&&canvas.getAttribute('aria-label'),text:dialog&&dialog.textContent,pixels,closeFocused:document.activeElement===close,before};
  },fixture);
  assert.ok(setup.button&&setup.enabled,'ready current-photo depth exposes an enabled Preview depth map action');
  assert.ok(setup.dialog&&setup.role&&setup.canvasLabel,'preview uses an accessible modal and named grayscale image');
  assert.match(setup.text,/model estimate/i);assert.match(setup.text,/relative depth/i);assert.match(setup.text,/Farther/);assert.match(setup.text,/Nearer/);
  assert.deepEqual(setup.pixels,[0,0,0,255,64,64,64,255,192,192,192,255,255,255,255,255],'preview renders grayscale with documented far-to-near pixel meaning');
  assert.ok(setup.closeFocused,'opening the preview moves keyboard focus to its Close button');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  const afterEscape=await page.evaluate(before=>({closed:!document.querySelector('.msk-depth-preview-dialog')?.open,
    focus:document.activeElement?.id,trigger:document.getElementById('btn-msk-depth-preview')?.id,
    unchanged:before.snapshot===JSON.stringify(getUISnapshot())&&before.params===JSON.stringify(getFXParams())&&before.history===fxHistory.length&&before.index===fxHistIdx&&before.exportScope===fxExportScope}),setup.before);
  assert.ok(afterEscape.closed&&afterEscape.focus==='btn-msk-depth-preview',`Escape closes the preview and restores focus to its trigger: ${JSON.stringify(afterEscape)}`);
  assert.ok(afterEscape.unchanged,'opening and closing preview leaves adjustments, history and export scope untouched');
  const repeated=await page.evaluate(()=>{const b=document.getElementById('btn-msk-depth-preview');b.focus();b.click();const first=!!window.__mskDepthPreview;mskDepthPreviewClose(true);b.focus();b.click();return{first,count:document.querySelectorAll('.msk-depth-preview-dialog').length,secondFocused:document.activeElement?.getAttribute('aria-label')==='Close depth map preview'};});
  await page.waitForTimeout(40);
  const repeatFocus=await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')==='Close depth map preview');
  assert.ok(repeated.first&&repeated.count===1&&repeated.secondFocused&&repeatFocus,'reopening leaves one dialog and a prior close timer cannot steal focus');
  await page.evaluate(()=>mskDepthPreviewClose(false));
  const geometryClosed=await page.evaluate(()=>{const b=document.getElementById('btn-msk-depth-preview');b.focus();b.click();const open=!!document.querySelector('.msk-depth-preview-dialog')?.open;const item=curItem();item.geom={...item.geom,rot:90};updateWork();return open&&!document.querySelector('.msk-depth-preview-dialog')?.isConnected;});
  assert.ok(geometryClosed,'a geometry/source change closes and invalidates the old preview');
  const sourceClosed=await page.evaluate(()=>{const b=document.getElementById('btn-msk-depth-preview'),item=curItem();b.focus();b.click();item.img._depthMap.data[0]=32;fxSyncDepthTexture({setDepthTex(){},clearDepthTex(){}},item);return !document.querySelector('.msk-depth-preview-dialog')?.isConnected;});
  assert.ok(sourceClosed,'in-place depth regeneration closes the preview bound to old source bytes');
  const photoClosed=await page.evaluate(()=>{const b=document.getElementById('btn-msk-depth-preview');b.focus();b.click();const open=!!document.querySelector('.msk-depth-preview-dialog')?.open;mskDepthPreviewSync({img:{_depthMap:{data:Uint8Array.of(0),w:1,h:1}},geom:defGeom()});return open&&!document.querySelector('.msk-depth-preview-dialog')?.isConnected;});
  assert.ok(photoClosed,'switching to another photo closes the previous photo’s preview');
  assert.equal(errors.length,0,`page errors: ${errors.join(' | ')}`);
  console.log('PASS depth map preview: accessible modal, grayscale orientation labels, Escape/focus, read-only state, geometry invalidation');
}finally{await browser.close();server.close();}
