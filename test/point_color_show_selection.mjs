#!/usr/bin/env node
// CHR-259: Point Colour "Show selection" — a view-only overlay of the selected range's weight.
// Checks: the overlay appears and is stronger on in-range pixels than out-of-range ones; toggling
// it off restores the identical preview; it never reaches an export (single-pass or tiled) and
// never enters history or the recipe; it switches off when another range is selected.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.png':'image/png'};
const server=await new Promise(resolve=>{
  const s=createServer(async(req,res)=>{try{
    const raw=req.url.split('?')[0],file=path.join(ROOT,decodeURIComponent(raw==='/'?'/chromasmith-22.html':raw));
    if(!file.startsWith(ROOT)){res.writeHead(403);res.end();return;}
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream'});res.end(await readFile(file));
  }catch{res.writeHead(404);res.end('not found');}});
  s.listen(0,'127.0.0.1',()=>resolve(s));
});
const browser=await chromium.launch({
  ...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),
  args:['--use-gl=swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader'],
});
let result;
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`,{waitUntil:'load'});
  await page.waitForFunction(()=>document.readyState==='complete'&&typeof FXR==='function'&&typeof pcToggleShowSel==='function',null,{timeout:30000});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  result=await page.evaluate(async()=>{
    const checks=[];const check=(name,pass,detail='')=>checks.push({name,pass:!!pass,detail});
    if(!FX.ok||FX.gl.isContextLost())return{skip:'WebGL2 unavailable'};
    // Left half: the picked red (in range). Right half: blue (far outside the range).
    const w=96,h=64,src=document.createElement('canvas');src.width=w;src.height=h;
    const cx=src.getContext('2d');cx.fillStyle='rgb(204,51,51)';cx.fillRect(0,0,w/2,h);cx.fillStyle='rgb(40,70,210)';cx.fillRect(w/2,0,w/2,h);
    document.getElementById('cs-modal-ov')?.remove();
    if(!document.getElementById('tg-pointcolor').classList.contains('on'))toggleFX('pointcolor');
    const[ph,ps]=r2hsv(0.8,0.2,0.2);
    fxState.pointColors=[{h:ph,s:ps,rgb:[204,51,51],hue:0,sat:-60,lum:0,range:35,smoothness:50},
      {h:0.6,s:0.8,rgb:[40,70,210],hue:0,sat:0,lum:0,range:35,smoothness:50}];
    pcSel=0;pcRebuild();pcSyncUI();bakeHsl();
    FX.setImage(src);
    const P=()=>getFXParams();
    const px=opts=>{FX.render(P(),w,h,{glowScale:1,seed:3.5,...opts});return Uint8Array.from(FX.getPixels().px);};
    const hash=a=>{let v=2166136261>>>0;for(const b of a){v^=b;v=Math.imul(v,16777619)>>>0;}return v.toString(16);};
    const at=(a,x,y)=>{const i=((h-1-y)*w+x)*4;return[a[i],a[i+1],a[i+2]];};
    const histBefore=fxHistory.length,snapBefore=JSON.stringify(getUISnapshot());
    mskSetSelViewStyle('wob'); // white-on-black shows the raw weight
    const offPx=px(mskPreviewRenderOptions());
    check('button starts off',!document.getElementById('btn-pc-showsel').classList.contains('on'));
    document.getElementById('btn-pc-showsel').click();
    check('button turns on',document.getElementById('btn-pc-showsel').classList.contains('on')&&mskPreviewRenderOptions().showPcSel===true);
    const wob=px(mskPreviewRenderOptions());
    const inW=at(wob,w/4,h/2)[0],outW=at(wob,3*w/4,h/2)[0];
    check('white-on-black weight: in-range pixel bright, out-of-range dark',inW>200&&outW<10,`in ${inW} out ${outW}`);
    mskSetSelViewStyle('color');mskSelViewColorInput('#13b85c');
    const col=px(mskPreviewRenderOptions());
    const dIn=at(col,w/4,h/2).map((v,i)=>Math.abs(v-at(offPx,w/4,h/2)[i])).reduce((a,b)=>a+b),dOut=at(col,3*w/4,h/2).map((v,i)=>Math.abs(v-at(offPx,3*w/4,h/2)[i])).reduce((a,b)=>a+b);
    const g=at(col,w/4,h/2);
    check('colour overlay is stronger on in-range pixels than out-of-range',dIn>60&&dIn>dOut*4&&g[1]>g[0],`in delta ${dIn}, out delta ${dOut}, in px ${g}`);
    mskSelViewColorInput('#ff2626');
    // Export: single-pass and multi-tile, toggle on vs off, byte-identical (on a renderer holding
    // the selection cube too, so only the missing preview token keeps it out).
    const exR=new FXR(document.createElement('canvas'));exR.resetTextureSnapshotFrom(FX);
    // An export draws a fresh random grain/dither seed per call; pin it so on-vs-off is a byte comparison.
    const rr=exR.render.bind(exR);exR.render=(p,a,b,o)=>rr(p,a,b,{...o,seed:3.5});
    check('export renderer received the selection cube (stronger test)',!!exR.pcSelTx);
    const exp=async()=>{const c=await processToCanvas(P(),src,w,h,()=>{},exR);return new Uint8Array(c.getContext('2d').getImageData(0,0,w,h).data);};
    const tiled=async()=>{const o=fxExportTileSize;fxExportTileSize=()=>32;let n=0;try{const c=await renderTiled(P(),src,w,h,(d,t)=>{n=t;},exR);return{n,px:new Uint8Array(c.getContext('2d').getImageData(0,0,w,h).data)};}finally{fxExportTileSize=o;}};
    const expOn=await exp(),tOn=await tiled();
    pcToggleShowSel(false);
    const expOff=await exp(),tOff=await tiled();
    check('export byte-identical with the toggle on vs off',hash(expOn)===hash(expOff));
    check('tiled export byte-identical with the toggle on vs off',tOn.n>1&&hash(tOn.px)===hash(tOff.px),`${tOn.n} tiles`);
    check('toggle off restores the identical preview',hash(px(mskPreviewRenderOptions()))===hash(offPx));
    check('no history entry and no recipe change',fxHistory.length===histBefore&&JSON.stringify(getUISnapshot())===snapBefore&&!/showsel|pcShowSel/i.test(JSON.stringify(fxState)));
    // Switching off on range change / section off.
    pcToggleShowSel(true);
    document.querySelectorAll('#pc-list .pc-chip')[1].click();
    check('selecting another range turns it off',!pcShowSelActive()&&!document.getElementById('btn-pc-showsel').classList.contains('on'));
    pcToggleShowSel(true);toggleFX('pointcolor');
    check('turning Point Colour off turns it off',!pcShowSelActive()&&mskPreviewRenderOptions().showPcSel===false);
    return{checks};
  });
  if(errors.length)throw new Error(`browser/shader errors: ${errors.join('\n')}`);
}finally{await browser.close();server.close();}
if(result?.skip)console.log(`SKIP: ${result.skip}`);
else{
  let fail=0;for(const c of result.checks){console.log(`  ${c.pass?'PASS':'FAIL'} ${c.name}${c.detail?` [${c.detail}]`:''}`);if(!c.pass)fail++;}
  console.log(`${result.checks.length-fail}/${result.checks.length} point colour show-selection checks PASS`);
  if(fail)process.exitCode=1;
}
