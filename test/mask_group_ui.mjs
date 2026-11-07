#!/usr/bin/env node
// Browser regression: stacked masks read as a group in the list (rail + count badge) and the root says so.
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
  await page.setInputFiles('#in-fx-img', path.join(root,'test/fixtures/gradient.png'));
  await page.waitForFunction(()=>{const c=document.getElementById('fx-canvas');return c&&c.width>0;},null,{timeout:30000});
  await page.evaluate(()=>{document.querySelector('[data-tour-action="close"]')?.click();document.getElementById('cs-modal-ov')?.remove();
    const make=(id,cx,x)=>Object.assign({id,name:id,type:'radial',cx,cy:.5,rx:.1,ry:.1,feather:.5,compositionMigrated:true,crSamples:[],invert:false,lumLo:0,lumHi:1,exp:0,con:0,temp:0,tint:0,sat:0,hue:0,hi:0,sh:0},x||{});
    fxState.masks=[make('root',.25,{exp:.5}),make('c1',.5,{composeOp:'add',operandId:'root'}),make('solo',.8)];mskSel=0;fxSection('local',true);toggleFX('local');mskRebuild();});
  await page.waitForTimeout(500);
  const r=await page.evaluate(()=>({rows:[...document.querySelectorAll('#local-list>button')].map(b=>({gr:b.dataset.gr,tag:b.querySelector('.msk-grp-tag')?.textContent||''})),note:document.querySelector('.msk-edit-note')?.textContent||''}));
  assert.deepEqual(r.rows.map(x=>x.gr),['0','0',undefined],'root and component share a group, loose mask has none');
  assert.equal(r.rows[0].tag,'Group \u00b7 2');assert.equal(r.rows[1].tag,'');
  assert.match(r.note,/Group of 2 shapes/);
  console.log('PASS mask group rail, badge and note');
}finally{await browser.close();server.close();}
