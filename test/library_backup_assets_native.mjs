// CHR-205 native create/verify/staged-restore of user LUT assets through the actual UI and IPC.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=process.cwd(),output=path.join(process.env.BACKUP_OUTPUT||path.join(root,'test/output/backup-assets-native'),String(Date.now()));
await mkdir(output,{recursive:true});
const lastFile=path.join(process.env.APPDATA,'Chromasmith/library-backup-last.json');
let previousLast;try{previousLast=await readFile(lastFile);}catch(e){if(e.code!=='ENOENT')throw e;}
const browser=await chromium.connectOverCDP(process.env.NATIVE_CDP||'http://127.0.0.1:9223');
const page=browser.contexts()[0].pages().find(p=>!p.url().includes('devtools'));
const name=`CHR205 native fixture ${Date.now()}`;
try{
 await page.waitForFunction(()=>typeof csBackupUserAssets==='function'&&typeof chromasmithLibraryIsOpen==='function');
 await page.evaluate(()=>document.getElementById('cs-modal-ov')?.remove());
 await page.evaluate(async({name,output})=>{
  await lutLibPut(name,Uint8Array.from({length:33*33*33*3},(_,i)=>(i*19+7)%256));
  await lutTx('readwrite',s=>s.put({name:'CHR205 built-in cache sentinel',data:new Uint8Array(33*33*33*3)}),'lutcache');
  if(!chromasmithLibraryIsOpen())await chromasmithToggleLibrary();
  const core=__TAURI__.core;
  window.__backupNativeCore=core;window.__backupNativeResult=null;window.__backupNativeError=null;
  __TAURI__.core={...core,invoke:async(command,args,options)=>{
   if(command==='plugin:dialog|open')return output;
   let result;try{result=await core.invoke(command,args,options);}catch(e){if(command==='library_backup_create')window.__backupNativeError=String(e);throw e;}
   if(command==='library_backup_create')window.__backupNativeResult=result;
   return result;
  }};
 },{name,output});
 await page.locator('#lib-view-menu-btn').click();await page.locator('#lib-backup-create').click();
 await page.waitForFunction(()=>!!window.__backupNativeResult||!!window.__backupNativeError,null,{timeout:60000});
 assert.equal(await page.evaluate(()=>window.__backupNativeError),null);
 const result=await page.evaluate(()=>window.__backupNativeResult);assert.equal(result.verified,true);
 await page.waitForFunction(p=>document.querySelector('#lib-backup-last')?.textContent.includes(p),result.path);
 const assets=JSON.parse(await readFile(path.join(result.path,'user-assets.json'),'utf8'));
 assert.equal(assets.formatVersion,1);const lut=assets.luts.find(l=>l.name===name);assert.ok(lut);
 const bytes=Buffer.from(lut.bytesBase64,'base64');assert.equal(bytes.length,33*33*33*3);assert.ok(bytes.every((v,i)=>v===(i*19+7)%256));
 assert.equal(assets.luts.some(l=>l.name==='CHR205 built-in cache sentinel'),false);
 const manifest=await page.evaluate(p=>__TAURI__.core.invoke('library_backup_verify',{path:p}),result.path);
 assert.ok(manifest.files.some(f=>f.path==='user-assets.json'));
 const restored=path.join(output,'verified-restored');
 await page.evaluate(({source,destination})=>__TAURI__.core.invoke('library_backup_restore',{path:source,destination}),{source:result.path,destination:restored});
 assert.deepEqual(await readFile(path.join(restored,'user-assets.json')),await readFile(path.join(result.path,'user-assets.json')));
 await writeFile(path.join(restored,'user-assets.json'),'corrupt fixture');
 const rejected=await page.evaluate(async p=>{try{await __TAURI__.core.invoke('library_backup_verify',{path:p});return false;}catch(e){return String(e).includes('failed verification');}},restored);
 assert.equal(rejected,true);
 console.log('PASS native UI backup, exact user LUT bytes, built-in exclusion, manifest verification, staged restore identity and corruption rejection');
 await writeFile(path.join(output,'result.json'),JSON.stringify({backup:result.path,restored,userLuts:assets.luts.length,lutBytes:bytes.length,verified:true,corruptionRejected:rejected},null,2));
}finally{
 await page.evaluate(async name=>{await lutLibDel(name);await lutTx('readwrite',s=>s.delete('CHR205 built-in cache sentinel'),'lutcache');if(window.__backupNativeCore)__TAURI__.core=window.__backupNativeCore;},name).catch(()=>{});
 if(previousLast)await writeFile(lastFile,previousLast);else await rm(lastFile,{force:true});
 await browser.close();
}
