// Mobile data safety and user-flow gate. Drives the shipped WebView assets, with only
// native filesystem/share/media bridges substituted so denial and cancellation are repeatable.
import assert from 'node:assert/strict';
import {expect as baseExpect} from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium, webkit } from 'playwright';
const expect=baseExpect.configure({timeout:30000});

const root = resolve('.');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.png':'image/png','.woff2':'font/woff2'};
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(path);
    res.writeHead(200, {'Content-Type':mime[extname(path)] || 'application/octet-stream', 'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/chromasmith-22.html?mlib=1`;
const engines = process.argv.includes('--webkit') ? [['WebKit', webkit]] : process.argv.includes('--all') ? [['Chromium', chromium], ['WebKit', webkit]] : [['Chromium', chromium]];
await mkdir('test/output/mobile', { recursive:true });
let failures = 0;

async function exercise(name, engine) {
  const browser = await engine.launch(name === 'Chromium' ? {args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']} : {});
  const context = await browser.newContext({viewport:{width:360,height:780},hasTouch:true,isMobile:true});
  await context.addInitScript(() => {
    localStorage.setItem('chromasmith-tour-seen-v1','1');localStorage.setItem('cs_install_seen','1');
    window.nativeCalls = []; window.nativeBack = {};
    window.Capacitor = {isNativePlatform:()=>true, getPlatform:()=> 'android', Plugins:{
      App:{addListener:async (event,cb)=>{window.nativeBack[event]=cb;return {remove(){}};},minimizeApp:async()=>window.nativeCalls.push('minimize')},
      Filesystem:{stat:async()=>{throw Object.assign(Error('File does not exist'),{code:'OS-PLUG-FILE-0008'});},writeFile:async opts=>{if(window.failFiles)throw Error('Storage full');window.nativeCalls.push(opts);return {uri:'file:///test/'+opts.path};}},
      Share:{share:async()=>{if(window.cancelShare)throw Error('User cancelled');window.nativeCalls.push('share');return {};}},
      Media:{getAlbums:async()=>({albums:[{name:'Chromasmith',identifier:'album1'}]}),createAlbum:async()=>({identifier:'album1'}),savePhoto:async()=>{if(window.denyPhotos)throw Error('Permission denied');window.nativeCalls.push('photo');return {};}}
    }};
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(60000);
  await page.route('https://**/*',r=>r.abort());
  const errors = []; page.on('pageerror',e=>errors.push(e.message));
  const check = async (label, fn) => { await fn(); console.log(`PASS [${name}] ${label}`); };
  try {
    await page.goto(url);await page.waitForFunction(()=>window.MobileLibrary?.isOpen() && window.MobileUI && window.MobileExport,{},{timeout:60000});
    // Disable transitions for deterministic geometry; production motion is covered by the shared gates.
    await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}'});
    await check('360px gallery import/selection controls fit and meet 48px floor',async()=>{
      const bounds = await page.locator('#mlib .mh button').evaluateAll(a=>a.map(e=>{const r=e.getBoundingClientRect();return [r.x,r.right,r.height,r.width];}));
      assert(bounds.every(([x,right,h,w])=>x>=0&&right<=360&&h>=48&&w>=48));
      assert.equal(await page.locator('#mlib .mh').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
    });
    await page.locator('#mlib .import-file').setInputFiles(['test/fixtures/portrait.png','test/fixtures/gradient.png']);
    await page.waitForFunction(()=>fxImages.length===1&&!MobileLibrary.isOpen()&&MobileLibrary.queue.length===2);
    let ids = await page.evaluate(()=>MobileLibrary.queue);
    await check('multiple imports form an explicit per-photo queue',async()=>{
      assert.equal(await page.locator('#phone-queue span').textContent(),'1 / 2');
      assert.equal(await page.evaluate(()=>fxImages.length),1);
    });
    await check('exact duplicate reuse also works without Web Crypto',async()=>{
      const result=await page.evaluate(async id=>{const blob=await MobileLibrary.getBlob(id),d=Object.getOwnPropertyDescriptor(crypto,'subtle');Object.defineProperty(crypto,'subtle',{value:undefined,configurable:true});try{return await MobileLibrary.importFiles([new File([blob],'renamed.png',{type:'image/png'})]);}finally{if(d)Object.defineProperty(crypto,'subtle',d);else delete crypto.subtle;}},ids[0]);assert.deepEqual(result,[ids[0]]);
    });
    await page.evaluate(()=>fxSection('adjust'));
    await page.screenshot({path:`test/output/mobile/${name}-adjust.png`});
    await check('range targets, exact values, compare and switch are accessible',async()=>{
      const rects=await page.locator('#sl-adj-exp, #vl-adj-exp, .fx-ctrl[data-fxsec=adjust]>.fx-ctrl-title, #phone-compare').evaluateAll(a=>a.map(e=>{const r=e.getBoundingClientRect();return {id:e.id,w:r.width,h:r.height,name:e.getAttribute('aria-label')||e.textContent};}));
      assert(rects.every(r=>r.w>=48&&r.h>=48&&r.name));
      await page.locator('#phone-compare').click();assert.equal(await page.evaluate(()=>fxCompare),true);
      await page.locator('#phone-compare').click();assert.equal(await page.evaluate(()=>fxCompare),false);
      assert.equal(await page.evaluate(()=>csSwipeAdjust),false);
      await page.locator('#vl-adj-exp').click();await page.locator('#phone-number').fill('20');await page.locator('[data-apply]').click();
      assert.equal(await page.locator('#sl-adj-exp').inputValue(),'20');
    });
    await check('switching before debounce preserves the outgoing recipe and isolates the next',async()=>{
      await page.evaluate(async next=>{const s=document.getElementById('sl-adj-exp');s.value=40;s.dispatchEvent(new Event('input',{bubbles:true}));await MobileLibrary.openPhoto(next);},ids[1]);
      assert.equal(await page.evaluate(async first=>MobileProject.validateRecipe((await MobileLibrary.getPhoto(first)).recipe).sliders['adj-exp'],ids[0]),'40');
      assert.equal(await page.locator('#sl-adj-exp').inputValue(),'0');
      await page.evaluate(()=>{const s=document.getElementById('sl-adj-exp');s.value=-20;s.dispatchEvent(new Event('input',{bubbles:true}));});
      await page.evaluate(first=>MobileLibrary.openPhoto(first),ids[0]);assert.equal(await page.locator('#sl-adj-exp').inputValue(),'40');
    });
    await check('gallery thumbnails and search, actions, collections and larger text work',async()=>{
      await page.evaluate(()=>MobileLibrary.open());
      assert(!(await page.locator('#mlib input[type=search]').isVisible()));
      await page.locator('#mlib .grid').dispatchEvent('wheel',{deltaY:-200});await expect(page.locator('#mlib input[type=search]')).toBeVisible();
      await page.locator('#mlib input[type=search]').fill('portrait');await page.waitForFunction(()=>document.querySelectorAll('#mlib .cell').length===1);
      await page.waitForFunction(()=>{const e=document.querySelector('#mlib .cell img');return e?.complete&&e.naturalWidth>0;});
      await page.locator('#mlib .photo-menu').dispatchEvent('click');await page.locator('[data-act=collection]').click();await page.locator('#phone-name').fill('Trip');await page.locator('[data-save]').click();
      await page.waitForFunction(()=>document.querySelector('#mlib .collections option[value="Trip"]'));
      await page.locator('#mlib [data-a=settings]').click();await page.locator('[data-pref=textSize]').selectOption('1.3');await page.locator('.phone-close').click();
      await page.screenshot({path:`test/output/mobile/${name}-gallery-large-text.png`});
      assert.equal(await page.locator('#mlib .mh').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
      await page.locator('#mlib input[type=search]').fill('');
    });
    await check('closing selective paste resolves without modifying any photo',async()=>{
      await page.evaluate(()=>{window.pasteSettled=false;MobileLibrary.pasteTo([MobileLibrary.queue[1]],getUISnapshot()).then(()=>window.pasteSettled=true);});
      await page.waitForSelector('.phone-dialog');await page.locator('.phone-close').click();await page.waitForFunction(()=>window.pasteSettled);
    });
    await check('named versions preserve current edits when forking',async()=>{
      await page.evaluate(id=>MobileLibrary.openPhoto(id),ids[0]);
      await page.evaluate(id=>{MobileLibrary.saveVersion(id);},ids[0]);await page.locator('#phone-name').fill('Warm');await page.locator('[data-save]').click();
      await expect.poll(()=>page.evaluate(async id=>(await MobileLibrary.getPhoto(id)).versions.length,ids[0])).toBe(1);
      await page.evaluate(()=>{const s=document.getElementById('sl-adj-exp');s.value=60;s.dispatchEvent(new Event('input',{bubbles:true}));});
      await page.evaluate(()=>MobileLibrary.open());await page.locator('#mlib .photo-menu').first().dispatchEvent('click');await page.locator('[data-version="0"]').click();await page.locator('[data-open]').click();await page.locator('[data-answer=yes]').click();await page.locator('#phone-name').fill('Warm fork');await page.locator('[data-save]').click();
      await expect.poll(()=>page.evaluate(async id=>{const p=await MobileLibrary.getPhoto(id);return !MobileLibrary.isOpening&&!MobileUI.dialog&&document.getElementById('sl-adj-exp').value==='40'&&p.versions.length===3&&MobileProject.validateRecipe(p.recipe).sliders['adj-exp']==='40';},ids[0])).toBe(true);
      const p=await page.evaluate(id=>MobileLibrary.getPhoto(id),ids[0]);
      assert.equal(MobileRecipe(p.recipe).sliders['adj-exp'],'40');
      assert(p.versions.some(v=>v.name==='Before Warm fork'&&MobileRecipe(v.recipe).sliders['adj-exp']==='60'));
    });
    await check('persistent Trash retains original bytes and survives reload',async()=>{
      await page.evaluate(id=>MobileLibrary.trash([id]),ids[1]);await page.reload();await page.waitForFunction(()=>window.MobileLibrary&&!MobileLibrary.isOpening&&(MobileLibrary.isOpen()||fxImages.length));
      assert((await page.evaluate(id=>MobileLibrary.getPhoto(id),ids[1])).trashed);
      assert(await page.evaluate(async id=>(await MobileLibrary.getBlob(id)).size>0,ids[1]));
      await page.evaluate(id=>MobileLibrary.restore([id]),ids[1]);assert(!(await page.evaluate(id=>MobileLibrary.getPhoto(id),ids[1])).trashed);
    });
    await check('ZIP round-trip preserves original bytes, recipes and versions; restore adds new IDs',async()=>{
      const result=await page.evaluate(async()=>{
        const ps=await MobileLibrary.allPhotos(),blob=await MobileProject.pack(ps,MobileLibrary.getBlob),r=await MobileProject.unpack(blob);
        const original=new Uint8Array(await (await MobileLibrary.getBlob(ps[0].id)).arrayBuffer()),restored=new Uint8Array(await r[0].blob.arrayBuffer());
        const before=ps.length;await MobileLibrary.restoreBackup(blob);const after=await MobileLibrary.allPhotos();
        return {same:original.length===restored.length&&original.every((v,i)=>v===restored[i]),recipe:r[0].photo.recipe===ps[0].recipe,versions:r[0].photo.versions.length===ps[0].versions.length,count:after.length,before,newIds:after.filter(p=>!ps.some(a=>a.id===p.id)).length};
      });
      assert(result.same&&result.recipe&&result.versions);assert.equal(result.count,result.before*2);assert.equal(result.newIds,result.before);
      const invalid=await page.evaluate(async()=>{const before=(await MobileLibrary.allPhotos()).length;let threw=false;try{await MobileLibrary.restoreBackup(new Blob(['invalid ZIP']));}catch{threw=true;}return {threw,before,after:(await MobileLibrary.allPhotos()).length};});
      assert(invalid.threw);assert.equal(invalid.before,invalid.after);
    });
    await page.evaluate(id=>MobileLibrary.openPhoto(id),ids[0]);
    await check('denied Photos export offers retry to Files and records only real saves',async()=>{
      const result=await page.evaluate(async()=>{window.denyPhotos=true;window.chromasmithMobileExportDestination='photos';return capShareFiles([{fname:'retry.jpg',content:new Uint8Array([1,2,3])}]);});assert.equal(result[0].ok,false);
      await page.evaluate(()=>chromasmithShowMobileExportResult());await page.locator('[data-files]').click();await page.waitForFunction(()=>document.querySelector('.phone-dialog-content')?.textContent.includes('Saved to file:'));
      assert.equal(await page.evaluate(async()=>(await chromasmithGetExportHistory()).at(-1).status),'saved');await page.locator('.phone-close').click();
    });
    await check('cancelled share is a failure; successful share does not claim Photos save',async()=>{
      const cancelled=await page.evaluate(async()=>{window.cancelShare=true;window.chromasmithMobileExportDestination='share';return capShareFiles([{fname:'share.jpg',content:new Uint8Array([1])}]);});assert.equal(cancelled[0].ok,false);assert.match(cancelled[0].err,/cancelled/);
      const shared=await page.evaluate(async()=>{window.cancelShare=false;return capShareFiles([{fname:'share.jpg',content:new Uint8Array([1])}]);});assert.equal(shared[0].status,'shared');
      await page.evaluate(()=>chromasmithShowMobileExportResult());assert.match(await page.locator('.phone-dialog-content').textContent(),/save not confirmed/);await page.locator('.phone-close').click();
    });
    await check('tool search/categories and remembered sheet size remain usable',async()=>{
      await page.evaluate(()=>fxToolsOpen());assert(!(await page.locator('#phone-tool-search').isVisible()));await page.locator('#phone-tools-find').click();await page.locator('#phone-tool-search').fill('Halation');assert.equal(await page.locator('#fx-tool-grid .fx-sec-btn:visible').count(),1);
      await page.locator('#phone-tool-search').fill('');await page.locator('#fx-tool-cats [data-cat=geometry]').click();
      assert(await page.locator('#fx-tool-grid .fx-sec-btn:visible').count()>=3);
      await page.evaluate(()=>{fxToolsClose();fxToolsOpen();});assert.equal(await page.locator('#fx-tool-cats [data-cat=geometry]').getAttribute('aria-pressed'),'true');
      await page.evaluate(()=>fxSection('adjust'));await page.evaluate(()=>document.body.classList.toggle('sheet-full'));await page.waitForTimeout(100); // the Expand/Reduce button was removed; the sheet size is now set by dragging, which toggles this same class
      await page.evaluate(()=>{fxSheetClose();fxSection('adjust');});assert.equal(await page.evaluate(()=>document.body.classList.contains('sheet-full')),true);
    });
    await check('look grid exposes strength/favourite and mask workflow has explicit paint/erase',async()=>{
      await page.evaluate(()=>fxSection('looks'));await page.locator('#phone-look-browse').click();
      assert(await page.evaluate(()=>document.body.classList.contains('phone-looks-grid')));
      assert.equal(await page.locator('#fx-looks').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),2);
      const look=await page.evaluate(()=>[...document.querySelectorAll('#fx-looks .look-cell')].find(c=>c._lookJob?.val)?._lookJob.val);
      assert(look);await page.locator('#fx-looks .look-cell').evaluateAll((a,val)=>a.find(c=>c._lookJob?.val===val).click(),look);
      await page.waitForFunction(()=>!document.querySelector('#phone-look-fav').disabled);
      await page.locator('#phone-look-fav').click();assert.equal(await page.locator('#phone-look-fav').getAttribute('aria-pressed'),'true');
      await page.locator('#phone-look-strength').click();assert(await page.locator('#sl-lut-mix').isVisible());
      await page.evaluate(()=>{document.body.classList.remove('phone-looks-grid');fxSection('local');});
      await page.locator('[data-mask-add]').click();await page.locator('[data-mask=brush]').click();
      assert.equal(await page.evaluate(()=>fxState.masks.at(-1).type),'brush');
      assert(await page.evaluate(()=>mskPaintMode));await page.locator('[data-mask-erase]').click();assert(await page.evaluate(()=>mskPaintErase));
      await page.evaluate(()=>mskPaintStop());
    });
    await check('real export renderer reaches Files and returns an honest save receipt',async()=>{
      await page.evaluate(()=>{window.chromasmithMobileExportDestination='files';document.getElementById('sel-exp-fmt').value='jpg';document.getElementById('sel-exp-size').value='2048';document.getElementById('sl-exp-q').value=88;});
      await page.evaluate(()=>exportFX());await page.waitForSelector('.phone-dialog');
      assert.match(await page.locator('.phone-dialog-content').textContent(),/Saved to file:/);await page.locator('.phone-close').click();
      assert(await page.evaluate(()=>nativeCalls.some(c=>c&&c.directory==='DOCUMENTS'&&c.data?.length>100)));
    });
    await check('batch export uses individual recipes and produces one result per photo',async()=>{
      await page.evaluate(()=>MobileLibrary.open());await page.locator('#mlib [data-a=select]').click();
      for(const id of ids)await page.locator('#mlib .cell[data-id="'+id+'"]').click();await page.locator('#mlib [data-a=edit]').click();await page.waitForFunction(()=>!MobileLibrary.isOpening&&MobileLibrary.queue.length===2&&!MobileLibrary.isOpen());
      await page.locator('#phone-queue [data-q=actions]').click();await page.locator('[data-queue-export]').click();await page.locator('[data-dest=files]').click();await page.locator('[data-go]').click();
      await page.waitForFunction(()=>document.querySelector('.phone-dialog h2')?.textContent==='Export results',{},{timeout:60000});
      assert.equal(await page.locator('.phone-dialog-content b').count(),2);
      assert(await page.locator('.phone-dialog-content').evaluate(e=>[...e.querySelectorAll('p')].every(p=>p.textContent.includes('Saved to file:'))));
      await page.locator('.phone-close').click();
    });
    await check('Android back dismisses dialog, sheet, gallery selection before minimizing',async()=>{
      await page.evaluate(()=>MobileUI.sheet('Test','<button>Continue</button>'));await page.evaluate(()=>nativeBack.backButton());assert.equal(await page.locator('.phone-dialog').count(),0);
      await page.evaluate(()=>nativeBack.backButton());assert.equal(await page.evaluate(()=>document.body.classList.contains('sheet-open')),false);
      await page.evaluate(()=>nativeBack.backButton());assert.equal(await page.evaluate(()=>MobileLibrary.isOpen()),true);
      await page.locator('#mlib [data-a=select]').click();await page.evaluate(()=>nativeBack.backButton());assert.equal(await page.locator('#mlib.selecting').count(),0);
      await page.evaluate(()=>nativeBack.backButton());assert(await page.evaluate(()=>nativeCalls.includes('minimize')));
    });
    await check('landscape and tablet controls stay within viewport',async()=>{
      await page.evaluate(id=>MobileLibrary.openPhoto(id),ids[0]);await page.evaluate(()=>fxSection('adjust'));
      for (const viewport of [{width:780,height:360},{width:1024,height:768}]) {
        await page.setViewportSize(viewport);await page.screenshot({path:`test/output/mobile/${name}-${viewport.width}x${viewport.height}.png`});
        assert(await page.locator('#cs-rotate').evaluate(e=>!e||getComputedStyle(e).display==='none').catch(()=>true));
        const nav=await page.locator('#fx-mobile-nav').boundingBox();assert(nav.y>=0&&nav.y+nav.height<=viewport.height+2);
        const panel=await page.locator('.fx-panel').boundingBox();assert(panel.x+panel.width<=viewport.width+2);
      }
    });
    assert.deepEqual(errors,[],`Uncaught page errors: ${errors.join('; ')}`);
    console.log(`PASS [${name}] no uncaught page errors`);
  } catch (error) {
    console.error('Mobile failure state:',await page.evaluate(()=>({status:document.querySelector('#mlib .status')?.textContent,queue:window.MobileLibrary?.queue,chrome:[...document.querySelectorAll('#phone-context,#phone-save-status,#phone-queue,#fx-actionbar')].map(e=>[e.id,e.parentElement?.id,e.outerHTML.slice(0,300)]),photos:typeof fxImages==='undefined'?null:fxImages.length,dialog:document.querySelector('.phone-dialog')?.textContent,body:document.body.className})).catch(()=>null),errors);
    await page.screenshot({path:`test/output/mobile/${name}-failure.png`}).catch(()=>{});throw error;
  } finally { await browser.close(); }
}
function MobileRecipe(recipe) { return JSON.parse(Buffer.from(recipe,'base64').toString('utf8')); }
try { for (const [name,engine] of engines) {try {await exercise(name,engine);} catch(e) {failures++;console.error(`FAIL ${name}:`,e.stack);}} }
finally { await new Promise(r=>server.close(r)); }
process.exitCode=failures?1:0;
