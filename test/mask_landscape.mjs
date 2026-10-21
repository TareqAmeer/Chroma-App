#!/usr/bin/env node
// Browser regression: Landscape create tile + category chips + mask from a (stubbed) landscape_run.
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mime={'.html':'text/html','.js':'text/javascript','.png':'image/png'};
const server=createServer(async(req,res)=>{try{const f=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname));
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  res.setHeader('Content-Type',mime[path.extname(f)]||'application/octet-stream');res.end(await readFile(f));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:['--use-gl=swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1300,height:800}});
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`,{waitUntil:'load'});
  await page.waitForFunction(()=>typeof mskPersonCreate==='function');
  await page.setInputFiles('#in-fx-img', path.join(root,'test/fixtures/gradient.png'));
  await page.waitForFunction(()=>{const c=document.getElementById('fx-canvas');return c&&c.width>0;},null,{timeout:30000});
  const r=await page.evaluate(async()=>{
    document.querySelector('[data-tour-action="close"]')?.click();document.getElementById('cs-modal-ov')?.remove();
    fxSection('local',true);toggleFX('local');
    const out={};
    out.tileBefore=!!document.querySelector('.msk-tile[data-kind="landscape"]');
    const{w,h}=samInputDims();
    window.__TAURI__={};
    _samFramedInvoke=async(cmd)=>{
      const hdr=new TextEncoder().encode(JSON.stringify({width:w,height:h,groups:['sky','water','vegetation','mountains','buildings','ground']}));
      const b=new Uint8Array(4+hdr.length+6*w*h);new DataView(b.buffer).setUint32(0,hdr.length,true);b.set(hdr,4);
      b.fill(255,4+hdr.length,4+hdr.length+w*h); // sky = everything
      return b.buffer;};
    _mskLandscapeAvail=true;mskCreateGridSync();
    
    out.tileAfter=!!document.querySelector('.msk-tile[data-kind="landscape"]');
    out.chips=[...document.querySelectorAll('#msk-landscape-row button')].map(b=>b.textContent);
    fxState.masks=[];
    const m=await Promise.race([mskAddLandscape('sky'),new Promise(r=>setTimeout(()=>r('TIMEOUT'),8000))]);
    out.name=m&&m.name;out.cov=m?m.px.filter(v=>v>127).length/m.px.length:-1;
    const m2=await Promise.race([mskAddLandscape('water'),new Promise(r=>setTimeout(()=>r(null),8000))]);
    out.waterCov=m2?m2.px.filter(v=>v>127).length/m2.px.length:-1;
    return out;
  });
  console.log(JSON.stringify(r));
  assert.equal(r.tileBefore,false);assert.equal(r.tileAfter,true);
  assert.deepEqual(r.chips,['Sky','Water','Vegetation','Mountains','Buildings','Ground']);
  assert.equal(r.name,'Sky (Landscape)');assert.equal(r.cov,1);assert.equal(r.waterCov,0);
  console.log('mask_landscape: ok');
}finally{await browser.close();server.close();}
