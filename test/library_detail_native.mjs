import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import {readFile,mkdir,copyFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),folder=path.join(root,'test/output/detail-native-fixtures',String(Date.now()));
const originals=process.env.DETAIL_ASSETS||'C:/Users/Tareq/Documents/github/Chroma-App/.worktrees/photo-ticket-completion/test/output/reference-assets';
await mkdir(folder,{recursive:true});
const names=['color-negative-positive-triptych.jpg','dusty-scan.jpg','person-photo.jpg','power-lines.jpg'];
if(process.env.DETAIL_SYNTHETIC!=='1')for(let i=0;i<8;i++)await copyFile(path.join(originals,names[i%4]),path.join(folder,`${i+1}-${names[i%4]}`));
const browser=await chromium.connectOverCDP(process.env.DETAIL_CDP||'http://127.0.0.1:9223');
const context=browser.contexts()[0],pages=context.pages(),page=pages.find(p=>!p.url().includes('devtools'))||pages[0];
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const cdp=await context.newCDPSession(page);
let source=await readFile(path.join(root,'desktop/library-ui.js'),'utf8');
const transitions=process.env.DETAIL_TRANSITIONS==='1';
if(transitions){
 assert.equal(process.env.DETAIL_OVERRIDE,'1','transition observation requires the explicit source override');
 // Expose existing viewer state only in the intercepted test script, never production assets.
 source=source.replace('function detailView(cell){','window.__detailTransitionState=detailState; function detailView(cell){');
}
try{
await page.reload({waitUntil:'domcontentloaded'});
if(process.env.DETAIL_SYNTHETIC==='1'){
 // Deterministic mixed-size JPEGs exercise source-resolution crops without external assets.
 for(let i=0;i<8;i++){
  const bytes=await page.evaluate(async i=>{const w=i%4===0?1024:1280,h=i%4===0?768:960,c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d'),im=ctx.createImageData(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=(y*w+x)*4;im.data[p]=(x*17+y*3+i*31)%256;im.data[p+1]=(x*3+y*11)%256;im.data[p+2]=((x>>3)^(y>>3))*16%256;im.data[p+3]=255;}ctx.putImageData(im,0,0);return Array.from(new Uint8Array(await(await new Promise(r=>c.toBlob(r,'image/jpeg',.99))).arrayBuffer()));},i);
  await writeFile(path.join(folder,`${i+1}-${names[i%4]}`),new Uint8Array(bytes));
 }
}
if(process.env.DETAIL_OVERRIDE==='1'){
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*library-ui.js*',requestStage:'Request'}]});
  cdp.on('Fetch.requestPaused',async e=>{await cdp.send('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(source).toString('base64')});});
  await page.reload({waitUntil:'domcontentloaded'});
}
await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await page.waitForFunction(()=>typeof chromasmithOpenFolder==='function');
await page.evaluate(()=>document.querySelectorAll('button').forEach(b=>{if(['Skip guide','Skip for now','Got it'].includes(b.textContent.trim()))b.click();}));
await page.evaluate(async folder=>{if(!chromasmithLibraryIsOpen())await chromasmithToggleLibrary();await chromasmithOpenFolder(folder);},folder);
await page.evaluate(()=>{if(!document.getElementById('lib-overlay').classList.contains('full'))chromasmithToggleExpandedView();});
await page.waitForFunction(()=>document.querySelectorAll('#lib-grid .lib-card').length>=8);
const cards=page.locator('#lib-grid .lib-card');await cards.nth(0).click();await cards.nth(1).click({modifiers:['Control']});await cards.nth(2).click({modifiers:['Control']});await cards.nth(3).click({modifiers:['Control']});await page.keyboard.press('c');
await page.waitForFunction(()=>document.querySelectorAll('#lib-compare [data-source-width]').length===2);
await page.evaluate(()=>document.querySelectorAll('button').forEach(b=>{if(['Skip guide','Skip for now','Got it'].includes(b.textContent.trim()))b.click();}));
const editorIndex=await page.evaluate(()=>fxCurIdx);
await page.locator('#lib-compare [data-detail="native"]').click();
await page.waitForFunction(()=>[...document.querySelectorAll('#lib-compare .lib-cmp-pane')].every(e=>e.dataset.detailScale==='1'));
const read=()=>page.evaluate(()=>[...document.querySelectorAll('#lib-compare .lib-cmp-pane')].map(e=>({...e.dataset,canvasWidth:e.querySelector('canvas').width,canvasHeight:e.querySelector('canvas').height,css:e.querySelector('canvas').style.cssText})));
const native=await read();assert.notEqual(native[0].sourceWidth,native[1].sourceWidth);for(const p of native){assert.equal(p.canvasWidth,+p.detailWidth);assert.equal(p.canvasHeight,+p.detailHeight);}
const a=page.locator('#lib-compare [data-pane="A"] .lib-cmp-canvas-wrap'),box=await a.boundingBox();
await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+65,box.y+box.height/2+35);await page.mouse.up();await page.waitForTimeout(600);
const linked=await read();assert.notEqual(linked[0].detailX,native[0].detailX);assert.notEqual(linked[1].detailX,native[1].detailX);
await page.locator('#lib-compare [data-detail="link"]').click();const frozenB=(await read())[1];await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-45,box.y+box.height/2);await page.mouse.up();await page.waitForTimeout(600);assert.equal((await read())[1].detailX,frozenB.detailX);
assert.equal(await page.evaluate(()=>fxCurIdx),editorIndex,'detail inspection must preserve Editor selection');
if(transitions){
 await page.waitForFunction(()=>[...window.__detailTransitionState.cache.keys()].some(k=>JSON.parse(k)[0].includes('3-person-photo')));
 const before=await page.evaluate(()=>{
  const e=document.querySelector('#lib-compare [data-pane="B"].lib-cmp-pane'),c=e.querySelector('canvas');
  window.__transitionCanvas=c;
  const pixels=Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data);
  window.__transitionRelease=null;
  window.__detailTransitionState.queue=window.__detailTransitionState.queue.then(()=>new Promise(r=>window.__transitionRelease=r));
  return{pixels,width:c.width,height:c.height};
 });
 await page.waitForFunction(()=>typeof window.__transitionRelease==='function');
 await page.locator('#lib-compare .lib-cmp-photo-sel[data-pane="B"]').evaluate(el=>{for(const v of ['0','2','3']){el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}));}});
 const pending=await page.evaluate(()=>{const c=document.querySelector('#lib-compare [data-pane="B"] canvas');return{same:c===window.__transitionCanvas,width:c.width,height:c.height,pixels:Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data)};});
 assert.equal(pending.same,true);assert.equal(pending.width,before.width);assert.equal(pending.height,before.height);assert.deepEqual(pending.pixels,before.pixels,'pending replacement retains every displayed pixel');
 await page.evaluate(()=>window.__transitionRelease());
 await page.waitForFunction(()=>document.querySelector('.lib-cmp-name[data-pane="B"]').textContent==='4-power-lines.jpg');
 await page.waitForFunction(()=>[...window.__detailTransitionState.cache.keys()].some(k=>JSON.parse(k)[0].includes('1-color-negative')));
 const bounds=await page.evaluate(()=>({entries:window.__detailTransitionState.cache.size,pixels:[...window.__detailTransitionState.cache.values()].reduce((n,c)=>n+c.width*c.height,0)}));
 assert.ok(bounds.entries<=4&&bounds.pixels<=4e6,JSON.stringify(bounds));
 console.log('PASS CHR-268 next-image prefetch, rapid replacement pixel retention, final selection and bounded cache',bounds);
}
await page.locator('#lib-compare .lib-cmp-photo-sel[data-pane="B"]').evaluate(el=>{el.value='2';el.dispatchEvent(new Event('change',{bubbles:true}));el.value='3';el.dispatchEvent(new Event('change',{bubbles:true}));});
await page.waitForFunction(()=>document.querySelector('#lib-compare .lib-cmp-pane[data-pane="B"]').dataset.sourceWidth==='1280');
await page.locator('#lib-compare [data-detail="meta"]').click();assert.equal(await page.locator('#lib-compare .lib-detail-meta:visible').count(),2);
// Compare Original ROI against directly decoded source pixels, not a fitted-canvas upsample.
const pixel=[];
for(const pane of ['A','B']){
await page.locator(`#lib-compare .lib-cmp-src-sel[data-pane="${pane}"]`).selectOption('orig');await page.waitForTimeout(800);
const sample=await page.evaluate(async pane=>{
 const e=document.querySelector(`#lib-compare [data-pane="${pane}"].lib-cmp-pane`),c=e.querySelector('canvas'),select=e.querySelector('.lib-cmp-photo-sel'),filePath=select.options[+select.value].textContent;
 const grid=[...document.querySelectorAll('#lib-grid .lib-card')];const path=grid.find(g=>g.dataset.path.endsWith(filePath)).dataset.path;
 const bytes=await __TAURI__.core.invoke('read_file_bytes',{path}),im=await createImageBitmap(new Blob([new Uint8Array(bytes)]));
 const expected=document.createElement('canvas');expected.width=c.width;expected.height=c.height;expected.getContext('2d').drawImage(im,+e.dataset.detailX,+e.dataset.detailY,+e.dataset.detailWidth,+e.dataset.detailHeight,0,0,c.width,c.height);
 const actual=c.getContext('2d').getImageData(0,0,c.width,c.height).data,target=expected.getContext('2d').getImageData(0,0,c.width,c.height).data;let error=0,max=0;for(let i=0;i<actual.length;i+=4)for(let k=0;k<3;k++){const d=Math.abs(actual[i+k]-target[i+k]);error+=d;max=Math.max(max,d);}return{mae:error/(actual.length/4*3),max,width:c.width,height:c.height};
},pane);assert.ok(sample.mae<2,JSON.stringify({pane,...sample}));pixel.push({pane,...sample});
}
await page.keyboard.press('Escape');for(let i=0;i<8;i++)await cards.nth(i).click({modifiers:i?['Control']:[]});await page.keyboard.press('n');await page.waitForFunction(()=>document.querySelectorAll('#lib-survey [data-source-width]').length===8);
await page.locator('#lib-survey [data-detail="native"]').click();await page.waitForFunction(()=>[...document.querySelectorAll('#lib-survey .lib-survey-cell')].every(e=>e.dataset.detailScale==='1'));
const survey=await page.evaluate(()=>[...document.querySelectorAll('#lib-survey .lib-survey-cell')].map(e=>({width:e.querySelector('canvas').width,height:e.querySelector('canvas').height,sourceWidth:+e.dataset.sourceWidth,sourceHeight:+e.dataset.sourceHeight,scale:+e.dataset.detailScale})));
assert.equal(survey.length,8);assert.ok(survey.every(p=>p.width*p.height<=1e6));assert.deepEqual(errors,[]);
if(transitions){
 const prior=await page.evaluate(()=>{window.__surveyTransitionCanvases=[...document.querySelectorAll('#lib-survey canvas')];window.__surveyTransitionRelease=null;window.__detailTransitionState.queue=window.__detailTransitionState.queue.then(()=>new Promise(r=>window.__surveyTransitionRelease=r));return window.__surveyTransitionCanvases.map(c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data));});
 await page.waitForFunction(()=>typeof window.__surveyTransitionRelease==='function');
 await page.locator('#lib-survey [data-detail="fit"]').click();
 const pending=await page.evaluate(()=>[...document.querySelectorAll('#lib-survey canvas')].map((c,i)=>({same:c===window.__surveyTransitionCanvases[i],pixels:Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data)})));
 assert.ok(pending.every(p=>p.same));assert.deepEqual(pending.map(p=>p.pixels),prior,'all eight Survey cells retain pixels during queued replacement');
 await page.evaluate(()=>window.__surveyTransitionRelease());await page.waitForFunction(()=>[...document.querySelectorAll('#lib-survey .lib-survey-cell')].every(e=>+e.dataset.detailScale<1));
 console.log('PASS CHR-268 all eight Survey cells retain canvases and pixels during replacement');
}
const layout=await page.evaluate(()=>{const main=document.querySelector('#lib-main'),bounds=main.getBoundingClientRect(),cells=[...document.querySelectorAll('#lib-survey .lib-survey-cell')];const content=cells.map(e=>{const r=e.getBoundingClientRect();return{bottom:r.bottom,contentBottom:bounds.top+main.scrollHeight,right:r.right,maxRight:bounds.right};});main.scrollTop=main.scrollHeight;const last=cells.at(-1).getBoundingClientRect();return{content,scrollHeight:main.scrollHeight,clientHeight:main.clientHeight,scrollTop:main.scrollTop,last:{top:last.top,bottom:last.bottom,mainBottom:bounds.bottom}};});assert.ok(layout.content.every(r=>r.bottom<=r.contentBottom+1&&r.right<=r.maxRight+1),JSON.stringify(layout));assert.ok(layout.scrollHeight>layout.clientHeight&&layout.scrollTop>0&&layout.last.bottom<=layout.last.mainBottom+1,JSON.stringify(layout));

await page.screenshot({path:path.join(root,'test/output/detail-native-8.png')});
const result={synthetic:process.env.DETAIL_SYNTHETIC==='1',fixture:folder,frontendOverride:process.env.DETAIL_OVERRIDE==='1',native,linked,pixel,survey,layout,pageErrors:errors};await writeFile(path.join(root,'test/output/detail-native-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await cdp.send('Fetch.disable').catch(()=>{});await browser.close();}
