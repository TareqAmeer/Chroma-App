// Verifies slider ergonomics: numeric entry, arrow nudge, Home/End, dbl-click reset, mod dots.
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
await pg.waitForFunction(()=>typeof window.initSliderErgonomics==='function'||typeof initSliderErgonomics==='function',null,{timeout:30000});
const fx=(await readFile(path.join(ROOT,'test/fixtures/portrait.png'))).toString('base64');
await pg.evaluate(async b64=>{const bin=atob(b64),a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);await window.loadFXImages([new File([a],'portrait.png',{type:'image/png'})]);},fx);
await pg.waitForFunction(()=>typeof fxImages!=='undefined'&&fxImages.length>0,null,{timeout:20000});
// Ensure Basic Adjustments is on so the row is visible
await pg.evaluate(()=>{const tg=document.getElementById('tg-adjust');if(tg&&!tg.classList.contains('on'))toggleFX('adjust');});
const res=await pg.evaluate(async()=>{
  const out={};
  const sl=document.getElementById('sl-adj-exp');
  const row=sl.closest('.fx-row'), val=row.querySelector('.fx-val');
  const wait=()=>new Promise(r=>setTimeout(r,220));
  sl.value='0'; sl.dispatchEvent(new Event('input',{bubbles:true})); await wait();
  out.start={value:sl.value, mod:row.classList.contains('fx-mod')};
  // Arrow nudge
  sl.focus();
  sl.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  out.afterArrow={value:sl.value};
  sl.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true}));
  out.afterShiftArrow={value:sl.value};
  await wait();
  out.modAfterNudge=row.classList.contains('fx-mod');
  // Home / End
  sl.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));
  out.afterEnd={value:sl.value,max:sl.max};
  sl.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
  out.afterHome={value:sl.value,min:sl.min};
  // Numeric entry: simulate the click->edit->blur cycle
  val.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  out.editable=val.isContentEditable;
  val.textContent='37';
  val.dispatchEvent(new FocusEvent('blur',{bubbles:true}));
  out.afterTyped={value:sl.value};
  // Out-of-range typed value must clamp, not corrupt
  val.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  val.textContent='99999';
  val.dispatchEvent(new FocusEvent('blur',{bubbles:true}));
  out.afterTypedHuge={value:sl.value,max:sl.max};
  // Garbage typed value must leave it alone
  val.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  val.textContent='abc';
  val.dispatchEvent(new FocusEvent('blur',{bubbles:true}));
  out.afterTypedGarbage={value:sl.value};
  // Double-click resets to factory default
  sl.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  await wait();
  out.afterDblClick={value:sl.value, mod:row.classList.contains('fx-mod')};
  return out;
});
console.log(JSON.stringify(res,null,1));
await br.close(); server.close();
