// ROADMAP.md R6 — deconvolution sharpening: perf + visual sanity probe.
// Times FX.render() with the new deconv pass off vs on, and does a pixel-level sanity check
// on a real fixture (test/fixtures/portrait.png) that Amount>0 measurably sharpens an edge
// without pathological change at moderate settings, while a pushed Amount starts to show
// ringing (variance growth in a flat region near a hard edge).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const ROOT = process.cwd();
const server = createServer(async (req,res)=>{
  try { const d = await readFile(path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).slice(1)));
    const u=req.url.split('?')[0];
    const ct=u.endsWith('.html')?'text/html':u.endsWith('.js')||u.endsWith('.mjs')?'text/javascript':u.endsWith('.png')?'image/png':'application/octet-stream';
    res.writeHead(200,{'Content-Type':ct}); res.end(d); } catch { res.writeHead(404); res.end(); }
}).listen(0,'127.0.0.1');
await new Promise(r=>server.on('listening',r));
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage();
p.on('pageerror', e=>console.log('[pageerror]',e.message));
p.on('console', m=>{ if(/GLSL compile error/.test(m.text())) console.log('[console.error]',m.text()); });
await p.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`,{waitUntil:'load'});
await p.waitForFunction(()=>typeof FX!=='undefined'&&FX&&typeof FX.render==='function');

const out = await p.evaluate(async ()=>{
  function loadImg(url){return new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=rej;im.src=url;});}
  const img = await loadImg('/test/fixtures/portrait.png');
  FX.setImage(img);
  const W=img.naturalWidth, H=img.naturalHeight;

  function baseParams(){ return getFXParams(); }

  function timeRender(P,w,h,n){
    // warm up once (shader compile / first-frame cost shouldn't count)
    FX.render(P,w,h,{glowScale:1});
    const gl=FX.gl; gl.finish();
    const t0=performance.now();
    for(let i=0;i<n;i++){ FX.render(P,w,h,{glowScale:1}); gl.finish(); }
    return (performance.now()-t0)/n;
  }

  function readPixels(w,h){
    const gl=FX.gl; const buf=new Uint8Array(w*h*4);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,buf);
    return buf; // NOTE: flipped Y vs image, doesn't matter for the stats we take
  }

  const results={};
  // --- Perf: deconv OFF (golden path) vs ON, at a realistic preview-ish size and a larger one ---
  for(const sz of [[1024,683],[2048,1365]]){
    const [w,h]=sz;
    const Poff=baseParams();
    const Pon=baseParams(); Pon.deconv={amount:0.7,radius:3};
    const tOff=timeRender(Poff,w,h,5);
    const tOn=timeRender(Pon,w,h,5);
    results[`t_${w}x${h}_off`]=tOff;
    results[`t_${w}x${h}_on`]=tOn;
  }

  // --- Visual sanity: render at native-ish size (capped) with a few Amount settings ---
  const rw=Math.min(W,1200), rh=Math.round(rw*H/W);
  function statsFor(amount,radius){
    const P=baseParams(); if(amount>0)P.deconv={amount,radius};
    FX.render(P,rw,rh,{glowScale:1});
    const px=readPixels(rw,rh);
    // Sample a horizontal scanline through the middle (tanned field -> pale disc edge, per
    // CLAUDE.md's portrait.png fixture description) and measure max abs derivative (edge
    // steepness) plus variance in a flat run of pixels away from any edge (ringing proxy).
    const y=Math.floor(rh*0.5);
    const lum=x=>{const i=(y*rw+x)*4;return 0.2126*px[i]+0.7152*px[i+1]+0.0722*px[i+2];};
    let maxSlope=0;
    for(let x=1;x<rw-1;x++) maxSlope=Math.max(maxSlope, Math.abs(lum(x+1)-lum(x-1))/2);
    // flat region: first 40px of the scanline (background), variance of luminance
    let mean=0; for(let x=2;x<42;x++) mean+=lum(x); mean/=40;
    let varr=0; for(let x=2;x<42;x++){const d=lum(x)-mean; varr+=d*d;} varr/=40;
    return {maxSlope,flatVar:varr};
  }
  results.sanity_off = statsFor(0,3);
  results.sanity_amt50 = statsFor(0.5,3);
  results.sanity_amt100 = statsFor(1.0,3);
  results.sanity_amt100_bigRadius = statsFor(1.0,7);

  return results;
});
console.log(JSON.stringify(out,null,2));
await b.close(); server.close();
