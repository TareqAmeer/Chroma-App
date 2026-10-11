// CHR-247: rectangle prompts stay normalized, persistent, EdgeSAM-only and photo-safe.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const html=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)),'..','chromasmith-22.html'),'utf8');
const boxStart=html.indexOf('function _samNormalizeBox('),provStart=html.indexOf('const _MSK_AI_PROVENANCE_VERSION='),provEnd=html.indexOf('\n// Stable composition identity.',provStart);
const runStart=html.indexOf('async function samRunPoints('),runEnd=html.indexOf('\n// ── Named subjects:',runStart);
assert(boxStart>=0&&provStart>=0&&provEnd>provStart&&runStart>=0&&runEnd>runStart,'production box, provenance and inference helpers exist');
const normalize=new Function(html.slice(boxStart,html.indexOf('\nasync function samRunPoints(',boxStart))+'\nreturn _samNormalizeBox;')();
assert.deepEqual(normalize({x0:.8,y0:.9,x1:.2,y1:.1}),{x0:.2,y0:.1,x1:.8,y1:.9});
assert.equal(normalize({x0:-1,y0:.2,x1:2,y1:.7}).x0,0);
assert.equal(normalize({x0:.1,y0:.1,x1:.102,y1:.9}),null);
assert.equal(normalize({x0:NaN,y0:0,x1:1,y1:1}),null);
const source=html.slice(provStart,provEnd)+'\n'+html.slice(boxStart,html.indexOf('\nasync function samRunPoints(',boxStart))+'\n'+html.slice(runStart,runEnd)+'\nreturn{samRunPoints,_mskNormalizeAIProvenance};';
function response(){const body=new Uint8Array([40,80,120,160]),header=new TextEncoder().encode(JSON.stringify({width:2,height:2})),buf=new Uint8Array(4+header.length+body.length);new DataView(buf.buffer).setUint32(0,header.length,true);buf.set(header,4);buf.set(body,4+header.length);return buf.buffer;}
async function invokeCase({stale=false}={}){
 let active={path:'photo-a.jpg'},sourceItem=active,calls=[];
 const m={origin:'ai',aiPoints:[],aiBox:{x0:.1,y0:.2,x1:.8,y1:.9}};
 const win={__TAURI__:{core:{invoke:async(name,payload)=>{calls.push({name,payload});if(stale)active={path:'photo-b.jpg'};return response();}}}};
 const f=new Function('window','curItem','fxPhotoActivity','samEnsureEncoded','_samEncoding','_samToken','_sam2Token','samSubsamplePoints','_samRefineMask','_mskTexDirty','_samLastError','mskRebuild','fxUpdate','renderPreview','fxHistoryPush','hapt','toast','log',source)(win,()=>active,()=>()=>{},async()=>{},false,'edge-token','sam2-token',p=>p,x=>x,false,null,()=>{},()=>{},()=>{},()=>{},()=>{},()=>{});
 const result=await f.samRunPoints(m,{silent:true,expectedItem:sourceItem});return{result,m,calls};
}
const good=await invokeCase();assert.equal(good.result.ok,true);assert.equal(good.calls.length,1);assert.equal(good.calls[0].name,'sam_box');
assert.deepEqual(good.calls[0].payload,{token:'edge-token',rect:{x1:.1,y1:.2,x2:.8,y2:.9}});
assert.equal(good.m.aiProvenance.backend,'sam_box');assert.equal(good.m.aiProvenance.modelId,'edge-sam');
const stale=await invokeCase({stale:true});assert.equal(stale.result.ok,false);assert.equal(stale.m.px,undefined);assert.equal(stale.m.aiProvenance,undefined);
assert(html.includes("mskAiPromptMode==='box'"),'rectangle select mode is wired into AI prompt controls');
assert(html.includes("role=\"status\" aria-live=\"polite\""),'prompt instructions are announced accessibly');
assert(html.includes('function _aiRenderLiveBox(a,b)'),'drag feedback draws a live rectangle');
assert(html.includes('if(m.aiBox)o.aiBox=Object.assign({},m.aiBox)'),'box prompt is cloned into snapshots');
assert(html.includes('if(o.aiBox)m.aiBox=Object.assign({},o.aiBox)'),'box prompt is restored from snapshots');
console.log('PASS CHR-247 rectangle prompt: normalized endpoints, validation, snapshot persistence, live/accessibility UI, EdgeSAM-only IPC and stale-photo guard');
