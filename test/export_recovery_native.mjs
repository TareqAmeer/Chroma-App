// CHR-201/202: real WebView2 render -> Rust disk writes, failed-only retry, no duplicate successes.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import {mkdir,readFile,readdir,rmdir,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=process.cwd(),fixture=path.join(root,'test/output/export-recovery-native',String(Date.now()));
const dirs={Archive:path.join(fixture,'archive'),Proof:path.join(fixture,'proof'),Social:path.join(fixture,'social'),Original:path.join(fixture,'original')};
for(const dir of Object.values(dirs))await mkdir(dir,{recursive:true});
const blocked=path.join(dirs.Social,'Photo-07_Social.webp');await mkdir(blocked);
const browser=await chromium.connectOverCDP(process.env.NATIVE_CDP||'http://127.0.0.1:9223');
try{
 const page=browser.contexts()[0].pages().find(p=>!p.url().includes('devtools'));
 await page.reload();await page.waitForFunction(()=>typeof exportMultiPresetRun==='function');
 const bytes=Array.from(await readFile(path.join(root,'test/fixtures/portrait.png')));
 await page.evaluate(async({bytes,dirs})=>{
  window.chromasmithGetOpenedPaths=()=>[];
  await loadFXImages(Array.from({length:20},(_,i)=>new File([new Uint8Array(bytes)],`Photo-${String(i+1).padStart(2,'0')}.png`,{type:'image/png'})));
  await __TAURI__.core.invoke('set_export_dir',{path:dirs.Original});localStorage.setItem('cs-export-dir',dirs.Original);
  localStorage.setItem('cs-export-collide','overwrite');
  exportPresetsSave([
   {name:'Archive',settings:{fmt:'png',q:100,size:0,sharp:0,keepGps:true,dest:dirs.Archive}},
   {name:'Proof',settings:{fmt:'jpg',q:90,size:128,sharp:1,keepGps:false,dest:dirs.Proof}},
   {name:'Social',settings:{fmt:'webp',q:82,size:64,sharp:2,keepGps:true,dest:dirs.Social}}
  ]);
  await exportMultiPresetRun(['Archive','Proof','Social'],fxImages.slice());
 },{bytes,dirs});
 const failure=await page.evaluate(()=>window._expFail.map(f=>({name:f.name,err:f.err,dest:f.dest})));
 assert.equal(failure.length,1,JSON.stringify(failure));assert.match(failure[0].name,/Photo-07_Social/);assert.equal(failure[0].dest,dirs.Social);
 const inventory=async()=>{const files=[];for(const dir of [dirs.Archive,dirs.Proof,dirs.Social])for(const name of await readdir(dir)){const p=path.join(dir,name);if((await stat(p)).isFile())files.push([p,createHash('sha256').update(await readFile(p)).digest('hex')]);}return new Map(files);};
 const before=await inventory();assert.equal(before.size,59);
 await new Promise(r=>setTimeout(r,9400));
 assert.ok(await page.evaluate(()=>!document.getElementById('cs-export-done')&&document.getElementById('exp-last').textContent.includes('failed')),'persistent result survives completion pill');
 await rmdir(blocked);
 await page.evaluate(()=>expRetry('all'));
 assert.equal(await page.evaluate(()=>window._expFail.length),0);
 const after=await inventory();assert.equal(after.size,60);
 for(const dir of [dirs.Archive,dirs.Proof,dirs.Social])assert.equal((await readdir(dir)).length,20);
 for(const[p,hash]of before)assert.equal(after.get(p),hash,'successful outputs remain unchanged');
 assert.ok(after.has(blocked));
 await page.evaluate(p=>__TAURI__.core.invoke('reveal_in_finder',{path:p}),blocked);
 assert.equal(await page.evaluate(()=>localStorage.getItem('cs-export-dir')),dirs.Original);
 const probe=await page.evaluate(async()=>{const content=new Uint8Array([1,2,3]);return await saveFiles([{content,fname:'restored-destination.bin',mime:'application/octet-stream'}]);});
 assert.ok(probe[0].ok);assert.ok((await stat(path.join(dirs.Original,'restored-destination.bin'))).isFile());
 // Suffix and skip use the actual native writer; neither changes the pre-existing bytes.
 const sentinel=path.join(dirs.Original,'collision.bin');await writeFile(sentinel,new Uint8Array([9,9]));
 const collision=await page.evaluate(async()=>{localStorage.setItem('cs-export-collide','suffix');const a=await saveFiles([{content:new Uint8Array([1,2]),fname:'collision.bin',mime:'application/octet-stream'}]);localStorage.setItem('cs-export-collide','skip');const b=await saveFiles([{content:new Uint8Array([3,4]),fname:'collision.bin',mime:'application/octet-stream'}]);return {a,b};});
 assert.deepEqual([...await readFile(sentinel)],[9,9]);assert.ok(collision.a[0].path.endsWith('collision (2).bin'));assert.ok(collision.b[0].skipped);
 await page.evaluate(()=>__TAURI__.core.invoke('set_export_dir',{path:''}));
 console.log(JSON.stringify({passed:true,fixture,outputs:after.size,unchanged:before.size,failure,collision}));
}finally{await browser.close();}
