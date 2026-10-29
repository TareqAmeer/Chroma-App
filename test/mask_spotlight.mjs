#!/usr/bin/env node
// Browser regression: Lightroom-style brush spotlight overlay (preview-only DOM layer).
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mime={'.html':'text/html','.js':'text/javascript','.png':'image/png'};
const server=createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname));
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:['--use-gl=swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1200,height:800}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`,{waitUntil:'load'});
  page.on('console',m=>m.type()==='error'&&console.log('console:',m.text()));
  await page.waitForFunction(()=>typeof mskSpotlightUpdate==='function'&&typeof mskBrushNudge==='function',null,{timeout:15000}).catch(e=>{console.log(errors);throw e;});
  const r=await page.evaluate(()=>{
    document.querySelector('[data-tour-action="close"]')?.click();document.getElementById('cs-modal-ov')?.remove();
    const out={};const sp=document.getElementById('msk-spotlight'),cur=document.getElementById('msk-brush-cursor');
    out.exists=!!sp&&!!cur;
    out.pref=mskSpotlight;
    // stub box so no photo is needed
    window.mskOverlayBox=()=>({left:10,top:20,width:400,height:300});
    {const wr=document.getElementById('fx-wrap').getBoundingClientRect();window.fxPhotoClientRect=()=>({left:wr.left+10,top:wr.top+20,width:400,height:300});}  // photo screen rect, #fx-wrap-relative 10,20
    mskBrushSize=40;mskBrushFeather=50;
    // overlay on: no spotlight, it would grey out the strokes already painted
    mskPreviewMode='select';mskSpotlightUpdate(210,170,100);out.withOverlay=sp.classList.contains('on');
    mskPreviewMode='off';
    mskSpotlightUpdate(210,170,100);
    out.on=sp.classList.contains('on');
    out.ro=sp.style.getPropertyValue('--ro');out.ri=sp.style.getPropertyValue('--ri');
    out.sx=sp.style.getPropertyValue('--sx');
    out.filter=getComputedStyle(sp).backdropFilter||getComputedStyle(sp).webkitBackdropFilter;
    out.pe=getComputedStyle(sp).pointerEvents;
    mskSpotlightToggle(false);out.offHidden=!sp.classList.contains('on');out.stored=localStorage.getItem('chromasmith_msk_spotlight');
    mskSpotlightToggle(true);
    mskSpotlightUpdate(210,170,100);mskSpotlightHide();out.hidden=!sp.classList.contains('on');
    out.dotR=mskScribbleDotR();
    return out;
  });
  assert.ok(r.exists);assert.equal(r.on,true);assert.equal(r.withOverlay,false);
  assert.equal(r.ro,'100px');assert.equal(r.ri,'50px');assert.equal(r.sx,'200px');
  assert.match(r.filter,/grayscale/);assert.equal(r.pe,'none');
  assert.equal(r.offHidden,true);assert.equal(r.stored,'0');assert.equal(r.hidden,true);
  assert.equal(r.dotR,'0.1000');
  assert.deepEqual(errors,[]);
  console.log('mask_spotlight: PASS');
}finally{await browser.close();server.close();}
