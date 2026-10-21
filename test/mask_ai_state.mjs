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
  await page.waitForFunction(()=>typeof mskAiUpdate==='function');
  await page.setInputFiles('#in-fx-img', path.join(root,'test/fixtures/gradient.png'));
  await page.waitForFunction(()=>{const c=document.getElementById('fx-canvas');return c&&c.width>0;},null,{timeout:30000});
  const r=await page.evaluate(async()=>{
    document.querySelector('[data-tour-action="close"]')?.click();document.getElementById('cs-modal-ov')?.remove();
    window.__TAURI__=window.__TAURI__||{};
    const make=(id,x)=>({id,name:id,type:'brush',origin:'ai',ai:true,aiPoints:[{nx:.5,ny:.5,positive:true}],px:new Uint8ClampedArray(16).fill(255),mtW:4,mtH:4,feather:.5,compositionMigrated:true,crSamples:[],invert:false,lumLo:0,lumHi:1,exp:0,con:0,temp:0,tint:0,sat:0,hue:0,hi:0,sh:0,...x});
    fxState.masks=[make('a',{}),make('b',{aiState:'stale'}),make('c',{aiState:'failed',aiStateMsg:'boom'}),{id:'r',name:'r',type:'radial',cx:.5,cy:.5,rx:.3,ry:.3,feather:.5,compositionMigrated:true,crSamples:[],invert:false,lumLo:0,lumHi:1,exp:0,con:0,temp:0,tint:0,sat:0,hue:0,hi:0,sh:0}];
    mskSel=3;fxSection('local',true);toggleFX('local');mskRebuild();
    const rows=[...document.querySelectorAll('#local-list > button')];
    const dots=rows.map(b=>b.querySelector('.msk-ai-dot')?.className.replace('msk-ai-dot ','')||'');
    const upd=rows.map(b=>!!b.querySelector('.msk-ai-update'));
    const all=document.getElementById('msk-update-all').style.display;
    // Update: success then failure (stub the re-evaluator)
    window.__ok=true;const orig=_mskPortableReevaluate;
    _mskPortableReevaluate=async()=>window.__ok?{ok:true}:{ok:false,error:'nope'};
    const okRes=await mskAiUpdate(1);const afterOk=fxState.masks[1].aiState||'';
    window.__ok=false;const failRes=await mskAiUpdate(0);const afterFail=[fxState.masks[0].aiState,fxState.masks[0].px.length>0];
    await mskAiUpdateAll();
    const allDone=fxState.masks.map(m=>m.aiState||'');
    _mskPortableReevaluate=orig;
    // paste marks stale
    const pasted=pasteEditSelectiveApply({masks:[]},{masks:[{origin:'ai',ai:true},{type:'radial'}]},['masks']).masks.map(m=>m.aiState||'');
    return{dots,upd,all,okRes,afterOk,failRes,afterFail,allDone,pasted};
  });
  assert.deepEqual(r.dots,['ready','stale','failed','']);
  assert.deepEqual(r.upd,[false,true,true,false]);
  assert.equal(r.all,'');
  assert.equal(r.okRes,true);assert.equal(r.afterOk,'');
  assert.equal(r.failRes,false);assert.deepEqual(r.afterFail,['failed',true],'failed update keeps old pixels');
  assert.deepEqual(r.allDone,['failed','','failed',''],'update-all retried stale/failed masks (stub fails)');
  assert.deepEqual(r.pasted,['stale','']);
  console.log('PASS mask AI state: dots, Update, Update all, paste marks stale');
}finally{await browser.close();server.close();}
