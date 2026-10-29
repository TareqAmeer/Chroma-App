// CHR-247: verifies provenance comes from the successful production inference command.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const html=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)),'..','chromasmith-22.html'),'utf8');
const helperStart=html.indexOf('const _MSK_AI_PROVENANCE_VERSION=');
const helperEnd=html.indexOf('\n// Stable composition identity.',helperStart);
const complementStart=html.indexOf('function _samComplementSubjectMask(');
const complementEnd=html.indexOf('\nfunction _samNormalizeBox(',complementStart);
const samStart=html.indexOf('async function samRunPoints(');
const samEnd=html.indexOf('\n// ── Named subjects:',samStart);
assert(helperStart>=0&&helperEnd>helperStart&&complementStart>=0&&complementEnd>complementStart&&samStart>=0&&samEnd>samStart,'production provenance, background complement, and inference helpers exist');
const make= new Function('window','curItem','fxPhotoActivity','samEnsureEncoded','_samEncoding','_samToken','_sam2Token','samSubsamplePoints','_samRefineMask','_mskTexDirty','_samLastError','mskRebuild','fxUpdate','renderPreview','fxHistoryPush','hapt','toast','log',
 `${html.slice(helperStart,helperEnd)}\n${html.slice(complementStart,complementEnd)}\n${html.slice(samStart,samEnd)}\nreturn{samRunPoints,_samComplementSubjectMask,_mskRecordAIProvenance,_mskNormalizeAIProvenance};`);
// Globals samRunPoints reaches that are not under test: busy pill, mask texture size, raster finishing (identity here).
Object.assign(globalThis,{mskAiBusy:()=>({cancelled:false,done(){}}),mskTexDims:()=>({w:2,h:2}),samInputDims:()=>({w:1024,h:1024}),
 _mskFinishAiRaster:(px,w,h)=>({px,w,h}),mskMatteModelFor:async()=>null,_mskMatteFor:async()=>null,_mskEdgeMatte:async()=>null,_samNormalizeBox:()=>null,
 fxState:{masks:[]},mskSel:-1,
 // one-shot AI masks (Auto Subject, Foreground, Landscape) re-run through their own path; this test covers point prompts + sky
 _mskIsOneShotAI:()=>false,_mskOneShotRaster:async()=>null});
