// Regression check for a libraw worker that stops responding without an error.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const server=createServer(async(req,res)=>{
  try{
    const filename=path.join(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1));
    const body=await readFile(filename);
    res.writeHead(200,{
      'Content-Type':filename.endsWith('.html')?'text/html':'application/octet-stream',
      'Cross-Origin-Opener-Policy':'same-origin',
      'Cross-Origin-Embedder-Policy':'require-corp'
    });
    res.end(body);
  }catch{res.writeHead(404);res.end()}
}).listen(0,'127.0.0.1');
await new Promise(resolve=>server.on('listening',resolve));
let browser;
try{
  browser=await chromium.launch();
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`);
  const result=await page.evaluate(async()=>{
    const worker={terminated:false,terminate(){this.terminated=true}};
    const ok=await withRawDecodeTimeout({worker},async()=>42,20);
    let message='';
    try{await withRawDecodeTimeout({worker},()=>new Promise(()=>{}),20)}
    catch(e){message=e.message}
    return{isolated:crossOriginIsolated,ok,message,terminated:worker.terminated};
  });
  if(!result.isolated||result.ok!==42||!result.terminated||!/timed out.*desktop app/i.test(result.message))
    throw new Error(`RAW timeout regression: ${JSON.stringify(result)}`);
  console.log('PASS: stalled browser RAW worker times out with a clear error and is terminated');
}finally{
  if(browser)await browser.close();
  server.close();
}
