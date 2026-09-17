// Regression probe: clicking "Reset photo" / "Reset all edits" must revert adjustments.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const ROOT='/Users/tareqameer/Documents/GitHub/Chroma-App';
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.png':'image/png','.json':'application/json','.cube':'text/plain'};
const server=await new Promise(r=>{const s=createServer(async(rq,rs)=>{try{const p=path.join(ROOT,decodeURIComponent(rq.url.split('?')[0]));const d=await readFile(p);rs.setHeader('Cross-Origin-Opener-Policy','same-origin');rs.setHeader('Cross-Origin-Embedder-Policy','require-corp');rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);}catch{rs.writeHead(404);rs.end();}});s.listen(0,'127.0.0.1',()=>r(s));});
const base=`http://127.0.0.1:${server.address().port}`;
const br=await chromium.launch({args:['--use-gl=swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox','--enable-unsafe-swiftshader']});
const pg=await br.newPage({viewport:{width:1400,height:1000}});
pg.on('pageerror',e=>console.error('[pageerror]',e.message));
pg.on('console',m=>{if(m.type()==='error')console.error('[console.error]',m.text());});
await pg.goto(`${base}/chromasmith-22.html`,{waitUntil:'load'});
await pg.waitForFunction(()=>typeof window.loadFXImages==='function',null,{timeout:30000});
const fx=(await readFile(path.join(ROOT,'test/fixtures/portrait.png'))).toString('base64');
await pg.evaluate(async b64=>{const bin=atob(b64),a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);await window.loadFXImages([new File([a],'portrait.png',{type:'image/png'})]);},fx);
await pg.waitForFunction(()=>typeof fxImages!=='undefined'&&fxImages.length>0,null,{timeout:20000});
await pg.evaluate(()=>{const tg=document.getElementById('tg-adjust');if(tg&&!tg.classList.contains('on'))toggleFX('adjust');});
const res=await pg.evaluate(async()=>{
  const wait=()=>new Promise(r=>setTimeout(r,250));
  const sl=document.getElementById('sl-adj-exp');
  const before=JSON.stringify(getUISnapshot());
  sl.value='60'; sl.dispatchEvent(new Event('input',{bubbles:true})); await wait();
  const afterEdit={value:sl.value, snapEqualsBefore: JSON.stringify(getUISnapshot())===before};
  await window.fxResetAll();
  await wait();
  const beforeObj=JSON.parse(before), afterObj=getUISnapshot();
  const diffKeys=[];
  const walk=(a,b,p)=>{
    if(a===b)return;
    if(typeof a!=='object'||typeof b!=='object'||!a||!b){diffKeys.push(p+': '+JSON.stringify(a)+' -> '+JSON.stringify(b));return;}
    const keys=new Set([...Object.keys(a),...Object.keys(b)]);
    for(const k of keys)walk(a[k],b[k],p?p+'.'+k:k);
  };
  walk(beforeObj,afterObj,'');
  const afterReset={value:sl.value, snapEqualsBefore: JSON.stringify(afterObj)===before, histLen:fxHistory.length, diffKeys};
  return {afterEdit, afterReset};
});
console.log(JSON.stringify(res,null,1));
await br.close(); server.close();
