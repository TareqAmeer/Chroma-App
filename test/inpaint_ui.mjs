import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const photo=process.env.CHROMA_INPAINT_FIXTURE||path.join(root,'test/fixtures/chart.png');

const server=createServer(async(req,res)=>{try{let file=req.url.split('?')[0].slice(1);if(file==='real-photo')file=photo;const body=await readFile(path.isAbsolute(file)?file:path.join(root,file));res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':file.endsWith('.jpg')||file===photo?'image/jpeg':'image/png'});res.end(body);}catch{res.writeHead(404);res.end();}}).listen(0,'127.0.0.1');
await new Promise(r=>server.on('listening',r));let browser;
try{
 browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 await page.addInitScript(()=>localStorage.setItem('chromasmith-tour-seen-v1','1'));
 await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`);await page.waitForFunction(()=>typeof loadFXImages==='function');
 await page.evaluate(async()=>{const bytes=await(await fetch('/real-photo')).arrayBuffer();await loadFXImages([new File([bytes],'power-lines.jpg',{type:'image/jpeg'})]);curItem().path='native-fixture.jpg';});
 // The native Rust probe generated these full-resolution real-image pixels.
 // The bridge is mocked here to exercise renderer/UI/storage independently of Tauri.
 await page.evaluate(async()=>{window.__inpaintCalls=[];window.__missing=false;const original=curItem().img,w=original.naturalWidth,h=original.naturalHeight;window.__patchUrls=[];
  for(let n=0;n<3;n++){const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.drawImage(original,0,0);const left=Math.floor(w*.30),top=Math.floor(h*.46),rw=Math.max(1,Math.floor(w*.03)),rh=Math.max(1,Math.floor(h*.33));x.fillStyle=['#f08a48','#4796a6','#7d9b54'][n];x.fillRect(left,top,rw,rh);const d=x.getImageData(0,0,w,h);for(let y=0;y<h;y++)for(let px=0;px<w;px++)if(!(y>=top&&y<top+rh&&px>=left&&px<left+rw))d.data[(y*w+px)*4+3]=0;x.putImageData(d,0,0);window.__patchUrls.push(c.toDataURL());}
  window.__TAURI__={core:{convertFileSrc:p=>p,invoke:async(cmd,args)=>{window.__inpaintCalls.push(cmd);if(cmd==='inpaint_resolve'){if(window.__missing)throw Error('Accepted repair asset unavailable; restore the photo assets folder');return window.__patchUrls[Number(args.patch.asset.slice(-1))];}throw Error('Unexpected native request '+cmd);}}};
 });
 await page.addScriptTag({url:`http://127.0.0.1:${server.address().port}/desktop/inpaint-ui.js`});
 const result=await page.evaluate(async()=>{
  const it=curItem(),img=it.img,w=img.naturalWidth,h=img.naturalHeight;
  const pixels=img=>{const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0);return c.getContext('2d').getImageData(0,0,w,h).data;};
  const base=pixels(img);const patch={version:1,asset:'0'.repeat(64),sourceId:'a'.repeat(64),width:w,height:h,enabled:true};
  fxHistoryPush();it.inpaint=[patch];await chromasmithInpaintRestore(it);fxHistoryPush();const after=pixels(geomCanvas(it));let changed=0,outside=0;for(let i=0;i<after.length;i++)if(after[i]!==base[i]){changed++;const px=(i>>2)%w,y=Math.floor((i>>2)/w);if(!(y>=Math.floor(h*.46)&&y<Math.floor(h*.79)&&px>=Math.floor(w*.30)&&px<Math.floor(w*.33)))outside++;}
  const snapshot=getUISnapshot();
  const originalGeom=it.geom;it.geom={rot:90,flipH:false,flipV:false,angle:0,crop:null};const transformed=geomCanvas(it);const rotation={width:transformed.width,height:transformed.height};it.geom=originalGeom;
  it.inpaint[0].enabled=false;const hiddenSame=chromasmithInpaintApply(img,it)===img;it.inpaint[0].enabled=true;
  await applyUISnapshot({...snapshot,inpaint:null});const resetSame=geomCanvas(it)===img;
  await applyUISnapshot(snapshot);const restored=pixels(geomCanvas(it));let restoreDiff=0;for(let i=0;i<after.length;i++)restoreDiff=Math.max(restoreDiff,Math.abs(after[i]-restored[i]));
  // Exercise the actual export renderer as well as geomCanvas: a persisted repair
  // must be present in exported pixels, without changing any unmasked pixels.
  fxState.artSeed=7.7;const repairedExport=await processToCanvas(getFXParams(),geomCanvas(it),w,h);const cleanExport=await processToCanvas(getFXParams(),img,w,h);const repaired=pixels(repairedExport),clean=pixels(cleanExport);let exportChanged=0,exportOutside=0;for(let i=0;i<repaired.length;i++)if(repaired[i]!==clean[i]){exportChanged++;const px=(i>>2)%w,y=Math.floor((i>>2)/w);if(!(y>=Math.floor(h*.46)&&y<Math.floor(h*.79)&&px>=Math.floor(w*.30)&&px<Math.floor(w*.33)))exportOutside++;}
  return {w,h,changed,outside,hiddenSame,resetSame,restoreDiff,rotation,recipeBytes:JSON.stringify(snapshot.inpaint).length,calls:window.__inpaintCalls,exportChanged,exportOutside};
 });
 console.log('Inpaint editor and export pixels:',JSON.stringify(result));assert.ok(result.changed>0);assert.equal(result.outside,0);assert.equal(result.hiddenSame,true);assert.equal(result.resetSame,true);assert.equal(result.restoreDiff,0);assert.equal(result.rotation.width,result.h);assert.equal(result.rotation.height,result.w);assert.ok(result.recipeBytes<300);assert.ok(result.calls.every(c=>c==='inpaint_resolve'),'replay invoked inference');assert.ok(result.exportChanged>0,'export omitted the accepted repair');assert.equal(result.exportOutside,0,'export changed pixels outside the accepted repair');
 await page.evaluate(()=>{fxSection('retouch',true);const toggle=document.getElementById('tg-retouch');if(!toggle.classList.contains('on'))toggleFX('retouch');});const hide=page.locator('#inpaint-accepted button').first();await hide.waitFor({state:'visible',timeout:2000});assert.match(await hide.textContent(),/Hide repair 1/);await hide.click();const show=page.locator('#inpaint-accepted button').first();await show.waitFor({state:'visible'});assert.match(await show.textContent(),/Show repair 1/);await show.click();
 const missing=await page.evaluate(async()=>{window.__missing=true;try{await chromasmithInpaintHydrate(curItem());return 'no failure';}catch(e){return e.message;}});assert.match(missing,/restore/);
 const refuses=await page.evaluate(()=>{try{geomCanvas(curItem());return false;}catch{return true;}});assert.equal(refuses,true);assert.deepEqual(errors,[]);
 console.log('PASS: accepted native pixels, export inclusion, exact outside-mask/hidden identity, geometry, recipe roundtrip, visible controls, missing-asset refusal, no replay inference or console errors. Native bridge mocked; live Tauri job review remains a separate gate.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
