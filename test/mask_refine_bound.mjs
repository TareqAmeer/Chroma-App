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
  await page.waitForFunction(()=>typeof _samRefineMask==='function'&&typeof _samDilateBinary==='function');
  const r=await page.evaluate(async()=>{
    // Photo: left 60 px bright grey "subject", right side the SAME grey (a look-alike background). Mask = left 60 px only.
    const W=200,H=60,cv=document.createElement('canvas');cv.width=W;cv.height=H;const c=cv.getContext('2d');
    c.fillStyle='#777';c.fillRect(0,0,W,H);c.fillStyle='#202020';c.fillRect(60,0,10,H);
    const img=new Image();img.src=cv.toDataURL();await img.decode();
    window.curItem=()=>({img,path:'/x.png'});
    const mask=new Uint8ClampedArray(W*H);for(let y=0;y<H;y++)for(let x=0;x<60;x++)mask[y*W+x]=255;
    const out=_samRefineMask(mask,W,H);
    let far=0,farMax=0,inside=0;for(let y=0;y<H;y++)for(let x=0;x<W;x++){const v=out[y*W+x];if(x>=60+14){far+=v>0?1:0;farMax=Math.max(farMax,v);}if(x<40)inside+=v>240?1:0;}
    const dil=_samDilateBinary(mask,W,H,12);
    return{far,farMax,inside,insideExpected:40*H,d11:dil[30*W+71],d13:dil[30*W+73]};
  });
  assert.equal(r.far,0,'no selection weight may leak beyond the dilated band');
  assert.ok(r.inside>=r.insideExpected*0.95,'the subject interior stays selected');
  assert.equal(r.d11,1);assert.equal(r.d13,0);
  assert.deepEqual(errors,[]);
  done=true;console.log('PASS guided-filter refine bounded to a band around the mask');
}finally{await browser.close();server.close();if(!done)process.exitCode=1;}
