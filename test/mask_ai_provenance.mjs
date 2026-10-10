// CHR-247: verifies provenance comes from the successful production inference command.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const html=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)),'..','chromasmith-22.html'),'utf8');
const helperStart=html.indexOf('const _MSK_AI_PROVENANCE_VERSION=');
const helperEnd=html.indexOf('\n// Stable composition identity.',helperStart);
const samStart=html.indexOf('async function samRunPoints(');
const samEnd=html.indexOf('\n// ── Named subjects:',samStart);
assert(helperStart>=0&&helperEnd>helperStart&&samStart>=0&&samEnd>samStart,'production provenance and inference helpers exist');
const make= new Function('window','curItem','fxPhotoActivity','samEnsureEncoded','_samEncoding','_samToken','_sam2Token','samSubsamplePoints','_samRefineMask','_mskTexDirty','_samLastError','mskRebuild','fxUpdate','renderPreview','fxHistoryPush','hapt','toast','log',
 `${html.slice(helperStart,helperEnd)}\n${html.slice(samStart,samEnd)}\nreturn{samRunPoints,_mskRecordAIProvenance,_mskNormalizeAIProvenance};`);
function response(){const body=new Uint8Array([20,40,60,80]),header=new TextEncoder().encode(JSON.stringify({width:2,height:2})),buf=new Uint8Array(4+header.length+body.length);new DataView(buf.buffer).setUint32(0,header.length,true);buf.set(header,4);buf.set(body,4+header.length);return buf.buffer;}
async function fixture({sam2=false,fail=false}={}){
 let item={path:'C:/photos/source.jpg'},active=item,command='';
 const m={origin:'ai',aiPoints:[{nx:.2,ny:.3,positive:true}],aiProvenance:{schemaVersion:1,backend:'sam_points',modelId:'edge-sam',recordedAt:'old'}};
 const win={__TAURI__:{core:{invoke:async(name)=>{command=name;if(fail)throw Error('fixture failure');return response();}}}};
 const fn=make(win,()=>active,()=>()=>{},async()=>{},false,{},sam2?{}:null,points=>points,mask=>mask,false,null,()=>{},()=>{},()=>{},()=>{},()=>{},()=>{});
 const result=await fn.samRunPoints(m,{silent:true});
 return{m,result,command,item};
}
for(const sam2 of [false,true]){
 const f=await fixture({sam2});assert.equal(f.result.ok,true);assert.equal(f.command,sam2?'sam2_points':'sam_points');
 assert.equal(f.m.aiProvenance.backend,f.command);assert.equal(f.m.aiProvenance.modelId,sam2?'sam2-hiera-tiny':'edge-sam');
 assert.equal(f.m.aiProvenance.promptSchemaVersion,1);assert.equal(f.m.aiProvenance.modelVersion,null);assert.equal(f.m.aiProvenance.artifactDigest,null);
 assert.deepEqual(f.m.aiProvenance.sourceLocation,{kind:'path',value:f.item.path});assert.match(f.m.aiProvenance.recordedAt,/^\d{4}-/);
}
const failed=await fixture({fail:true});assert.equal(failed.result.ok,false);assert.equal(failed.m.aiProvenance.recordedAt,'old');
const staleMask={origin:'ai',aiPoints:[{nx:.2,ny:.3,positive:true}],aiProvenance:{schemaVersion:1,backend:'sam_points',modelId:'edge-sam',recordedAt:'old'}};
// A photo switch during the native call must leave raster and provenance untouched.
let current={path:'source'},calls=0;const w={__TAURI__:{core:{invoke:async()=>{calls++;current={path:'other'};return response();}}}};
const run=make(w,()=>current,()=>()=>{},async()=>{},false,{},null,p=>p,x=>x,false,null,()=>{},()=>{},()=>{},()=>{},()=>{},()=>{});
const before=staleMask.aiProvenance;const staleResult=await run.samRunPoints(staleMask,{silent:true});assert.equal(staleResult.ok,false);assert.deepEqual(staleMask.aiProvenance,before);assert.equal(calls,1);
const normalizeStart=html.indexOf('const _MSK_AI_PROVENANCE_VERSION='),normalizeEnd=html.indexOf('\n// Stable composition identity.',normalizeStart);
const normalize=new Function(html.slice(normalizeStart,normalizeEnd)+'\nreturn _mskNormalizeAIProvenance;')();
assert.equal(normalize({schemaVersion:1,backend:'fake-model',modelId:'invented'}).backend,null);
assert.equal(normalize({schemaVersion:99,backend:'sam_points'}),null);
assert.equal(normalize(null),null);
const snapshots=new Function(html.slice(normalizeStart,normalizeEnd)+'\n'+html.slice(html.indexOf('function _mskToSnap('),html.indexOf('\nfunction _mskFromSnap('))+'\nfunction _mskMigrate(m){return m;}\n'+html.slice(html.indexOf('function _mskFromSnap('),html.indexOf('\nfunction _mskCloneLive('))+'\nreturn{to:_mskToSnap,from:_mskFromSnap};')();
const provenance={schemaVersion:1,promptSchemaVersion:1,backend:'sam2_points',modelId:'sam2-hiera-tiny',modelVersion:null,artifactDigest:null,sourceLocation:{kind:'path',value:'photo.jpg'},skySeedAlgorithmVersion:'sky-grid-v1',recordedAt:'fixed'};
const snap=snapshots.to({origin:'sky',aiProvenance:provenance},true);provenance.sourceLocation.value='mutated';assert.equal(snap.aiProvenance.sourceLocation.value,'photo.jpg');
assert.equal(snap.aiProvenance.skySeedAlgorithmVersion,'sky-grid-v1');
const restored=snapshots.from(snap);snap.aiProvenance.sourceLocation.value='changed-snapshot';assert.equal(restored.aiProvenance.sourceLocation.value,'photo.jpg');
const reevaluateStart=html.indexOf('async function _mskPortableReevaluate('),reevaluateEnd=html.indexOf('\nasync function mskCopyAndReevaluate(',reevaluateStart);
const reevaluate=new Function('mskGenerateSky','_skySeedPoints','samRunPoints','_mskRecordAIProvenance','curItem',html.slice(reevaluateStart,reevaluateEnd)+'\nreturn _mskPortableReevaluate;')(
 (m)=>{m.px=new Uint8Array([1]);m.mtW=m.mtH=1;},()=>[],async()=>({ok:true}),make({},()=>null,()=>{},async()=>{},false,null,null,p=>p,x=>x,false,null,()=>{},()=>{},()=>{},()=>{},()=>{},()=>{})._mskRecordAIProvenance,()=>target.item);
