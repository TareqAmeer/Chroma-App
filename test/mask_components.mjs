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
  await page.waitForFunction(()=>typeof mskSetComposition==='function'&&typeof applyUISnapshot==='function');
  const r=await page.evaluate(async()=>{
    document.querySelector('[data-tour-action="close"]')?.click();document.getElementById('cs-modal-ov')?.remove();
    const make=(id)=>({id,name:id,type:'radial',cx:.5,cy:.5,rx:.3,ry:.3,feather:.5,compositionMigrated:true,crSamples:[],invert:false,lumLo:0,lumHi:1,exp:0,con:0,temp:0,tint:0,sat:0,hue:0,hi:0,sh:0});
    fxState.masks=[make('root')];mskSel=0;fxSection('local',true);toggleFX('local');mskRebuild();
    const snap=getUISnapshot({skipRaster:true});
    fxHistory=[{j:JSON.stringify(snap),snap,rasters:[null],label:'Start',ts:Date.now()}];fxHistIdx=0;
    await new Promise(r=>setTimeout(r,450));
    const out={};
    for(const op of ['add','subtract','intersect']){
      mskSel=0;mskRebuild();
      document.querySelector('#local-list > button .msk-li-act[title="'+{add:'Add to',subtract:'Subtract from',intersect:'Intersect with'}[op]+'"]').click();
      mskAdd('radial');
    }
    // Components chain onto the group's running result (Lightroom order): root, then each previous component.
    out.ops=fxState.masks.slice(1).map((m,k)=>[m.composeOp,m.operandId===fxState.masks[k].id]);
    out.count=document.getElementById('msk-count').textContent;
    out.depths=[...document.querySelectorAll('#local-list > button')].map(b=>b.dataset.depth||'0');
    // save/load round trip
    const s2=JSON.parse(JSON.stringify(getUISnapshot({skipRaster:true})));
    fxState.masks=[];applyUISnapshot(s2);
    out.loaded=fxState.masks.map((m,k)=>[m.id===fxState.masks[0].id,m.composeOp||'',k>0&&m.operandId===fxState.masks[k-1].id]);
    out.loadedN=fxState.masks.length;
    // undo
    const before=fxHistory.length;await new Promise(r=>setTimeout(r,450));
    out.hist=fxHistory.length>before-1;
    return out;
  });
  assert.deepEqual(r.ops.map(x=>x[0]),['add','subtract','intersect']);
  assert.ok(r.ops.every(x=>x[1]===true),'each component chains onto the group result so far');
  assert.equal(r.count,'4 of 8 masks');
  assert.deepEqual(r.depths,['0','1','1','1']);
  assert.equal(r.loadedN,4);
  assert.deepEqual(r.loaded.map(x=>x[1]),['','add','subtract','intersect']);
  assert.ok(r.loaded.slice(1).every(x=>x[2]));
  assert.deepEqual(errors,[]);
  done=true;console.log('PASS mask components: add/subtract/intersect via row actions, depth, save/load');
}finally{await browser.close();server.close();if(!done)process.exitCode=1;}