function response(maskBytes=[20,40,60,80]){const body=new Uint8Array(maskBytes),header=new TextEncoder().encode(JSON.stringify({width:2,height:2})),buf=new Uint8Array(4+header.length+body.length);new DataView(buf.buffer).setUint32(0,header.length,true);buf.set(header,4);buf.set(body,4+header.length);return buf.buffer;}
async function fixture({sam2=false,fail=false,background=false,maskBytes}={}){
 let item={path:'C:/photos/source.jpg'},active=item,command='';
 const m={origin:'ai',aiSelectionMode:background?'background':undefined,aiPoints:[{nx:.2,ny:.3,positive:true}],px:new Uint8ClampedArray([9,8,7,6]),aiProvenance:{schemaVersion:1,backend:'sam_points',modelId:'edge-sam',recordedAt:'old'}};
 const priorPixels=Uint8ClampedArray.from(m.px);
 const win={__TAURI__:{core:{invoke:async(name)=>{command=name;if(fail)throw Error('fixture failure');return response(maskBytes);}}}};
 const fn=make(win,()=>active,()=>()=>{},async()=>{},false,{},sam2?{}:null,points=>points,mask=>mask,false,null,()=>{},()=>{},()=>{},()=>{},()=>{},()=>{});
 const result=await fn.samRunPoints(m,{silent:true});
 return{m,result,command,item,priorPixels,fn};
}
for(const sam2 of [false,true]){
 const f=await fixture({sam2});assert.equal(f.result.ok,true);assert.equal(f.command,sam2?'sam2_points':'sam_points');
 assert.equal(f.m.aiProvenance.backend,f.command);assert.equal(f.m.aiProvenance.modelId,sam2?'sam2-hiera-tiny':'edge-sam');
 assert.equal(f.m.aiProvenance.promptSchemaVersion,1);assert.equal(f.m.aiProvenance.modelVersion,null);assert.equal(f.m.aiProvenance.artifactDigest,null);
 assert.deepEqual(f.m.aiProvenance.sourceLocation,{kind:'path',value:f.item.path});assert.match(f.m.aiProvenance.recordedAt,/^\d{4}-/);
}
const failed=await fixture({fail:true});assert.equal(failed.result.ok,false);assert.equal(failed.m.aiProvenance.recordedAt,'old');
const background=await fixture({background:true});assert.equal(background.result.ok,true);assert.deepEqual([...background.m.px],[235,215,195,175]);
assert.equal(background.m.aiSelectionMode,'background');assert.equal(background.m.aiProvenance.backend,'sam_points');
const emptyBackground=await fixture({background:true,maskBytes:[0,0,0,0]});
assert.equal(emptyBackground.result.ok,false);assert.match(emptyBackground.result.error,/empty or covers the entire photo/);
assert.deepEqual([...emptyBackground.m.px],[...emptyBackground.priorPixels]);assert.equal(emptyBackground.m.aiProvenance.recordedAt,'old');
const fullBackground=await fixture({background:true,maskBytes:[255,255,255,255]});
assert.equal(fullBackground.result.ok,false);assert.deepEqual([...fullBackground.m.px],[...fullBackground.priorPixels]);
assert.deepEqual([...fixtureHelper([0,128,255])],[255,127,0]);
function fixtureHelper(mask){return make({},()=>null,()=>()=>{},async()=>{},false,null,null,x=>x,x=>x,false,null,()=>{},()=>{},()=>{},()=>{},()=>{},()=>{})._samComplementSubjectMask(mask);}
const backgroundActionStart=html.indexOf('async function mskAddBackground('),backgroundActionEnd=html.indexOf('\n// Teeth are not',backgroundActionStart);
assert(backgroundActionStart>=0&&backgroundActionEnd>backgroundActionStart,'background menu action exists');
let addedType='',addedMask=null;
// Without a matting model (browser / none installed) Background falls back to the scribbled AI mask.
const addBackground=new Function('mskAdd','log','window','mskMatteModels','mskAddSubjectMatte',`${html.slice(backgroundActionStart,backgroundActionEnd)}\nreturn mskAddBackground;`)((type,configure)=>{addedType=type;addedMask={};configure(addedMask);return addedMask;},()=>{},{},async()=>[],async()=>null);
assert.equal(await addBackground(),addedMask);assert.equal(addedType,'ai');assert.equal(addedMask.aiSelectionMode,'background');assert.equal(addedMask.name,'Background');
const menuStart=html.indexOf('function mskAddMenu('),menuEnd=html.indexOf('\nfunction mskMoreMenu(',menuStart),menuSource=html.slice(menuStart,menuEnd);
assert(menuSource.includes("item('Select Subject'"));assert(menuSource.includes("item('Select Background'"));
const staleMask={origin:'ai',aiPoints:[{nx:.2,ny:.3,positive:true}],aiProvenance:{schemaVersion:1,backend:'sam_points',modelId:'edge-sam',recordedAt:'old'}};
// A photo switch during the native call must leave raster and provenance untouched.
let current={path:'source'},calls=0;const w={__TAURI__:{core:{invoke:async()=>{calls++;current={path:'other'};return response();}}}};
const run=make(w,()=>current,()=>()=>{},async()=>{},false,{},null,p=>p,x=>x,false,null,()=>{},()=>{},()=>{},()=>{},()=>{},()=>{});
const before=staleMask.aiProvenance;const staleResult=await run.samRunPoints(staleMask,{silent:true});assert.equal(staleResult.ok,false);assert.deepEqual(staleMask.aiProvenance,before);assert.equal(calls,1);
const normalizeStart=html.indexOf('const _MSK_AI_PROVENANCE_VERSION='),normalizeEnd=html.indexOf('\n// Stable composition identity.',normalizeStart);
const normalize=new Function(html.slice(normalizeStart,normalizeEnd)+'\nreturn _mskNormalizeAIProvenance;')();
const normalizeBoxStart=html.indexOf('function _samNormalizeBox('),normalizeBoxEnd=html.indexOf('\nasync function samRunPoints(',normalizeBoxStart);
const normalizeBox=new Function(html.slice(normalizeBoxStart,normalizeBoxEnd)+'\nreturn _samNormalizeBox;')();
assert.equal(normalize({schemaVersion:1,backend:'fake-model',modelId:'invented'}).backend,null);
assert.equal(normalize({schemaVersion:99,backend:'sam_points'}),null);
assert.equal(normalize(null),null);
const snapshots=new Function(html.slice(normalizeStart,normalizeEnd)+'\n'+html.slice(html.indexOf('function _mskToSnap('),html.indexOf('\nfunction _mskFromSnap('))+'\nfunction _mskMigrate(m){return m;}\n'+html.slice(html.indexOf('function _mskFromSnap('),html.indexOf('\nfunction _mskCloneLive('))+'\nreturn{to:_mskToSnap,from:_mskFromSnap};')();
const provenance={schemaVersion:1,promptSchemaVersion:1,backend:'sam2_points',modelId:'sam2-hiera-tiny',modelVersion:null,artifactDigest:null,sourceLocation:{kind:'path',value:'photo.jpg'},skySeedAlgorithmVersion:'sky-grid-v1',recordedAt:'fixed'};
const snap=snapshots.to({origin:'sky',aiProvenance:provenance},true);provenance.sourceLocation.value='mutated';assert.equal(snap.aiProvenance.sourceLocation.value,'photo.jpg');
assert.equal(snap.aiProvenance.skySeedAlgorithmVersion,'sky-grid-v1');
const restored=snapshots.from(snap);snap.aiProvenance.sourceLocation.value='changed-snapshot';assert.equal(restored.aiProvenance.sourceLocation.value,'photo.jpg');
const reevaluateStart=html.indexOf('async function _mskPortableReevaluate('),reevaluateEnd=html.indexOf('\nasync function mskCopyAndReevaluate(',reevaluateStart);
const reevaluate=new Function('mskGenerateSky','_skySeedPoints','samRunPoints','_mskRecordAIProvenance','_mskNormalizeAIProvenance','_samNormalizeBox','curItem','mskSkyUpgrade',html.slice(reevaluateStart,reevaluateEnd)+'\nreturn _mskPortableReevaluate;')(
 (m)=>{m.px=new Uint8Array([1]);m.mtW=m.mtH=1;},()=>[],async()=>({ok:true}),make({},()=>null,()=>{},async()=>{},false,null,null,p=>p,x=>x,false,null,()=>{},()=>{},()=>{},()=>{},()=>{},()=>{})._mskRecordAIProvenance,normalize,normalizeBox,()=>target.item,async()=>false);
