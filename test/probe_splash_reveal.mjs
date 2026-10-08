// Regression: bf22824's splash reveal hung when rAF never fires (WKWebView pauses rAF for a
// click-through / occluded transparent window). hideBootSplash() must still reveal the app,
// and must leave the window NOT ignoring cursor events, even if every Tauri window call rejects.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { repositoryRootFromTestUrl } from './lib/repo-paths.mjs';
const __CSROOT = repositoryRootFromTestUrl(import.meta.url);
const ROOT=__CSROOT;
const server=await new Promise(r=>{const s=createServer(async(rq,rs)=>{try{const p=path.join(ROOT,decodeURIComponent(rq.url.split('?')[0]));const d=await readFile(p);rs.writeHead(200,{'Content-Type':p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':'application/octet-stream'});rs.end(d);}catch{rs.writeHead(404);rs.end();}});s.listen(0,'127.0.0.1',()=>r(s));});
const base=`http://127.0.0.1:${server.address().port}`;
const br=await chromium.launch();
let fail=0;
for(const mode of ['ok','reject']){
  const pg=await br.newPage({viewport:{width:1200,height:900}});
  const pageErrors=[];
  pg.on('pageerror',e=>{pageErrors.push(e.message);console.error('[pageerror]',e.message);});
  await pg.addInitScript(mode=>{
    window.__ignoreLog=[];
    window.__invokeLog=[];
    window.__unexpectedInvokeLog=[];
    window.requestAnimationFrame=()=>0; // frozen rAF, as in an occluded WKWebView
    const w={setIgnoreCursorEvents:v=>{window.__ignoreLog.push(v);return mode==='reject'?Promise.reject(new Error('denied')):Promise.resolve();},
      cursorPosition:()=>mode==='reject'?Promise.reject(new Error('denied')):Promise.resolve({x:5,y:5}),
      outerPosition:()=>Promise.resolve({x:0,y:0}),innerPosition:()=>Promise.resolve({x:0,y:0}),scaleFactor:()=>Promise.resolve(1)};
    window.__TAURI__={core:{invoke:(command,args)=>{
      window.__invokeLog.push(command);
      if(command==='native_build_tag')return Promise.resolve('splash-probe');
      if(command==='list_lens_profiles')return Promise.resolve([]);
      if(command==='diag_state_path')return Promise.resolve('/splash-probe/chromasmith_diag_state.json');
      // No diagnostics automation opt-in file exists in this isolated probe.
      if(command==='read_file_bytes'&&args?.path==='/splash-probe/chromasmith_automation_enable.json')return Promise.reject(new Error('ENOENT'));
      window.__unexpectedInvokeLog.push(command);
      return Promise.reject(new Error('Unexpected native command in splash probe: '+command));
    }},window:{getCurrentWindow:()=>w}};
  },mode);
  await pg.goto(`${base}/chromasmith-22.html`,{waitUntil:'domcontentloaded'});
  await pg.waitForFunction(()=>typeof window.hideBootSplash==='function',null,{timeout:30000});
  await pg.evaluate(()=>window.hideBootSplash());
  await pg.waitForTimeout(2500);
  const r=await pg.evaluate(()=>({splash:!!document.getElementById('boot-splash'),hold:document.documentElement.classList.contains('cs-reveal-hold'),lastIgnore:window.__ignoreLog.at(-1)}));
  const ok=!r.splash&&!r.hold&&r.lastIgnore===false;
  console.log(mode,ok?'PASS':'FAIL',JSON.stringify(r));
  console.log('native commands',JSON.stringify(await pg.evaluate(()=>window.__invokeLog)));
  assert.deepEqual(pageErrors,[],`${mode}: startup JavaScript errors`);
  assert.deepEqual(await pg.evaluate(()=>window.__unexpectedInvokeLog),[],`${mode}: unmocked native command`);
  if(!ok)fail=1;
  await pg.close();
}
await br.close();server.close();process.exit(fail);
