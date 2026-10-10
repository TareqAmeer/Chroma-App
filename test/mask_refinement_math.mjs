#!/usr/bin/env node
// Deterministic unit checks for non-destructive AI-mask Feather / Edge raster derivation.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = await readFile(new URL('../chromasmith-22.html', import.meta.url), 'utf8');
const extract = (name, next) => {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = html.indexOf(`function ${next}(`, start + 1);
  assert.notEqual(end, -1, `missing following ${next}`);
  return html.slice(start, end);
};
const source = extract('_mskBoxExtrema', 'mskRefinementSet')
  + extract('_mskDepthSmoothstep', 'mskBuildTex')
  + extract('mskRefinedPixels', 'mskRefinementSet')
  + html.slice(html.indexOf('function fxDepthForGeom('),html.indexOf('async function fxEnsureDepthMap('));
const context = { Uint8ClampedArray, Uint8Array, Float32Array, Int32Array, Math, Map };
context.mskEnsureDims = () => {};
vm.createContext(context);
vm.runInContext(source, context);

const width = 17, height = 11;
const mask = new Uint8ClampedArray(width * height);
for (let y = 2; y < 9; y++) for (let x = 4; x < 12; x++) mask[y * width + x] = 255;
const model = { type: 'brush', origin: 'coat', ai: true, px: mask, mtW: width, mtH: height,
  refineFeather: 0, refineEdge: 0 };
const base = context.mskRefinedPixels(model);
assert.equal(base, mask, 'zero settings preserve the authored raster by reference');

model.refineEdge = 100;
const grown = context.mskRefinedPixels(model);
assert.ok(grown[(1 * width) + 3] > 0, 'positive Edge expands the mask');
assert.equal(model.px, mask, 'derivation never mutates the authored mask');

model.refineEdge = -100;
const shrunk = context.mskRefinedPixels(model);
assert.equal(shrunk[(2 * width) + 4], 0, 'negative Edge contracts the mask');

model.refineEdge = 0; model.refineFeather = 100;
const soft = context.mskRefinedPixels(model);
assert.ok(soft[(5 * width) + 3] > 0 && soft[(5 * width) + 3] < 255,
  'Feather creates partial edge coverage');
assert.equal(model.px, mask, 'Feather leaves the authored raster exact for reset');

model.refineFeather = 0;
assert.equal(context.mskRefinedPixels(model), mask, 'reset returns exact source bytes');

const depthData=Uint8Array.from([0,32,64,96,128,160,192,224,255]);
const depthRenderer={_depthSnapshot:{data:depthData,w:9,h:1,version:1}};
const depthMask={type:'none',origin:'depth',depOn:true,depLo:.3,depHi:.7,invert:false,
  refineFeather:0,refineEdge:0};
assert.equal(context.mskDepthCoverageSource(depthRenderer,depthMask,9,1),null,
  'zero refinement leaves depth on the original GPU gate without quantizing coverage');
depthMask.refineEdge=100;
const depthSource=context.mskDepthCoverageSource(depthRenderer,depthMask,9,1);
assert.ok(depthSource&&depthSource.px.some(v=>v>0&&v<255),'depth range produces soft canonical coverage');
assert.equal(context.mskDepthCoverageSource(depthRenderer,depthMask,9,1),depthSource,
  'unchanged depth source, range and dimensions reuse the immutable coverage');
depthMask.refineEdge=0;
assert.equal(context.mskRefinedPixels(depthMask,depthSource),depthSource.px,
  'zero depth refinement preserves exact canonical source bytes');
depthMask.refineEdge=100;
const originalDepthCoverage=Uint8Array.from(depthSource.px),baseCoverage=Array.from(originalDepthCoverage).reduce((a,b)=>a+b,0);
const expanded=context.mskRefinedPixels(depthMask,depthSource);
assert.ok(Array.from(expanded).reduce((a,b)=>a+b,0)>baseCoverage,'positive Edge expands non-inverted depth coverage');
assert.deepEqual(Array.from(depthSource.px),Array.from(originalDepthCoverage),'depth refinement never mutates canonical source');
depthMask.invert=true;depthMask._refineCache=null;
const expandedInverse=context.mskRefinedPixels(depthMask,depthSource);
assert.ok(Array.from(expandedInverse).reduce((a,b)=>a+b,0)<baseCoverage,
  'positive Edge contracts source coverage when the shader later inverts the shapeless mask, expanding the final selection');