const target={item:{path:'target.jpg'}},skyCandidate={origin:'sky',aiPoints:[],aiProvenance:{backend:'sam2_points'}};
assert.equal((await reevaluate(skyCandidate,target)).ok,true);assert.equal(skyCandidate.aiProvenance.backend,null);assert.equal(skyCandidate.aiProvenance.skySeedAlgorithmVersion,'sky-grid-v1');
const failedCandidate={origin:'ai',aiPoints:[{nx:.1,ny:.1,positive:true}],aiProvenance:{recordedAt:'before'}};
const failedReevaluate=new Function('mskGenerateSky','_skySeedPoints','samRunPoints','_mskRecordAIProvenance','_mskNormalizeAIProvenance','_samNormalizeBox','curItem','mskSkyUpgrade',html.slice(reevaluateStart,reevaluateEnd)+'\nreturn _mskPortableReevaluate;')(()=>{},()=>[],async()=>({ok:false,error:'model failed'}),()=>{},normalize,normalizeBox,()=>target.item);
assert.equal((await failedReevaluate(failedCandidate,target)).ok,false);assert.equal(failedCandidate.aiProvenance.recordedAt,'before');
const staleReevaluate=new Function('mskGenerateSky','_skySeedPoints','samRunPoints','_mskRecordAIProvenance','_mskNormalizeAIProvenance','_samNormalizeBox','curItem','mskSkyUpgrade',html.slice(reevaluateStart,reevaluateEnd)+'\nreturn _mskPortableReevaluate;')(()=>{},()=>[],async()=>({ok:false,error:'Photo changed during mask recomputation'}),()=>{},normalize,normalizeBox,()=>({path:'different.jpg'}));
assert.equal((await staleReevaluate({...failedCandidate},target)).ok,false);
const skyStart=html.indexOf('function _skyHeuristic('),  // the sky score helper sits just above mskGenerateSky
      skyEnd=html.indexOf('\nfunction mskSkyRedetect(',skyStart);
