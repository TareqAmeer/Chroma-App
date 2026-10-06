// Release validation for recovery, destructive actions and partial native failures.
import assert from 'node:assert/strict';
import {expect as baseExpect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile, mkdir, access} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {chromium, webkit} from 'playwright';
const expect=baseExpect.configure({timeout:30000});

const root=resolve(process.env.CHROMA_MOBILE_WEB_ROOT||'.'),fixtures=resolve('test/fixtures');
let entry='chromasmith-22.html';try{await access(resolve(root,entry));}catch{entry='index.html';}
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');const path=url.pathname.startsWith('/test/fixtures/')?resolve(fixtures,url.pathname.slice('/test/fixtures/'.length)):resolve(root,'.'+url.pathname);
 if(!path.startsWith(root+sep)&&!path.startsWith(fixtures+sep)){res.writeHead(403).end();return;}
 try{const bytes=await readFile(path);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.wasm':'application/wasm'})[extname(path)]||'application/octet-stream','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
await mkdir('test/output/mobile',{recursive:true});
let failures=0;
const engines=process.argv.includes('--all')?[['Chromium',chromium],['WebKit',webkit]]:process.argv.includes('--webkit')?[['WebKit',webkit]]:[['Chromium',chromium]];
async function exercise(name,engine){
 const browser=await engine.launch(name==='Chromium'?{args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}:{});
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});page.setDefaultTimeout(30000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());
 await page.addInitScript(()=>{
  localStorage.setItem('chromasmith-tour-seen-v1','1');localStorage.setItem('cs_install_seen','1');
  window.savedFiles={};window.nativeCalls=[];window.nativeWriteCount=0;
  window.Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'android',Plugins:{
   App:{addListener:async()=>({remove(){}}),minimizeApp:async()=>{}},
   Filesystem:{stat:async o=>{if(!(o.directory+'/'+o.path in savedFiles))throw Object.assign(Error('File does not exist'),{code:'OS-PLUG-FILE-0008'});return {size:savedFiles[o.directory+'/'+o.path].length};},writeFile:async o=>{nativeCalls.push(o);nativeWriteCount++;if(window.failWriteAt===nativeWriteCount)throw Error('Storage full');savedFiles[o.directory+'/'+o.path]=o.data;return {uri:'file:///test/'+o.path};}},
   Share:{share:async()=>{if(window.cancelShare)throw Error('User cancelled');return {};}},
   Media:{getAlbums:async()=>({albums:[{name:'Chromasmith',identifier:'album'}]}),savePhoto:async()=>{if(window.denyPhotos)throw Error('Permission denied');return {};}}
  }};
 });
 const check=async(label,fn)=>{if(process.env.CHROMA_EDGE_CASE&&!label.includes(process.env.CHROMA_EDGE_CASE))return;try{await page.evaluate(()=>MobileUI.dialog?.close());await fn();console.log(`PASS [${name}] ${label}`);}catch(e){failures++;console.error(`FAIL [${name}] ${label}: ${e.stack}`);await page.screenshot({path:`test/output/mobile/${name}-edge-${label.replace(/\W+/g,'-')}.png`}).catch(()=>{});}};
 try{
  await page.goto(`http://127.0.0.1:${server.address().port}/${entry}?mlib=1`);await page.waitForFunction(()=>window.MobileLibrary?.isOpen()&&window.MobileUI&&window.MobileExport);
  await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}'});
  const ids=await page.evaluate(async()=>{const files=await Promise.all(['portrait','gradient'].map(async n=>new File([await(await fetch('/test/fixtures/'+n+'.png')).blob()],n+'.png',{type:'image/png'})));return MobileLibrary.importFiles(files);});
  await page.evaluate(i=>MobileLibrary.openPhoto(i),ids[0]);
  const setExposure=v=>page.evaluate(v=>{const e=document.getElementById('sl-adj-exp');e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));},String(v));
  await check('failed decode preserves the outgoing edit',async()=>{
   await page.evaluate(i=>MobileLibrary.openPhoto(i),ids[0]);await setExposure(37);await page.evaluate(()=>MobileLibrary.flush());
   const bad=await page.evaluate(async()=>{const ids=await MobileLibrary.importFiles([new File(['broken image'],'corrupt.png',{type:'image/png'})]);return ids[0];});
   await page.evaluate(i=>MobileLibrary.openPhoto(i),bad);await page.waitForFunction(()=>!MobileLibrary.isOpening);
   const live=await page.locator('#sl-adj-exp').inputValue();await page.evaluate(()=>MobileUI.dialog?.close());await page.evaluate(()=>MobileLibrary.flush());
   const saved=await page.evaluate(async i=>MobileProject.validateRecipe((await MobileLibrary.getPhoto(i)).recipe).sliders['adj-exp'],ids[0]);
   assert.equal(live,'37');assert.equal(saved,'37');assert.equal(await page.evaluate(()=>MobileLibrary.currentId),ids[0]);
  });
  await check('save failure is recoverable without losing pending edits',async()=>{
   await page.evaluate(i=>MobileLibrary.openPhoto(i),ids[0]);
   await page.evaluate(()=>{window.realPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(v,...args){if(this.name==='photos'&&v.recipe&&window.failPhotoWrite)throw new DOMException('Quota full','QuotaExceededError');return realPut.call(this,v,...args);};window.failPhotoWrite=true;});
   try{await setExposure(51);assert.equal(await page.evaluate(async()=>{try{await MobileLibrary.flush();return false;}catch{return true;}}),true);assert.match(await page.locator('#phone-save-status').textContent(),/Retry/);await page.locator('#phone-save-status').click();await expect(page.locator('#phone-save-status')).toHaveText(/Retry/);await page.evaluate(()=>{window.failPhotoWrite=false;document.getElementById('phone-save-status').click();});await expect.poll(()=>page.evaluate(async i=>MobileProject.validateRecipe((await MobileLibrary.getPhoto(i)).recipe).sliders['adj-exp'],ids[0])).toBe('51');}
   finally{await page.evaluate(()=>{IDBObjectStore.prototype.put=realPut;window.failPhotoWrite=false;});}
   // WebKit reports cancelled local LUT fetches as access-control errors on navigation.
   // Let gallery thumbnails finish so this assertion covers runtime errors in the live app.
   await page.waitForLoadState('networkidle');await page.reload();await page.waitForFunction(()=>window.MobileLibrary&&!MobileLibrary.isOpening&&fxImages.length);assert.equal(await page.locator('#sl-adj-exp').inputValue(),'51');
  });
  await check('Tone sync preserves target geometry masks retouch and grain',async()=>{
   await page.evaluate(i=>MobileLibrary.openPhoto(i),ids[1]);
   await page.evaluate(()=>{geomStraighten(3);mskAdd('radial');healAdd(.4,.4);const g=document.getElementById('sl-grain-a');g.value='21';g.dispatchEvent(new Event('input',{bubbles:true}));});await page.evaluate(()=>MobileLibrary.flush());
   const before=await page.evaluate(()=>getUISnapshot());await page.evaluate(i=>MobileLibrary.openPhoto(i),ids[0]);await setExposure(23);
   await page.evaluate(i=>{window.syncDone=false;MobileLibrary.pasteTo([i],getUISnapshot(),'Sync').then(()=>window.syncDone=true);},ids[1]);
   await page.locator('.phone-dialog input[type=checkbox]').first().waitFor();for(const box of await page.locator('.phone-dialog input[type=checkbox]').all())await box.uncheck();await page.locator('.phone-dialog input[value=adjust]').check();await page.locator('[data-paste]').click();await page.waitForFunction(()=>window.syncDone);
   await page.evaluate(i=>MobileLibrary.openPhoto(i),ids[1]);const after=await page.evaluate(()=>getUISnapshot());assert.equal(after.sliders['adj-exp'],'23');for(const key of ['geom','masks','heal'])assert.deepEqual(after[key],before[key]);assert.equal(after.sliders['grain-a'],before.sliders['grain-a']);
  });
  await check('legacy recipes and selected NR toggles keep their meaning',async()=>{
   const source=await page.evaluate(()=>{const s=getUISnapshot();s.ver=1;s.sliders['adj-exp']='50';s.toggles.nr=true;s.sliders['nr-lum']='35';return s;});
   await page.evaluate(({i,source})=>{window.pasteDone=false;MobileLibrary.pasteTo([i],source).then(()=>window.pasteDone=true);},{i:ids[1],source});
   await page.locator('.phone-dialog input[type=checkbox]').first().waitFor();for(const box of await page.locator('.phone-dialog input[type=checkbox]').all())await box.uncheck();await page.locator('.phone-dialog input[value=adjust]').check();await page.locator('[data-paste]').click();await page.waitForFunction(()=>window.pasteDone);
   assert.equal(await page.evaluate(async i=>MobileProject.validateRecipe((await MobileLibrary.getPhoto(i)).recipe).sliders['adj-exp'],ids[1]),'20');
   await page.evaluate(async i=>{const d=await new Promise(r=>{const q=indexedDB.open('chromasmith-mlib',1);q.onsuccess=()=>r(q.result);});await new Promise((r,j)=>{const t=d.transaction('photos','readwrite'),s=t.objectStore('photos'),q=s.get(i);q.onsuccess=()=>{const p=q.result,v=MobileProject.validateRecipe(p.recipe);v.ver=1;v.sliders['adj-exp']='100';v.toggles.nr=false;p.recipe=btoa(unescape(encodeURIComponent(JSON.stringify(v))));s.put(p);};t.oncomplete=r;t.onerror=()=>j(t.error);});d.close();},ids[1]);
   await page.evaluate(({i,source})=>{window.pasteDone=false;MobileLibrary.pasteTo([i],source).then(()=>window.pasteDone=true);},{i:ids[1],source});
   await page.locator('.phone-dialog input[type=checkbox]').first().waitFor();for(const box of await page.locator('.phone-dialog input[type=checkbox]').all())await box.uncheck();await page.locator('.phone-dialog input[value=nr]').check();await page.locator('[data-paste]').click();await page.waitForFunction(()=>window.pasteDone);
   await page.evaluate(i=>MobileLibrary.openPhoto(i),ids[1]);const s=await page.evaluate(()=>getUISnapshot());assert.equal(s.sliders['adj-exp'],'40');assert.equal(s.sliders['nr-lum'],'35');assert.equal(s.toggles.nr,true);
  });
  await check('numeric entry agrees with displayed adjustment units',async()=>{
   await page.evaluate(()=>fxSection('adjust'));await setExposure(40);const shown=await page.locator('#vl-adj-exp').textContent();await page.locator('#vl-adj-exp').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'phone-number');assert.equal(Number(await page.locator('#phone-number').inputValue()),parseFloat(shown));await page.locator('.phone-close').click();
   await page.evaluate(()=>fxSection('straighten'));await page.locator('#vl-straighten').click();await page.locator('#phone-number').fill('-2.5');await page.locator('[data-apply]').click();assert.equal(await page.evaluate(()=>curItem().geom.angle),-2.5);
  });
  await check('Files exports preserve existing and same-named outputs',async()=>{
   await page.evaluate(async()=>{window.chromasmithMobileExportDestination='files';window.savedFiles={};await capShareFiles([{fname:'same.jpg',content:new Uint8Array([1,2,3])}]);await capShareFiles([{fname:'same.jpg',content:new Uint8Array([4,5,6])}]);});
   const values=await page.evaluate(()=>Object.values(savedFiles));assert.equal(values.length,2);assert(values.includes('AQID')&&values.includes('BAUG'));
  });
  await check('partial export retry saves only failed files for the right photo',async()=>{
   await page.evaluate(i=>MobileLibrary.openPhoto(i),ids[0]);
   const receipts=await page.evaluate(async()=>{window.nativeCalls=[];window.nativeWriteCount=0;window.failWriteAt=2;window.chromasmithMobileExportDestination='files';return capShareFiles([{fname:'ok.jpg',content:new Uint8Array([7])},{fname:'failed.jpg',content:new Uint8Array([8])}]);});assert.equal(receipts[0].ok,true);assert.equal(receipts[1].ok,false);
   const previous=(await page.evaluate(i=>MobileLibrary.getPhoto(i),ids[0])).exports.length;await page.evaluate(i=>MobileLibrary.openPhoto(i),ids[1]);await page.evaluate(()=>{window.failWriteAt=0;chromasmithShowMobileExportResult();});await page.locator('[data-retry]').click();await page.waitForFunction(()=>document.querySelector('.phone-dialog-content')?.textContent.includes('Saved to file:'));
   assert.deepEqual(await page.evaluate(()=>nativeCalls.map(c=>c.path)),['Chromasmith/ok.jpg','Chromasmith/failed.jpg','Chromasmith/failed.jpg']);assert.equal((await page.evaluate(i=>MobileLibrary.getPhoto(i),ids[0])).exports.length,previous+1);
  });
  await check('single-file native helper reports failure without false success',async()=>{
   await page.evaluate(async()=>{window.testToasts=[];window.realToast=toast;window.toast=(message,...args)=>{testToasts.push(message);realToast(message,...args);};window.nativeWriteCount=0;window.failWriteAt=1;window.chromasmithMobileExportDestination='files';await saveFile(new Uint8Array([9]),'helper.jpg','image/jpeg');});
   try{assert(!(await page.evaluate(()=>testToasts)).some(x=>/^Saved/.test(x)));assert.match(await page.locator('.phone-dialog-content').textContent(),/Storage full/);}finally{await page.evaluate(()=>{window.toast=realToast;window.failWriteAt=0;});}
  });
  await check('native Blob exports retain their exact bytes',async()=>{
   const receipt=await page.evaluate(async()=>{window.chromasmithMobileExportDestination='files';return saveFile(new Blob([new Uint8Array([10,11,12])]),'blob-export.png','image/png');});assert.equal(receipt[0].ok,true);assert.equal(await page.evaluate(()=>Object.entries(savedFiles).find(([path])=>path.endsWith('/blob-export.png'))?.[1]),'CgsM');
  });
  await check('painting magnifier and erase follow a real brush stroke',async()=>{
   await page.evaluate(i=>MobileLibrary.openPhoto(i),ids[0]);await page.evaluate(()=>fxSection('local'));await page.locator('[data-mask-add]').click();await page.locator('[data-mask=brush]').click();
   const r=await page.locator('#fx-canvas').boundingBox(),x=r.x+r.width*.5,y=r.y+r.height*.5;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+10,y,{steps:4});assert.equal(await page.locator('#phone-mask-loupe').evaluate(e=>e.hidden),false);await page.mouse.up();assert.equal(await page.locator('#phone-mask-loupe').evaluate(e=>e.hidden),true);
   const sum=()=>page.evaluate(()=>Array.from(fxState.masks[mskSel].px||[]).reduce((a,b)=>a+b,0));const painted=await sum();assert(painted>0);await page.locator('[data-mask-erase]').click();await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+10,y,{steps:4});await page.mouse.up();assert((await sum())<painted);
  });
  await check('permanent deletion requires confirmation and preserves other originals',async()=>{
   await page.evaluate(i=>MobileLibrary.trash([i]),ids[1]);await page.evaluate(()=>MobileLibrary.open());await page.locator('#mlib [data-f=trash]').click();await page.locator('#mlib .photo-menu[data-id="'+ids[1]+'"]').dispatchEvent('click');await page.locator('[data-delete]').click();await page.locator('[data-answer=no]').click();assert(await page.evaluate(i=>MobileLibrary.getBlob(i),ids[1]));
   await page.locator('#mlib .photo-menu[data-id="'+ids[1]+'"]').dispatchEvent('click');await page.locator('[data-delete]').click();await page.locator('[data-answer=yes]').click();await expect.poll(()=>page.evaluate(i=>MobileLibrary.getPhoto(i),ids[1])).toBe(undefined);assert(await page.evaluate(i=>MobileLibrary.getBlob(i),ids[0]));
  });
  await check('small-phone dialogs and keyboard focus stay usable',async()=>{
   await page.evaluate(i=>MobileLibrary.openPhoto(i),ids[0]);await setExposure(70);await page.evaluate(()=>fxHistoryPush());
   await page.setViewportSize({width:320,height:568});await page.evaluate(()=>{document.body.style.setProperty('--phone-text-scale','1.3');MobileUI.sheet('Keyboard test','<button data-first>First</button><button data-last>Last</button>');});
   await page.keyboard.press('Control+z');assert.equal(await page.locator('#sl-adj-exp').inputValue(),'70');
   await page.locator('[data-last]').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.className),'phone-close');await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.hasAttribute('data-last')),true);assert(await page.locator('.phone-dialog section').evaluate(e=>e.scrollWidth<=e.clientWidth));await page.keyboard.press('Escape');assert.equal(await page.locator('.phone-dialog').count(),0);
  });
  assert.deepEqual(errors,[]);console.log(`PASS [${name}] edge cases have no uncaught page errors`);
 }finally{await browser.close();}
}
try{for(const [name,engine]of engines){try{await exercise(name,engine);}catch(e){failures++;console.error(`FAIL ${name}:`,e.stack);}}}finally{await new Promise(r=>server.close(r));}
process.exitCode=failures?1:0;
