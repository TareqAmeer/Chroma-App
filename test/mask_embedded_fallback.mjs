#!/usr/bin/env node
// Deterministic face-parser fallback contract; real model inference remains covered by desktop QA.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInContext, createContext } from 'node:vm';

const html=await readFile(new URL('../chromasmith-22.html',import.meta.url),'utf8');
function sliceBetween(start,end){
  const a=html.indexOf(start),b=html.indexOf(end,a);
  assert.ok(a>=0&&b>a,`missing source region: ${start}`);
  return html.slice(a,b);
}
const runtime=createContext({
  window:{__TAURI__:{core:{invoke(){}}}},
  _faceparseRunning:false,
  toast(){},log(){},
});
runInContext(sliceBetween('function _facePlace(', 'async function _mskApplyFaceFallback(')
  +sliceBetween('async function _mskApplyFaceFallback(', 'async function mskFaceAutoExclude('),runtime);

const photo={path:'portrait-a.heic'},mask={px:new Uint8Array([1]),mtW:1,mtH:1};
runtime.photo=photo;runtime.curItem=()=>runtime.photo;
runtime._faceparseRunLayers=async()=>({mtW:2,mtH:1,cropX0:0,cropY0:0,cropSize:2,
  layers:[0,1,2,3,4].map(group=>new Uint8Array([group===3?180:0,group===4?220:0]))});
runtime.mask=mask;runtime.item=photo;
assert.equal(await runInContext('_mskApplyFaceFallback(mask,item,3,true)',runtime),true);
assert.deepEqual(Array.from(mask.px),[180,0],'hair fallback keeps only the selected face-parser layer');
assert.equal(mask.mtW,2);assert.equal(mask.mtH,1);

const unchanged={px:new Uint8Array([9]),mtW:1,mtH:1};runtime.mask=unchanged;
runtime._faceparseRunLayers=()=>new Promise(resolve=>{runtime.releaseParse=()=>resolve({mtW:1,mtH:1,cropX0:0,cropY0:0,cropSize:1,layers:Array.from({length:5},()=>new Uint8Array([255]))});});
const stale=runInContext('_mskApplyFaceFallback(mask,item,3,true)',runtime);
await new Promise(resolve=>setTimeout(resolve,0));runtime.photo={path:'portrait-b.heic'};runtime.releaseParse();
assert.equal(await stale,false,'photo switch rejects stale model output');
assert.deepEqual(Array.from(unchanged.px),[9],'stale inference does not replace the current selection');

let calls=0;runtime._faceparseRunLayers=async()=>{calls++;throw new Error('must not run');};
assert.equal(await runInContext('_mskApplyFaceFallback(mask,item,0,true)',runtime),false,'unsupported groups fail closed');
assert.equal(calls,0);

assert.match(html,/if\(!matte\)return await mskEmbeddedMatteFallback\(kind,label,it\)/);
assert.match(html,/mask\.faceFallbackGroup=group/);
assert.match(html,/No embedded '\+label\+' matte/);
console.log('Embedded matte fallback: 9 checks passed (feature layer, stale photo, unsupported class, explicit choice wiring).');