const runSky=new Function('mskRefinementSourceReset','curItem','fxWork','fxImg','_mskRecordAIProvenance','_mskTexDirty',html.slice(skyStart,skyEnd)+'\nreturn mskGenerateSky;')(()=>{},()=>null,null,null,()=>{},false);
const invalidSky={origin:'sky',aiProvenance:{backend:'sam2_points'},px:new Uint8Array([1])};runSky(invalidSky);assert.equal(invalidSky.aiProvenance,null);assert.equal(invalidSky.px.length,0);
const recordHelpers=new Function(html.slice(normalizeStart,normalizeEnd)+'\nreturn _mskRecordAIProvenance;')();
const successfulSkyRun=new Function('mskRefinementSourceReset','curItem','fxWork','fxImg','_mskRecordAIProvenance','_mskTexDirty','mskTexDims','mskSourceData','_smoothstepJS',html.slice(skyStart,skyEnd)+'\nreturn mskGenerateSky;')(()=>{},()=>({path:'sky-target.jpg',img:{}}),null,null,recordHelpers,false,()=>({w:1,h:1}),()=>new Uint8Array([40,90,150,255]),()=>0.5);
const regeneratedSky={origin:'sky',aiProvenance:{backend:'sam2_points'}};successfulSkyRun(regeneratedSky);
assert.equal(regeneratedSky.aiProvenance.backend,null);assert.equal(regeneratedSky.aiProvenance.skySeedAlgorithmVersion,'sky-grid-v1');
assert.deepEqual(regeneratedSky.aiProvenance.sourceLocation,{kind:'path',value:'sky-target.jpg'});
let skyGenerationCount=0;
const staleSkyReevaluate=new Function('mskGenerateSky','_skySeedPoints','samRunPoints','_mskRecordAIProvenance','_mskNormalizeAIProvenance','_samNormalizeBox','curItem','mskSkyUpgrade',html.slice(reevaluateStart,reevaluateEnd)+'\nreturn _mskPortableReevaluate;')(()=>{skyGenerationCount++;},()=>[],async()=>({ok:true}),recordHelpers,normalize,normalizeBox,()=>({path:'wrong-photo.jpg'}));
assert.equal((await staleSkyReevaluate({origin:'sky',aiPoints:[]},target)).ok,false);assert.equal(skyGenerationCount,0);

// CHR-247: portable re-evaluation follows the backend recorded by the source, not whichever
// model happens to have a warm token in this renderer. Exercise the production encoder and
// command selector with tiny synthetic pixels and a controllable native IPC boundary.
const ensureStart=html.indexOf('function _samCurOwner('),  // owner + RGB helpers sit just above samEnsureEncoded
      ensureEnd=html.indexOf('\n// Resubmits m.aiPoints',ensureStart);
const backendHarness=new Function('window','curItem','fxPhotoActivity','fxState','mskSel','mskIsAI','samInputDims','mskSourceData','_samFramedInvoke','samRunPoints','_samToken','_samEncoding','_sam2Token','_sam2Encoding','toast','log','_samLastError','mskRebuild','mskSourceReset','samSubsamplePoints','_samRefineMask','_mskTexDirty','fxUpdate','renderPreview','fxHistoryPush','hapt',
 `let _samEncodeP=null;\n${html.slice(helperStart,helperEnd)}\n${html.slice(ensureStart,ensureEnd)}\n${html.slice(complementStart,complementEnd)}\n${html.slice(normalizeBoxStart,normalizeBoxEnd)}\n${html.slice(samStart,samEnd)}\nreturn{samEnsureEncoded,samEnsureEncoded2,samRunPoints};`);
