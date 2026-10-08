// CHR-201/202: collision policy is honoured by the real save path, a failed save is retried alone
// (no duplicate of what already succeeded), and the several-recipes dialog states the total count.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createServer} from 'node:http';import {chromium} from 'playwright';
const root=path.resolve(import.meta.dirname,'..');
const server=createServer((req,res)=>{try{const p=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!p.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(p));}catch(e){res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
  browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']});
  const page=await browser.newPage({viewport:{width:1366,height:768}});
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
    const writes=[],reveals=[];let failGradient=true;window.__TAURI__={core:{invoke:async(cmd,args,opts)=>{if(cmd==='set_export_dir')return args.path;if(cmd==='reveal_in_finder'){reveals.push(args.path);return;}if(cmd==='save_export_file_raw'){const name=atob(opts.headers['x-filename']);if(name==='Gradient_2.jpg'&&failGradient){failGradient=false;throw Error('temporary source unavailable');}const blob=new Blob([args]),bm=await createImageBitmap(blob);writes.push({name,width:bm.width,height:bm.height,bytes:args.byteLength});bm.close();return{path:'/delivery/archive/'+name,bytes:args.byteLength};}return undefined;}}};localStorage.removeItem('cs-export-collide');
    const f=async(n,w,h,type)=>{const src=await createImageBitmap(await(await fetch('/test/fixtures/'+n)).blob()),c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(src,0,0,w,h);src.close();const blob=await new Promise(resolve=>c.toBlob(resolve,type));return new File([blob],n==='portrait.png'?'Portrait.png':'Gradient.jpg',{type});};
    await loadFXImages([await f('portrait.png',2048,1536,'image/png'),await f('gradient.png',900,600,'image/jpeg')]);
    await new Promise(resolve=>{const poll=()=>fxImages.length===2&&(curItem()?.img?.naturalWidth||curItem()?.fullImg?.naturalWidth)?resolve():setTimeout(poll,25);poll();});
    fxExportScope='all';localStorage.setItem('cs-export-dir','/delivery/archive');switchTab('fx');fxSection('export');document.querySelector('.fx-ctrl[data-fxsec="export"] .fx-ctrl-title').click();
    exportPresetsSave([{name:'Client master',settings:{fmt:'auto',q:'91',size:'0',sharp:'0',dest:'/delivery/archive'}}]);exportPresetListRefresh('Client master');await exportPresetApply('Client master');document.getElementById('fx-fname').value='{name}_{seq}{nover}';expPlainRender();const gps=document.getElementById('tg-exp-gps');
    const host=document.getElementById('exp-est'),metaBefore=host.textContent,visible=host.offsetParent!==null,darkColor=getComputedStyle(host).color;
    gps.click();const metaRemoved=host.textContent;
    gps.click();const metaKept=host.textContent;
    document.body.classList.add('light');const lightColor=getComputedStyle(host).color,lightVisible=host.offsetParent!==null;document.body.classList.remove('light');
    await exportFX();const beforeExpiry={failures:window._expFail.length,result:document.getElementById('exp-last').textContent};
    await new Promise(resolve=>setTimeout(resolve,9300));const pillExpired=!document.getElementById('cs-export-done'),retry=document.querySelector('#exp-fail-list button[aria-label="Retry Gradient_2.jpg"]');
    if(retry)retry.click();await new Promise((resolve,reject)=>{const start=Date.now(),poll=()=>window._expFail.length===0?resolve():Date.now()-start>30000?reject(Error('failed output retry did not finish')):setTimeout(poll,25);poll();});
    const reveal=document.querySelector('#exp-last button');if(reveal)reveal.click();
    exportPresetsSave([{name:'A',settings:{fmt:'png',q:100,size:0,sharp:0,dest:'/delivery/archive'}},{name:'B',settings:{fmt:'jpg',q:90,size:1600,sharp:1,dest:'/delivery/proofs'}},{name:'C',settings:{fmt:'jpg',q:85,size:1080,sharp:2,dest:'/delivery/social'}}]);
    exportMultiPresetOpen();const t=[document.getElementById('emp-total').textContent];
    t.push([...document.querySelectorAll('.emp-dest')].map(n=>n.textContent));
    document.querySelectorAll('.emp-cb')[0].click();t.push(document.getElementById('emp-total').textContent);return{t,metaBefore,metaRemoved,metaKept,visible,darkColor,lightColor,lightVisible,writes,reveals,beforeExpiry,pillExpired,retryVisible:!!retry};});
  assert.equal(dlg.visible,true,'preflight is visible with the Output section open');
  assert.equal(dlg.lightVisible,true,'preflight remains visible in light theme');assert.notEqual(dlg.darkColor,dlg.lightColor,'preflight uses the active theme color');
  assert.match(dlg.metaBefore,/Metadata: photo metadata preserved/);
  assert.match(dlg.metaRemoved,/Metadata: photo metadata preserved except GPS location/);
  assert.match(dlg.metaKept,/Metadata: photo metadata preserved/);
  assert.match(dlg.metaBefore,/2 photos · 1 PNG, 1 JPG/);assert.match(dlg.metaBefore,/2048×1536, 900×600/);
  assert.match(dlg.metaBefore,/Saved as Portrait_1.png/);assert.match(dlg.metaBefore,/quality 91/);
  assert.match(dlg.metaBefore,/Export recipe: Client master/);assert.match(dlg.metaBefore,/Saving to \/delivery\/archive · if a file exists: add a number/);
  assert.match(dlg.metaBefore,/Offline sources: unavailable originals fail individually and stay listed for retry after reconnecting/);
  assert.deepEqual(dlg.writes.map(x=>[x.name,x.width,x.height]),[['Portrait_1.png',2048,1536],['Gradient_2.jpg',900,600]],'preflight concrete formats and per-photo dimensions match bytes actually exported');
  assert.equal(dlg.beforeExpiry.failures,1);assert.match(dlg.beforeExpiry.result,/1 saved, 1 failed/);assert.equal(dlg.pillExpired,true,'temporary completion pill expires');assert.equal(dlg.retryVisible,true,'failed output remains retryable after the pill disappears');
  assert.deepEqual(dlg.reveals,['/delivery/archive/Gradient_2.jpg'],'persistent Show in Finder still reveals the recovered output');
  assert(/2 photos . 3 recipes = 6 files/.test(dlg.t[0]),dlg.t[0]);assert(/2 photos . 2 recipes = 4 files/.test(dlg.t[2]),dlg.t[2]);
  assert.deepEqual(dlg.t[1],['/delivery/archive','/delivery/proofs','/delivery/social'],'the selected-recipe dialog names each recipe folder');
  const routed=await page.evaluate(async()=>{
    let active='',calls=0;const writes=[];
    window.__TAURI__={core:{invoke:async(cmd,body,opts)=>{
      if(cmd==='set_export_dir'){active=body.path;return body.path;}
      if(cmd==='save_export_file_raw'){
        calls++;const name=atob(opts.headers['x-filename']);writes.push({dest:active,name});
        return{path:`${active}/${name}`,bytes:body.length};
      }
      return undefined;
    }}};
    localStorage.setItem('cs-export-dir','/delivery/keep');
    exportPresetsSave([
      {name:'Archive',settings:{fmt:'png',q:100,size:0,sharp:0,dest:'/delivery/archive'}},
      {name:'Proof',settings:{fmt:'jpg',q:90,size:1600,sharp:1,dest:'/delivery/proofs'}}
    ]);
    await exportMultiPresetRun(['Archive','Proof'],2);
    return{writes,calls,restored:localStorage.getItem('cs-export-dir'),active};
  });
  assert.equal(routed.calls,4,'two real fixture photos are exported for each of two recipes');
  assert.deepEqual(routed.writes.map(x=>x.dest),['/delivery/archive','/delivery/archive','/delivery/proofs','/delivery/proofs']);
  assert(routed.writes.slice(0,2).every(x=>x.name.includes('_Archive')),'archive outputs keep the recipe name');
  assert(routed.writes.slice(2).every(x=>x.name.includes('_Proof')),'proof outputs keep the recipe name');
  assert.equal(routed.restored,'/delivery/keep');assert.equal(routed.active,'/delivery/keep','the pre-run destination is restored after all recipes');
  console.log('PASS: collision/retry safety, multi-recipe count, per-recipe destinations and folder restoration');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
