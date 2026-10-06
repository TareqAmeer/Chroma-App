// Compare optimized Android tiles against the original 1024px/fresh-canvas algorithm.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const ROOT=path.resolve(import.meta.dirname,'..');
const server=createServer(async(req,res)=>{try{
  const file=path.resolve(ROOT,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(ROOT+path.sep))throw new Error('outside root');
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'application/octet-stream');
  res.end(await readFile(file));
}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
  browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']});
  const page=await browser.newPage({userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36'});
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`);
  await page.waitForFunction(()=>typeof fxExportTileSize==='function'&&typeof getFXParams==='function');
  const skinMasks=JSON.parse(await readFile(path.join(ROOT,'test/recipes/skin_uniformity.json'),'utf8')).masks;
  const results=await page.evaluate(async skinMasks=>{
    // Frozen reference: the pre-CHR-284 algorithm (fresh tile canvases, 1024px centers).
    const legacy=async(P,src,iw,ih,renderer)=>{
      const REF=FXR.CAL.refWidth,sc=iw/REF,H=FXR.CAL.halation,B=FXR.CAL.bloom;
      let maxSig=Math.max((P.halation&&P.halation.radius||H.sigmaR)*sc,(P.bloom&&P.bloom.radius||B.sigma)*sc);
      if((P.masks||[]).some(m=>m.crOn&&m.uL&&m.crSamples&&m.crSamples.length))maxSig=Math.max(maxSig,FXR.CAL.skinBlurFrac*REF*sc);
      const halo=Math.ceil(maxSig*3)+16,TILE=1024,out=document.createElement('canvas');out.width=iw;out.height=ih;
      const oc=out.getContext('2d'),seed=Math.random()*100;fxSetCapturedExportDepth(renderer,P);
      for(let ty=0;ty<ih;ty+=TILE)for(let tx=0;tx<iw;tx+=TILE){
        const tw=Math.min(TILE,iw-tx),th=Math.min(TILE,ih-ty),sx=Math.max(0,tx-halo),sy=Math.max(0,ty-halo),ex=Math.min(iw,tx+tw+halo),ey=Math.min(ih,ty+th+halo),rw=ex-sx,rh=ey-sy;
        const tile=document.createElement('canvas');tile.width=rw;tile.height=rh;tile.getContext('2d').drawImage(src,sx,sy,rw,rh,0,0,rw,rh);
        renderer.setImage(tile);renderer.render(P,rw,rh,{glowScale:1,scOverride:sc,seed,uvOff:[sx/iw,(ih-ey)/ih],uvScale:[rw/iw,rh/ih]});
        const {px}=renderer.getPixels(),rc=document.createElement('canvas');rc.width=rw;rc.height=rh;
        rc.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer),rw,rh),0,0);oc.drawImage(rc,tx-sx,ty-sy,tw,th,tx,ty,tw,th);
        tile.width=tile.height=rc.width=rc.height=0;await new Promise(r=>requestAnimationFrame(r));
      }
      return applyRedEyeCorrections(out,P.redEyeOps);
    };
    Object.defineProperty(navigator,'deviceMemory',{configurable:true,value:4});
    shouldTile=()=>true;
    const src=document.createElement('canvas');src.width=2305;src.height=1537;
    const x=src.getContext('2d'),g=x.createLinearGradient(0,0,src.width,src.height);g.addColorStop(0,'#b68e7d');g.addColorStop(.6,'#faebd2');g.addColorStop(1,'#112b45');x.fillStyle=g;x.fillRect(0,0,src.width,src.height);
    for(let i=0;i<9;i++){x.fillStyle=i%2?'white':'black';x.fillRect(950+i*147,250+i*79,17,400);}
    x.clearRect(0,0,43,43); // reuse must not retain pixels in transparent corners
    const renderer=fxPrepareExportRenderer(),base=getFXParams();base.redEyeOps=[];
    const oldSize=fxExportTileSize,oldRandom=Math.random;Math.random=()=>.375;
    const records=[];
    const read=c=>c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,c.width,c.height).data;
    try{
      for(const kind of ['basic','grain','glow','skin']){
        const P=structuredClone(base);P.halation.enabled=false;P.bloom.enabled=false;P.grain.enabled=false;
        if(kind==='grain')P.grain.enabled=true;
        if(kind==='glow'){P.halation.enabled=true;P.bloom.enabled=true;}
        if(kind==='skin')P.masks=structuredClone(skinMasks);
        renderer._maskReferenceSize={w:src.width,h:src.height};
        const before=await legacy(P,src,src.width,src.height,renderer),a=read(before);
        // First isolate canvas reuse at the SAME tile size: every pixel must match exactly.
        fxExportTileSize=()=>1024;
        const reused=await processToCanvas(P,src,src.width,src.height,null,renderer),b=read(reused);
        let reuseMax=0;for(let i=0;i<a.length;i++)reuseMax=Math.max(reuseMax,Math.abs(a[i]-b[i]));
        fxExportTileSize=oldSize;
        const after=await processToCanvas(P,src,src.width,src.height,null,renderer),d=read(after);
        let sum=0,max=0,seamSum=0,seamN=0;
        for(let y=0;y<src.height;y++)for(let xx=0;xx<src.width;xx++)for(let k=0;k<3;k++){
          const i=(y*src.width+xx)*4+k,v=Math.abs(a[i]-d[i]);sum+=v;max=Math.max(max,v);
          if(Math.abs(xx-1024)<3||Math.abs(xx-2048)<3||Math.abs(y-1024)<3){seamSum+=v;seamN++;}
        }
        records.push({kind,reuseMax,mean:sum/(src.width*src.height*3),max,seamMean:seamSum/seamN});
        before.width=before.height=reused.width=reused.height=after.width=after.height=0;
      }
      // Cancel and failure cleanup: all temporary/output canvases must be released.
      const made=[],create=document.createElement.bind(document);document.createElement=(tag,...args)=>{const e=create(tag,...args);if(tag==='canvas')made.push(e);return e;};
      let cancelled=false;try{await processToCanvas(base,src,src.width,src.height,()=>{fxExportCancel=true;},renderer);}catch(e){cancelled=e.message==='export cancelled';}
      finally{fxExportCancel=false;document.createElement=create;}
      const cleanup=made.every(c=>c.width===0&&c.height===0);
      const fake={gl:{MAX_VIEWPORT_DIMS:1,MAX_TEXTURE_SIZE:2,MAX_RENDERBUFFER_SIZE:3,getParameter:k=>k===1?[4096,4096]:4096}};
      const plain={halation:{enabled:false},bloom:{enabled:false},nr:{detail:.5,luma:0,color:0,hlDesat:0}};
      Object.defineProperty(navigator,'deviceMemory',{value:2});const ordinary=oldSize(plain,src,100,fake),heavy=oldSize({...plain,tonemap:true},src,100,fake);
      Object.defineProperty(navigator,'deviceMemory',{value:1});const low=oldSize(plain,src,100,fake);
      Object.defineProperty(navigator,'deviceMemory',{value:4});const hugeHalo=oldSize(plain,src,400,fake);
      const hdr=oldSize({...plain,tonemap:true},src,100,fake),lens=oldSize({...plain,lens:{dist:.1}},src,100,fake),nr=oldSize({...plain,nr:{luma:20}},src,100,fake);
      const limited={gl:{...fake.gl,getParameter:k=>k===1?[2048,2048]:4096}};
      const gpuLimited=oldSize(plain,src,100,limited);
      Object.defineProperty(navigator,'userAgent',{configurable:true,value:'iPhone'});const ios=oldSize(plain,src,100,fake);
      Object.defineProperty(navigator,'userAgent',{value:'Android'});Object.defineProperty(navigator,'deviceMemory',{value:undefined});const unknownMemory=oldSize(plain,src,100,fake);
      let notice=null,prompts=0;
      await fxNotifyExportFinished({LocalNotifications:{checkPermissions:async()=>({display:'granted'}),requestPermissions:async()=>{prompts++;},schedule:async data=>{notice=data;}}},Date.now()-16000);
      await fxNotifyExportFinished({LocalNotifications:{checkPermissions:async()=>({display:'prompt'}),requestPermissions:async()=>{prompts++;},schedule:async()=>{prompts++;}}},Date.now()-16000);
      return {records,cancelled,cleanup,ordinary,heavy,low,hugeHalo,hdr,lens,nr,gpuLimited,ios,unknownMemory,prompts,inexact:notice?.notifications[0].isExactNotification===false};
    }finally{fxExportTileSize=oldSize;Math.random=oldRandom;}
  },skinMasks);
  console.log(JSON.stringify(results,null,2));
  for(const r of results.records){
    assert.equal(r.reuseMax,0,`${r.kind}: canvas reuse changed pixels`);
    assert.ok(r.max<=2,`${r.kind}: larger tiles differ excessively`);
    assert.ok(r.mean<.01,`${r.kind}: larger tiles differ excessively`);
    assert.ok(r.seamMean<.01,`${r.kind}: larger tiles introduced seam differences`);
  }
  assert.equal(results.cancelled,true);assert.equal(results.cleanup,true);
  assert.equal(results.ordinary,2048);assert.equal(results.heavy,1024);assert.equal(results.low,1024);assert.equal(results.hugeHalo,1760);
  assert.equal(results.prompts,0);assert.equal(results.inexact,true);
  assert.equal(results.gpuLimited,1848);assert.equal(results.ios,1024);assert.equal(results.unknownMemory,1024);
  assert.equal(results.hdr,1024);assert.equal(results.lens,1024);assert.equal(results.nr,1024);
  console.log('PASS Android tile pixels, seams, memory/GPU guards, cancellation and cleanup');
}finally{await browser?.close();server.close();}
