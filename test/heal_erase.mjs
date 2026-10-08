// CHR-275: repair erase gestures against actual canvas and overlay pointer handlers.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const {chromium}=await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(import.meta.dirname,'..');
const server=createServer(async(req,res)=>{try{const p=path.join(root,decodeURIComponent(req.url.split('?')[0]));res.setHeader('Content-Type',p.endsWith('.html')?'text/html':p.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(await readFile(p));}catch{res.writeHead(404);res.end();}}).listen(0,'127.0.0.1');
await new Promise(r=>server.on('listening',r));
const native=process.env.NATIVE_CDP;
const browser=native?await chromium.connectOverCDP(native):await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const page=native?browser.contexts()[0].pages()[0]:await browser.newPage({viewport:{width:1440,height:960}});
let failures=0;
const check=(name,ok)=>{console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)failures++;};
try{
 if(native)await page.reload();else await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`);
 await page.waitForFunction(()=>typeof healEraseIntersected==='function'&&typeof loadFXImages==='function');
 await page.evaluate(async()=>{
  localStorage.setItem('chromasmith-tour-seen-v1','1');localStorage.setItem('chromasmith-first-edit-stage-v1','done');
  document.querySelectorAll('.cs-tour,.cs-first-edit').forEach(e=>e.remove());
  const c=document.createElement('canvas');c.width=800;c.height=600;c.getContext('2d').fillRect(0,0,800,600);
  const blob=await new Promise(r=>c.toBlob(r));await loadFXImages([new File([blob],'erase.png',{type:'image/png'})]);
 });
 await page.waitForTimeout(800);
 if(native){await page.waitForFunction(()=>typeof window.chromasmithLibraryIsOpen==='function'&&document.body.classList.contains('lib-full'));await page.evaluate(async()=>{if(window.chromasmithLibraryIsOpen())await window.chromasmithToggleLibrary();});await page.waitForFunction(()=>!document.body.classList.contains('lib-full'));}
 await page.evaluate(()=>{document.getElementById('cs-modal-ov')?.remove();switchTab('fx');fxSection('texture');if(!healMode)healToggle();});
 await page.waitForTimeout(400);
 if(native)await page.waitForFunction(()=>{const r=FX.cv.getBoundingClientRect(),e=document.elementFromPoint(r.left+r.width*.2,r.top+r.height*.3);return e===FX.cv||!!e?.closest('#fx-heal-overlay');},null,{timeout:30000});
 const setup=()=>page.evaluate(()=>{
  curItem().geom=defGeom();
  curItem().heal=[{id:'heal',x:.2,y:.3,r:.015,mode:'heal',feather:.5,opacity:1,sx:.8,sy:.8},{id:'clone',x:.5,y:.3,r:.015,mode:'clone',feather:.5,opacity:1,sx:.8,sy:.8},{id:'stroke',x:.4,y:.65,r:.015,mode:'heal',feather:.5,opacity:1,pts:[[.4,.65],[.6,.65]]},{id:'safe',x:.85,y:.2,r:.015,mode:'clone',feather:.5,opacity:1,sx:.2,sy:.3}];
  healSel=null;healEraseMode=false;healEraseHeld=false;document.getElementById('sl-heal-size').value=1;updateWork();renderPreview();healSyncUI();fxHistoryPush();return JSON.stringify(healOps());
 });
 const point=(nx,ny)=>page.evaluate(({nx,ny})=>{const q=_healFwd(nx,ny),r=FX.cv.getBoundingClientRect();return{x:r.left+q.nx*r.width,y:r.top+q.ny*r.height};},{nx,ny});
 const ids=()=>page.evaluate(()=>healOps().map(o=>o.id));
 const drag=async(a,b)=>{const p=await point(...a),q=await point(...b);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(q.x,q.y,{steps:8});await page.mouse.up();};
 await setup();
 check('intersection uses target geometry, including stroke interiors',await page.evaluate(()=>JSON.stringify(healEraseIntersected({nx:.5,ny:.5},{nx:.5,ny:.8}))==='["stroke"]'));
 await page.evaluate(()=>healEraseToggle());
 if(process.env.DEBUG_ERASE)console.log(await page.evaluate(()=>{const q=_healFwd(.2,.3),r=FX.cv.getBoundingClientRect(),x=r.left+q.nx*r.width,y=r.top+q.ny*r.height;return{mode:healMode,erase:healEraseActive(),bounds:r.toJSON(),hit:document.elementFromPoint(x,y)?.outerHTML.slice(0,400)};}));
 await drag([.15,.3],[.55,.3]);
 if(process.env.DEBUG_ERASE)console.log(await ids());
 check('one erase gesture removes Heal and Clone and retains other operations',JSON.stringify(await ids())==='["stroke","safe"]');
 await page.evaluate(()=>fxUndo());await page.waitForTimeout(200);
 check('one undo restores the entire erase gesture',(await ids()).length===4);
 await setup();await page.evaluate(()=>{csShortcutSet('editor.mask-erase','Shift');});
 await page.keyboard.down('Shift');await drag([.5,.5],[.5,.8]);await page.keyboard.up('Shift');
 check('rebound Shift erases a stroke instead of selecting a donor',JSON.stringify(await ids())==='["heal","clone","safe"]'&&await page.evaluate(()=>!healEraseHeld));
 await setup();await page.keyboard.down('Alt');await drag([.1,.9],[.15,.9]);await page.keyboard.up('Alt');
 check('old Alt binding paints after rebinding',(await ids()).length===5);
 await setup();await page.evaluate(()=>healEraseToggle());const p=await point(.2,.3);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();
 check('blur cancels pending erase without changing operations',(await ids()).length===4);
 await setup();await page.evaluate(()=>{healEraseToggle();curItem().geom=Object.assign(defGeom(),{rot:90,crop:{x:.1,y:.1,w:.8,h:.8}});updateWork();renderPreview();healSyncUI();});
 await drag([.2,.3],[.2,.3]);check('rotated cropped photo erases correct source target',JSON.stringify(await ids())==='["clone","stroke","safe"]');
 await page.evaluate(()=>{csShortcutSet('editor.mask-erase',null);healEraseMode=false;healEraseSetHeld(false);});
}finally{await browser.close();server.close();}
process.exitCode=failures?1:0;