depthMask.invert=false;depthMask.depLo=.55;
const changedRange=context.mskDepthCoverageSource(depthRenderer,depthMask,9,1);
assert.notEqual(changedRange,depthSource,
  'changing the depth range creates a fresh immutable source while keeping per-mask settings undoable');
assert.notEqual(context.mskRefinedPixels(depthMask,changedRange),expanded,
  'changing the range while refined cannot reuse cached pixels from the old range');
depthMask.refineEdge=0;
assert.equal(context.mskDepthCoverageSource(depthRenderer,depthMask,9,1),null,
  'reset refinement returns the shader to its exact native depth-gate route');
depthMask.refineEdge=100;
depthRenderer._depthSnapshot={data:Uint8Array.from(depthData,(v,i)=>255-v),w:9,h:1,version:2};
const regenerated=context.mskDepthCoverageSource(depthRenderer,depthMask,9,1);
assert.notEqual(regenerated.data,depthSource.data,'depth regeneration/version change invalidates derived coverage');
assert.equal(context.mskDepthCoverageSource({_depthSnapshot:null},depthMask,9,1),null,
  'missing depth source never produces a raster, including for inverted masks');
depthMask.depLo=.31;depthMask.depHi=.79;depthMask.invert=false;depthMask.refineEdge=70;
const rendererA={_depthSnapshot:{data:depthData,w:9,h:1,version:7}},rendererB={_depthSnapshot:{data:Uint8Array.from(depthData,(v,i)=>255-v),w:9,h:1,version:7}};
const sourceA=context.mskDepthCoverageSource(rendererA,depthMask,9,1),sourceB=context.mskDepthCoverageSource(rendererB,depthMask,9,1);
assert.equal(sourceA.key,sourceB.key,'separate renderer snapshots can share dimensions/range/version keys');
assert.notEqual(context.mskRefinedPixels(depthMask,sourceA),context.mskRefinedPixels(depthMask,sourceB),
  'the same mask cache distinguishes distinct source pixel arrays across photos/renderers');
depthMask.invert=true;
context.FX={_depthSnapshot:{data:depthData,w:9,h:1,version:2}};
assert.equal(context.mskRefinementSupported(depthMask),true,'ready depth masks expose shared refinement controls');
assert.equal(context.mskRefinementSupported({...depthMask,depOn:false}),false,'disabled depth gate hides refinement controls');
context.FX={_depthSnapshot:null};
assert.equal(context.mskRefinementSupported(depthMask),false,'depth refinement controls stay hidden after source loss/photo switch');

const photoA={img:{_depthMap:{data:Uint8Array.from([10,20,30,40]),w:2,h:2}},geom:{}};
const photoB={img:{},geom:{}};
const renderer={_depthSnapshot:null,setDepthTex(data,w,h,sourceIdentity){this._depthSnapshot={data:Uint8Array.from(data),w,h};this._depthSourceIdentity=sourceIdentity;this.uploads=(this.uploads||0)+1;},clearDepthTex(){this._depthSnapshot=null;this._depthSourceIdentity=null;this.clears=(this.clears||0)+1;}};
assert.equal(context.fxSyncDepthTexture(renderer,photoA).data[1],20,'photo A depth map uploads');
assert.ok(renderer._depthSnapshot,'photo A depth snapshot is present');
assert.equal(context.fxSyncDepthTexture(renderer,photoB),null,'photo without depth has no active source');
assert.equal(renderer._depthSnapshot,null,'switching to a photo without depth clears the prior snapshot');
assert.equal(context.fxSyncDepthTexture(renderer,photoA).data[1],20,'returning to cached photo A restores its own depth map');
assert.equal(renderer.uploads,2,'A to B to A performs a fresh upload after clearing');
photoA.img._depthMap.data[1]=200;
assert.equal(context.fxSyncDepthTexture(renderer,photoA).data[1],200,'same-object byte regeneration is detected and re-uploaded');
assert.equal(renderer.uploads,3,'in-place depth regeneration changes source identity');
const invalidPhoto={img:{_depthMap:{data:Uint8Array.of(1,2,3),w:2,h:2}},geom:{}};
assert.equal(context.fxSyncDepthTexture(renderer,invalidPhoto),null,'malformed depth dimensions are rejected');
assert.equal(renderer._depthSnapshot,null,'rejected depth data clears any preceding photo snapshot');
console.log('mask refinement math: 28 checks PASS');
