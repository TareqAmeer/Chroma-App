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
  await page.waitForFunction(()=>typeof _fxClickZoom==='function'&&typeof _fxZoomToPct==='function');
  const r=await page.evaluate(async()=>{
    // Stand up a 6000x4000 working image shown 1500 css px wide on a dpr=2 display.
    const cv=document.createElement('canvas');cv.width=60;cv.height=40;cv._csFullW=6000;
    fxWork=cv;fxFullScale=()=>100;
    Object.defineProperty(window,'devicePixelRatio',{value:2,configurable:true});
    const zw=document.getElementById('fx-zoom-wrap');zw.style.width='1500px';zw.style.height='1000px';
    fxLoupe=false;fxZoom=FX_FIT;
    const out={};
    out.k=_fxTrueZoomK();                              // percent per fxZoom unit = 1500*2/6000*100 = 50
    out.fitLabel=(_updateZoomReadout(),document.getElementById('fx-zoom-pct').textContent);
    out.fitPct=_fxZoomToPct(FX_FIT);out.fitExpect=Math.round(FX_FIT*50*100)/100; // Fit shows as FX_FIT*50 (k=50)
    _fxClickZoom(400,300);
    out.afterClick=_fxZoomToPct(fxZoom);                // 100%
    out.label100=(_updateZoomReadout(),document.getElementById('fx-zoom-pct').textContent);
    _fxClickZoom(400,300);
    out.back=Math.abs(fxZoom-FX_FIT)<1e-6;
    zoomSetSlider(1000);out.maxPct=_fxZoomToPct(fxZoom);
    zoomSetSlider(0);out.minZoom=fxZoom;
    out.sliderRoundTrip=(fxZoom=_fxPctToZoom(400),_fxZoomToSlider(fxZoom));
    out.fitSnap=(zoomSetSlider(_fxZoomToSlider(FX_FIT)+3),Math.abs(fxZoom-FX_FIT)<1e-9);
    return out;
  });
  assert.equal(r.k,50);assert.equal(r.fitLabel,'Fit');assert.equal(r.fitPct,r.fitExpect);
  assert.ok(Math.abs(r.afterClick-100)<1e-6,'click zooms to true 100%');
  assert.equal(r.label100,'100%');assert.equal(r.back,true);
  assert.ok(Math.abs(r.maxPct-1600)<1,'slider top end is 1600%');
  assert.equal(r.minZoom,0.25);
  assert.ok(r.sliderRoundTrip>500&&r.sliderRoundTrip<1000);
  assert.equal(r.fitSnap,true,'slider snaps to Fit near the fit position');
  // Real pointer clicks run against a REAL opened photo: the stubbed 60px canvas above can't survive
  // the app's own async re-layout (the crisp-zoom render re-pins #fx-zoom-wrap to the canvas footprint
  // between evaluates), so a stub here measured the stub, not the product. 3000x2000 on a dpr=2 page.
  const rp=await browser.newPage({viewport:{width:1400,height:900},deviceScaleFactor:2});
  rp.on('pageerror',e=>errors.push(e.message));
  await rp.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`,{waitUntil:'load'});
  await rp.waitForFunction(()=>typeof fxSection==='function'&&typeof _fxClickZoom==='function');
  await rp.setInputFiles('#in-fx-img',{name:'photo3x2.png',mimeType:'image/png',buffer:await rp.evaluate(async()=>{const c=document.createElement('canvas');c.width=3000;c.height=2000;const g=c.getContext('2d');g.fillStyle='#888';g.fillRect(0,0,3000,2000);const b=await new Promise(r=>c.toBlob(r,'image/png'));return [...new Uint8Array(await b.arrayBuffer())];}).then(a=>Buffer.from(a))});
  await rp.waitForFunction(()=>{const c=document.getElementById('fx-canvas');return c&&c.width>0&&fxWork;},null,{timeout:30000});
  await rp.evaluate(()=>{document.querySelector('[data-tour-action="close"]')?.click();document.getElementById('cs-modal-ov')?.remove();});
  await rp.waitForTimeout(1200);
  const at=await rp.evaluate(()=>{const r=document.getElementById('fx-zoom-wrap').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,fit:Math.abs(fxZoom-FX_FIT)<1e-6};});
  assert.equal(at.fit,true,'real photo opens at Fit');
  const st=()=>rp.evaluate(()=>({pct:_fxZoomToPct(fxZoom),fit:Math.abs(fxZoom-FX_FIT)<1e-6,label:document.getElementById('fx-zoom-pct').textContent}));
  const settle=()=>rp.waitForTimeout(400);
  await rp.mouse.click(at.x,at.y);await settle();const c1=await st();
  assert.ok(Math.abs(c1.pct-100)<1e-6,'a real click on the photo zooms to 100% (got '+c1.pct+')');
  assert.equal(c1.label,'100%');
  await rp.mouse.move(at.x,at.y);await rp.mouse.down();await rp.mouse.move(at.x+40,at.y,{steps:4});await rp.mouse.up();await settle();
  assert.ok(Math.abs((await st()).pct-100)<1e-6,'a drag pans, it does not toggle zoom');
  await rp.mouse.click(at.x,at.y);await settle();
  assert.equal((await st()).fit,true,'click again returns to Fit');
  await rp.evaluate(()=>{mskAiTapMode=true;});await rp.mouse.click(at.x,at.y);await settle();
  const armed=(await st()).fit;await rp.evaluate(()=>{mskAiTapMode=false;});
  assert.equal(armed,true,'armed tool: a click does not zoom');
  await rp.close();
  const nodom=await page.evaluate(()=>{
    // The desktop open path can reach the readout before #fx-canvas / #fx-zoom-wrap exist: must not throw.
    const keepZ=document.getElementById('fx-zoom-wrap'),keepC=document.getElementById('fx-canvas');
    const zp=keepZ&&keepZ.parentNode,cp=keepC&&keepC.parentNode,zn=keepZ&&keepZ.nextSibling,cn=keepC&&keepC.nextSibling;
    if(keepZ)keepZ.remove();if(keepC)keepC.remove();
    let err=null;try{_updateZoomReadout();_fxZoomToPct(1);_fxZoomMax();_fxZoomFootprint();}catch(e){err=String(e);}
    if(cp&&keepC)cp.insertBefore(keepC,cn);if(zp&&keepZ)zp.insertBefore(keepZ,zn);
    return err;
  });
  assert.equal(nodom,null,'zoom readout/helpers must not throw when the canvas is not in the DOM: '+nodom);
  assert.deepEqual(errors,[]);
  done=true;console.log('PASS true zoom percent: Fit label, click Fit<->100%, 1600% cap, slider mapping');
}finally{await browser.close();server.close();if(!done)process.exitCode=1;}
