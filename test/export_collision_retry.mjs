// CHR-201/202: collision policy is honoured by the real save path, a failed save is retried alone
// (no duplicate of what already succeeded), and the several-recipes dialog states the total count.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createServer} from 'node:http';import {chromium} from 'playwright';
const root=path.resolve(import.meta.dirname,'..');
const server=createServer((req,res)=>{try{const p=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!p.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(p));}catch(e){res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
  browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']});
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`);await page.waitForFunction(()=>typeof expRetry==='function'&&typeof saveFiles==='function');
  const r=await page.evaluate(async()=>{
    const disk=new Map(),calls=[];let failOnce='b.jpg';
    window.__TAURI__={core:{invoke:async(cmd,body,opts)=>{if(cmd!=='save_export_file_raw')return undefined;let name=atob(opts.headers['x-filename']);const pol=opts.headers['x-collision'];calls.push(name+'|'+pol);
      if(name===failOnce){failOnce=null;throw new Error('disk full');}
      if(disk.has(name)){if(pol==='skip')return{path:'/o/'+name,bytes:0};if(pol==='suffix'){const b=name.replace(/\.[^.]+$/,'');name=`${b} (2)${name.slice(b.length)}`;}}
      disk.set(name,body.length);return{path:'/o/'+name,bytes:body.length};}}};
    const it=(n,l)=>({content:new Uint8Array(l),fname:n,mime:'image/jpeg'}),out={};
    const first=await saveFiles([it('a.jpg',10),it('b.jpg',10),it('c.jpg',10)]);out.first=first.map(x=>x.ok);
    window._expFail=[{kind:'save',name:'b.jpg',fname:'b.jpg',content:new Uint8Array(10),mime:'image/jpeg',err:'disk full'}];
    csExportResultKeep(2,1);out.failRows=document.querySelectorAll('#exp-fail-list button').length;
    calls.length=0;await expRetry(0);out.retryCalls=calls.slice();out.afterRetry=[...disk.keys()].sort();out.remaining=window._expFail.length;
    for(const pol of['skip','overwrite','suffix']){localStorage.setItem('cs-export-collide',pol);const s=await saveFiles([it('a.jpg',99)]);out[pol]={skipped:!!s[0].skipped,a:disk.get('a.jpg'),names:[...disk.keys()].sort().join()};}
    return out;});
  assert.deepEqual(r.first,[true,false,true]);assert.equal(r.failRows,1,'one retry button for one failure');
  assert.deepEqual(r.retryCalls,['b.jpg|suffix'],'retry saves only the failed file');assert.deepEqual(r.afterRetry,['a.jpg','b.jpg','c.jpg'],'no duplicates after retry');assert.equal(r.remaining,0);
  assert.equal(r.skip.skipped,true);assert.equal(r.skip.a,10,'skip leaves the existing file untouched');
  assert.equal(r.overwrite.a,99,'overwrite replaces it');assert(r.suffix.names.includes('a (2).jpg'),'suffix adds a number');
  const dlg=await page.evaluate(async()=>{
    delete window.__TAURI__;localStorage.removeItem('cs-export-collide');
    const f=async n=>new File([await (await fetch('/test/fixtures/'+n)).blob()],n,{type:'image/png'});
    await loadFXImages([await f('portrait.png'),await f('gradient.png')]);
    exportPresetsSave([{name:'A',settings:{fmt:'png',q:100,size:0,sharp:0}},{name:'B',settings:{fmt:'jpg',q:90,size:1600,sharp:1}},{name:'C',settings:{fmt:'jpg',q:85,size:1080,sharp:2}}]);
    exportMultiPresetOpen();const t=[document.getElementById('emp-total').textContent];document.querySelectorAll('.emp-cb')[0].click();t.push(document.getElementById('emp-total').textContent);return t;});
  assert(/2 photos . 3 recipes = 6 files/.test(dlg[0]),dlg[0]);assert(/2 photos . 2 recipes = 4 files/.test(dlg[1]),dlg[1]);
  console.log('PASS: collision policies honoured, per-file retry without duplicates, multi-recipe total count');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
