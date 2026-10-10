#!/usr/bin/env node
// Isolated FXR composition check. A second renderer avoids the editor's busy preview context,
// then compares real pixels for effective range-gated operations and full-frame/tiled output.
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.png':'image/png'};
function startServer(){return new Promise(resolve=>{
  const server=createServer(async(req,res)=>{try{
    const file=path.join(ROOT,decodeURIComponent(req.url.split('?')[0]==='/'?'/chromasmith-22.html':req.url.split('?')[0]));
    if(!file.startsWith(ROOT)){res.writeHead(403);res.end();return;}
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream'});res.end(await readFile(file));
  }catch{res.writeHead(404);res.end('not found');}});
  server.listen(0,'127.0.0.1',()=>resolve(server));
});}

const server=await startServer();
const browser=await chromium.launch({
  ...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),
  args:['--use-gl=swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader'],
});
let result;
try{
  const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`,{waitUntil:'load'});
  await page.waitForFunction(()=>document.readyState==='complete'&&typeof FXR==='function'
    &&typeof window.loadFXImages==='function',null,{timeout:30000});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  try{result=await page.evaluate(async()=>{
    const ck=[];const check=(name,pass,detail='')=>ck.push({name,pass:!!pass,detail});
    const w=128,h=96,src=document.createElement('canvas');src.width=w;src.height=h;
    const cx=src.getContext('2d');
    for(let x=0;x<w;x++){const v=Math.round(24+207*x/(w-1));cx.fillStyle=`rgb(${v},${Math.round(v*.78)},${Math.round(255-v*.55)})`;cx.fillRect(x,0,1,h);}
    const renderer=new FXR(document.createElement('canvas'));
    if(!renderer.ok||renderer.gl.isContextLost())return{skip:'isolated WebGL2 context unavailable before first render'};
    renderer.setImage(src);
    const build=()=>[
      {id:'mask-a',type:'radial',cx:.34,cy:.5,rx:.47,ry:.88,feather:.5,invert:false,
        lumLo:.16,lumHi:.78,exp:0,con:0,temp:0,tint:0,sat:0,hue:0,hi:0,sh:0,amount:100,
        crOn:false,crSamples:[],depOn:false,muted:false,compositionMigrated:true},
      {id:'mask-b',type:'radial',cx:.7,cy:.5,rx:.42,ry:.88,feather:.5,invert:false,
        lumLo:.25,lumHi:.88,exp:0,con:0,temp:0,tint:0,sat:0,hue:0,hi:0,sh:0,amount:100,
        crOn:false,crSamples:[],depOn:false,muted:false,compositionMigrated:true},
      {id:'mask-c',type:'radial',cx:.5,cy:.5,rx:.95,ry:.95,feather:.5,invert:false,
        lumLo:.2,lumHi:.9,exp:.8,con:0,temp:0,tint:0,sat:0,hue:0,hi:0,sh:0,amount:100,
        crOn:false,crSamples:[],depOn:false,muted:false,compositionMigrated:true},
      {id:'mask-d',type:'radial',cx:.5,cy:.5,rx:.95,ry:.95,feather:.5,invert:false,
        lumLo:.3,lumHi:.82,exp:-.35,con:0,temp:0,tint:0,sat:0,hue:0,hi:0,sh:0,amount:100,
        crOn:false,crSamples:[],depOn:false,muted:false,compositionMigrated:true},
    ];
    const render=(masks,showSel=-1,opts={})=>{
      const P=fxCompareParams();P.masks=masks;
      if(opts.exposure!=null)P.adjust={enabled:true,exposure:opts.exposure};
      renderer.render(P,w,h,{glowScale:1,seed:4.25,showSel,showSelOutline:!!opts.outline});
      return Uint8Array.from(renderer.getPixels().px);
    };
    const digest=px=>{let v=2166136261>>>0;for(let i=0;i<px.length;i++){v^=px[i];v=Math.imul(v,16777619)>>>0;}return v.toString(16);};
    const masks=build();masks[2].composeOp='subtract';masks[2].operandId='mask-a';masks[3].composeOp='intersect';masks[3].operandId='mask-c';
    const nested=render(masks,3);let min=255,max=0,energy=0;
    for(let i=0;i<nested.length;i+=4)for(let c=0;c<3;c++){min=Math.min(min,nested[i+c]);max=Math.max(max,nested[i+c]);energy+=nested[i+c];}
    check('GPU selection pixels are nonblank and vary',max>min&&energy>0,`range ${min}..${max}; energy ${energy}`);
    const plainMasks=build();const plain=render(plainMasks,3);
    check('nested subtract/intersect changes the range-gated selection',digest(nested)!==digest(plain));
    const addMasks=build();addMasks[2].composeOp='add';addMasks[2].operandId='mask-a';addMasks[3].composeOp='intersect';addMasks[3].operandId='mask-c';
    const add=render(addMasks,3);
    check('Add union produces distinct effective coverage',digest(add)!==digest(nested));
    const amountMasks=build();amountMasks[2].composeOp='add';amountMasks[2].operandId='mask-a';
    const amountZero=structuredClone(amountMasks);amountZero[2].amount=0;
    check('Amount zero leaves composed selection coverage unchanged',digest(render(amountZero,2))===digest(render(amountMasks,2)));
    check('Amount still scales this mask\'s own adjustment',digest(render(amountZero))!==digest(render(amountMasks)));
    const invalidMasks=build();invalidMasks[2].composeOp='subtract';invalidMasks[2].operandId='deleted-id';
    const invalid=render(invalidMasks,2);
    check('missing references fail closed in the rendered selection',digest(invalid)!==digest(render(build(),2)));
    const depthMasks=build();depthMasks[2].depOn=true;depthMasks[2].depLo=.2;depthMasks[2].depHi=.8;
    renderer.clearDepthTex();
    check('missing depth data fails closed instead of widening the selection',digest(render(depthMasks,2))!==digest(render(build(),2)));
    const invertedDepth=build();invertedDepth[2].type='none';invertedDepth[2].invert=true;invertedDepth[2].depOn=true;
    check('missing depth data also fails closed after shapeless inversion',digest(render(invertedDepth,2))!==digest(render(build(),2)));
    const eraserMasks=build();eraserMasks[1].isExclude=true;eraserMasks[1].lumLo=.45;eraserMasks[1].lumHi=.62;
    check('erasers subtract their effective range-gated coverage',digest(render(eraserMasks,0))!==digest(render(build(),0)));
    const outlineBase=render(masks,3,{outline:true}),outlineGraded=render(masks,3,{outline:true,exposure:1.5});
    const redEdgeMap=px=>Array.from({length:w*h},(_,p)=>px[p*4]-px[p*4+1]>2?1:0).join('');
    const edgeA=redEdgeMap(outlineBase),edgeB=redEdgeMap(outlineGraded),edgeDelta=Array.from(edgeA,(_,i)=>edgeA[i]!==edgeB[i]?1:0).reduce((a,b)=>a+b,0);
    let maxOverlayDelta=0,changedOverlayPixels=0;
    for(let p=0;p<w*h;p++){const d=Math.abs((outlineBase[p*4]-outlineBase[p*4+1])-(outlineGraded[p*4]-outlineGraded[p*4+1]));maxOverlayDelta=Math.max(maxOverlayDelta,d);if(d>1)changedOverlayPixels++;}
    check('selection outline coverage stays fixed across global exposure',changedOverlayPixels===0,`threshold-classified pixels ${edgeDelta}; max red-green delta ${maxOverlayDelta}; changed overlay pixels ${changedOverlayPixels}`);
    const fullParams=fxCompareParams();fullParams.masks=masks;
    renderer.render(fullParams,w,h,{glowScale:1,seed:4.25});const full=Uint8Array.from(renderer.getPixels().px);
    const originalSizer=fxExportTileSize;fxExportTileSize=()=>64;
    const tiled=await renderTiled(fullParams,src,w,h,()=>{},renderer);
    fxExportTileSize=originalSizer;
    const tile= new Uint8Array(tiled.getContext('2d').getImageData(0,0,w,h).data);
    let maxDelta=0;for(let i=0;i<full.length;i++)maxDelta=Math.max(maxDelta,Math.abs(full[i]-tile[i]));
    check('full-frame preview and multi-tile export pixels agree',maxDelta<=1,`max channel delta ${maxDelta}`);
    const reordered=masks.slice();[reordered[0],reordered[1]]=[reordered[1],reordered[0]];
    check('nested IDs retain operation output after reorder',digest(render(reordered,3))===digest(render(masks,3)));
    const bench=(list,frames=20)=>{const P=fxCompareParams();P.masks=list;renderer.render(P,w,h,{glowScale:1,seed:4.25});
      const t0=performance.now();for(let i=0;i<frames;i++)renderer.render(P,w,h,{glowScale:1,seed:4.25});return(performance.now()-t0)/frames;};
    const ordinaryMs=bench(build()),composedMs=bench(masks);
    check('ordinary no-outline render benchmark completed',Number.isFinite(ordinaryMs)&&Number.isFinite(composedMs),
      `mean GPU submission ${ordinaryMs.toFixed(2)}ms ordinary / ${composedMs.toFixed(2)}ms composed, no readback`);
    return{checks:ck,glLost:renderer.gl.isContextLost(),debug:{n:renderer._mskU?.mA?.length,
      e:Array.from(renderer._mskU?.mE||[]).slice(0,16),
      operands:Array.from(renderer._mskU?.mO||[]).filter((_,i)=>i%4<2).slice(0,8),
      topo:Array.from(renderer._mskU?.mTopo||[]),
      sampleDigests:[0,1,2,3].map(i=>digest(render(build(),i)))}};
  });}catch(e){throw new Error(`${e.message}\n${errors.join('\n')}`);}
  if(errors.length)throw new Error(`browser/shader errors: ${errors.join('\n')}`);
}finally{await browser.close();server.close();}
if(result?.skip){console.log(`SKIP: ${result.skip}`);process.exitCode=0;}
else{
  let fail=0;for(const c of result.checks){console.log(`  ${c.pass?'PASS':'FAIL'} ${c.name}${c.detail?` [${c.detail}]`:''}`);if(!c.pass)fail++;}
  if(result.glLost){console.log('SKIP: WebGL context was lost after composition renders; preview/export parity is inconclusive.');}
  console.log(`${result.checks.length-fail}/${result.checks.length} pixel checks PASS`);
  if(fail)process.exitCode=1;
}
