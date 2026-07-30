// Verifies export resize (quality + never-enlarge) and output sharpening.
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
await pg.waitForFunction(()=>typeof window.exportResample==='function'||typeof exportResample==='function',null,{timeout:30000});
const out=await pg.evaluate(async()=>{
  const res={};
  // Synthetic 800x600 with a hard edge and a 1px checker, so aliasing and sharpening both show.
  const W=2400,H=1800;
  const mk=()=>{const c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');
    x.fillStyle='#303030';x.fillRect(0,0,W,H);
    x.fillStyle='#d0d0d0';x.fillRect(W/2,0,W/2,H);
    for(let i=0;i<W;i+=2)for(let j=Math.round(H*0.83);j<H;j+=2){x.fillStyle=((i+j)/2)%2?'#000':'#fff';x.fillRect(i,j,1,1);}
    return c;};
  const setSel=(id,v)=>{const e=document.getElementById(id);if(!e)throw new Error('missing select '+id);e.value=String(v);
    if(e.value!==String(v))throw new Error(id+' rejected value '+v+' (no such option) -> got "'+e.value+'"');};
  const stats=c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let mean=0,n=c.width*c.height;for(let i=0;i<d.length;i+=4)mean+=d[i];mean/=n;
    // Edge contrast across the vertical boundary at the midline
    const y=(c.height>>1)*c.width;
    const xL=Math.max(0,Math.round(c.width*0.5)-3),xR=Math.min(c.width-1,Math.round(c.width*0.5)+2);
    const L=d[(y+xL)*4],R=d[(y+xR)*4];
    // checker region std-dev = how much fine detail survived
    let s=0,s2=0,cnt=0;
    for(let yy=Math.round(c.height*0.87);yy<c.height-1;yy++)for(let xx=1;xx<c.width-1;xx++){
      const v=d[(yy*c.width+xx)*4];s+=v;s2+=v*v;cnt++;}
    const mu=s/cnt,sd=Math.sqrt(Math.max(0,s2/cnt-mu*mu));
    return {w:c.width,h:c.height,mean:+mean.toFixed(2),edgeL:L,edgeR:R,edgeJump:Math.abs(R-L),detailSD:+sd.toFixed(2)};
  };
  setSel('sel-exp-size',0);setSel('sel-exp-sharp',0);
  res['off (control)']=stats(exportResample(mk()));
  setSel('sel-exp-size',1080);setSel('sel-exp-sharp',0);
  res['resize 1080, no sharp']=stats(exportResample(mk()));
  setSel('sel-exp-size',1080);setSel('sel-exp-sharp',2);
  res['resize 1080 + sharp Std']=stats(exportResample(mk()));
  setSel('sel-exp-size',1080);setSel('sel-exp-sharp',3);
  res['resize 1080 + sharp High']=stats(exportResample(mk()));
  setSel('sel-exp-size',4096);setSel('sel-exp-sharp',0);
  res['resize 4096 (> source: no enlarge)']=stats(exportResample(mk()));
  setSel('sel-exp-size',0);setSel('sel-exp-sharp',2);
  res['sharp only, full size']=stats(exportResample(mk()));
  return res;
});
for(const [k,v] of Object.entries(out)) console.log(k.padEnd(26), `${v.w}x${v.h}`.padEnd(10), 'mean',String(v.mean).padEnd(8),'edgeJump',String(v.edgeJump).padEnd(5),'detailSD',v.detailSD);
await br.close(); server.close();
