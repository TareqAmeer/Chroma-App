#!/usr/bin/env node
// Browser regression for docs/plans/mask-accuracy-pass.md: Detected chips (all COCO groups, states, keyboard,
// preview reuse, LRU), one-click Background, Auto Subject model choice + naming, Foreground from depth, and a
// completeness scan: every create-grid tile and Detected chip seen in the DOM must have a case here.
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mime={'.html':'text/html','.js':'text/javascript','.png':'image/png'};
const server=createServer(async(req,res)=>{try{const f=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname));
  res.setHeader('Content-Type',mime[path.extname(f)]||'application/octet-stream');res.end(await readFile(f));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:['--use-gl=swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1300,height:800}});
  const errs=[];page.on('pageerror',e=>errs.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`,{waitUntil:'load'});
  await page.waitForFunction(()=>typeof mskSceneEnsure==='function');
  await page.setInputFiles('#in-fx-img', path.join(root,'test/fixtures/gradient.png'));
  await page.waitForFunction(()=>{const c=document.getElementById('fx-canvas');return c&&c.width>0;},null,{timeout:30000});
  const r=await page.evaluate(async()=>{
    document.querySelector('[data-tour-action="close"]')?.click();document.getElementById('cs-modal-ov')?.remove();
    const out={calls:{}};const bump=c=>out.calls[c]=(out.calls[c]||0)+1;
    const{w,h}=samInputDims();
    const frame=(hdr,body)=>{const e=new TextEncoder().encode(JSON.stringify(hdr)),b=new Uint8Array(4+e.length+body.length);new DataView(b.buffer).setUint32(0,e.length,true);b.set(e,4);b.set(body,4+e.length);return b.buffer;};
    // subject = centre square; depth: near (220) in the bottom half, far (40) top
    const subj=new Uint8Array(w*h);for(let y=(h*.3)|0;y<h*.7;y++)for(let x=(w*.3)|0;x<w*.7;x++)subj[y*w+x]=255;
    let failDetect=true;
    window.__TAURI__={core:{invoke:async(cmd,a)=>{bump(cmd);
      if(cmd==='matte_models')return['modnet','isnet'];
      if(cmd==='landscape_available')return false;
      if(cmd==='sam_box'||cmd==='sam2_box')return frame({width:w,height:h},subj);
      throw new Error('unexpected '+cmd);}}};
    _samFramedInvoke=async(cmd,hdr)=>{bump(cmd);
      if(cmd==='scene_detect'){if(failDetect)throw new Error('boom');return[
        {label:'dog',score:.9,x0:.3,y0:.3,x1:.7,y1:.7},{label:'cat',score:.6,x0:.31,y0:.31,x1:.69,y1:.69},
        {label:'person',score:.8,x0:.05,y0:.1,x1:.2,y1:.9},{label:'bench',score:.7,x0:0,y0:.6,x1:1,y1:.8},
        {label:'potted plant',score:.6,x0:.8,y0:.1,x1:.95,y1:.4},{label:'cup',score:.9,x0:.5,y0:.5,x1:.51,y1:.51}];}
      if(cmd==='matte_run'){out.matteModel=hdr.model;return frame({width:w,height:h},subj);}
      if(cmd==='depth_run'){const b=new Uint8Array(hdr.width*hdr.height);for(let i=0;i<b.length;i++)b[i]=((i/hdr.width)|0)>hdr.height/2?220:40;return frame({width:hdr.width,height:hdr.height},b);}
      throw new Error('unexpected framed '+cmd);};
    samEnsureEncoded=async()=>{_samToken='e';_sam2Token='s2';};
    fxSection('local',true);toggleFX('local');
    const it=curItem();
    // 1. failure shows Retry, retry recovers
    await mskSceneEnsure();
    const el=document.getElementById('msk-scene');
    out.errUi=!!el.querySelector('[data-retry]');
    failDetect=false;el.querySelector('[data-retry]').click();
    for(let i=0;i<50&&_mskSceneOf(it).state!=='done';i++)await new Promise(r=>setTimeout(r,50));
    _mskSceneRenderChips();
    out.groups=[...el.querySelectorAll('.msk-scene-grp')].map(g=>g.getAttribute('aria-label')+':'+[...g.querySelectorAll('.msk-chip')].map(b=>b.textContent).join('|'));
    out.chipIds=[...el.querySelectorAll('.msk-chip')].map(b=>b.dataset.id);
    // 2. keyboard: ArrowRight moves focus
    const chips=[...el.querySelectorAll('.msk-chip')];chips[0].focus();chips[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    out.focusMoved=document.activeElement===chips[1];
    await new Promise(r=>setTimeout(r,400));mskScenePreviewClear();
    // 3. preview then click reuses the raster (one sam2_box call total), and people/animals get the matte edge + upsample
    out.calls.sam2_box=0;
    await mskScenePreview('dog0');await mskSceneAdd('dog0');
    const dog=fxState.masks[fxState.masks.length-1];
    out.dog={name:dog.name,edge:dog.aiEdge,w:dog.mtW,h:dog.mtH,boxCalls:out.calls.sam2_box,tex:mskTexDims()};
    out.dogMatte=out.matteModel;
    // 4. LRU of previews stays bounded
    const sc=_mskSceneOf(it);for(let i=0;i<20;i++)_mskSceneCache(sc,'x'+i,{px:new Uint8ClampedArray(1)});
    out.lru=sc.masks.size;
    // 5. Auto Subject = the detected person + dog (SAM boxes), named for what it found
    fxState.masks=[];out.matteModel=null;_mskMatteModels=null;delete it._matte;
    const a=await mskAddSubjectMatte();out.auto={name:a&&a.name,backend:a&&a.aiProvenance&&a.aiProvenance.backend};
    // 6. Background is one click: the complement, no scribble needed
    const b=await mskAddBackground();
    out.bg={name:b&&b.name,type:b&&b.type,corner:b&&b.px[0],centre:b&&b.px[(b.mtH>>1)*b.mtW+(b.mtW>>1)]};
    // 7. Foreground: the near (bottom) half
    const f=await mskAddForeground();
    out.fg=f?{top:f.px[5*f.mtW+5],bottom:f.px[(f.mtH-5)*f.mtW+5],name:f.name}:null;
    // 8. one-shot AI masks re-run on Update (as on a copy to another photo): Foreground and Background recompute
    out.calls.depth_run=0;out.calls.matte_run=0;delete it._matte;
    const fi=fxState.masks.indexOf(f),bi=fxState.masks.indexOf(b);
    out.reFg=await mskAiUpdate(fi);out.reBg=await mskAiUpdate(bi);
    out.reCalls={matte:out.calls.matte_run||0};out.canUpdate=[mskAiCanUpdate(f),mskAiCanUpdate(b),mskAiCanUpdate(a)];
    // 9. completeness: every tile in the create grid
    mskCreateGridSync&&mskCreateGridSync();
    out.tiles=[...document.querySelectorAll('.msk-tile')].map(t=>t.dataset.kind);
    return out;
  });
  console.log(JSON.stringify(r));
  assert.deepEqual(errs,[]);
  assert.equal(r.errUi,true,'failed detection offers Retry');
  assert.deepEqual(r.groups,['People:Person','Animals:Dog','Objects:Bench|Plant']);
  assert.equal(r.focusMoved,true);
  assert.equal(r.dog.name,'Dog');assert.equal(r.dog.edge,'animals');assert.ok(r.dog.boxCalls<=1,'hover preview reused on click: '+r.dog.boxCalls);
  assert.equal(r.dog.w,r.dog.tex.w,'AI raster stored at mask texture size');
  assert.equal(r.dogMatte,'isnet','animals use the general matting model');
  assert.equal(r.lru,8);
  assert.deepEqual(r.auto,{name:'Subjects',backend:'detect:sam2_box'});
  assert.equal(r.bg.name,'Background');assert.equal(r.bg.type,'brush');assert.ok(r.bg.corner>200&&r.bg.centre<50,JSON.stringify(r.bg));
  assert.ok(r.fg&&r.fg.bottom>200&&r.fg.top<50,JSON.stringify(r.fg));
  assert.equal(r.reFg,true,'Foreground re-runs on Update');assert.equal(r.reBg,true,'Background re-runs on Update');assert.ok(r.reCalls.matte>=1,'Background re-ran its models');
  assert.deepEqual(r.canUpdate,[true,true,true]);
  // Completeness: a new tile must be added to this list along with a case above.
  const covered=['auto subject','subject','objects','sky','landscape','background','foreground','skin','brush','linear','radial','color','luminance','depth'];
  for(const t of r.tiles)assert.ok(covered.includes(t),'untested create tile: '+t);
  for(const id of r.chipIds)assert.match(id,/^(person|dog|bench|potted_plant)\d$|^sky$/,'unexpected chip '+id);
  console.log('mask_detect_objects: ok');
}finally{await browser.close();server.close();}
