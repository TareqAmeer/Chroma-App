// Regression: bf22824's splash reveal hung when rAF never fires (WKWebView pauses rAF for a
// click-through / occluded transparent window). hideBootSplash() must still reveal the app,
// and must leave the window NOT ignoring cursor events, even if every Tauri window call rejects.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const __CSROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ROOT=__CSROOT;
const server=await new Promise(r=>{const s=createServer(async(rq,rs)=>{try{const p=path.join(ROOT,decodeURIComponent(rq.url.split('?')[0]));const d=await readFile(p);rs.writeHead(200,{'Content-Type':p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':'application/octet-stream'});rs.end(d);}catch{rs.writeHead(404);rs.end();}});s.listen(0,'127.0.0.1',()=>r(s));});
const base=`http://127.0.0.1:${server.address().port}`;
const br=await chromium.launch();
let fail=0;
for(const mode of ['ok','reject']){
  const pg=await br.newPage({viewport:{width:1200,height:900}});
  pg.on('pageerror',e=>console.error('[pageerror]',e.message));
  await pg.addInitScript(mode=>{
    window.__ignoreLog=[];
    window.requestAnimationFrame=()=>0; // frozen rAF, as in an occluded WKWebView
    const w={setIgnoreCursorEvents:v=>{window.__ignoreLog.push(v);return mode==='reject'?Promise.reject(new Error('denied')):Promise.resolve();},
      cursorPosition:()=>mode==='reject'?Promise.reject(new Error('denied')):Promise.resolve({x:5,y:5}),
      outerPosition:()=>Promise.resolve({x:0,y:0}),innerPosition:()=>Promise.resolve({x:0,y:0}),scaleFactor:()=>Promise.resolve(1)};
    window.__TAURI__={window:{getCurrentWindow:()=>w}};
  },mode);
  await pg.goto(`${base}/chromasmith-22.html`,{waitUntil:'domcontentloaded'});
  await pg.waitForFunction(()=>typeof window.hideBootSplash==='function',null,{timeout:30000});
  await pg.evaluate(()=>window.hideBootSplash());
  await pg.waitForTimeout(2500);
  const r=await pg.evaluate(()=>({splash:!!document.getElementById('boot-splash'),hold:document.documentElement.classList.contains('cs-reveal-hold'),lastIgnore:window.__ignoreLog.at(-1)}));
  const ok=!r.splash&&!r.hold&&r.lastIgnore===false;
  console.log(mode,ok?'PASS':'FAIL',JSON.stringify(r));
  if(!ok)fail=1;
  await pg.close();
}
await br.close();server.close();process.exit(fail);
