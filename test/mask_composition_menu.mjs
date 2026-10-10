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
  await page.evaluate(()=>{
    const skip=document.querySelector('[data-tour-action="close"]');skip?.click();
    document.getElementById('cs-modal-ov')?.remove();
    const make=(id,name)=>({id,name,type:'radial',cx:.5,cy:.5,rx:.3,ry:.3,feather:.5,
      compositionMigrated:true,crSamples:[],invert:false,lumLo:0,lumHi:1,exp:0,con:0,temp:0,tint:0,sat:0,hue:0,hi:0,sh:0});
    fxState.masks=[make('mask-a','Sky <A>'),make('mask-b','Brush'),make('mask-c','Subject')];mskSel=2;
    fxSection('local',true);toggleFX('local');mskRebuild();
    const snap=getUISnapshot({skipRaster:true}),rasters=fxState.masks.map(m=>m.px||null);
    fxHistory=[{j:JSON.stringify(snap),snap,rasters,label:'Start',ts:Date.now()}];fxHistIdx=0;fxSyncTopbarDisabled();
    document.querySelector('.msk-more').click();
    document.querySelector('.msk-more-menu .msk-more-it[aria-haspopup="dialog"]').click();
    window.__composeAutofocused=document.activeElement===document.querySelector('#msk-compose-operation');
  });
  await mkdir(path.join(path.dirname(fileURLToPath(import.meta.url)),'output'),{recursive:true});
  await page.locator('.msk-compose-menu').screenshot({path:path.join(path.dirname(fileURLToPath(import.meta.url)),'output','mask-composition-chooser.png')});
  await page.screenshot({path:path.join(path.dirname(fileURLToPath(import.meta.url)),'output','mask-composition-chooser-full.png')});
  const checks=await page.evaluate(async()=>{
    const out=[];const ck=(name,pass,detail='')=>{out.push({name,pass:!!pass,detail});if(!pass)throw Error(`${name}: ${detail}`);};
    const open=()=>{document.querySelector('.msk-more')?.click();document.querySelector('.msk-more-menu .msk-more-it[aria-haspopup="dialog"]')?.click();};
    const dialog=document.querySelector('.msk-compose-menu');
    ck('chooser is an accessible dialog with labeled native controls',!!dialog&&dialog.getAttribute('role')==='dialog'
      &&dialog.querySelector('label[for="msk-compose-operation"]')&&dialog.querySelector('label[for="msk-compose-operand"]'));
    ck('chooser exposes other masks by stable ID',Array.from(dialog.querySelector('#msk-compose-operand').options).map(o=>o.value).join(',')==='mask-a,mask-b');
    ck('mask names are text rather than interpreted markup',dialog.querySelector('#msk-compose-operand option').textContent.includes('Sky <A>'));
    ck('operation picker receives keyboard focus',window.__composeAutofocused);
    ck('opening preserves the top of the chooser content',dialog.scrollTop===0);
    if(_mskCompositionMenuClose)_mskCompositionMenuClose(false);
    open();
    await new Promise(resolve=>setTimeout(resolve,0));
    const reopened=document.querySelector('.msk-compose-menu');
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    ck('Escape closes the current reopened chooser',!!reopened&&!reopened.isConnected&&!_mskCompositionMenuClose);
    ck('Escape returns focus to the persistent mask menu button',document.activeElement===document.querySelector('#local-ctl .msk-more'),
      `active=${document.activeElement?.className}; trigger=${document.querySelector('#local-ctl .msk-more')?.className}`);
    open();
    ck('chooser reopens after Escape without a stale listener',!!document.querySelector('.msk-compose-menu')&&!!_mskCompositionMenuClose);
    const reopenedMenu=document.querySelector('.msk-compose-menu');
    _mskCompositionMenuClose(false);
    const fresh=document.querySelector('.msk-more');
    // Restore the ordinary initial dialog for the Add/undo path below.
    fresh.click();document.querySelector('.msk-more-menu .msk-more-it[aria-haspopup="dialog"]').click();
    const actualDialog=document.querySelector('.msk-compose-menu');
    ck('reopening replaces the prior dialog instance',!!actualDialog&&actualDialog!==reopenedMenu);
    const op=actualDialog.querySelector('#msk-compose-operation'),operand=actualDialog.querySelector('#msk-compose-operand');
    op.value='add';operand.value='mask-a';operand.dispatchEvent(new Event('change',{bubbles:true}));
    actualDialog.querySelector('.msk-compose-apply').click();
    ck('arbitrary Add uses the chosen stable operand',fxState.masks[2].composeOp==='add'&&fxState.masks[2].operandId==='mask-a');
    ck('successful composition is one undo step',fxHistIdx===1&&fxHistory.length===2);
    await fxUndo();
    ck('Undo restores the uncomposed mask',!fxState.masks[2].composeOp&&!fxState.masks[2].operandId);

    fxState.masks[0].composeOp='subtract';fxState.masks[0].operandId='mask-c';fxState.masks[0].compositionMigrated=true;
    mskSel=2;mskRebuild();const cycleBefore=JSON.stringify(fxState.masks.map(m=>[m.composeOp,m.operandId]));open();
    let current=document.querySelector('.msk-compose-menu');
    current.querySelector('#msk-compose-operation').value='intersect';
    current.querySelector('#msk-compose-operand').value='mask-a';
    current.querySelector('#msk-compose-operand').dispatchEvent(new Event('change',{bubbles:true}));
    ck('cycle is explained and Apply is disabled',current.querySelector('.msk-compose-status').textContent.includes('cycle')
      &&current.querySelector('.msk-compose-apply').disabled);
    ck('cycle refusal leaves live composition unchanged',JSON.stringify(fxState.masks.map(m=>[m.composeOp,m.operandId]))===cycleBefore);
    current.remove();if(_mskCompositionMenuClose)_mskCompositionMenuClose(false);

    fxState.masks[2].composeOp='subtract';fxState.masks[2].operandId='deleted-id';fxState.masks[2].compositionMigrated=true;
    mskRebuild();open();current=document.querySelector('.msk-compose-menu');
    ck('broken composition provides an explicit repair prompt',current.querySelector('[role=alert]')?.textContent.includes('disabled'));
    current.querySelector('#msk-compose-operation').value='intersect';
    current.querySelector('#msk-compose-operand').value='mask-b';
    current.querySelector('#msk-compose-operand').dispatchEvent(new Event('change',{bubbles:true}));
    current.querySelector('.msk-compose-apply').click();
    ck('repair stores the selected replacement ID',fxState.masks[2].composeOp==='intersect'&&fxState.masks[2].operandId==='mask-b');

    // A dialog that outlives a mask selection cannot apply its stored choice to the new row.
    open();current=document.querySelector('.msk-compose-menu');
    const prior=fxState.masks[1].composeOp||'';mskSel=1;
    current.querySelector('.msk-compose-apply').click();
    ck('stale chooser disables Apply after selection changes',current.querySelector('.msk-compose-apply').disabled
      &&current.querySelector('.msk-compose-status').textContent.includes('changed'));
    ck('stale chooser does not edit the newly selected mask',(fxState.masks[1].composeOp||'')===prior);
    return out;
  });
  assert.deepEqual(errors,[],`browser console errors: ${errors.join('; ')}`);
  console.log(`mask composition chooser: ${checks.length} checks PASS`);
  checks.forEach(x=>console.log(`  PASS ${x.name}${x.detail?` — ${x.detail}`:''}`));
  done=true;
}finally{
  await browser.close();await new Promise(resolve=>server.close(resolve));
  if(!done)process.exitCode=1;
}
