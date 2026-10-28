#!/usr/bin/env node
// Halation / bloom / grain must look the same at Fit (whole-image preview) as at 1:1 (export scale).
// Renders one synthetic photo as the Fit preview would and as the export would, box-downsamples the
// export to the preview size, and compares the glow profile across a hard bright edge.
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mime={'.html':'text/html','.js':'text/javascript','.png':'image/png','.wasm':'application/wasm'};
const server=createServer(async(req,res)=>{try{const f=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://x').pathname));if(!f.startsWith(root))throw 0;res.setHeader('Content-Type',mime[path.extname(f)]||'application/octet-stream');res.end(await readFile(f));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({args:['--use-gl=swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox','--enable-unsafe-swiftshader']});
const MODES=process.argv[2]?[process.argv[2]]:['halation','bloom','grain'];
try{
  const page=await browser.newPage({viewport:{width:1200,height:800}});
  page.on('pageerror',e=>console.log('[pageerror]',e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`,{waitUntil:'load'});
  await page.waitForFunction(()=>typeof processToCanvas==='function'&&typeof FX!=='undefined'&&FX&&FX.render);
  if(process.env.PW)await page.evaluate(v=>{window.__PW=v;},+process.env.PW);
  if(process.env.GP)await page.evaluate(v=>{window.__grAttP=v;},+process.env.GP);
  if(process.env.OLD)await page.evaluate(()=>{fxZoomGlowOpts=(iw,sq)=>({glowScale:1,scOverride:iw/FXR.CAL.refWidth});});
  for(const MODE of MODES){
  const r=await page.evaluate(async(MODE)=>{
    const IW=4800,IH=3200,PW=+(window.__PW||1600),PH=Math.round(PW*IH/IW);
    const src=document.createElement('canvas');src.width=IW;src.height=IH;const g=src.getContext('2d');
    g.fillStyle='#1a1a1a';g.fillRect(0,0,IW,IH);g.fillStyle='#ffffff';g.fillRect(IW/2,0,IW/2,IH);          // one hard bright edge at x=IW/2
    for(let i=0;i<40;i++){g.fillRect(200+i*40,400,6,600);}
    g.fillStyle='#808080';g.fillRect(0,IH*0.75,IW/2,IH*0.25);                                          // flat mid-grey patch (grain)                                               // thin bright lines (leaves/branches)
    const P=structuredClone(getFXParams());P.halation.enabled=MODE==='halation';P.bloom.enabled=MODE==='bloom';P.grain.enabled=MODE==='grain';
    if(P.adjust)P.adjust.enabled=false;P.masks=[];
    const read=c=>{const t=document.createElement('canvas');t.width=c.width;t.height=c.height;const x=t.getContext('2d');x.drawImage(c,0,0);return x.getImageData(0,0,c.width,c.height).data;};
    // A: Fit preview exactly as renderPreview calls it (no scOverride, preview options incl. truncRefW).
    fxWork=src;fxImg=src;
    FX.setImage(src);FX.render(P,PW,PH,mskPreviewRenderOptions({glowScale:fxGlowScale(),seed:7}));
    const A=read(FX.cv);
    // B: the export (truth), box-downsampled to the preview size.
    const ren=fxPrepareExportRenderer();const out=await processToCanvas(P,src,IW,IH,null,ren);
    const d=document.createElement('canvas');d.width=PW;d.height=PH;const dx=d.getContext('2d');dx.imageSmoothingQuality='high';dx.drawImage(out,0,0,PW,PH);
    const B=dx.getImageData(0,0,PW,PH).data;
    const row=Math.round(PH*0.5),row2=Math.round(700*PH/IH);
    const prof=(D,y,x0,x1)=>{const o=[];for(let x=x0;x<x1;x++){const i=(y*PW+x)*4;o.push([D[i],D[i+1],D[i+2]]);}return o;};
    const e=PW/2;
    // glow energy on the dark side of the edge: sum of (pixel - far-dark baseline) per channel
    const energy=(D,y)=>{const base=prof(D,y,40,60).reduce((a,p)=>a.map((v,k)=>v+p[k]/20),[0,0,0]);let s=[0,0,0];for(let x=e-200;x<e;x++){const i=(y*PW+x)*4;for(let k=0;k<3;k++)s[k]+=Math.max(0,D[i+k]-base[k]);}return s.map(Math.round);};
    // grain: std-dev of luma on a flat grey patch
    const sd=(D)=>{let a=[],y0=Math.round(PH*0.8);for(let y=y0;y<y0+60;y++)for(let x=PW*0.2;x<PW*0.2+60;x++){const i=(y*PW+x)*4;a.push((D[i]+D[i+1]+D[i+2])/3);}const m=a.reduce((p,v)=>p+v,0)/a.length;return +Math.sqrt(a.reduce((p,v)=>p+(v-m)**2,0)/a.length).toFixed(2);};
    const pA=prof(A,row,e-24,e+2).map(p=>p[0]),pB=prof(B,row,e-24,e+2).map(p=>p[0]);
    // C: a zoomed crop exactly as _fxRenderTiles/renderFullResCrop render it (current code path), at sq output px per source px,
    // box-downsampled back to source density and compared with the export at native res (no downsample).
    const Bfull=read(out);
    const tile=(sq)=>{const cx0=IW/2-400,cy0=IH/2-200,cw=600,ch=400,ow=Math.round(cw*sq),oh=Math.round(ch*sq);
      const opt=mskPreviewRenderOptions({...fxZoomGlowOpts(IW,sq),seed:7});
      if(!FX.pushTempCrop(src,cx0,cy0,cw,ch)){const c=document.createElement('canvas');c.width=cw;c.height=ch;c.getContext('2d').drawImage(src,cx0,cy0,cw,ch,0,0,cw,ch);FX.pushTempImage(c);}
      FX.render(P,ow,oh,{...opt,uvOff:[cx0/IW,(IH-(cy0+ch))/IH],uvScale:[cw/IW,ch/IH]});
      const t=document.createElement('canvas');t.width=cw;t.height=ch;const tx=t.getContext('2d');tx.imageSmoothingQuality='high';tx.drawImage(FX.cv,0,0,ow,oh,0,0,cw,ch);
      FX.popTempImage();const D=tx.getImageData(0,0,cw,ch).data;
      const y=200,o=[],ref=[];for(let x=340;x<402;x+=2){const i=(y*cw+x)*4;o.push(D[i]);const j=((cy0+y)*IW+cx0+x)*4;ref.push(Bfull[j]);}
      let err=0;o.forEach((v,k)=>err=Math.max(err,Math.abs(v-ref[k])));return{sq,maxErr:err,tile:o.join(','),export:ref.join(',')};};
    const tiles=[tile(0.5),tile(1),tile(2),tile(3)];
    const gsd=(sq)=>{const cx0=400,cy0=Math.round(IH*0.8),cw=300,ch=200,ow=Math.round(cw*sq),oh=Math.round(ch*sq);
      const opt=mskPreviewRenderOptions({...fxZoomGlowOpts(IW,sq),seed:7});
      if(!FX.pushTempCrop(src,cx0,cy0,cw,ch)){const c=document.createElement('canvas');c.width=cw;c.height=ch;c.getContext('2d').drawImage(src,cx0,cy0,cw,ch,0,0,cw,ch);FX.pushTempImage(c);}
      FX.render(P,ow,oh,{...opt,uvOff:[cx0/IW,(IH-(cy0+ch))/IH],uvScale:[cw/IW,ch/IH]});
      const t=document.createElement('canvas');t.width=cw;t.height=ch;const tx=t.getContext('2d');tx.imageSmoothingQuality='high';tx.drawImage(FX.cv,0,0,ow,oh,0,0,cw,ch);FX.popTempImage();
      const D=tx.getImageData(0,0,cw,ch).data;let a=[];for(let i=0;i<D.length;i+=4)a.push((D[i]+D[i+1]+D[i+2])/3);const m=a.reduce((p,v)=>p+v,0)/a.length;
      let b=[];for(let y=cy0;y<cy0+ch;y++)for(let x=cx0;x<cx0+cw;x++){const i=(y*IW+x)*4;b.push((Bfull[i]+Bfull[i+1]+Bfull[i+2])/3);}const mb=b.reduce((p,v)=>p+v,0)/b.length;
      return{sq,tileSd:+Math.sqrt(a.reduce((p,v)=>p+(v-m)**2,0)/a.length).toFixed(2),exportSd:+Math.sqrt(b.reduce((p,v)=>p+(v-mb)**2,0)/b.length).toFixed(2)};};
    const grainTiles=MODE==='grain'?[gsd(1),gsd(2),gsd(3)]:null;
    return {MODE,tiles,grainTiles,edgeEnergy:{fit:energy(A,row),export:energy(B,row)},linesEnergy:{fit:energy(A,row2),export:energy(B,row2)},
      redProfile:{fit:pA.join(','),export:pB.join(',')},grainSd:{fit:sd(A),export:sd(B)},
      trunc:fxExportWidth(),fullScale:fxFullScale()};
  },MODE);
  const tag=r.MODE;
  if(process.env.VERBOSE)console.log(JSON.stringify(r,null,1));
  if(tag!=='grain'){
    // Fit preview vs the export viewed at the same size: glow energy within 5%.
    for(const k of [0,1]){const f=r.edgeEnergy.fit[k],e=r.edgeEnergy.export[k];if(e>20)assert.ok(Math.abs(f-e)/e<0.05,tag+' Fit energy '+f+' vs export '+e);}
    // Zoomed crops at 50%..300% vs the export at native size: within resampling error at the edge pixel.
    for(const t of r.tiles)assert.ok(t.maxErr<=(tag==='bloom'?45:20),tag+' zoom '+t.sq+'x max err '+t.maxErr+'\n tile '+t.tile+'\n exp  '+t.export);
  }else{
    assert.ok(Math.abs(r.grainSd.fit-r.grainSd.export)/r.grainSd.export<0.3,'Fit grain sd '+r.grainSd.fit+' vs export viewed at Fit size '+r.grainSd.export);
  }
  console.log('zoom parity '+tag+': ok',JSON.stringify(tag==='grain'?r.grainSd:r.tiles.map(t=>[t.sq,t.maxErr])));
  }

}finally{await browser.close();server.close();}
