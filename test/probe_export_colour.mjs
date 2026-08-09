// Exports a real clip through the app's own path and reports the MP4's colour metadata.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const ROOT=process.cwd();
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.png':'image/png','.MOV':'video/quicktime','.mp4':'video/mp4','.wasm':'application/wasm','.cube':'text/plain','.json':'application/json'};
const server=await new Promise(r=>{const s=createServer(async(q,res)=>{try{
  const u=decodeURIComponent(q.url.split('?')[0]);const f=path.join(ROOT,u);const d=await readFile(f);
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});res.end(d);
}catch{res.writeHead(404);res.end();}});s.listen(0,'127.0.0.1',()=>r(s));});
const port=server.address().port;
const b=await chromium.launch({args:['--use-gl=swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox','--enable-unsafe-swiftshader']});
const pg=await b.newPage({viewport:{width:1400,height:900}});
pg.on('pageerror',e=>console.error('[pageerror]',e.message));
await pg.goto(`http://127.0.0.1:${port}/chromasmith-22.html?deskx=1`,{waitUntil:'load'});
await pg.waitForFunction(()=>typeof window.loadFXImages==='function',null,{timeout:30000});
const b64=await pg.evaluate(async ()=>{
  const r=await fetch('/test/fixtures/video_tiny.mp4');const bl=await r.blob();
  await window.loadFXImages([new File([bl],'video_tiny.mp4',{type:'video/mp4'})]);
  await new Promise(r=>setTimeout(r,9000));
  const it=(typeof curItem==='function'&&curItem())||fxImages[0];
  if(!it) throw new Error('clip did not load: fxImages='+(typeof fxImages!=='undefined'?fxImages.length:'undef'));
  it.trimInFrame=0; it.trimOutFrame=4;              // 6 frames is plenty to read the tags
  let out=null;
  window.saveFile=async(content)=>{
    const buf = content instanceof Blob ? await content.arrayBuffer()
              : (content.buffer ? content.buffer : content);
    const u=new Uint8Array(buf);
    let s='';const CH=0x8000;
    for(let i=0;i<u.length;i+=CH)s+=String.fromCharCode.apply(null,u.subarray(i,Math.min(i+CH,u.length)));
    out=btoa(s);
  };
  await window.fxVideoExportSmall(it);
  return out;
});
await writeFile('/tmp/exported_probe.mp4', Buffer.from(b64,'base64'));
console.log('exported', (Buffer.from(b64,'base64').length/1024).toFixed(0)+'KB');
await b.close(); server.close();
