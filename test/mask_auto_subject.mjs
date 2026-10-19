#!/usr/bin/env node
// Browser regression for accessible composition choice, fail-closed cycle checks, repair and undo.
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mime={'.html':'text/html','.js':'text/javascript','.png':'image/png'};
const server=createServer(async(req,res)=>{
  try{
    const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname));
    if(!file.startsWith(root)){res.writeHead(403).end();return;}
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));
  }catch{res.writeHead(404).end('not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({
  ...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),
  args:['--use-gl=swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader'],
});
let done=false;
try{
  const page=await browser.newPage({viewport:{width:1000,height:760}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`,{waitUntil:'load'});
  await page.waitForFunction(()=>typeof mskAddSubjectMatte==='function');
  const r=await page.evaluate(async()=>{
    document.querySelector('[data-tour-action="close"]')?.click();document.getElementById('cs-modal-ov')?.remove();
    const cv=document.createElement('canvas');cv.width=120;cv.height=80;const c=cv.getContext('2d');c.fillStyle='#888';c.fillRect(0,0,120,80);
    const img=new Image();img.src=cv.toDataURL();await img.decode();
    window.curItem=()=>({img,path:'/x.png'});
    const calls=[];
    window.__TAURI__={core:{invoke:async(cmd,arg)=>{
      calls.push(cmd);
      if(cmd==='matte_models')return ['modnet'];
      if(cmd==='matte_run'){
        const dv=new DataView(arg.buffer),hl=dv.getUint32(0,true),hd=JSON.parse(new TextDecoder().decode(arg.slice(4,4+hl)));
        const out=new Uint8Array(hd.width*hd.height);for(let y=0;y<hd.height;y++)for(let x=0;x<hd.width;x++)out[y*hd.width+x]=x<hd.width/2?255:0;
        const hdr=new TextEncoder().encode(JSON.stringify({width:hd.width,height:hd.height,model:hd.model}));
        const b=new Uint8Array(4+hdr.length+out.length);new DataView(b.buffer).setUint32(0,hdr.length,true);b.set(hdr,4);b.set(out,4+hdr.length);return b.buffer;
      }
      return null;}}};
    fxState.masks=[];mskSel=0;fxSection('local',true);toggleFX('local');
    const m=await mskAddSubjectMatte();
    const tiles=(mskRebuild(),[...document.querySelectorAll('#msk-create-grid .msk-tile')].map(b=>b.dataset.kind));
    return {ok:!!m,name:m&&m.name,origin:m&&m.origin,ai:m&&mskIsAI(m),w:m&&m.mtW,h:m&&m.mtH,left:m&&m.px[0],right:m&&m.px[m.mtW-1],refinable:m&&mskRefinementSupported(m),count:fxState.masks.length,calls,tiles};
  });
  assert.equal(r.ok,true);assert.equal(r.name,'Auto Subject');assert.equal(r.origin,'ai');assert.equal(r.ai,true);
  assert.equal(r.left,255);assert.equal(r.right,0);assert.equal(r.refinable,true);assert.equal(r.count,1);
  assert.deepEqual(r.calls.filter(c=>c.startsWith('matte')),['matte_models','matte_run']);
  assert.ok(r.tiles.includes('auto subject'));
  assert.deepEqual(errors,[]);
  done=true;console.log('PASS Auto Subject: matte_run result installed as a refinable AI raster mask');
}finally{await browser.close();server.close();if(!done)process.exitCode=1;}