async function backendFixture({preferredBackend=null,warmEdge=false,warmSam2=false,failEncode=null,box=false,provenance}={}){
 const item={path:'C:/photos/target.jpg',img:{target:true}},commands=[];
 let edgeToken=warmEdge?'warm-edge':null,sam2Token=warmSam2?'warm-sam2':null;
 const state={masks:[]};
 const framed=async(cmd)=>{commands.push(cmd);if(cmd===failEncode)throw Error(`${cmd} unavailable`);};
 const native={__TAURI__:{core:{invoke:async(cmd)=>{commands.push(cmd);return response();}}}};
 const runtime=backendHarness(native,()=>item,()=>()=>{},state,0,m=>m.origin==='ai',()=>({w:2,h:2}),()=>new Uint8Array([10,20,30,255,40,50,60,255,70,80,90,255,100,110,120,255]),framed,async()=>({ok:true}),edgeToken,false,sam2Token,false,()=>{},()=>{},null,()=>{},()=>{},points=>points,mask=>mask,false,()=>{},()=>{},()=>{},()=>{});
 const mask={origin:'ai',aiPoints:[{nx:.2,ny:.3,positive:true}],aiBox:box?{x0:.1,y0:.1,x1:.9,y1:.9}:null,px:new Uint8ClampedArray([7,8,9,10]),mtW:2,mtH:2,aiProvenance:provenance===undefined?{schemaVersion:1,backend:preferredBackend||'sam_points',modelId:preferredBackend==='sam2_points'?'sam2-hiera-tiny':'edge-sam',recordedAt:'old'}:provenance};
 state.masks=[mask];
 const result=await runtime.samRunPoints(mask,{detached:true,silent:true,preferredBackend});
 return{commands,result,mask};
}
const edgePreferred=await backendFixture({preferredBackend:'sam_points',warmEdge:true,warmSam2:true});
assert.equal(edgePreferred.result.ok,true,JSON.stringify(edgePreferred));assert.deepEqual(edgePreferred.commands,['sam_points'],'saved EdgeSAM does not drift to a warm SAM 2 token');
const edgeCold=await backendFixture({preferredBackend:'sam_points'});
assert.equal(edgeCold.result.ok,true,JSON.stringify(edgeCold.result));assert.deepEqual(edgeCold.commands,['sam_encode','sam_points'],'saved EdgeSAM prepares its required token on a cold target');
const sam2Preferred=await backendFixture({preferredBackend:'sam2_points',warmEdge:true});
assert.equal(sam2Preferred.result.ok,true);assert.deepEqual(sam2Preferred.commands,['sam2_encode','sam2_points'],'saved SAM 2 is prepared directly without EdgeSAM encode/upgrade');
const boxPreferred=await backendFixture({preferredBackend:'sam_box',warmEdge:true,warmSam2:true,box:true});
assert.equal(boxPreferred.result.ok,true);assert.equal(boxPreferred.commands.at(-1),'sam_box','box prompts remain on EdgeSAM even when saved provenance names SAM 2');
const legacyBox=await backendFixture({warmEdge:true,box:true,provenance:null});
assert.equal(legacyBox.result.ok,true);assert.equal(legacyBox.commands.at(-1),'sam_box','unknown legacy rectangle prompts retain EdgeSAM box inference');
const unknownAuto=await backendFixture({preferredBackend:null,warmEdge:true,warmSam2:true});
assert.equal(unknownAuto.result.ok,true);assert.equal(unknownAuto.commands.at(-1),'sam2_points','unknown legacy provenance keeps automatic warm-token selection');
for(const failedBackend of ['sam_points','sam2_points']){
 const failedRequired=await backendFixture({preferredBackend:failedBackend,failEncode:failedBackend==='sam2_points'?'sam2_encode':'sam_encode'});
 assert.equal(failedRequired.result.ok,false,`${failedBackend} preparation failure is returned`);
 assert.deepEqual([...failedRequired.mask.px],[7,8,9,10],'failed required model leaves candidate pixels untouched');
 assert.equal(failedRequired.mask.aiProvenance.recordedAt,'old','failed required model leaves provenance untouched');
 assert(!failedRequired.commands.includes(failedBackend),'failed preparation never invokes the segmentation command');
}

