import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const ROOT=process.cwd();
const server=createServer(async(req,res)=>{try{const u=req.url.split('?')[0];const d=await readFile(path.join(ROOT,decodeURIComponent(u).slice(1)));
  res.writeHead(200,{'Content-Type':u.endsWith('.html')?'text/html':u.endsWith('.png')?'image/png':'application/octet-stream'});res.end(d);}catch{res.writeHead(404);res.end();}}).listen(0,'127.0.0.1');
await new Promise(r=>server.on('listening',r));
const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage();
p.on('pageerror',e=>console.log('[pageerror]',e.message));
await p.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`,{waitUntil:'load'});
await p.waitForFunction(()=>typeof matchSeriesToReference==='function');
const out=await p.evaluate(async()=>{
  // Three synthetic frames of "the same scene": a reference, one a stop darker, one warm-shifted.
  const mk=(mul,rMul,bMul)=>{const c=document.createElement('canvas');c.width=c.height=120;
    const x=c.getContext('2d');const d=x.createImageData(120,120);
    for(let i=0;i<d.data.length;i+=4){
      const t=((i/4)%120)/120;
      d.data[i]=Math.min(255,(90+t*60)*mul*rMul); d.data[i+1]=Math.min(255,(90+t*60)*mul);
      d.data[i+2]=Math.min(255,(90+t*60)*mul*bMul); d.data[i+3]=255;
    }
    x.putImageData(d,0,0);return c;};
  const ref=mk(1,1,1), dark=mk(0.5,1,1), warm=mk(1,1.25,0.8);
  const s=(c)=>_matchStats(c);
  const off=(a,bb)=>_matchOffsets(s(a),s(bb));
  const r={
    darkOffset:off(ref,dark),        // should be a POSITIVE exposure of about +1 stop => +20
    warmOffset:off(ref,warm),        // should be a temp correction, little exposure
    selfOffset:off(ref,ref),         // must be all zeros — matching a photo to itself
  };
  // And the residual after applying: does the correction actually close the gap?
  const applyExp=(c,stops)=>{const o=document.createElement('canvas');o.width=o.height=120;
    const x=o.getContext('2d');x.drawImage(c,0,0);
    const d=x.getImageData(0,0,120,120);const g=Math.pow(2,stops);
    for(let i=0;i<d.data.length;i+=4){d.data[i]*=g;d.data[i+1]*=g;d.data[i+2]*=g;}
    x.putImageData(d,0,0);return o;};
  const before=Math.abs(s(ref).lum-s(dark).lum);
  const fixed=applyExp(dark,r.darkOffset.exp/20);
  const after=Math.abs(s(ref).lum-s(fixed).lum);
  r.lumGapBefore=+before.toFixed(4); r.lumGapAfter=+after.toFixed(4);
  r.closedPct=Math.round((1-after/before)*100);
  // End to end through the real entry point, with a loaded batch.
  const toFile=async(c,name)=>new Promise(res=>c.toBlob(bl=>res(new File([bl],name,{type:'image/png'})),'image/png'));
  await loadFXImages([await toFile(ref,'ref.png'),await toFile(dark,'dark.png'),await toFile(warm,'warm.png')]);
  await new Promise(z=>setTimeout(z,500));
  r.loaded=fxImages.length;
  fxCurIdx=0;
  await matchSeriesToReference(0);
  r.overrides=fxImages.map(it=>it.adjustOverride?{exp:it.adjustOverride.exp,temp:it.adjustOverride.temp}:null);
  matchSeriesClear();
  r.afterClear=fxImages.map(it=>it.adjustOverride);
  return r;
});
console.log(JSON.stringify(out,null,1));
await b.close();server.close();
