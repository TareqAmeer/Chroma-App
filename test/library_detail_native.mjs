import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,mkdir,copyFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),folder=path.join(root,'test/output/detail-real-photos');
const originals=process.env.DETAIL_ASSETS||'C:/Users/Tareq/Documents/github/Chroma-App/.worktrees/photo-ticket-completion/test/output/reference-assets';
await mkdir(folder,{recursive:true});
const names=['color-negative-positive-triptych.jpg','dusty-scan.jpg','person-photo.jpg','power-lines.jpg'];
for(let i=0;i<8;i++)await copyFile(path.join(originals,names[i%4]),path.join(folder,`${i+1}-${names[i%4]}`));
const browser=await chromium.connectOverCDP(process.env.DETAIL_CDP||'http://127.0.0.1:9223');
const context=browser.contexts()[0],pages=context.pages(),page=pages.find(p=>!p.url().includes('devtools'))||pages[0];
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const cdp=await context.newCDPSession(page);
const source=await readFile(path.join(root,'desktop/library-ui.js'),'utf8');
try{
if(process.env.DETAIL_OVERRIDE==='1'){
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*library-ui.js*',requestStage:'Request'}]});
  cdp.on('Fetch.requestPaused',async e=>{await cdp.send('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(source).toString('base64')});});
  await page.reload({waitUntil:'domcontentloaded'});
}
await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await page.waitForFunction(()=>typeof chromasmithOpenFolder==='function');
await page.evaluate(()=>document.querySelectorAll('button').forEach(b=>{if(['Skip for now','Got it'].includes(b.textContent.trim()))b.click();}));
await page.evaluate(async folder=>{if(!chromasmithLibraryIsOpen())await chromasmithToggleLibrary();await chromasmithOpenFolder(folder);},folder);
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
await page.locator('#lib-compare .lib-cmp-photo-sel[data-pane="B"]').evaluate(el=>{el.value='2';el.dispatchEvent(new Event('change',{bubbles:true}));el.value='3';el.dispatchEvent(new Event('change',{bubbles:true}));});
await page.waitForFunction(()=>document.querySelector('#lib-compare .lib-cmp-pane[data-pane="B"]').dataset.sourceWidth==='1280');
await page.locator('#lib-compare [data-detail="meta"]').click();assert.equal(await page.locator('#lib-compare .lib-detail-meta:visible').count(),2);
// Compare Original ROI against directly decoded source pixels, not a fitted-canvas upsample.
await page.locator('#lib-compare .lib-cmp-src-sel[data-pane="A"]').selectOption('orig');await page.waitForTimeout(800);
const pixel=await page.evaluate(async()=>{
 const e=document.querySelector('#lib-compare [data-pane="A"].lib-cmp-pane'),c=e.querySelector('canvas'),select=e.querySelector('.lib-cmp-photo-sel'),filePath=select.options[+select.value].textContent;
 const grid=[...document.querySelectorAll('#lib-grid .lib-card')];const path=grid.find(g=>g.dataset.path.endsWith(filePath)).dataset.path;
 const bytes=await __TAURI__.core.invoke('read_file_bytes',{path}),im=await createImageBitmap(new Blob([new Uint8Array(bytes)]));
 const expected=document.createElement('canvas');expected.width=c.width;expected.height=c.height;expected.getContext('2d').drawImage(im,+e.dataset.detailX,+e.dataset.detailY,+e.dataset.detailWidth,+e.dataset.detailHeight,0,0,c.width,c.height);
 const actual=c.getContext('2d').getImageData(0,0,c.width,c.height).data,target=expected.getContext('2d').getImageData(0,0,c.width,c.height).data;let error=0,max=0;for(let i=0;i<actual.length;i+=4)for(let k=0;k<3;k++){const d=Math.abs(actual[i+k]-target[i+k]);error+=d;max=Math.max(max,d);}return{mae:error/(actual.length/4*3),max,width:c.width,height:c.height};
});assert.ok(pixel.mae<2,JSON.stringify(pixel));
await page.keyboard.press('Escape');for(let i=0;i<8;i++)await cards.nth(i).click({modifiers:i?['Control']:[]});await page.keyboard.press('n');await page.waitForFunction(()=>document.querySelectorAll('#lib-survey [data-source-width]').length===8);
await page.locator('#lib-survey [data-detail="native"]').click();await page.waitForFunction(()=>[...document.querySelectorAll('#lib-survey .lib-survey-cell')].every(e=>e.dataset.detailScale==='1'));
const survey=await page.evaluate(()=>[...document.querySelectorAll('#lib-survey .lib-survey-cell')].map(e=>({width:e.querySelector('canvas').width,height:e.querySelector('canvas').height,sourceWidth:+e.dataset.sourceWidth,sourceHeight:+e.dataset.sourceHeight,scale:+e.dataset.detailScale})));
assert.equal(survey.length,8);assert.ok(survey.every(p=>p.width*p.height<=1e6));assert.deepEqual(errors,[]);
const layout=await page.evaluate(()=>{const main=document.querySelector('#lib-main'),bounds=main.getBoundingClientRect(),cells=[...document.querySelectorAll('#lib-survey .lib-survey-cell')];const content=cells.map(e=>{const r=e.getBoundingClientRect();return{bottom:r.bottom,contentBottom:bounds.top+main.scrollHeight,right:r.right,maxRight:bounds.right};});main.scrollTop=main.scrollHeight;const last=cells.at(-1).getBoundingClientRect();return{content,scrollHeight:main.scrollHeight,clientHeight:main.clientHeight,scrollTop:main.scrollTop,last:{top:last.top,bottom:last.bottom,mainBottom:bounds.bottom}};});assert.ok(layout.content.every(r=>r.bottom<=r.contentBottom+1&&r.right<=r.maxRight+1),JSON.stringify(layout));assert.ok(layout.scrollHeight>layout.clientHeight&&layout.scrollTop>0&&layout.last.bottom<=layout.last.mainBottom+1,JSON.stringify(layout));

await page.screenshot({path:path.join(root,'test/output/detail-native-8.png')});
const result={frontendOverride:process.env.DETAIL_OVERRIDE==='1',native,linked,pixel,survey,layout,pageErrors:errors};await writeFile(path.join(root,'test/output/detail-native-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await cdp.send('Fetch.disable').catch(()=>{});await browser.close();}
