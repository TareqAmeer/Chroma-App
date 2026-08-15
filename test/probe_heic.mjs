// Probe, not a gate: HEIC decode is the ENGINE's job, and the engines disagree — WKWebView (the
// desktop shell and iOS) hands it to ImageIO and it works, Chromium cannot decode it at all.
// Run against a HEIC of your own; there is no fixture, since HEIC files are large and these are
// user photos. Confirms Chromium's refusal is real, and that loadImg turns it into a message
// that names the format and the surface rather than a bare "decode failed".
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const ROOT=process.cwd();
const server=createServer(async(req,res)=>{try{const u=req.url.split('?')[0];const d=await readFile(path.join(ROOT,decodeURIComponent(u).slice(1)));
  const ct=u.endsWith('.html')?'text/html':u.endsWith('.heic')?'image/heic':'application/octet-stream';
  res.writeHead(200,{'Content-Type':ct});res.end(d);}catch{res.writeHead(404);res.end();}}).listen(0,'127.0.0.1');
await new Promise(r=>server.on('listening',r));
const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage();
await p.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`,{waitUntil:'load'});
const r=await p.evaluate(async()=>{
  const blob=await (await fetch('test/fixtures/probe.heic')).blob();
  const out={size:blob.size,type:blob.type};
  try{ const bm=await createImageBitmap(blob); out.createImageBitmap={ok:true,w:bm.width,h:bm.height}; }
  catch(e){ out.createImageBitmap={ok:false,err:String(e.message||e)}; }
  out.imgTag=await new Promise(res=>{
    const i=new Image(); const u=URL.createObjectURL(blob);
    i.onload=()=>res({ok:true,w:i.naturalWidth,h:i.naturalHeight});
    i.onerror=()=>res({ok:false,err:'img decode failed'});
    i.src=u; setTimeout(()=>res({ok:false,err:'timeout'}),4000);
  });
  return out;
});
console.log('Chromium (web build):', JSON.stringify(r,null,1));
// And the app's own path must now say something actionable rather than "decode failed".
const msg=await p.evaluate(async()=>{
  const blob=await (await fetch('test/fixtures/probe.heic')).blob();
  const f=new File([blob],'IMG_1320.HEIC',{type:'image/heic'});
  try{ await loadImg(f); return 'UNEXPECTED: decoded'; }catch(e){ return String(e.message||e); }
});
console.log('app error message:', msg);
await b.close();server.close();
