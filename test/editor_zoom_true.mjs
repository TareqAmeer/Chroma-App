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
    out.fitPct=_fxZoomToPct(FX_FIT);                    // 0.9*50 = 45%
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
  assert.equal(r.k,50);assert.equal(r.fitLabel,'Fit');assert.equal(r.fitPct,45);
  assert.ok(Math.abs(r.afterClick-100)<1e-6,'click zooms to true 100%');
  assert.equal(r.label100,'100%');assert.equal(r.back,true);
  assert.ok(Math.abs(r.maxPct-1600)<1,'slider top end is 1600%');
  assert.equal(r.minZoom,0.25);
  assert.ok(r.sliderRoundTrip>500&&r.sliderRoundTrip<1000);
  assert.equal(r.fitSnap,true,'slider snaps to Fit near the fit position');
  const c=await page.evaluate(async()=>{
    fxZoom=FX_FIT;const zw=document.getElementById('fx-zoom-wrap');
    const ev=(t,x,y,o={})=>zw.dispatchEvent(new PointerEvent(t,{pointerId:1,pointerType:'mouse',button:0,clientX:x,clientY:y,bubbles:true,cancelable:true,...o}));
    zw.setPointerCapture=()=>{};
    ev('pointerdown',300,300);ev('pointerup',300,300);
    const click=_fxZoomToPct(fxZoom);
    ev('pointerdown',300,300);ev('pointermove',340,300);ev('pointerup',340,300);   // a drag must NOT toggle
    const afterDrag=_fxZoomToPct(fxZoom);
    ev('pointerdown',300,300);ev('pointerup',300,300);                             // click again -> Fit
    const back=Math.abs(fxZoom-FX_FIT)<1e-6;
    mskAiTapMode=true;ev('pointerdown',300,300);ev('pointerup',300,300);mskAiTapMode=false;
    const armed=Math.abs(fxZoom-FX_FIT)<1e-6;                                        // armed tool: no zoom
    return{click,afterDrag,back,armed};
  });
  assert.ok(Math.abs(c.click-100)<1e-6,'a real click on the photo zooms to 100%');
  assert.ok(Math.abs(c.afterDrag-100)<1e-6,'a drag pans, it does not toggle zoom');
  assert.equal(c.back,true);assert.equal(c.armed,true);
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
