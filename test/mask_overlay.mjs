#!/usr/bin/env node
// Preview-only selection-display modes over effective mask coverage. This uses an isolated FXR
// context so the editor's long-lived WebGL preview cannot make export checks silently blank.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.png':'image/png'};
function startServer(){return new Promise(resolve=>{
  const server=createServer(async(req,res)=>{try{
    const raw=req.url.split('?')[0],file=path.join(ROOT,decodeURIComponent(raw==='/'?'/chromasmith-22.html':raw));
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
    &&typeof mskPreviewRenderOptions==='function',null,{timeout:30000});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  result=await page.evaluate(async()=>{
    const checks=[];const check=(name,pass,detail='')=>checks.push({name,pass:!!pass,detail});
    const w=128,h=96,src=document.createElement('canvas');src.width=w;src.height=h;
    const cx=src.getContext('2d');
    for(let x=0;x<w;x++)for(let y=0;y<h;y++){
      const r=Math.round(22+210*x/(w-1)),g=Math.round(30+170*y/(h-1)),b=Math.round(220-150*x/(w-1));
      cx.fillStyle=`rgb(${r},${g},${b})`;cx.fillRect(x,y,1,1);
    }
    const renderer=new FXR(document.createElement('canvas'));
    if(!renderer.ok||renderer.gl.isContextLost())return{skip:'isolated WebGL2 context unavailable before first render'};
    renderer.setImage(src);
    const masks=[
      {id:'overlay-a',type:'radial',cx:.33,cy:.5,rx:.34,ry:.72,feather:.42,invert:false,lumLo:.08,lumHi:.92,
        exp:0,con:0,temp:0,tint:0,sat:0,hue:0,hi:0,sh:0,amount:100,crOn:false,crSamples:[],depOn:false,muted:false,compositionMigrated:true},
      {id:'overlay-b',type:'radial',cx:.68,cy:.5,rx:.34,ry:.72,feather:.42,invert:false,lumLo:.2,lumHi:.78,
        exp:0,con:0,temp:0,tint:0,sat:0,hue:0,hi:0,sh:0,amount:100,crOn:false,crSamples:[],depOn:false,muted:false,
        composeOp:'intersect',operandId:'overlay-a',compositionMigrated:true},
    ];
    const P=fxCompareParams();P.masks=masks;P.adjust={enabled:true,exposure:.7};
    const pixels=opts=>{renderer.render(P,w,h,{glowScale:1,seed:3.5,...opts});return Uint8Array.from(renderer.getPixels().px);};
    const hash=a=>{let v=2166136261>>>0;for(const b of a){v^=b;v=Math.imul(v,16777619)>>>0;}return v.toString(16);};
    const stats=px=>{let min=255,max=0,energy=0;for(let i=0;i<px.length;i+=4)for(let c=0;c<3;c++){min=Math.min(min,px[i+c]);max=Math.max(max,px[i+c]);energy+=px[i+c];}return{min,max,energy};};
    const tg=document.getElementById('tg-local');if(tg)tg.classList.add('on');
    fxState.masks=masks;mskSel=1;mskPreviewMode='select';
    // Let the ordinary editor state settle first; fxUpdate synchronizes slider-backed values and
    // can legitimately create one history entry if the harness changed the initial photo state.
    fxUpdate();await new Promise(r=>setTimeout(r,450));fxHistoryPush();
    const historyCountBeforePrefs=fxHistory.length,historyIndexBeforePrefs=fxHistIdx;
    const normal=pixels({});
    mskSetSelViewStyle('legacy');
    const legacyOpts=mskPreviewRenderOptions();
    const legacy=pixels(legacyOpts);
    const legacyExplicit=pixels({...legacyOpts,showSelMode:0,showSelColor:[1,.15,.15]});
    mskSelViewColorInput('#13b85c');
    const greenLegacy=pixels(mskPreviewRenderOptions());
    mskSetSelViewStyle('photo');
    const photo=pixels(mskPreviewRenderOptions());
    mskSetSelViewStyle('bw');
    const whiteBlack=pixels(mskPreviewRenderOptions());
    await new Promise(r=>setTimeout(r,450));
    const st=stats(whiteBlack);let grayOnly=true,nonBlack=0;
    for(let i=0;i<whiteBlack.length;i+=4){if(whiteBlack[i]!==whiteBlack[i+1]||whiteBlack[i+1]!==whiteBlack[i+2])grayOnly=false;if(whiteBlack[i]>0)nonBlack++;}
    let outsideCoverageMaxDelta=0,outsideCoveragePixels=0;
    for(let i=0;i<whiteBlack.length;i+=4)if(whiteBlack[i]===0){outsideCoveragePixels++;
      for(let c=0;c<3;c++)outsideCoverageMaxDelta=Math.max(outsideCoverageMaxDelta,Math.abs(photo[i+c]-normal[i+c]));}
    check('effective-selection display modes render nonblank pixels',stats(legacy).energy>0&&stats(photo).energy>0&&nonBlack>0,`white/black range ${st.min}..${st.max}; active pixels ${nonBlack}`);
    check('default colour overlay matches the legacy selection shader output',hash(legacy)===hash(legacyExplicit));
    check('custom colour changes colour-overlay pixels',hash(legacy)!==hash(greenLegacy));
    check('on-image and white-on-black render distinct output',hash(photo)!==hash(whiteBlack));
    check('white-on-black output is grayscale effective coverage',grayOnly&&st.max>0);
    check('on-image overlay preserves the graded photo outside selection coverage',outsideCoveragePixels>0&&outsideCoverageMaxDelta<=1,
      `${outsideCoveragePixels} zero-coverage pixels; max channel delta ${outsideCoverageMaxDelta}`);

    mskSelViewAlwaysInput(true);mskPreviewMode='off';
    const alwaysOpts=mskPreviewRenderOptions();
    check('always-show preference keeps the selected mask visible across preview modes',alwaysOpts.showSel===1&&alwaysOpts.previewOnly===MSK_PREVIEW_RENDER_TOKEN);
    const persisted=JSON.parse(localStorage.getItem('chromasmith.mask-selection-view.v1')||'{}');
    check('mode, colour and always-show persist as UI preferences',persisted.style==='bw'&&persisted.color==='#13b85c'&&persisted.always===true);
    check('changing overlay preferences does not add an undo/history entry',fxHistory.length===historyCountBeforePrefs&&fxHistIdx===historyIndexBeforePrefs,
      `${historyCountBeforePrefs}/${historyIndexBeforePrefs} before, ${fxHistory.length}/${fxHistIdx} after`);
    const snapshot=typeof getUISnapshot==='function'?getUISnapshot():{};
    check('overlay display preferences are excluded from photo snapshots',!Object.keys(snapshot).some(k=>/selview|selection.?overlay/i.test(k)));
    fxState.masks=[];mskSel=-1;mskUpdateSelViewControls();
    check('always-show controls and shader selection hide when no mask is active',mskShowSelIdx()===-1&&document.getElementById('msk-selview-style-row').style.display==='none');
    fxState.masks=masks;mskSel=1;mskUpdateSelViewControls();

    // Emulate the ordinary FX export call carrying stale/always-on UI values. Without the private
    // preview token, the shader must take its exact normal path even when the preference is true.
    const exportLike=pixels({showSel:1,showSelOpacity:.75,showSelMode:2,showSelColor:[0,1,0]});
    check('export-like render ignores always-show UI values without preview token',hash(exportLike)===hash(normal));
    const captureP={...getFXParams(),masks:P.masks,adjust:P.adjust,
      previewOnly:MSK_PREVIEW_RENDER_TOKEN,showSel:mskShowSelIdx(),showSelMode:2,showSelColor:[0,1,0]};
    const captureCanvas=await processToCanvas(captureP,src,w,h,()=>{},renderer);
    const capturePx=new Uint8Array(captureCanvas.getContext('2d').getImageData(0,0,w,h).data);
    check('actual processToCanvas export ignores persisted always-show and token-tainted params',hash(capturePx)===hash(normal));
    const full=pixels({}),oldTileSize=fxExportTileSize;fxExportTileSize=()=>64;
    let tileTotal=0,tileDone=0;
    const tiled=await renderTiled(P,src,w,h,(n,total)=>{tileDone=n;tileTotal=total;},renderer);fxExportTileSize=oldTileSize;
    const tiledPx=new Uint8Array(tiled.getContext('2d').getImageData(0,0,w,h).data);
    let tileDelta=0;for(let i=0;i<full.length;i++)tileDelta=Math.max(tileDelta,Math.abs(full[i]-tiledPx[i]));
    check('renderTiled actually renders multiple tiles',tileTotal>1&&tileDone===tileTotal,`${tileDone}/${tileTotal} tiles`);
    check('multi-tile export remains overlay-free while always-show preference is enabled',tileDelta<=1,`max pixel delta ${tileDelta}`);
    return{checks,glLost:renderer.gl.isContextLost()};
  });
  // Check local-storage parsing after reload and that actual photo selection changes do not reset
  // the global overlay preference. The photo switch's unrelated rendering/persistence work is stubbed.
  await page.evaluate(()=>{mskSetSelViewStyle('photo');mskSelViewColorInput('#7b28e0');mskSelViewAlwaysInput(true);});
  await page.reload({waitUntil:'load'});
  const persistedReload=await page.evaluate(()=>({style:mskSelViewStyle,color:mskSelViewColor,always:mskAlwaysShowSelection}));
  result.checks.push({name:'overlay preferences survive page reload',pass:persistedReload.style==='photo'&&persistedReload.color==='#7b28e0'&&persistedReload.always===true,detail:JSON.stringify(persistedReload)});
  await page.evaluate(()=>localStorage.removeItem('chromasmith.mask-selection-view.v1'));
  await page.reload({waitUntil:'load'});
  const reset=await page.evaluate(()=>({style:mskSelViewStyle,color:mskSelViewColor,always:mskAlwaysShowSelection}));
  result.checks.push({name:'clearing the overlay preference restores legacy defaults',pass:reset.style==='legacy'&&reset.color==='#ff2626'&&reset.always===false,detail:JSON.stringify(reset)});
  await page.evaluate(()=>localStorage.setItem('chromasmith.mask-selection-view.v1','{"style":"unexpected","color":"nope","always":"true"}'));
  await page.reload({waitUntil:'load'});
  const invalidPrefs=await page.evaluate(()=>({style:mskSelViewStyle,color:mskSelViewColor,always:mskAlwaysShowSelection}));
  result.checks.push({name:'malformed stored overlay preferences fail back to legacy defaults',pass:invalidPrefs.style==='legacy'&&invalidPrefs.color==='#ff2626'&&invalidPrefs.always===false,detail:JSON.stringify(invalidPrefs)});
  await page.evaluate(()=>localStorage.removeItem('chromasmith.mask-selection-view.v1'));
  await page.reload({waitUntil:'load'});
  const switched=await page.evaluate(()=>{
    mskSetSelViewStyle('photo');mskSelViewColorInput('#26c9d4');mskSelViewAlwaysInput(true);
    fxSyncHdrOption=()=>{};fxInvalidateMaskSource=()=>{};fxPhotoActivityInvalidate=()=>{};fxSyncVideoUI=()=>{};
    secScopePersist=()=>{};samInvalidate=()=>{};mskRebuild=()=>{};updateWork=()=>{};redeyeSyncUI=()=>{};
    fxPaintSlider=()=>{};_stA2S=()=>0;applyAdjustVals=()=>{};domAdjustVals=()=>({});adjSyncScopeUI=()=>{};
    secScopeShowItem=()=>{};fxDeskbarTitle=()=>{};fxDimsFmt=()=>'';setDZ=()=>{};showExif=()=>{};
    fxUpdateFlagBtns=()=>{};renderPreview=()=>{};buildLookGallery=()=>{};buildFilmstrip=()=>{};fnSyncStatus=()=>{};
    window.chromasmithLibraryBusy=false;cropMode=false;redeyeMode=false;
    fxImages=[{name:'source',ext:'png',img:null,masks:[{id:'source-mask'}]},
      {name:'target',ext:'png',img:null,masks:[{id:'target-mask'}]}];
    fxCurIdx=0;fxState.masks=fxImages[0].masks;mskSel=0;fxSelectImage(1);
    return{index:fxCurIdx,style:mskSelViewStyle,color:mskSelViewColor,always:mskAlwaysShowSelection,
      activeMask:fxState.masks[0]?.id};
  });
  result.checks.push({name:'photo switch preserves UI overlay preference and selects target mask',pass:switched.index===1&&switched.style==='photo'&&switched.color==='#26c9d4'&&switched.always===true&&switched.activeMask==='target-mask',detail:JSON.stringify(switched)});
  if(errors.length)throw new Error(`browser/shader errors: ${errors.join('\n')}`);
}finally{await browser.close();server.close();}
if(result?.skip)console.log(`SKIP: ${result.skip}`);
else{
  let fail=0;for(const c of result.checks){console.log(`  ${c.pass?'PASS':'FAIL'} ${c.name}${c.detail?` [${c.detail}]`:''}`);if(!c.pass)fail++;}
  if(result.glLost)console.log('SKIP: WebGL context lost after first render; rendered assertions are inconclusive.');
  console.log(`${result.checks.length-fail}/${result.checks.length} overlay checks PASS`);
  if(fail)process.exitCode=1;
}
