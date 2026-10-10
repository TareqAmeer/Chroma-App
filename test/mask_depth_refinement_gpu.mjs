#!/usr/bin/env node
// GPU regression for depth refinement: native/reset parity, derived selection and shared tiled path.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const HERE=path.dirname(fileURLToPath(import.meta.url)),ROOT=path.resolve(HERE,'..');
const MIME={'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm','.png':'image/png'};
const server=createServer(async(req,res)=>{try{const pathname=decodeURIComponent(req.url.split('?')[0]);const file=path.join(ROOT,pathname==='/'?'index.html':pathname.replace(/^\/+/,''));if(!file.startsWith(ROOT)){res.writeHead(403);res.end();return;}const data=await readFile(file);res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end('not found');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-gl=swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),shaderErrors=[];
  page.on('console',msg=>{if(msg.type()==='error'&&/GLSL compile error|LINK FAILED|SHADER_COMPILE|program.*link/i.test(msg.text()))shaderErrors.push(msg.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`,{waitUntil:'load'});
  await page.waitForFunction(()=>typeof loadFXImages==='function'&&typeof processToCanvas==='function');
  const fixture=(await readFile(path.join(HERE,'fixtures','chart.png'))).toString('base64');
  const result=await page.evaluate(async b64=>{
    const bin=atob(b64),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    await loadFXImages([new File([bytes],'chart.png',{type:'image/png'})]);
    const item=fxImages[fxCurIdx||0];item.geom={rot:90,flipH:false,flipV:false,angle:0,crop:{x:.1,y:.1,w:.8,h:.8}};
    const source=geomCanvas(item),w=1280,h=1024,src=document.createElement('canvas');src.width=w;src.height=h;src.getContext('2d').drawImage(source,0,0,w,h);
    const depth={data:new Uint8Array(24*16),w:24,h:16};for(let y=0;y<depth.h;y++)for(let x=0;x<depth.w;x++)depth.data[y*depth.w+x]=Math.round(x/(depth.w-1)*255);
    const transformed=fxDepthForGeom(depth,item.geom);
    const mask={id:'depth-test',type:'none',origin:'depth',depOn:true,depLo:.28,depHi:.72,invert:false,
      refineFeather:0,refineEdge:0,exp:.65,con:0,temp:0,sat:0,lumLo:0,lumHi:1,hi:0,sh:0,amount:100,muted:false};
    const P=getFXParams();P.masks=[mask];P._exportDepthMap={data:new Uint8Array(depth.data),w:depth.w,h:depth.h};P.geom=item.geom;P.redEyeOps=[];P.grain={enabled:false};P.halation={enabled:false};P.bloom={enabled:false};P.adjust={enabled:false};P.lut=null;P.print=null;P.vignette={enabled:false};fxGlowScale=()=>1;Math.random=()=>.375;
    const hash=canvas=>{const d=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height).data;let v=2166136261;for(let i=0;i<d.length;i++){v^=d[i];v=Math.imul(v,16777619);}return v>>>0;};
    const renderer=fxPrepareExportRenderer();
    const selectionHash=()=>{const out=document.createElement('canvas');out.width=w;out.height=h;renderer.setImage(src);fxSetCapturedExportDepth(renderer,P);renderer.render(P,w,h,{showSel:0,previewOnly:MSK_PREVIEW_RENDER_TOKEN});const{px}=renderer.getPixels();out.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer),w,h),0,0);return hash(out);};
    const selectionBase=selectionHash();
    shouldTile=()=>false;const baseline=await processToCanvas(P,src,w,h,()=>{},renderer),baselineHash=hash(baseline);
    shouldTile=()=>true;const tiledBase=await processToCanvas(P,src,w,h,()=>{},renderer),tiledBaseHash=hash(tiledBase);
    mask.refineEdge=60;const selectionRefined=selectionHash();const refined=await processToCanvas(P,src,w,h,()=>{},renderer),refinedHash=hash(refined);
    mask.refineEdge=0;const reset=await processToCanvas(P,src,w,h,()=>{},renderer),resetHash=hash(reset);
    mask.refineEdge=60;shouldTile=()=>true;let tiles=0;const tiled=await processToCanvas(P,src,w,h,()=>{tiles++;},renderer),tiledHash=hash(tiled);
    const diff=(a,b)=>{const x=a.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data,y=b.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data;let n=0,max=0,sum=0;for(let i=0;i<x.length;i++){const d=Math.abs(x[i]-y[i]);if(d)n++;if(d>max)max=d;sum+=d;}return{n,max,mean:sum/x.length};};
    return{baselineHash,refinedHash,resetHash,tiledBaseHash,tiledHash,tiles,selectionBase,selectionRefined,baseDiff:diff(baseline,tiledBase),refinedDiff:diff(refined,tiled),packed:{maskType:Array.from(renderer._mskU.mB.slice(0,4)),dep:Array.from(renderer._mskU.mDep.slice(0,4)),exposure:renderer._mskU.mC[0],source:mskDepthCoverageSource(renderer,mask,16,16)?.px?.reduce((a,b)=>a+b,0)},transformed:{w:transformed.w,h:transformed.h},expected:{w:Math.round(depth.h*.8),h:Math.round(depth.w*.8)}};
  },fixture);
  assert.notEqual(result.refinedHash,result.baselineHash,`Feather/Edge changes GPU-rendered selection: ${JSON.stringify(result)}`);
  assert.equal(result.resetHash,result.baselineHash,'reset exactly restores native GPU depth output');
  assert.equal(result.tiledHash,result.refinedHash,'preview-size and tiled export share the same derived selection');
  assert.ok(result.tiles>1,`the fixture crosses a tile boundary (${result.tiles} tiles)`);
  assert.deepEqual(result.transformed,result.expected,'export depth receives photo crop/rotation exactly once');
  assert.equal(shaderErrors.length,0,`shader compile/link errors: ${shaderErrors.join(' | ')}`);
  console.log(`PASS depth GPU path (${result.tiles} tiles): native/reset ${result.baselineHash}, refined/tiled ${result.refinedHash}, transformed ${result.transformed.w}×${result.transformed.h}`);
}finally{await browser.close();server.close();}
