import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright';

const root=path.resolve(import.meta.dirname,'..');
const server=createServer((req,res)=>{
  try{const p=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!p.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(p));}
  catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']});
  const page=await browser.newPage({viewport:{width:1366,height:768}}),pageErrors=[];page.on('pageerror',e=>pageErrors.push(String(e)));
  await page.goto('http://127.0.0.1:'+server.address().port+'/chromasmith-22.html');
  await page.waitForFunction(()=>typeof exportMultiPresetOpen==='function'&&typeof saveFiles==='function');
  await page.evaluate(async()=>{
    const base=await(await fetch('/test/fixtures/portrait.png')).blob(),src=await createImageBitmap(base),large=document.createElement('canvas');
    large.width=2048;large.height=1536;large.getContext('2d').drawImage(src,0,0,large.width,large.height);src.close();
    const largeBlob=await new Promise(resolve=>large.toBlob(resolve,'image/png'));
    await loadFXImages(Array.from({length:20},(_,i)=>new File([i===0?largeBlob:base],'Photo-'+String(i+1).padStart(2,'0')+'.png',{type:'image/png'})));
    await new Promise((resolve,reject)=>{const start=Date.now(),poll=()=>fxImages.length===20&&curItem()?.img?.naturalWidth?resolve():Date.now()-start>30000?reject(Error('fixture load timeout')):setTimeout(poll,25);poll();});
    let active='',failOnce=true;const attempts=[],saved=new Map(),dimensions={};
    window.testAttempts=attempts;window.testSaved=saved;window.testDimensions=dimensions;window.testActive=()=>active;
    const format=b=>b[0]===0x89&&b[1]===0x50?'PNG':b[0]===0xff&&b[1]===0xd8?'JPG':String.fromCharCode(...b.slice(0,4))==='RIFF'?'WebP':'unknown';
    window.__TAURI__={core:{invoke:async(cmd,args,opts)=>{
      if(cmd==='set_export_dir'){active=args.path;return active;}if(cmd!=='save_export_file_raw')return undefined;
      const name=atob(opts.headers['x-filename']),bytes=new Uint8Array(args),dest=active,key=dest+'/'+name,fmt=format(bytes);
      attempts.push({destination:dest,name,format:fmt});
      if(failOnce&&name.includes('Photo-07_Social')){failOnce=false;throw Error('synthetic disk-full');}
      if(!saved.has(key))saved.set(key,{destination:dest,name,format:fmt});
      if(!dimensions[dest]){const bm=await createImageBitmap(new Blob([bytes]));dimensions[dest]=[bm.width,bm.height];bm.close();}
      return{path:key,bytes:bytes.length};
    }}};
    localStorage.setItem('cs-export-dir','/delivery/original');
    exportPresetsSave([
      {name:'Archive',settings:{fmt:'png',q:100,size:0,sharp:0,dest:'/delivery/archive'}},
      {name:'Proof',settings:{fmt:'jpg',q:90,size:1600,sharp:1,dest:'/delivery/proofs'}},
      {name:'Social',settings:{fmt:'webp',q:82,size:1080,sharp:2,dest:'/delivery/social'}}
    ]);
    sk2ExportOpen();
  });
  await page.locator('#sk2-export').waitFor({state:'visible'});
  const skipGuide=page.getByRole('button',{name:'Skip guide'});if(await skipGuide.count())await skipGuide.click();
  await page.locator('#sk2-export .sk2x-more > summary').click();
  const presetTitle=page.locator('#sk2-export .fx-ctrl[data-fxsec="exppreset"] .fx-ctrl-title');
  if(await presetTitle.evaluate(el=>el.closest('.fx-ctrl').classList.contains('fx-sec-collapsed')))await presetTitle.click();
  await page.locator('#sk2-export button[title^="Export the same photos"]').click();
  const dialog=await page.evaluate(()=>({total:document.getElementById('emp-total').textContent,selected:document.querySelectorAll('.emp-cb:checked').length}));
  assert.match(dialog.total,/20 photos × 3 recipes = 60 files/,dialog.total);assert.equal(dialog.selected,3);
  await page.locator('#emp-go').click();await page.waitForFunction(()=>window._expAccumulate===false&&window._expPlanned===0,{timeout:90000});
  const failed=await page.evaluate(()=>window._expFail.map(f=>f.name));assert.equal(failed.length,1,JSON.stringify(failed));assert.match(failed[0],/Photo-07_Social/i);
  const outputTitle=page.locator('#sk2-export .fx-ctrl[data-fxsec="export"] .fx-ctrl-title');
  if(await outputTitle.evaluate(el=>el.closest('.fx-ctrl').classList.contains('fx-sec-collapsed')))await outputTitle.click();
  const retry=page.locator('#exp-fail-list button[aria-label^="Retry "]');assert.equal(await retry.isVisible(),true,'failed-output recovery visible after reopening Output');
  await retry.click();await page.waitForFunction(()=>window._expFail.length===0,{timeout:30000});
  const r=await page.evaluate(()=>({attempts:window.testAttempts,entries:[...window.testSaved.entries()],dims:window.testDimensions,restored:localStorage.getItem('cs-export-dir'),active:window.testActive(),failed:window._expFail.length}));
  assert.equal(r.entries.length,60);assert.equal(r.attempts.length,61);assert.equal(r.failed,0);assert.equal(r.restored,'/delivery/original');assert.equal(r.active,'/delivery/original');assert.equal(new Set(r.entries.map(([p])=>p)).size,60);
  for(const[dest,fmt,file]of[['/delivery/archive','PNG','Photo-01_Archive.png'],['/delivery/proofs','JPG','Photo-01_Proof.jpg'],['/delivery/social','WebP','Photo-01_Social.webp']]){
    const rows=r.entries.filter(([,v])=>v.destination===dest);assert.equal(rows.length,20,dest);assert(rows.every(([,v])=>v.format===fmt),dest);assert(r.entries.some(([p])=>p===dest+'/'+file),file);
  }
  assert.deepEqual(r.dims['/delivery/archive'],[2048,1536]);assert.deepEqual(r.dims['/delivery/proofs'],[1600,1200]);assert.deepEqual(r.dims['/delivery/social'],[1080,810]);
  const retried=r.attempts.filter(a=>a.name.includes('Photo-07_Social'));assert.equal(retried.length,2);assert(retried.every(a=>a.destination==='/delivery/social'));assert.deepEqual(pageErrors,[]);
  console.log('PASS CHR-202: 20 photos × 3 recipes = 60 unique outputs; PNG/JPG/WebP; dimensions 2048×1536, 1600×1200, 1080×810; one failed target retried once in its recipe folder, destination restored, zero page errors.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
