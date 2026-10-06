// Encoder parity, capability/memory limits, error fallback and worker cleanup.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createServer} from 'node:http';import {chromium} from 'playwright';
const ROOT=path.resolve(import.meta.dirname,'..');
const server=createServer((req,res)=>{try{const p=path.resolve(ROOT,'.'+decodeURIComponent(req.url.split('?')[0]));if(!p.startsWith(ROOT+path.sep))throw Error('outside root');res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'application/javascript':'application/octet-stream');res.end(fs.readFileSync(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
  browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']});
  const page=await browser.newPage({userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36'});
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`);await page.waitForFunction(()=>typeof fxEncodeExportCanvas==='function');
  const results=await page.evaluate(async()=>{
    Object.defineProperty(navigator,'deviceMemory',{configurable:true,value:2});
    const c=document.createElement('canvas');c.width=1600;c.height=1200;const x=c.getContext('2d');
    const g=x.createLinearGradient(0,0,1600,1200);g.addColorStop(0,'#013568');g.addColorStop(.5,'#b77552');g.addColorStop(1,'#fffade');x.fillStyle=g;x.fillRect(0,0,1600,1200);
    for(let i=0;i<10;i++){x.fillStyle=i%2?'black':'white';x.fillRect(30+i*143,60+i*91,11,110);}
    const WorkerOriginal=Worker,originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
    let workers=0,terminated=0,urls=0,revoked=0;
    window.Worker=class extends WorkerOriginal{constructor(...a){super(...a);workers++;}terminate(){terminated++;super.terminate();}};
    URL.createObjectURL=(...a)=>{urls++;return originalCreate.apply(URL,a);};URL.revokeObjectURL=(...a)=>{revoked++;return originalRevoke.apply(URL,a);};
    const result=[];
    try{
      for(const alpha of [false,true]){
        if(alpha){x.clearRect(0,0,80,90);x.clearRect(1300,800,300,400);x.globalAlpha=.37;x.fillStyle='#3fe16c';x.fillRect(1300,800,300,400);x.globalAlpha=1;}
        for(const q of [.8,.95,.99]){
          const before=await new Promise(r=>c.toBlob(r,'image/jpeg',q));const after=await fxEncodeExportCanvas(c,'image/jpeg',q);
          const a=new Uint8Array(await before.arrayBuffer()),b=new Uint8Array(await after.arrayBuffer());
          result.push({alpha,quality:q,bytes:a.length,exact:a.length===b.length&&a.every((v,i)=>v===b[i])});
        }
      }
      const success={workers,terminated,urls,revoked};
      // Capability, platform, size and memory fallbacks need not allocate huge canvases.
      let normal=0;const fake=(w,h)=>({width:w,height:h,toBlob(cb){normal++;cb(new Blob(['fallback'],{type:'image/jpeg'}));}});
      await fxEncodeExportCanvas(fake(999,999),'image/jpeg',.99);
      await fxEncodeExportCanvas(fake(6001,4000),'image/jpeg',.99);
      Object.defineProperty(navigator,'deviceMemory',{value:1});await fxEncodeExportCanvas(fake(1600,1200),'image/jpeg',.99);
      Object.defineProperty(navigator,'deviceMemory',{value:undefined});await fxEncodeExportCanvas(fake(1600,1200),'image/jpeg',.99);
      Object.defineProperty(navigator,'deviceMemory',{value:2});await fxEncodeExportCanvas(fake(1600,1200),'image/png',undefined);
      Object.defineProperty(navigator,'userAgent',{configurable:true,value:'iPhone'});await fxEncodeExportCanvas(fake(1600,1200),'image/jpeg',.99);
      Object.defineProperty(navigator,'userAgent',{value:'Android'});
      const offscreen=OffscreenCanvas;window.OffscreenCanvas=undefined;await fxEncodeExportCanvas(fake(1600,1200),'image/jpeg',.99);window.OffscreenCanvas=offscreen;
      const fallbackCount=normal;let failedTerminated=0;
      window.Worker=class{postMessage(){queueMicrotask(()=>this.onerror({}));}terminate(){failedTerminated++;}};
      const fallback=await fxEncodeExportCanvas(c,'image/jpeg',.99);
      const failBytes=new Uint8Array(await fallback.arrayBuffer());const main=await new Promise(r=>c.toBlob(r,'image/jpeg',.99));const mainBytes=new Uint8Array(await main.arrayBuffer());
      const fallbackExact=failBytes.length===mainBytes.length&&failBytes.every((v,i)=>v===mainBytes[i]);
      return {pixels:result,success,fallbackCount,failedTerminated,fallbackExact,urls,revoked};
    }finally{window.Worker=WorkerOriginal;URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;}
  });
  assert(results.pixels.every(r=>r.exact),'Worker changed JPEG output');assert.deepEqual(results.success,{workers:6,terminated:6,urls:6,revoked:6});assert.equal(results.fallbackCount,7);assert.equal(results.failedTerminated,1);assert(results.fallbackExact);assert.equal(results.urls,results.revoked);
  console.log(JSON.stringify(results,null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
