// Verifies the shapeless Colour/Luminance Range mask types and per-mask Texture actually work.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const ROOT='/Users/tareqameer/Documents/GitHub/Chroma-App';
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.png':'image/png','.json':'application/json','.cube':'text/plain'};
const server=await new Promise(r=>{const s=createServer(async(rq,rs)=>{try{const p=path.join(ROOT,decodeURIComponent(rq.url.split('?')[0]));const d=await readFile(p);rs.setHeader('Cross-Origin-Opener-Policy','same-origin');rs.setHeader('Cross-Origin-Embedder-Policy','require-corp');rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);}catch{rs.writeHead(404);rs.end();}});s.listen(0,'127.0.0.1',()=>r(s));});
const base=`http://127.0.0.1:${server.address().port}`;
const br=await chromium.launch({args:['--use-gl=swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox','--enable-unsafe-swiftshader']});
const pg=await br.newPage({viewport:{width:1200,height:900}});
pg.on('pageerror',e=>console.error('[pageerror]',e.message));
pg.on('console',m=>{if(m.type()==='error')console.error('[console.error]',m.text());});
await pg.goto(`${base}/chromasmith-22.html`,{waitUntil:'load'});
await pg.waitForFunction(()=>typeof window.applyUISnapshot==='function'&&typeof window.processToCanvas==='function',null,{timeout:30000});
const fx=(await readFile(path.join(ROOT,'test/fixtures/portrait.png'))).toString('base64');
await pg.evaluate(async b64=>{const bin=atob(b64),a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);await window.loadFXImages([new File([a],'portrait.png',{type:'image/png'})]);},fx);
await pg.waitForFunction(()=>typeof fxImages!=='undefined'&&fxImages.length>0,null,{timeout:15000});
const out=await pg.evaluate(async()=>{
  const base={type:'none',invert:false,lumLo:0,lumHi:1,exp:0,con:0,temp:0,tint:0,sat:0,hue:0,hi:0,sh:0,
    subtract:false,colHue:0,colAmt:0,colSat:0.65,crOn:false,crSamples:[],crRange:40,
    uH:0,uS:0,uL:0,preserve:70,tgtMode:'match',tgtHex:'#d7bd96',tanDepth:0,tanWarm:0,srcV:null,
    amount:100,name:'',muted:false,tex:0};
  const shot=async m=>{
    window.__reseed&&window.__reseed();
    window.applyUISnapshot({sliders:{},toggles:{local:!!m},selects:{'sel-lut':'','sel-print':''},colors:{},masks:m?[m]:[]});
    window.fxUpdate&&window.fxUpdate();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const it=fxImages[0],src=window.geomCanvas?window.geomCanvas(it):it.img;
    const cv=await window.processToCanvas(window.getFXParams(),src,src.naturalWidth||src.width,src.naturalHeight||src.height);
    const c=cv.getContext('2d');
    const px=(x,y)=>{const d=c.getImageData(x,y,1,1).data;return [d[0],d[1],d[2]];};
    return {field:px(30,30), disc:px(256,140), dot:px(256,192)};
  };
  const res={};
  res['off']=await shot(null);
  // COLOUR RANGE, no shape: gate on the pale disc's tone, push exposure. Only the disc should move.
  res['colour range: disc only, exp+']=await shot({...base,origin:'color',crOn:true,crRange:30,
    crSamples:[{h:0.0955,s:0.16,v:0.98}],exp:0.5});
  // Inverted: everything EXCEPT the disc.
  res['colour range INVERTED']=await shot({...base,origin:'color',crOn:true,crRange:30,
    crSamples:[{h:0.0955,s:0.16,v:0.98}],exp:0.5,invert:true});
  // LUMINANCE RANGE, no shape: only the bright disc (lum>0.8).
  res['lum range: >0.8, exp+']=await shot({...base,origin:'lum',lumLo:0.8,lumHi:1,exp:0.5});
  // TEXTURE: soften vs sharpen the whole frame (flat field => little change; edges => visible).
  // TEXTURE acts on the high-pass, which is ZERO in a flat field — so measure it where detail
  // exists: find the pixel that changes most between -100 and +100, and report the edge profile.
  const fullShot=async m=>{
    window.__reseed&&window.__reseed();
    window.applyUISnapshot({sliders:{},toggles:{local:!!m},selects:{'sel-lut':'','sel-print':''},colors:{},masks:m?[m]:[]});
    window.fxUpdate&&window.fxUpdate();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const it=fxImages[0],src=window.geomCanvas?window.geomCanvas(it):it.img;
    const cv=await window.processToCanvas(window.getFXParams(),src,src.naturalWidth||src.width,src.naturalHeight||src.height);
    return {w:cv.width,h:cv.height,d:cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data};
  };
  const A=await fullShot(null);
  const S=await fullShot({...base,origin:'color',tex:-100});
  const P=await fullShot({...base,origin:'color',tex:100});
  let best=0,bx=0,by=0;
  for(let y=1;y<A.h-1;y++)for(let x=1;x<A.w-1;x++){
    const i=(y*A.w+x)*4;
    const dv=Math.abs(P.d[i]-S.d[i])+Math.abs(P.d[i+1]-S.d[i+1])+Math.abs(P.d[i+2]-S.d[i+2]);
    if(dv>best){best=dv;bx=x;by=y;}
  }
  const rd=(O,x,y)=>{const i=(y*O.w+x)*4;return [O.d[i],O.d[i+1],O.d[i+2]];};
  res['__tex']={at:[bx,by],maxDelta:best,off:rd(A,bx,by),soften:rd(S,bx,by),sharpen:rd(P,bx,by),
    profile:[-2,-1,0,1,2].map(k=>({dx:k,off:rd(A,bx+k,by),soft:rd(S,bx+k,by),sharp:rd(P,bx+k,by)}))};
  return res;
});
for(const [k,v] of Object.entries(out)){
  if(k==='__tex')continue;
  console.log(k.padEnd(32), 'field',String(v.field).padEnd(16),'disc',String(v.disc).padEnd(16),'dot',String(v.dot));
}
const T=out.__tex;
console.log(`\nTEXTURE — most-changed pixel ${JSON.stringify(T.at)}, total RGB delta soften->sharpen = ${T.maxDelta}`);
console.log(`  off ${T.off}  soften(-100) ${T.soften}  sharpen(+100) ${T.sharpen}`);
console.log('  edge profile (dx from that pixel):');
for(const p of T.profile) console.log(`    dx=${String(p.dx).padStart(2)}  off ${String(p.off).padEnd(16)} soft ${String(p.soft).padEnd(16)} sharp ${p.sharp}`);
await br.close(); server.close();
