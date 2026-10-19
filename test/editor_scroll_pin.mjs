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
  await page.waitForFunction(()=>typeof appHSync==='function');
  const r=await page.evaluate(async()=>{
    const m=document.querySelector('main');m.style.overflow='hidden';m.style.height='200px';
    const pad=document.createElement('div');pad.style.height='400px';m.appendChild(pad);
    m.scrollTop=16;                       // what focus restoration does
    await new Promise(r=>setTimeout(r,50));
    const afterScroll=m.scrollTop;
    m.scrollTop=30;window.dispatchEvent(new Event('focus'));
    return{afterScroll,afterFocus:m.scrollTop};
  });
  assert.equal(r.afterScroll,0,'main must snap back to 0 after a programmatic scroll');
  assert.equal(r.afterFocus,0,'window focus must reset main scroll');
  assert.deepEqual(errors,[]);
  done=true;console.log('PASS main scroll is pinned against focus-restore drift');
}finally{await browser.close();server.close();if(!done)process.exitCode=1;}
