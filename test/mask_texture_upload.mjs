#!/usr/bin/env node
// Keep the packed secondary mask-texture upload on a valid WebGL pixel-store state.
const { chromium }=await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const server=createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(req.url.split('?')[0]);
    const file=path.join(ROOT,pathname==='/'?'/chromasmith-22.html':pathname);
    if(!file.startsWith(ROOT)){res.writeHead(403);res.end();return;}
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    res.writeHead(200,{'Content-Type':path.extname(file)==='.html'?'text/html':'application/octet-stream'});
    res.end(await readFile(file));
  }catch{res.writeHead(404);res.end('not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({
  ...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),
  args:['--use-gl=swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader'],
});
try{
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`,{waitUntil:'load'});
  await page.waitForFunction(()=>typeof FXR==='function',{timeout:30000});
  const result=await page.evaluate(()=>{
    const renderer=new FXR(document.createElement('canvas'));
    if(!renderer.ok||renderer.gl.isContextLost())return{skip:'WebGL2 unavailable'};
    const gl=renderer.gl;
    while(gl.getError()!==gl.NO_ERROR){}
    renderer.setMaskTex2(new Uint8Array(2*2*4),2,2);
    return{error:gl.getError(),invalidEnum:gl.INVALID_ENUM};
  });
  if(result.skip){console.log(`SKIP ${result.skip}`);}
  else if(result.error!==0)throw new Error(`setMaskTex2 raised WebGL error ${result.error}`);
  else console.log('PASS setMaskTex2 uploads without a WebGL error');
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
