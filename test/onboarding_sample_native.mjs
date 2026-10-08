import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile,stat,unlink,rmdir} from 'node:fs/promises';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const samplePath='vendor/splash/dog-sitting.webp';
const hash=async()=>createHash('sha256').update(await readFile(samplePath)).digest('hex');
const before=await hash();
const browser=await chromium.connectOverCDP(process.env.NATIVE_CDP||'http://127.0.0.1:9223');
const destination=path.resolve('test/output/onboarding-native-export',String(Date.now()));await mkdir(destination,{recursive:true});
let restore;
try {
 const page=browser.contexts()[0].pages().find(p=>!p.url().includes('devtools'));
 await page.setViewportSize({width:1366,height:768});
 await page.reload();await page.waitForFunction(()=>typeof csTourTrySample==='function'&&typeof chromasmithToggleLibrary==='function');
 restore=await page.evaluate(()=>({dest:localStorage.getItem('cs-export-dir')||'',collide:localStorage.getItem('cs-export-collide')}));
 await page.evaluate(destination=>{window.__onboardingCore=__TAURI__.core;window.__onboardingWrites=[];window.__onboardingReveals=[];__TAURI__.core={...window.__onboardingCore,invoke:async(command,args,options)=>{if(command==='plugin:dialog|open'&&args?.options?.directory)return destination;const result=await window.__onboardingCore.invoke(command,args,options);if(command==='save_export_file_raw')window.__onboardingWrites.push(result.path);if(command==='reveal_in_finder')window.__onboardingReveals.push(args.path);return result;}};},destination);
 await page.evaluate(async()=>{
  document.getElementById('cs-modal-ov')?.remove();
  localStorage.setItem('chromasmith-first-edit-guide-v1','1');localStorage.removeItem('chromasmith-first-edit-stage-v1');
  if(!chromasmithLibraryIsOpen())await chromasmithToggleLibrary();
  if(!document.getElementById('lib-overlay').classList.contains('full'))chromasmithToggleExpandedView();
  chromasmithShowTour();
 });
 assert.equal(await page.evaluate(()=>document.getElementById('lib-overlay').classList.contains('full')),true);
 // Failed fetch must leave the current Gallery visible and not advance the guide.
 await page.evaluate(async()=>{const original=window.fetch;window.fetch=async()=>({ok:false,status:503});try{await csTourTrySample()}finally{window.fetch=original}});
 assert.equal(await page.evaluate(()=>chromasmithLibraryIsOpen()),true);
 assert.equal(await page.evaluate(()=>csFirstEditStage()),'');
 for(const theme of ['dark','light']) {
  await page.evaluate(async theme=>{
   document.getElementById('cs-modal-ov')?.remove();sk2ExportClose();document.body.classList.toggle('light',theme==='light');
   if(!chromasmithLibraryIsOpen())await chromasmithToggleLibrary();
   if(!document.getElementById('lib-overlay').classList.contains('full'))chromasmithToggleExpandedView();
   localStorage.removeItem('chromasmith-first-edit-stage-v1');chromasmithShowTour();
  },theme);
  await page.locator('[data-tour-action="sample"]').click();
  await page.waitForFunction(()=>fxImages[0]?.name==='Chromasmith sample'&&!chromasmithLibraryIsOpen()&&csFirstEditStage()==='look');
  await page.evaluate(theme=>fxSetTheme(theme),theme);
  assert.equal(await page.evaluate(()=>document.body.classList.contains('light')),theme==='light');
  assert.equal(await page.evaluate(()=>document.body.classList.contains('lib-full')),false);
  const dims=await page.evaluate(()=>[fxImages[0].img.width,fxImages[0].img.height]);assert.deepEqual(dims,[665,448]);
  await page.locator('[data-guide-action]').click();
  const canvas=page.locator('#fx-canvas');await canvas.waitFor({state:'visible'});
  await page.waitForFunction(()=>[...document.querySelectorAll('#sel-lut option')].some(o=>o.value.startsWith('p:')));
  await page.evaluate(async()=>{const o=[...document.querySelectorAll('#sel-lut option')].find(o=>o.value.startsWith('p:'));await selectLUT(o.value)});
  await page.waitForFunction(()=>csFirstEditStage()==='compare');await page.locator('[data-guide-action]').click();
  await page.waitForFunction(()=>csFirstEditStage()==='export'&&document.querySelector('#cs-modal-ov h2')?.textContent.includes('3 of 3'));
  await page.locator('[data-guide-action]').click();
  await page.locator('#sk2-export').waitFor({state:'visible'});
  if(!await page.locator('#sk2-export .sk2x-more').evaluate(el=>el.open))await page.locator('#sk2-export .sk2x-more summary').click();
  if(await page.locator('#sk2-export [data-fxsec="export"]').evaluate(el=>el.classList.contains('fx-sec-collapsed')))await page.locator('#sk2-export [data-fxsec="export"] .fx-ctrl-title').click();
  await page.locator('#fx-exportdir-btn').click();
  await page.locator('#sk2-export [data-sel="sel-exp-fmt"] [data-v="png"]').click();await page.locator('#sk2-export [data-sel="sel-exp-size"] [data-v="0"]').click();
  await page.evaluate(()=>localStorage.setItem('cs-export-collide','suffix'));
  await page.locator('#sk2-export .sk2x-btn').click();
  await page.waitForSelector('#cs-export-done');
  assert.match(await page.locator('#cs-export-done').innerText(),/First edit saved to/);
  assert.equal(await page.evaluate(()=>csFirstEditStage()),'complete');
  const output=await page.evaluate(()=>window.__onboardingWrites.at(-1));assert.ok(output&&path.dirname(output)===destination);assert.ok((await stat(output)).size>100);
  const encoded=await readFile(output);assert.deepEqual([...encoded].slice(0,8),[137,80,78,71,13,10,26,10]);assert.deepEqual([encoded.readUInt32BE(16),encoded.readUInt32BE(20)],[665,448]);
  await mkdir('test/output',{recursive:true});await page.screenshot({path:`test/output/onboarding-native-${theme}.png`});
  await page.locator('#cs-export-done button').first().click();
  await page.waitForFunction(output=>window.__onboardingReveals.includes(output),output);
  if(theme==='dark'){
   const bytes=await readFile(output);await unlink(output);await mkdir(output);
   try{
    await page.evaluate(async()=>{csFirstEditSetStage('export');fxVersion=window._expVerUsed;localStorage.setItem('cs-export-collide','overwrite');await exportFX();});
    assert.equal(await page.evaluate(()=>csFirstEditStage()),'export','failed write must not finish the guide');
    assert.equal(await page.locator('#cs-export-done').count(),0,'failed write must not show successful output');
    assert.equal(await page.evaluate(()=>window._expFail.length),1);
   }finally{await rmdir(output);await writeFile(output,bytes);}
  }
 }
 assert.equal(await hash(),before,'bundled sample must remain unchanged');
 await writeFile('test/output/onboarding-native-export-results.json',JSON.stringify({destination,realNativeExport:true,realNativeReveal:true,failedWriteKeepsGuide:true,themes:['dark','light'],sampleUnchanged:true},null,2));
 console.log('PASS native full Gallery → sample → visible Studio → look → compare → output in both themes; failed fetch preserves Gallery');
}finally{const page=browser.contexts()[0].pages().find(p=>!p.url().includes('devtools'));if(page&&restore)await page.evaluate(async saved=>{if(window.__onboardingCore)__TAURI__.core=window.__onboardingCore;await __TAURI__.core.invoke('set_export_dir',{path:saved.dest});localStorage.setItem('cs-export-dir',saved.dest);if(saved.collide===null)localStorage.removeItem('cs-export-collide');else localStorage.setItem('cs-export-collide',saved.collide);},restore);await browser.close()}