// Verify the portable copy selector forwards normalized saved intent, including for sky seeds;
// a known sky backend failure is a failed target, while unknown legacy retains heuristic fallback.
const portableCalls=[];
const portableReevaluate=new Function('mskGenerateSky','_skySeedPoints','samRunPoints','_mskRecordAIProvenance','_mskNormalizeAIProvenance','_samNormalizeBox','curItem','mskSkyUpgrade',html.slice(reevaluateStart,reevaluateEnd)+'\nreturn _mskPortableReevaluate;')(
 m=>{m.px=new Uint8Array([1]);m.mtW=m.mtH=1;},()=>[{nx:.5,ny:.5,positive:true}],async(m,opts)=>{portableCalls.push(opts.preferredBackend);return{ok:false,error:'required model unavailable'};},recordHelpers,normalize,normalizeBox,()=>target.item,async()=>true);
const knownPoint={origin:'ai',aiPoints:[{nx:.2,ny:.2,positive:true}],aiProvenance:{schemaVersion:1,backend:'sam2_points',modelId:'sam2-hiera-tiny'}};
assert.equal((await portableReevaluate(knownPoint,target)).ok,false);assert.equal(portableCalls.pop(),'sam2_points');
const knownSky={origin:'sky',aiPoints:[],aiProvenance:{schemaVersion:1,backend:'sam_points',modelId:'edge-sam'}};
// Sky re-runs through its own heuristic + landscape-model edge (mskSkyUpgrade), never through SAM points.
assert.equal((await portableReevaluate(knownSky,target)).ok,true,'sky recomputes on the target photo');assert.equal(portableCalls.length,0,'sky does not call SAM');
const legacySky={origin:'sky',aiPoints:[],aiProvenance:null};
const legacySkyResult=await portableReevaluate(legacySky,target);assert.equal(legacySkyResult.ok,true);assert.equal(portableCalls.length,0,'unknown sky keeps the heuristic path');
let guardedCalls=0;
const guardedReevaluate=new Function('mskGenerateSky','_skySeedPoints','samRunPoints','_mskRecordAIProvenance','_mskNormalizeAIProvenance','_samNormalizeBox','curItem','mskSkyUpgrade',html.slice(reevaluateStart,reevaluateEnd)+'\nreturn _mskPortableReevaluate;')(
 m=>{m.px=new Uint8Array([1]);m.mtW=m.mtH=1;},()=>[],async()=>{guardedCalls++;return{ok:true};},recordHelpers,normalize,normalizeBox,()=>target.item,async()=>false);
const invalidSavedBox={origin:'ai',aiPoints:[{nx:.2,ny:.2,positive:true}],aiBox:{x0:.1,y0:.1,x1:.8,y1:.8},px:new Uint8Array([5]),aiProvenance:{schemaVersion:1,backend:'sam2_points',modelId:'sam2-hiera-tiny',recordedAt:'saved'}};
assert.equal((await guardedReevaluate(invalidSavedBox,target)).ok,false,'rectangle prompts cannot silently change a saved point backend');
assert.deepEqual([...invalidSavedBox.px],[5]);assert.equal(invalidSavedBox.aiProvenance.recordedAt,'saved');
const missingSavedBox={origin:'ai',aiPoints:[{nx:.2,ny:.2,positive:true}],px:new Uint8Array([6]),aiProvenance:{schemaVersion:1,backend:'sam_box',modelId:'edge-sam',recordedAt:'saved'}};
assert.equal((await guardedReevaluate(missingSavedBox,target)).ok,false,'saved box backend requires a valid rectangle prompt');
assert.deepEqual([...missingSavedBox.px],[6]);assert.equal(missingSavedBox.aiProvenance.recordedAt,'saved');
assert.equal(guardedCalls,0,'inconsistent saved prompt/backend pairs are rejected before model work');
const noSeedKnownSky={origin:'sky',aiPoints:[],px:new Uint8Array([8]),aiProvenance:{schemaVersion:1,backend:'sam_points',modelId:'edge-sam',recordedAt:'saved'}};
// No landscape model on the target: the regenerated heuristic sky is kept, with a warning (no SAM work).
const noModelSky=await guardedReevaluate(noSeedKnownSky,target);assert.equal(noModelSky.ok,true);assert.match(noModelSky.warning||'',/edge clean-up unavailable/);
assert.equal(guardedCalls,0);
console.log('PASS AI provenance and Select Background: saved backend preparation/dispatch, inconsistent prompt rejection, sky re-run policy, source provenance, soft complement, and failure preservation');
