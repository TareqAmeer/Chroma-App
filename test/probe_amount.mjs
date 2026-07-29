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
await pg.goto(`${base}/chromasmith-22.html`,{waitUntil:'load'});
await pg.waitForFunction(()=>typeof window.applyUISnapshot==='function'&&typeof window.processToCanvas==='function',null,{timeout:30000});
const fx=(await readFile(path.join(ROOT,'test/fixtures/portrait.png'))).toString('base64');
await pg.evaluate(async b64=>{const bin=atob(b64),a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);await window.loadFXImages([new File([a],'portrait.png',{type:'image/png'})]);},fx);
await pg.waitForFunction(()=>typeof fxImages!=='undefined'&&fxImages.length>0,null,{timeout:15000});
const recipe=JSON.parse(await readFile(path.join(ROOT,'test/recipes/skin_uniformity.json'),'utf8'));delete recipe._desc;
const out=await pg.evaluate(async snap=>{
  const res={};
  for(const amt of [0,25,50,100,null]){
    const s=JSON.parse(JSON.stringify(snap));
    if(amt===null){s.masks[0].muted=true;} else {s.masks[0].amount=amt;}
    s.selects={'sel-lut':'','sel-print':''};
    window.__reseed&&window.__reseed();
    window.applyUISnapshot(s); window.fxUpdate&&window.fxUpdate();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const it=fxImages[0], src=window.geomCanvas?window.geomCanvas(it):it.img;
    const cv=await window.processToCanvas(window.getFXParams(),src,src.naturalWidth||src.width,src.naturalHeight||src.height);
    const d=cv.getContext('2d').getImageData(30,30,1,1).data;
    res[amt===null?'muted':('amount '+amt)]=[d[0],d[1],d[2]];
  }
  return res;
},recipe);
console.log(JSON.stringify(out,null,1));
await br.close(); server.close();