const target={item:{path:'target.jpg'}},skyCandidate={origin:'sky',aiPoints:[],aiProvenance:{backend:'sam2_points'}};
assert.equal((await reevaluate(skyCandidate,target)).ok,true);assert.equal(skyCandidate.aiProvenance.backend,null);assert.equal(skyCandidate.aiProvenance.skySeedAlgorithmVersion,'sky-grid-v1');
const failedCandidate={origin:'ai',aiPoints:[{nx:.1,ny:.1,positive:true}],aiProvenance:{recordedAt:'before'}};
const failedReevaluate=new Function('mskGenerateSky','_skySeedPoints','samRunPoints','_mskRecordAIProvenance','curItem',html.slice(reevaluateStart,reevaluateEnd)+'\nreturn _mskPortableReevaluate;')(()=>{},()=>[],async()=>({ok:false,error:'model failed'}),()=>{},()=>target.item);
assert.equal((await failedReevaluate(failedCandidate,target)).ok,false);assert.equal(failedCandidate.aiProvenance.recordedAt,'before');
const staleReevaluate=new Function('mskGenerateSky','_skySeedPoints','samRunPoints','_mskRecordAIProvenance','curItem',html.slice(reevaluateStart,reevaluateEnd)+'\nreturn _mskPortableReevaluate;')(()=>{},()=>[],async()=>({ok:false,error:'Photo changed during mask recomputation'}),()=>{},()=>({path:'different.jpg'}));
assert.equal((await staleReevaluate({...failedCandidate},target)).ok,false);
const skyStart=html.indexOf('function mskGenerateSky('),skyEnd=html.indexOf('\nfunction mskSkyRedetect(',skyStart);
const runSky=new Function('mskRefinementSourceReset','curItem','fxWork','fxImg','_mskRecordAIProvenance','_mskTexDirty',html.slice(skyStart,skyEnd)+'\nreturn mskGenerateSky;')(()=>{},()=>null,null,null,()=>{},false);
const invalidSky={origin:'sky',aiProvenance:{backend:'sam2_points'},px:new Uint8Array([1])};runSky(invalidSky);assert.equal(invalidSky.aiProvenance,null);assert.equal(invalidSky.px.length,0);
const recordHelpers=new Function(html.slice(normalizeStart,normalizeEnd)+'\nreturn _mskRecordAIProvenance;')();
const successfulSkyRun=new Function('mskRefinementSourceReset','curItem','fxWork','fxImg','_mskRecordAIProvenance','_mskTexDirty','mskTexDims','mskSourceData','_smoothstepJS',html.slice(skyStart,skyEnd)+'\nreturn mskGenerateSky;')(()=>{},()=>({path:'sky-target.jpg',img:{}}),null,null,recordHelpers,false,()=>({w:1,h:1}),()=>new Uint8Array([40,90,150,255]),()=>0.5);
const regeneratedSky={origin:'sky',aiProvenance:{backend:'sam2_points'}};successfulSkyRun(regeneratedSky);
assert.equal(regeneratedSky.aiProvenance.backend,null);assert.equal(regeneratedSky.aiProvenance.skySeedAlgorithmVersion,'sky-grid-v1');
assert.deepEqual(regeneratedSky.aiProvenance.sourceLocation,{kind:'path',value:'sky-target.jpg'});
let skyGenerationCount=0;
const staleSkyReevaluate=new Function('mskGenerateSky','_skySeedPoints','samRunPoints','_mskRecordAIProvenance','curItem',html.slice(reevaluateStart,reevaluateEnd)+'\nreturn _mskPortableReevaluate;')(()=>{skyGenerationCount++;},()=>[],async()=>({ok:true}),recordHelpers,()=>({path:'wrong-photo.jpg'}));
assert.equal((await staleSkyReevaluate({origin:'sky',aiPoints:[]},target)).ok,false);assert.equal(skyGenerationCount,0);
console.log('PASS AI provenance: successful EdgeSAM/SAM2 command identity, unknown model revision/digest, source path, malformed/legacy normalization, failed and stale calls preserve prior provenance');
