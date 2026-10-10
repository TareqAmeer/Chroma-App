#!/usr/bin/env node
// Browser regression for saving/applying the existing Style mask category as an appendable preset.
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mime={'.html':'text/html','.js':'text/javascript','.png':'image/png'};
const server=createServer(async(req,res)=>{
  try{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname));
    if(!file.startsWith(root)){res.writeHead(403).end();return;}
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));
  }catch{res.writeHead(404).end('not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),
  args:['--use-gl=swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
let done=false;
try{
  const page=await browser.newPage({viewport:{width:1024,height:768}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('chromasmith-styles-v1',JSON.stringify([{
    version:2,name:'Mask test',keys:['toggle:local','extra:masks','slider:adj-exp'],
    recipe:{sliders:{'adj-exp':'80'},toggles:{local:true},masks:[
      {id:'preset-shape',type:'radial',cx:.5,cy:.5,rx:.3,ry:.3,feather:.5,crSamples:[],compositionMigrated:true,aiProvenance:{schemaVersion:1,promptSchemaVersion:1,backend:'sam2_points',modelId:'sam2-hiera-tiny',modelVersion:null,artifactDigest:null,sourceLocation:null,skySeedAlgorithmVersion:null,recordedAt:'preset-fixture'}},
      {id:'preset-cut',type:'linear',cx:.5,cy:.5,rx:.3,ry:.3,feather:.5,crSamples:[],compositionMigrated:true,composeOp:'subtract',subtract:true,operandId:'preset-shape'}
    ]}
  }])));
  console.log('preset browser: opening editor');
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`,{waitUntil:'domcontentloaded',timeout:12000});
  await page.waitForFunction(()=>typeof styleApply==='function'&&typeof _stylePrepareMaskPreset==='function',{timeout:12000});
  console.log('preset browser: editor ready');
  const fixture=(await readFile(path.join(root,'test','fixtures','chart.png'))).toString('base64');
  const setup=await Promise.race([page.evaluate(async b64=>{
    document.querySelector('[data-tour-action="close"]')?.click();document.getElementById('cs-modal-ov')?.remove();
    const bin=atob(b64),bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));
    await loadFXImages([new File([bytes],'mask-preset.png',{type:'image/png'})]);
    const make=(id,type='radial')=>({id,name:id,type,cx:.5,cy:.5,rx:.25,ry:.25,feather:.5,crSamples:[],compositionMigrated:true});
    fxState.masks=[make('target-mask')];mskSel=0;_mskEnsureIds(fxState.masks);mskRebuild();
    const local=document.getElementById('tg-local');local?.classList.remove('on');
    fxHistory=[];fxHistIdx=-1;fxHistoryPush();
    return{exp:document.getElementById('sl-adj-exp')?.value,history:fxHistory.length,index:fxHistIdx,targetId:fxState.masks[0].id};
  },fixture),new Promise((_,reject)=>setTimeout(()=>reject(new Error('editor image setup exceeded 15 seconds')),15000))]);
  console.log('preset browser: photo setup complete');
  assert.equal(setup.history,1,'test begins from a single undo baseline');
  await page.evaluate(()=>{void styleApply('Mask test');});
  await page.waitForSelector('#paste-confirm');
  const selection=await page.evaluate(()=>{
    document.querySelectorAll('.paste-field-cb').forEach(cb=>{cb.checked=['toggle:local','extra:masks'].includes(cb.value);});
    document.getElementById('paste-confirm').click();return true;
  });
  assert.equal(selection,true);
  await page.waitForSelector('#style-mask-apply');
  const appendDefault=await page.locator('[name="style-mask-mode"][value="append"]').isChecked();
  assert.equal(appendDefault,true,'Append is the safe default');
  await page.locator('#style-mask-apply').click();
  await page.waitForTimeout(500);
  const resultState=await page.evaluate(()=>({count:fxState.masks.length,dialog:document.getElementById('cs-modal-ov')?.innerText||'',body:document.body.innerText.slice(-700),logs:document.getElementById('log-area')?.innerText||''}));
  assert.equal(resultState.count,3,`Append should add two preset masks: ${JSON.stringify(resultState)}`);
  assert.equal(resultState.dialog,'','preset modal closes after commit');
  const applied=await page.evaluate(()=>({ids:fxState.masks.map(m=>m.id),provenance:fxState.masks[1].aiProvenance,op:fxState.masks[2].composeOp,operand:fxState.masks[2].operandId,
    local:document.getElementById('tg-local')?.classList.contains('on'),exp:document.getElementById('sl-adj-exp')?.value,
    history:fxHistory.length,index:fxHistIdx}));
  assert.equal(applied.ids[0],setup.targetId,'append preserves the target mask');
 assert.equal(applied.provenance?.backend,'sam2_points','preset mask provenance survives browser apply');
 assert.equal(applied.provenance?.recordedAt,'preset-fixture','preset descriptor survives its recipe snapshot');
  assert.equal(new Set(applied.ids).size,3,'preset IDs are remapped without target collisions');
  assert.equal(applied.op,'subtract');assert.equal(applied.operand,applied.ids[1],'internal composition refs follow the remapped IDs');
  assert.equal(applied.local,false,'append preserves a muted local-adjustment layer when target masks already exist');
  assert.equal(applied.exp,setup.exp,'unchecked global grade fields remain unchanged');
  assert.equal(applied.index,setup.index+1,'the preset application creates one undo step');
  await page.evaluate(()=>fxUndo());
  await page.waitForFunction(id=>fxState.masks.length===1&&fxState.masks[0].id===id,setup.targetId);
  const undone=await page.evaluate(()=>({local:document.getElementById('tg-local')?.classList.contains('on'),exp:document.getElementById('sl-adj-exp')?.value}));
  assert.deepEqual(undone,{local:false,exp:setup.exp},'one Undo restores the complete pre-apply snapshot');
  await page.evaluate(()=>document.querySelector('#local-ctl .msk-more')?.click());
  const saveAction=page.locator('.msk-more-menu .msk-more-it').filter({hasText:'Save as Mask Preset'});
  assert.equal(await saveAction.count(),1,'selected mask More menu exposes the mask preset shortcut');
  await saveAction.click();await page.waitForSelector('#paste-confirm');
  const preselected=await page.evaluate(()=>[...document.querySelectorAll('.paste-field-cb:checked')].map(b=>b.value).sort());
  assert.deepEqual(preselected,['extra:masks','toggle:local'],'shortcut preselects only masks and the local-adjustment enable state');
  await page.locator('#paste-cancel').click();
  const emptyBase=await page.evaluate(()=>{fxState.masks=[];mskSel=0;mskRebuild();fxHistoryPush();return{index:fxHistIdx,length:fxHistory.length};});
  await page.evaluate(()=>{void styleApply('Mask test');});
  await page.waitForSelector('#paste-confirm');
  await page.locator('#paste-confirm').click();
  await page.waitForSelector('#style-mask-apply');
  await page.locator('#style-mask-apply').click();
  await page.waitForFunction(()=>fxState.masks.length===2&&!document.getElementById('cs-modal-ov'));
  await page.waitForFunction(index=>fxHistIdx===index,emptyBase.index+1,{timeout:3000});
  const emptyApplied=await page.evaluate(()=>({local:document.getElementById('tg-local')?.classList.contains('on'),index:fxHistIdx}));
  assert.equal(emptyApplied.local,true,'an enabled preset turns on local adjustments when no target masks exist');
  assert.equal(emptyApplied.index,emptyBase.index+1,'adding to an empty mask set creates one history entry');
  assert.deepEqual(errors,[],`browser console errors: ${errors.join('; ')}`);
  done=true;console.log('mask Style preset browser flow: Append, ID remap, internal refs, field isolation and one-step Undo PASS');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));if(!done)process.exitCode=1;}
