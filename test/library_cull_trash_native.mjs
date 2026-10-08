// CHR-267: actual native cull UI -> confirmed system Trash, plus reversible reject metadata.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=process.cwd(),stamp=String(Date.now()),folder=path.join(root,'test/output/cull-native',stamp);
await mkdir(folder,{recursive:true});
const browser=await chromium.connectOverCDP(process.env.NATIVE_CDP||'http://127.0.0.1:9223');
const page=browser.contexts()[0].pages().find(p=>!p.url().includes('devtools'));
page.setDefaultTimeout(20000);
let preference;
const hash=bytes=>createHash('sha256').update(Array.isArray(bytes)?new Uint8Array(bytes):bytes).digest('hex');
const files=[];
try{
 await page.waitForFunction(()=>typeof chromasmithOpenFolder==='function');
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
 await writeFile(path.join(folder,'result.json'),JSON.stringify({rejected:rejected.path,prompt,rejectUndo:true,cancelPreserved:true,unmodifiedSurvivors:3,recycleEntries:bin,photoHash:rejected.hash,sidecarHash},null,2));
 console.log('PASS native reject/undo, count/name confirmation, cancelled delete, exact photo+sidecar bytes in Windows Recycle Bin and untouched survivors');
}finally{
 await page.evaluate(value=>{if(value===null)localStorage.removeItem('chromasmith_lib_cull_auto_advance');else if(value!==undefined)localStorage.setItem('chromasmith_lib_cull_auto_advance',value);},preference).catch(()=>{});
 await browser.close();
}

