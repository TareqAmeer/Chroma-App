import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const samplePath='vendor/splash/dog-sitting.webp';
const hash=async()=>createHash('sha256').update(await readFile(samplePath)).digest('hex');
const before=await hash();
const browser=await chromium.connectOverCDP(process.env.NATIVE_CDP||'http://127.0.0.1:9223');
try {
 const page=browser.contexts()[0].pages().find(p=>!p.url().includes('devtools'));
 await page.reload();await page.waitForFunction(()=>typeof csTourTrySample==='function'&&typeof chromasmithToggleLibrary==='function');
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
   document.getElementById('cs-modal-ov')?.remove();document.body.classList.toggle('light',theme==='light');
   if(!chromasmithLibraryIsOpen())await chromasmithToggleLibrary();
   if(!document.getElementById('lib-overlay').classList.contains('full'))chromasmithToggleExpandedView();
   localStorage.removeItem('chromasmith-first-edit-stage-v1');chromasmithShowTour();
  },theme);
  await page.locator('[data-tour-action="sample"]').click();
  await page.waitForFunction(()=>fxImages[0]?.name==='Chromasmith sample'&&!chromasmithLibraryIsOpen()&&csFirstEditStage()==='look');
  assert.equal(await page.evaluate(()=>document.body.classList.contains('lib-full')),false);
  const dims=await page.evaluate(()=>[fxImages[0].img.width,fxImages[0].img.height]);assert.deepEqual(dims,[665,448]);
  await page.locator('[data-guide-action]').click();
  const canvas=page.locator('#fx-canvas');await canvas.waitFor({state:'visible'});
  await page.waitForFunction(()=>[...document.querySelectorAll('#sel-lut option')].some(o=>o.value.startsWith('p:')));
  await page.evaluate(async()=>{const o=[...document.querySelectorAll('#sel-lut option')].find(o=>o.value.startsWith('p:'));await selectLUT(o.value)});
  await page.waitForFunction(()=>csFirstEditStage()==='compare');await page.locator('[data-guide-action]').click();
  await page.waitForFunction(()=>csFirstEditStage()==='export'&&document.querySelector('#cs-modal-ov h2')?.textContent.includes('3 of 3'));
  await page.locator('[data-guide-action]').click();
  await mkdir('test/output',{recursive:true});await page.screenshot({path:`test/output/onboarding-native-${theme}.png`});
 }
 assert.equal(await hash(),before,'bundled sample must remain unchanged');
 console.log('PASS native full Gallery → sample → visible Studio → look → compare → output in both themes; failed fetch preserves Gallery');
}finally{await browser.close()}

