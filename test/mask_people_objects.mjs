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
  await page.waitForFunction(()=>typeof mskPersonCreate==='function');
  await page.setInputFiles('#in-fx-img', path.join(root,'test/fixtures/gradient.png'));
  await page.waitForFunction(()=>{const c=document.getElementById('fx-canvas');return c&&c.width>0;},null,{timeout:30000});
  const r=await page.evaluate(async()=>{
    document.querySelector('[data-tour-action="close"]')?.click();document.getElementById('cs-modal-ov')?.remove();
    window.__TAURI__=window.__TAURI__||{};
    fxSection('local',true);toggleFX('local');
    const it=curItem();
    Object.defineProperty(it,'_scene',{value:{state:'done',list:[{id:'person0',label:'Person 1',kind:'person',box:{x0:.2,y0:.1,x1:.8,y1:.9}},{id:'dog0',label:'Dog',kind:'dog',box:{x0:.1,y0:.5,x1:.3,y1:.9}}],masks:{}},writable:true,configurable:true});
    samRunPoints=async m=>{m.px=new Uint8ClampedArray(64).fill(255);m.mtW=8;m.mtH=8;return{ok:true};};
    _faceparseRunLayers=async()=>({mtW:8,mtH:8,cropX0:0,cropY0:0,cropSize:4,layers:[0,1,2,3,4].map(()=>new Uint8Array(16).fill(255))});
    samEnsureEncoded=()=>{};
    const out={};
    mskSceneRender();
    const el=document.getElementById('msk-people');
    out.people=[...el.querySelectorAll('.msk-person b')].map(b=>b.textContent);
    out.partLabels=[...el.querySelectorAll('.msk-person label')].map(l=>l.textContent.trim());out.sepLabel=el.querySelector('.msk-people-sep').textContent.trim();
    // separate, whole kept
    fxState.masks=[];mskPeopleToggle('person0','skin',true);mskPeopleToggle('person0','lips',true);
    await mskPersonCreate('person0');
    out.sep=fxState.masks.map(m=>m.name);
    // union, no whole
    fxState.masks=[];_mskPeople.sel.person0={whole:false,skin:true,hair:true};mskPeopleSeparate(false);
    await mskPersonCreate('person0');
    out.union=fxState.masks.map(m=>m.name);
    // objects tool arms the rectangle prompt
    fxState.masks=[];mskAiPromptMode='scribble';mskAddObjects();
    out.obj={n:fxState.masks.length,mode:mskAiPromptMode,tap:mskAiTapMode};
    return out;
  });
  assert.deepEqual(r.people,['Person 1']);
  assert.deepEqual(r.partLabels,['Whole person','Face skin','Eyes & brows','Lips','Hair','Glasses']);
  assert.equal(r.sepLabel,'Create separate masks');
  assert.deepEqual(r.sep,['Person 1','Face skin \u00b7 Person 1','Lips \u00b7 Person 1']);
  assert.deepEqual(r.union,['Person 1 \u00b7 Face skin, Hair']);
  assert.deepEqual(r.obj,{n:1,mode:'scribble',tap:true}); // Objects opens on Scribble like Lightroom (docs/plans/mask-tool-fixes.md Phase 1)
  console.log('PASS people panel + objects tool');
}finally{await browser.close();server.close();}
