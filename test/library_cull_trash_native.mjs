// CHR-267: actual native cull UI -> confirmed system Trash, plus reversible reject metadata.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,access,rename,rmdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=process.cwd(),stamp=String(Date.now()),folder=path.join(root,'test/output/cull-native',stamp);
await mkdir(folder,{recursive:true});
const browser=await chromium.connectOverCDP(process.env.NATIVE_CDP||'http://127.0.0.1:9223');
const page=browser.contexts()[0].pages().find(p=>!p.url().includes('devtools'));
page.setDefaultTimeout(20000);
let preference,bindings;
const hash=bytes=>createHash('sha256').update(Array.isArray(bytes)?new Uint8Array(bytes):bytes).digest('hex');
const files=[];
try{
 await page.waitForFunction(()=>typeof chromasmithOpenFolder==='function');
 const expectedBuild=process.env.CULL_EXPECTED_BUILD;
 assert.ok(expectedBuild,'CULL_EXPECTED_BUILD must identify the native app build under test');
 const actualBuild=await page.evaluate(()=>BUILD);
 assert.equal(actualBuild,expectedBuild,`native app BUILD must match CULL_EXPECTED_BUILD (${expectedBuild})`);
 await page.evaluate(()=>{csFirstEditSkip();document.getElementById('cs-modal-ov')?.remove();});
 preference=await page.evaluate(()=>localStorage.getItem('chromasmith_lib_cull_auto_advance'));
 await page.evaluate(()=>localStorage.setItem('chromasmith_lib_cull_auto_advance','0'));
 for(let i=0;i<4;i++){
  const bytes=await page.evaluate(async i=>{const c=document.createElement('canvas');c.width=1200;c.height=800;const g=c.getContext('2d');g.fillStyle=['#c93636','#36c936','#3636c9','#c9c936'][i];g.fillRect(0,0,c.width,c.height);g.fillStyle='#fff';g.font='80px sans-serif';g.fillText('Cull fixture '+i,150,350);return Array.from(new Uint8Array(await(await new Promise(r=>c.toBlob(r,'image/jpeg',.95))).arrayBuffer()));},i);
  const file=path.join(folder,`CHR267-${stamp}-frame${i}.jpg`);await writeFile(file,new Uint8Array(bytes));files.push({path:file,hash:hash(bytes)});
 }
 await page.evaluate(async folder=>{if(!chromasmithLibraryIsOpen())await chromasmithToggleLibrary();await chromasmithOpenFolder(folder);},folder);
 await page.waitForFunction(()=>document.querySelectorAll('#lib-grid .lib-card').length===4);
 const cards=page.locator('#lib-grid .lib-card');for(let i=0;i<4;i++)await cards.nth(i).click({modifiers:i?['Control']:[]});
 await page.locator('#lib-batchbar [data-act="cull"]').click();
 await page.locator('#lib-cull-time-all').click();await page.locator('#lib-cull-time-start').click();await page.locator('#fx-confirm-ok').click();
 await page.locator('#lib-cull-del').waitFor();assert.equal(await page.locator('#lib-cull-del').textContent(),'Delete rejected (0)');
 await page.evaluate(()=>document.getElementById('cs-modal-ov')?.remove());
 if(process.env.CULL_ADVANCE==='1'){
  bindings=await page.evaluate(()=>chromasmithShortcutRegistry.export());
  await page.evaluate(()=>{csShortcutSet('library.pick','F7');csShortcutSet('library.reject','F8');csShortcutSet('library.rate-5','F9');});
  const focus=idx=>page.waitForFunction(i=>document.querySelector('.lib-survey-cell.cmp-focus')?.dataset.surveyIdx===String(i),idx);
  await page.locator('#lib-cull-auto-advance').click();
  await page.locator('.lib-survey-cell[data-survey-idx="0"]').focus();
  await page.keyboard.press('F7');await focus(1);await page.keyboard.press('F8');await focus(2);await page.keyboard.press('F9');await focus(3);
  const ratings=await page.evaluate(()=>[...document.querySelectorAll('.lib-survey-cell .lib-cmp-chrome span')].map(e=>e.textContent));assert.equal(ratings[2],'5★');
  for(let i=0;i<3;i++){await page.keyboard.press('Control+z');await page.waitForTimeout(100);}
  await page.waitForFunction(()=>document.getElementById('lib-cull-del')?.textContent==='Delete rejected (0)');
  await page.locator('#lib-cull-auto-advance').click();await page.locator('.lib-survey-cell[data-survey-idx="3"]').focus();await page.keyboard.press('F7');await page.waitForTimeout(150);await focus(3);await page.keyboard.press('Control+z');await page.waitForTimeout(100);
  await page.keyboard.press('p');await page.waitForTimeout(150);assert.equal(await page.locator('.lib-survey-cell[data-survey-idx="3"] [data-survey-action="pick"]').evaluate(e=>e.classList.contains('on')),false,'old Pick binding is suppressed');
  await page.locator('#lib-cull-auto-advance').click();
  await page.locator('.lib-survey-cell[data-survey-idx="3"]').focus();
  const target=files[3].path.replace(/\.jpg$/i,'.xmp'),saved=target+'.preserved';
  assert.ok(path.resolve(target).startsWith(path.resolve(folder)+path.sep));
  await rename(target,saved);await mkdir(target);
  await page.evaluate(()=>{const core=__TAURI__.core;window.__nativeCullCore=core;window.__nativeCullFailure=null;__TAURI__.core={...core,invoke:async(command,args,options)=>{try{return await core.invoke(command,args,options);}catch(e){if(command==='set_sidecar')window.__nativeCullFailure=String(e);throw e;}}};});
  try{await page.keyboard.press('F9');await page.waitForFunction(()=>!!window.__nativeCullFailure);await focus(3);assert.notEqual(await page.locator('.lib-survey-cell[data-survey-idx="3"] .lib-cmp-chrome span').textContent(),'5★','native failed rating rolls back');}
  finally{await rmdir(target);await rename(saved,target);await page.evaluate(()=>__TAURI__.core=window.__nativeCullCore);}
  // Hold only the response of an actual successful write, navigate away, then release it.
  await page.locator('.lib-survey-cell[data-survey-idx="0"]').focus();
  await page.evaluate(()=>{const core=__TAURI__.core;window.__nativeCullCore=core;window.__nativeCullRelease=null;__TAURI__.core={...core,invoke:async(command,args,options)=>{const result=await core.invoke(command,args,options);if(command==='set_sidecar')await new Promise(r=>window.__nativeCullRelease=r);return result;}};});
  await page.keyboard.press('F7');await page.waitForFunction(()=>typeof window.__nativeCullRelease==='function');await page.keyboard.press('ArrowRight');await focus(1);
  await page.evaluate(()=>{__TAURI__.core=window.__nativeCullCore;window.__nativeCullRelease();});await page.waitForTimeout(150);await focus(1);
  await page.keyboard.press('Control+z');await page.waitForTimeout(100);
  await page.evaluate(text=>chromasmithShortcutRegistry.import(text),bindings);bindings=undefined;
  await page.locator('#lib-cull-auto-advance').click();await page.locator('.lib-survey-cell[data-survey-idx="0"]').focus();
  console.log('PASS native rebound Pick/Reject/rating advance, paused advance, old binding suppression, real failed rating rollback and stale completion protection');
 }
 await page.keyboard.press('Shift+X');await page.waitForFunction(()=>document.getElementById('lib-cull-del')?.textContent==='Delete rejected (1)');
 for(const f of files)assert.equal(hash(await readFile(f.path)),f.hash,'reject preserves every original');
 await page.keyboard.press('Control+z');await page.waitForFunction(()=>document.getElementById('lib-cull-del')?.textContent==='Delete rejected (0)');
 await page.keyboard.press('Shift+X');await page.waitForFunction(()=>document.getElementById('lib-cull-del')?.textContent==='Delete rejected (1)');
 await page.locator('#lib-cull-del').click();
 const prompt=await page.locator('#fx-confirm-msg').innerText();assert.match(prompt,/Delete 1 rejected photo/);assert.match(prompt,/Trash/);
 await page.locator('#fx-confirm-modal button').filter({hasText:/^Cancel$/}).click();for(const f of files)await access(f.path);
 const rejected=files.find(f=>prompt.includes(path.basename(f.path)));assert.ok(rejected);
 const sidecar=rejected.path.replace(/\.jpg$/i,'.xmp'),sidecarHash=hash(await readFile(sidecar));
 await page.locator('#lib-cull-del').click();await page.locator('#fx-confirm-modal button').filter({hasText:/^Move 1 to Trash$/}).click();
 await page.waitForFunction(()=>document.getElementById('lib-cull-del')?.textContent==='Delete rejected (0)');
 await assert.rejects(access(rejected.path));for(const f of files.filter(f=>f!==rejected))assert.equal(hash(await readFile(f.path)),f.hash);
 const shellScript=`$taskFolder=$env:CHROMA_CULL_TRASH_FOLDER;$taskNames=$env:CHROMA_CULL_TRASH_NAMES|ConvertFrom-Json;$taskShell=New-Object -ComObject Shell.Application;$taskBin=$taskShell.Namespace(10);$taskMatches=@();foreach($taskItem in $taskBin.Items()){$taskName=$taskItem.Name;$taskExt=[IO.Path]::GetExtension($taskItem.Path);if(-not $taskName.EndsWith($taskExt,[StringComparison]::OrdinalIgnoreCase)){$taskName+=$taskExt};$taskFrom=$taskItem.ExtendedProperty('System.Recycle.DeletedFrom');if($taskNames -contains $taskName -and $taskFrom -eq $taskFolder){$taskMatches+=@{name=$taskName;path=$taskItem.Path;from=$taskFrom}}};ConvertTo-Json -InputObject $taskMatches -Compress`;
 const env={...process.env,CHROMA_CULL_TRASH_FOLDER:folder,CHROMA_CULL_TRASH_NAMES:JSON.stringify([path.basename(rejected.path),path.basename(sidecar)])};
 const bin=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',shellScript],{env,encoding:'utf8'}).trim());
 assert.equal(bin.length,2,'original and its sidecar are recoverable system Recycle Bin entries');
 assert.equal(hash(await readFile(bin.find(f=>f.name===path.basename(rejected.path)).path)),rejected.hash);
 assert.equal(hash(await readFile(bin.find(f=>f.name===path.basename(sidecar)).path)),sidecarHash);
 // Undo must restore the exact OS-issued photo and sidecar receipts and return the cull state.
 await page.keyboard.press('Control+z');
 await page.waitForFunction(()=>document.getElementById('lib-cull-del')?.textContent==='Delete rejected (1)');
 let restoredBytes=false;const restoreDeadline=Date.now()+15000;
 while(Date.now()<restoreDeadline){
  try{restoredBytes=hash(await readFile(rejected.path))===rejected.hash&&hash(await readFile(sidecar))===sidecarHash;if(restoredBytes)break;}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.equal(restoredBytes,true,'in-app Undo restores exact original photo and XMP bytes');
 await writeFile(path.join(folder,'result.json'),JSON.stringify({rejected:rejected.path,prompt,rejectUndo:true,cancelPreserved:true,unmodifiedSurvivors:3,recycleEntries:bin,photoHash:rejected.hash,sidecarHash,autoAdvanceValidated:process.env.CULL_ADVANCE==='1'},null,2));
 console.log('PASS native reject/undo, count/name confirmation, cancelled delete, exact photo+sidecar bytes in Windows Recycle Bin and byte-exact in-app Undo, untouched survivors');
}finally{
 await page.evaluate(()=>{if(window.__nativeCullCore)__TAURI__.core=window.__nativeCullCore;if(typeof window.__nativeCullRelease==='function')window.__nativeCullRelease();}).catch(()=>{});
 if(bindings)await page.evaluate(text=>chromasmithShortcutRegistry.import(text),bindings).catch(()=>{});
 await page.evaluate(value=>{if(value===null)localStorage.removeItem('chromasmith_lib_cull_auto_advance');else if(value!==undefined)localStorage.setItem('chromasmith_lib_cull_auto_advance',value);},preference).catch(()=>{});
 await browser.close();
}

