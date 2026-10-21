#!/usr/bin/env node
// Browser regression: clicking a mask's covered area on the photo selects that mask.
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
  await page.waitForFunction(()=>typeof mskHitTest==='function');
  const r=await page.evaluate(()=>{
    const make=(id,x)=>({id,name:id,type:'radial',cx:.5,cy:.5,rx:.1,ry:.1,feather:.5,compositionMigrated:true,crSamples:[],invert:false,lumLo:0,lumHi:1,exp:0,con:0,temp:0,tint:0,sat:0,hue:0,hi:0,sh:0,...x});
    fxState.masks=[make('a',{cx:.2,cy:.2}),make('b',{cx:.8,cy:.8})];
    return[mskHitTest(.2,.2),mskHitTest(.8,.8),mskHitTest(.5,.5)];
  });
  assert.deepEqual(r,[0,1,-1]);
  const a=await page.evaluate(()=>{mskSel=0;mskPhotoClick({target:document.body,clientX:0,clientY:0});return mskSel;});
  assert.equal(a,0);
  await page.setInputFiles('#in-fx-img', path.join(root,'test/fixtures/gradient.png'));
  await page.waitForFunction(()=>{const c=document.getElementById('fx-canvas');return c&&c.width>0;},null,{timeout:30000});
  await page.evaluate(()=>{document.querySelector('[data-tour-action="close"]')?.click();document.getElementById('cs-modal-ov')?.remove();
    const make=(id,x)=>({id,name:id,type:'radial',cx:.5,cy:.5,rx:.1,ry:.1,feather:.5,compositionMigrated:true,crSamples:[],invert:false,lumLo:0,lumHi:1,exp:0,con:0,temp:0,tint:0,sat:0,hue:0,hi:0,sh:0,...x});
    fxState.masks=[make('a',{cx:.25,cy:.5}),make('b',{cx:.75,cy:.5})];mskSel=0;fxSection('local',true);toggleFX('local');mskRebuild();});
  const bx=await page.evaluate(()=>{const r=document.getElementById('fx-canvas').getBoundingClientRect();return{l:r.left,t:r.top,w:r.width,h:r.height};});
  await page.mouse.click(bx.l+bx.w*.75,bx.t+bx.h*.5);
  assert.equal(await page.evaluate(()=>mskSel),1,'photo click selects mask b');
  console.log('PASS mask photo click hit-test');
}finally{await browser.close();server.close();}
