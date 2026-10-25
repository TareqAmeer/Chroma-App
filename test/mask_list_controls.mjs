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
  await page.waitForFunction(()=>typeof mskSetComposition==='function'&&typeof mskMoreMenu==='function');
  await page.waitForFunction(()=>typeof mskToggleMute==='function'&&typeof mskFixupBar==='function');
  const r=await page.evaluate(async()=>{
    document.querySelector('[data-tour-action="close"]')?.click();document.getElementById('cs-modal-ov')?.remove();
    const make=(id,name,x={})=>({id,name,type:'radial',cx:.5,cy:.5,rx:.3,ry:.3,feather:.5,compositionMigrated:true,crSamples:[],invert:false,lumLo:0,lumHi:1,exp:0,con:0,temp:0,tint:0,sat:0,hue:0,hi:0,sh:0,...x});
    fxState.masks=[make('a','A'),make('b','B',{composeOp:'subtract',operandId:'a'}),make('c','C',{composeOp:'intersect',operandId:'a'}),make('d','D',{isExclude:true})];mskSel=0;
    fxSection('local',true);toggleFX('local');mskRebuild();
    const rows=[...document.querySelectorAll('#local-list > button')];
    const chips=rows.map(b=>b.querySelector('.msk-op-chip')?.dataset.op||'');
    rows[1].querySelector('.msk-li-mute').click();
    const afterMute={muted:fxState.masks[1].muted,sel:mskSel,pressed:document.querySelectorAll('#local-list > button')[1].querySelector('.msk-li-mute').getAttribute('aria-pressed')};
    document.querySelectorAll('#local-list > button')[2].querySelector('.msk-li-solo').click();
    const afterSolo={solo:mskSolo,sel:mskSel};
    const bar=mskFixupBar({type:'radial'});
    return {chips,afterMute,afterSolo,rows:rows.length,barForRadial:bar};
  });
  assert.deepEqual(r.chips,['','subtract','intersect','erase']);
  assert.equal(r.rows,4);
  assert.deepEqual(r.afterMute,{muted:true,sel:0,pressed:'true'});
  assert.deepEqual(r.afterSolo,{solo:2,sel:0});
  assert.equal(r.barForRadial,'');
  const g=await page.evaluate(()=>{
    fxState.masks=[{id:'a',name:'A',type:'radial',cx:.5,cy:.5,rx:.3,ry:.3,feather:.5,compositionMigrated:true,crSamples:[],invert:false,lumLo:0,lumHi:1,exp:0,con:0,temp:0,tint:0,sat:0,hue:0,hi:0,sh:0}];mskSel=0;mskRebuild();
    const tiles=[...document.querySelectorAll('#msk-create-grid .msk-tile')].map(b=>b.dataset.kind);
    const rowBtns=[...document.querySelectorAll('.msk-compose-row button')].map(b=>b.textContent.trim());
    mskComposeMenu({stopPropagation(){},currentTarget:document.querySelector('.msk-compose-row button')},'subtract');
    const hdr=document.querySelector('.msk-more-menu .msk-more-hd')?.textContent;
    mskAdd('radial');
    const n=fxState.masks[1];
    const plain=(mskAdd('radial'),fxState.masks[2]);
    const before=document.querySelector('.msk-more-menu');
    return {tiles,rowBtns,hdr,n:{op:n.composeOp,operand:n.operandId,sub:n.subtract},plainOp:plain.composeOp||'',pending:_mskPendingCompose};
  });
  const rowAct=await page.evaluate(()=>{
    fxState.masks=[{id:'a',name:'A',type:'radial',cx:.5,cy:.5,rx:.3,ry:.3,feather:.5,compositionMigrated:true,crSamples:[],invert:false,lumLo:0,lumHi:1,exp:0,con:0,temp:0,tint:0,sat:0,hue:0,hi:0,sh:0},
      {id:'b',name:'B',type:'radial',cx:.2,cy:.5,rx:.3,ry:.3,feather:.5,compositionMigrated:true,crSamples:[],invert:false,lumLo:0,lumHi:1,exp:0,con:0,temp:0,tint:0,sat:0,hue:0,hi:0,sh:0}];mskSel=1;mskRebuild();
    const rows=[...document.querySelectorAll('#local-list > button')];
    const acts=[...rows[0].querySelectorAll('.msk-li-act')].map(x=>x.title);
    const count=document.getElementById('msk-count').textContent;
    rows[0].querySelectorAll('.msk-li-act')[1].click();
    const hdr=document.querySelector('.msk-more-menu .msk-more-hd')?.textContent;
    mskAdd('radial');
    const n=fxState.masks[2];
    const depth=document.querySelectorAll('#local-list > button')[2].dataset.depth;
    // Button system: Invert lives in exactly one place (the combine row's #btn-msk-invert), not as a 4th mini control on every row.
    mskSel=0;mskRebuild();document.getElementById('btn-msk-invert').click();
    return {acts,count,hdr,sel:mskSel,op:n.composeOp,operand:n.operandId,depth,inv:fxState.masks[0].invert,invPressed:document.getElementById('btn-msk-invert').getAttribute('aria-pressed')};
  });
  assert.deepEqual(rowAct.acts,['Add to','Subtract from','Intersect with']);
  assert.equal(rowAct.count,'2 of '+8+' masks');assert.match(rowAct.hdr,/Subtract from/);
  assert.equal(rowAct.op,'subtract');assert.equal(rowAct.operand,'a');assert.equal(rowAct.depth,'1');assert.equal(rowAct.inv,true);assert.equal(rowAct.invPressed,'true');
  assert.deepEqual(g.tiles,['sky','brush','linear','radial','color','luminance']);
  assert.deepEqual(g.rowBtns,['+ Add','\u2212 Subtract','\u2229 Intersect','Invert']);
  assert.match(g.hdr,/Subtract from/);
  assert.deepEqual(g.n,{op:'subtract',operand:'a',sub:true});
  assert.equal(g.plainOp,'');assert.equal(g.pending,null);
  assert.deepEqual(errors,[]);
  done=true;console.log('PASS mask list chips, inline mute/solo, fix-up gating, create grid, compose-on-create');
}finally{await browser.close();server.close();if(!done)process.exitCode=1;}
