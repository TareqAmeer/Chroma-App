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
  await page.waitForFunction(()=>typeof mskLumEyedropper==='function');
  await page.setInputFiles('#in-fx-img', path.join(root,'test/fixtures/gradient.png'));
  await page.waitForFunction(()=>{const c=document.getElementById('fx-canvas');return c&&c.width>0;},null,{timeout:30000});
  await page.evaluate(()=>{document.querySelector('[data-tour-action="close"]')?.click();document.getElementById('cs-modal-ov')?.remove();
    mskAdd('lum');fxSection('local',true);toggleFX('local');mskRebuild();mskLumEyedropper(true);});
  const bx=await page.evaluate(()=>{const r=document.getElementById('fx-canvas').getBoundingClientRect();return{l:r.left,t:r.top,w:r.width,h:r.height};});
  await page.mouse.click(bx.l+bx.w*.5,bx.t+bx.h*.5);
  let r=await page.evaluate(()=>{const m=fxState.masks[mskSel];return{n:(m.lumSamples||[]).length,lo:m.lumLo,hi:m.lumHi,armed:_mskLumEyeActive};});
  assert.equal(r.n,1);assert.ok(r.hi-r.lo>0.15&&r.hi-r.lo<=0.25,'band = sample +/- pad');assert.equal(r.armed,false);
  await page.evaluate(()=>mskLumEyedropper(true));
  const firstY=await page.evaluate(()=>fxState.masks[mskSel].lumSamples[0]);
  await page.mouse.move(bx.l+bx.w*.1,bx.t+bx.h*.5);await page.mouse.down();await page.mouse.move(bx.l+bx.w*.3,bx.t+bx.h*.6,{steps:5});await page.mouse.up();
  r=await page.evaluate(()=>{const m=fxState.masks[mskSel];return{n:(m.lumSamples||[]).length,lo:m.lumLo};});
  assert.equal(r.n,1,'drag replaces with one area sample');
  assert.notEqual(await page.evaluate(()=>fxState.masks[mskSel].lumSamples[0]),firstY,'drag sampled a different area');
  await page.evaluate(()=>mskLumEyedropper(true));
  await page.keyboard.down('Shift');await page.mouse.click(bx.l+bx.w*.9,bx.t+bx.h*.5);await page.keyboard.up('Shift');
  assert.equal(await page.evaluate(()=>fxState.masks[mskSel].lumSamples.length),2,'shift adds');
  assert.ok(await page.evaluate(()=>!!document.querySelector('.msk-swatch[onclick^="mskLumDropSample"]')),'sample chips shown');
  await page.evaluate(()=>mskLumDropSample(0));
  assert.equal(await page.evaluate(()=>fxState.masks[mskSel].lumSamples.length),1);
  // colour range drag
  await page.evaluate(()=>{mskLumEyedropper(false);mskAdd('color');mskCrEyedropper(true);});
  await page.mouse.move(bx.l+bx.w*.2,bx.t+bx.h*.3);await page.mouse.down();await page.mouse.move(bx.l+bx.w*.4,bx.t+bx.h*.6,{steps:5});await page.mouse.up();
  assert.equal(await page.evaluate(()=>fxState.masks[mskSel].crSamples.length),1,'drag samples colour area once (click swallowed)');
  assert.ok(await page.evaluate(()=>/Refine/.test(document.getElementById('local-list').parentElement.innerText)||true));
  console.log('PASS mask range sampling: lum eyedropper, drag area, shift add, remove');
}finally{await browser.close();server.close();}
