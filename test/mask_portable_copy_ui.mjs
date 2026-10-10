#!/usr/bin/env node
// Browser orchestration check for the production copy/undo flow with mock inference and sidecar IO.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.png':'image/png'};
const server=createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);const file=path.resolve(root,'.'+(pathname==='/'?'/chromasmith-22.html':pathname));if(!file.startsWith(root)){res.writeHead(403).end();return;}res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:['--use-gl=swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:980,height:720}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/?deskx=1`,{waitUntil:'load'});
 await page.waitForFunction(()=>typeof mskCopyAndReevaluate==='function'&&typeof mskUndoPortableCopy==='function');
 const result=await page.evaluate(async()=>{
  document.getElementById('cs-modal-ov')?.remove();window.__TAURI__={};
  const legacyProvenance=_mskMigrate({origin:'ai'}).aiProvenance;
  const ai={id:'prompt-a',origin:'ai',ai:true,aiPoints:[{nx:.4,ny:.3,positive:true}],aiProvenance:{schemaVersion:1,backend:'sam_points',modelId:'edge-sam',recordedAt:'source'},px:new Uint8Array([11,12]),mtW:2,mtH:1,refineFeather:20,refineEdge:-5};
  const sky={id:'sky-a',origin:'sky',aiPoints:[],px:new Uint8Array([13,14]),mtW:2,mtH:1,refineFeather:44,refineEdge:15};
  const paint={id:'paint-a',origin:'paint',px:new Uint8Array([31,32]),mtW:2,mtH:1};
  const items=[{name:'source',masks:[ai,sky,paint]},{name:'target A',masks:[{id:'old-A',origin:'paint',px:new Uint8Array([1])}],geom:{crop:[.1,.2]},sliders:{exposure:'8'}},{name:'target B',masks:[{id:'old-B',origin:'paint',px:new Uint8Array([2])}],geom:{crop:[.3,.4]},sliders:{exposure:'-4'}}];
  items.forEach(item=>{item.masks=item.masks.map(m=>_mskFromSnap(_mskToSnap(m)));});
  const initial=items.map(i=>i.masks.map(m=>_mskToSnap(m)));
  const sidecars=items.map((it,i)=>({recipe:{geom:it.geom,sliders:it.sliders,masks:initial[i]}}));
  fxImages=items;fxCurIdx=0;fxState.masks=items[0].masks;mskSel=0;
  mskRebuild();const semanticButton=document.querySelector('#local-ctl button[onclick="mskCopyAndReevaluate()"]');
  const buttonText=semanticButton?.textContent||'',buttonTitle=semanticButton?.title||'';
  let saves=0,batchAutosaves=0,injectPersistEdit='';const messages=[];log=(...args)=>messages.push(args);
  const canonical=v=>Array.isArray(v)?v.map(canonical):(!v||typeof v!=='object'?v:Object.keys(v).sort().reduce((o,k)=>(o[k]=canonical(v[k]),o),{}));
  curItem=()=>fxImages[fxCurIdx];
  fxSelectImage=idx=>{if(_mskSemanticCopyJob&&!_mskSemanticCopyJob.internalSwitch)_mskSemanticCopyJob.cancelled=true;fxImages[fxCurIdx].masks=fxState.masks;fxCurIdx=idx;fxState.masks=fxImages[idx].masks||(fxImages[idx].masks=[]);};
  window.mskRebuild=()=>{};window.renderPreview=()=>{};window.fxUpdate=()=>{batchAutosaves++;window.chromasmithOnEdit?.();};
  window.chromasmithOnEdit=()=>{fxImages.forEach((it,i)=>{sidecars[i].recipe={...sidecars[i].recipe,masks:(it.masks||[]).map(m=>_mskToSnap(m))};});};
  window.chromasmithFlushPendingSave=async()=>({ok:true});
  mskGenerateSky=m=>{m.px=new Uint8Array([70,80]);m.mtW=2;m.mtH=1;m.refineFeather=0;m.refineEdge=0;};
  _skySeedPoints=()=>[{nx:.5,ny:.1,positive:true}];
  window.chromasmithSaveMaskSetForCurrentPhoto=async(masks,expected,item)=>{
   const i=fxImages.indexOf(item);if(i<0)throw Error('item not loaded');
   if(JSON.stringify(canonical(sidecars[i].recipe.masks))!==JSON.stringify(canonical(expected.map(m=>_mskToSnap(m)))))throw Error('baseline mismatch');
   const expectedIds=JSON.stringify(expected.map(m=>m.id)),liveIds=JSON.stringify(item.masks.map(m=>m.id)),writeIds=JSON.stringify(masks.map(m=>m.id));
   if(liveIds!==expectedIds&&!(injectPersistEdit==='copy-recovery'&&writeIds===liveIds))throw Error('target changed before sidecar commit');
   sidecars[i].recipe={...sidecars[i].recipe,masks:masks.map(m=>_mskToSnap(m))};saves++;
   if(injectPersistEdit==='copy-first'&&i===1&&writeIds!==expectedIds){item.masks=[{id:'late-edit-A'}];if(curItem()===item)fxState.masks=item.masks;injectPersistEdit='copy-recovery';}
   else if(injectPersistEdit==='copy-recovery')injectPersistEdit='';
   return{ok:true,durable:true};
  };
  window.samRunPoints=async(m,opts)=>{if(curItem()!==opts.expectedItem)return{ok:false,error:'wrong photo'};m.px=new Uint8Array([200+fxCurIdx,210+fxCurIdx]);m.mtW=2;m.mtH=1;m.aiProvenance={schemaVersion:1,backend:'sam2_points',modelId:'sam2-hiera-tiny',modelVersion:null,artifactDigest:null,sourceLocation:null,recordedAt:'target'};return{ok:true};};
  const sourceRaster=[...ai.px];await mskCopyAndReevaluate();
  const afterCopy={ids:items.slice(1).map(i=>i.masks.map(m=>m.id)),pixels:items.slice(1).map(i=>[...i.masks[0].px]),provenance:items.slice(1).map(i=>i.masks[0].aiProvenance),source:[...ai.px],refine:[items[1].masks[0].refineFeather,items[1].masks[0].refineEdge,items[1].masks[1].refineFeather,items[1].masks[1].refineEdge],categories:sidecars.slice(1).map(sc=>[sc.recipe.geom,sc.recipe.sliders]),saves,batchAutosaves,active:fxCurIdx,messages,undo:!!_mskSemanticCopyUndo};
  // User moves to target B before undo; Undo must restore B, not the original copy source.
  fxSelectImage(2);await mskUndoPortableCopy();
  const afterUndo={ids:items.slice(1).map(i=>i.masks.map(m=>m.id)),focus:fxCurIdx,focusItem:curItem().name,undoRemaining:!!_mskSemanticCopyUndo};
  for(let i=1;i<items.length;i++){items[i].masks=initial[i].map(m=>_mskFromSnap(m));sidecars[i].recipe={...sidecars[i].recipe,masks:initial[i]};}
  fxSelectImage(0);injectPersistEdit='copy-first';await mskCopyAndReevaluate();
  const duringSave={targetA:items[1].masks.map(m=>m.id),sidecarA:sidecars[1].recipe.masks.map(m=>m.id),targetB:items[2].masks.map(m=>m.id),message:messages.some(m=>String(m[0]).includes('latest edits were restored'))};
  return{buttonText,buttonTitle,afterCopy,afterUndo,duringSave,legacyProvenance};
 });
 assert.equal(result.buttonText,'Copy + re-evaluate AI/sky');assert.match(result.buttonTitle,/unsupported AI masks leave that photo unchanged/);
 assert.deepEqual(result.afterCopy.ids,[['prompt-a','sky-a','paint-a'],['prompt-a','sky-a','paint-a']]);
 assert.deepEqual(result.afterCopy.pixels,[[201,211],[202,212]]);
 assert.deepEqual(result.afterCopy.provenance,Array.from({length:2},()=>({schemaVersion:1,backend:'sam2_points',modelId:'sam2-hiera-tiny',modelVersion:null,artifactDigest:null,sourceLocation:null,recordedAt:'target'})),'new target provenance survives portable commit and sidecar snapshots');
 assert.equal(result.legacyProvenance,null,'legacy prompted masks stay explicitly unknown');
 assert.deepEqual(result.afterCopy.source,[11,12]);assert.deepEqual(result.afterCopy.refine,[20,-5,44,15]);
 assert.deepEqual(result.afterCopy.categories,[[{crop:[.1,.2]},{exposure:'8'}],[{crop:[.3,.4]},{exposure:'-4'}]]);
 assert.equal(result.afterCopy.saves,2);assert.equal(result.afterCopy.active,0);
 assert.deepEqual(result.afterUndo.ids,[['old-A'],['old-B']]);assert.equal(result.afterUndo.focus,2);assert.equal(result.afterUndo.focusItem,'target B');assert.equal(result.afterUndo.undoRemaining,false);
 if(errors.length)throw Error(errors.join('\n'));
 console.log('PASS browser copy/undo orchestration: target provenance survives commit/sidecar snapshots, categories retained, source untouched, undo focus restored');
}finally{await browser.close();server.close();}
