#!/usr/bin/env node
// Browser regression: the eyedropper hover loupe reads the WebGL preview through gl.readPixels,
// not drawImage(webglCanvas). The desktop app (WKWebView) showed #000000 on hover; there the
// drawImage path of a premultipliedAlpha:false WebGL canvas came back empty. Chromium can't
// reproduce WebKit, so this test SIMULATES that failure (drawImage of #fx-canvas draws nothing)
// and checks the loupe still shows the real colour, and that a fully failed read hides the loupe
// instead of showing a fake #000000. Real WKWebView confirmation still needs the desktop app.
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
let n=0;const ok=(c,m)=>{assert.ok(c,m);n++;};
try{
  const page=await browser.newPage({viewport:{width:1300,height:800}});
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`,{waitUntil:'load'});
  await page.setInputFiles('#in-fx-img', path.join(root,'test/fixtures/gradient.png'));
  await page.waitForFunction(()=>{const c=document.getElementById('fx-canvas');return c&&c.width>0&&typeof fxReadCanvasRGBA==="function";},null,{timeout:30000});
  await page.evaluate(()=>{document.querySelector('[data-tour-action="close"]')?.click();document.getElementById('cs-modal-ov')?.remove();});
  await page.waitForTimeout(500);
  const bx=await page.evaluate(()=>{const r=document.getElementById('fx-canvas').getBoundingClientRect();return{l:r.left,t:r.top,w:r.width,h:r.height};});
  const hexOf=d=>'#'+[d[0],d[1],d[2]].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();

  // 1. readPixels path agrees with a drawImage reference in Chromium (row flip, coordinates).
  const cmp=await page.evaluate(()=>{
    const cv=FX.cv,out=[];
    for(const[fx,fy]of[[.1,.1],[.9,.2],[.5,.5],[.2,.9]]){
      const x=Math.floor(cv.width*fx),y=Math.floor(cv.height*fy);
      const a=Array.from(fxReadCanvasRGBA(cv,x,y,1,1));
      const t=document.createElement('canvas');t.width=t.height=1;const c=t.getContext('2d');c.drawImage(cv,x,y,1,1,0,0,1,1);
      out.push([a,Array.from(c.getImageData(0,0,1,1).data)]);
    }
    return out;
  });
  for(const[a,b]of cmp)ok(a.every((v,i)=>Math.abs(v-b[i])<=1),`readPixels ${a} matches drawImage ${b}`);
  ok(new Set(cmp.map(([a])=>a.join())).size>1,'samples differ across the gradient (not a constant read)');

  // 2. Simulate the WKWebView failure: drawImage of the WebGL canvas draws nothing.
  await page.evaluate(()=>{
    const orig=CanvasRenderingContext2D.prototype.drawImage;window.__origDraw=orig;
    CanvasRenderingContext2D.prototype.drawImage=function(src,...a){if(src===FX.cv)return;return orig.call(this,src,...a);};
    _wbEyedropperActive=true;fxEyeArmedSync();
  });
  const fx=.7,fy=.4;
  const expect=await page.evaluate(([fx,fy])=>{const cv=FX.cv,r=cv.getBoundingClientRect();
    const x=Math.floor((r.width*fx)*cv.width/r.width),y=Math.floor((r.height*fy)*cv.height/r.height);
    return Array.from(fxReadCanvasRGBA(cv,x,y,1,1));},[fx,fy]);
  await page.mouse.move(bx.l+bx.w*fx-5,bx.t+bx.h*fy);
  await page.mouse.move(bx.l+bx.w*fx,bx.t+bx.h*fy);
  await page.waitForTimeout(150);
  const shown=await page.evaluate(()=>_fxEyeEl&&_fxEyeEl.style.display!=='none'?_fxEyeEl.lastChild.textContent:null);
  ok(shown&&shown!=='#000000',`hover loupe shows a colour with drawImage broken (got ${shown})`);
  ok(shown===hexOf(expect),`hover loupe ${shown} equals the pixel under the cursor ${hexOf(expect)}`);
  const pick=await page.evaluate(([fx,fy])=>{const r=FX.cv.getBoundingClientRect();
    return _pickAvgRGB({clientX:r.left+r.width*fx,clientY:r.top+r.height*fy},true);},[fx,fy]);
  ok(pick&&pick.some(v=>v>8),`click pick (fromCanvas) also survives broken drawImage: ${pick&&pick.map(Math.round)}`);

  // 3. Both reads fail: hide the loupe rather than show a fake #000000.
  await page.evaluate(()=>{const g=FX.gl;window.__origRP=g.readPixels;g.readPixels=function(...a){const b=a[6];if(b&&b.fill)b.fill(0);};});
  await page.mouse.move(bx.l+bx.w*.3,bx.t+bx.h*.6);
  await page.waitForTimeout(150);
  const hidden=await page.evaluate(()=>!_fxEyeEl||_fxEyeEl.style.display==='none');
  ok(hidden,'loupe hidden when nothing could be read');
  await page.evaluate(()=>{FX.gl.readPixels=window.__origRP;CanvasRenderingContext2D.prototype.drawImage=window.__origDraw;});
  console.log(`PASS mask eyedropper readback (${n} checks)`);
}finally{await browser.close();server.close();}
