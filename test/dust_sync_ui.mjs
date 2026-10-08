import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import path from 'node:path';
import { readFile, copyFile } from 'node:fs/promises';
// Native staging omits the browser isolation shim. Supply the real shim to the
// generated, ignored test staging so both script and worker requests succeed.
await copyFile('coi-serviceworker.min.js','desktop/dist/coi-serviceworker.min.js');
const server=createServer(async(req,res)=>{try{const pathname=decodeURIComponent(req.url.split('?')[0]);if(pathname.endsWith('/favicon.ico')){res.writeHead(204);res.end();return;}const body=await readFile(path.join(process.cwd(),pathname.slice(1)));const type={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.wasm':'application/wasm'}[path.extname(pathname)]||'application/octet-stream';res.writeHead(200,{'Content-Type':type,'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});res.end(body);}catch{res.writeHead(404);res.end();}}).listen(0,'127.0.0.1');
await new Promise(resolve=>server.on('listening',resolve));
const port=server.address().port;
const started = Date.now();
async function waitJournal(page,ready){const deadline=Date.now()+15000;while(Date.now()<deadline){const list=await page.evaluate(()=>window.libtestRecipeBatchInvoke('recipe_batch_list',{}));if(ready(list))return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('batch journal did not reach expected state');}
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors=[];
  page.on('pageerror',e=>pageErrors.push(e.message));
  page.on('console',e=>{if(e.type()==='error')pageErrors.push(e.text()+' '+e.location().url);});
  await page.addInitScript(() => localStorage.setItem('chromasmith-tour-seen-v1', '1'));
  await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=6&deskx=1`);
  const cards = page.locator('#lib-grid .lib-card[data-path]');
  await cards.first().waitFor();
  await page.waitForTimeout(1500);
  const paths = await cards.evaluateAll(nodes => nodes.slice(0, 3).map(n => n.dataset.path));
  // Seed real per-photo recipes through the ordinary UI path before syncing dust.
  await page.evaluate(() => {
    const snap=getUISnapshot();snap.sliders['adj-exp']=17;
    snap.heal=[{id:'existing',x:.8,y:.2,r:.03,sx:.9,sy:.4,mode:'clone',feather:.5,opacity:.7}];
    window.__copiedRecipe=btoa(unescape(encodeURIComponent(JSON.stringify(snap))));
  });
  for(let i=0;i<3;i++)await cards.nth(i).click({modifiers:['Control']});
  await cards.nth(1).click({button:'right'});
  await page.getByText('Edit (3)',{exact:true}).hover();
  await page.getByText('Paste edit',{exact:true}).click();
  await waitJournal(page,list=>list.some(b=>b.status==='completed'));
  const original=await page.evaluate(async()=>{const list=await window.libtestRecipeBatchInvoke('recipe_batch_list',{});const seed=await window.libtestRecipeBatchInvoke('recipe_batch_get',{id:(list.find(b=>b.label==='Paste edit')||list[0]).id});return {recipe:seed.items[0].recipe};});
  await page.evaluate((sourcePath) => {
    const snap = getUISnapshot();
    snap.heal = [{ id:'dust', x:.3,y:.4,r:.02,sx:.5,sy:.5,mode:'heal',feather:0,opacity:1 }, {id:'object',x:.6,y:.6,r:.05,pts:[[.6,.6],[.7,.7]]}];
    window.__copiedRecipe = btoa(unescape(encodeURIComponent(JSON.stringify(snap))));
    window.__copiedRecipeOrigin = { path: sourcePath, recipe: window.__copiedRecipe };
  }, paths[2]);
  await cards.nth(1).click({button:'right'});
  await page.getByText('Edit (3)',{exact:true}).hover();
  await page.getByText('Sync sensor dust (review each photo)…',{exact:true}).click();
  const dialog=page.locator('#dust-sync-review');
  await dialog.waitFor();
  assert.equal(await dialog.locator('[data-spot]').count(),1,'brush object must be excluded');
  assert.match(await dialog.locator('[data-photo]').innerText(),/DC-S9 · 2026-07-20/,'target must display its same-shoot camera/day metadata');
  await dialog.locator('[data-spot]').check();
  await page.waitForFunction(()=>{const img=document.querySelector('#dust-sync-review [data-photo] img');return img.complete&&img.naturalWidth>0;});
  const marker=await dialog.locator('[data-photo] svg').evaluate(svg=>{const e=svg.querySelector('ellipse'),r=svg.getBoundingClientRect();return {width:r.width,height:r.height,rx:Number(e.getAttribute('rx'))*r.width,ry:Number(e.getAttribute('ry'))*r.height};});
  assert.ok(marker.width>0&&marker.height>0,'review photo/marker is not rendered');
  assert.ok(Math.abs(marker.rx-marker.ry)<1,'marker radius distorted by thumbnail aspect');
  assert.equal(await dialog.locator('[data-apply]').isDisabled(),true);
  await dialog.locator('[data-approve]').check();
  // Changing the selected spots invalidates every prior approval.
  await dialog.locator('[data-spot]').uncheck();
  await dialog.locator('[data-spot]').check();
  assert.equal(await dialog.locator('[data-approve]').isChecked(),false);
  await dialog.locator('[data-approve]').check();
  await dialog.locator('[data-next]').click();
  await dialog.locator('[data-approve]').check();
  await dialog.locator('[data-apply]').click();
  await waitJournal(page,list=>list.some(b=>b.label==='Sensor-dust sync (reviewed)'&&b.status==='completed'));
  const batch=await page.evaluate(async()=>{const list=await window.libtestRecipeBatchInvoke('recipe_batch_list',{});return window.libtestRecipeBatchInvoke('recipe_batch_get',{id:list.find(b=>b.label==='Sensor-dust sync (reviewed)').id});});
  assert.deepEqual(batch.items.map(i=>i.path),paths.slice(0,2));
  assert.ok(batch.items.every(i=>i.status==='applied'));
  for(const item of batch.items){const snap=JSON.parse(decodeURIComponent(escape(atob(item.recipe))));assert.equal(snap.heal.length,2);assert.equal(snap.heal[0].id,'existing');assert.equal(snap.heal[1].feather,0);const prior=JSON.parse(decodeURIComponent(escape(atob(original.recipe))));const appended=snap.heal.pop();assert.ok(appended.id.startsWith('dust-'));assert.deepEqual(snap,prior,'sync altered unrelated retouch/settings');}
  const untouched=await page.evaluate(path=>window.libtestRecipeBatchInvoke('get_sidecar',{path}),paths[2]);
  assert.equal(untouched.recipe,original.recipe,'unapproved photo changed');
  const fixture=(await readFile(process.env.CHROMA_DUST_FIXTURE || 'test/fixtures/chart.png')).toString('base64');
  const pixels=await page.evaluate(async ({fixture,batch,original,untouched})=>{
    const bytes=Uint8Array.from(atob(fixture),c=>c.charCodeAt(0));
    await loadFXImages([new File([bytes],'dust-review.png',{type:'image/png'})]);
    const image=curItem().img,c=document.createElement('canvas');c.width=image.naturalWidth||image.width;c.height=image.naturalHeight||image.height;
    const ctx=c.getContext('2d');ctx.drawImage(image,0,0);
    // Controlled sensor-dust defect on the loaded image, with a reproducible donor.
    const x=Math.round(c.width*.3),y=Math.round(c.height*.4),radius=Math.max(1,Math.floor(Math.max(c.width,c.height)*.006));
    ctx.fillStyle='#000';ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fill();
    const decode=r=>JSON.parse(decodeURIComponent(escape(atob(r))));
    const prior=decode(original.recipe),synced=decode(batch.items[0].recipe),notApproved=decode(untouched.recipe);
    const selected={...synced.heal.at(-1)};
    const before=healApply(c,structuredClone(prior.heal));
    const after=healApply(c,structuredClone(synced.heal));
    const expected=healApply(c,[...structuredClone(prior.heal),selected]);
    const identity=healApply(c,structuredClone(notApproved.heal));
    const data=cv=>cv.getContext('2d').getImageData(0,0,c.width,c.height).data;
    const a=data(after),b=data(before),e=data(expected),u=data(identity);
    let changed=0,outside=0,parity=0,identityDiff=0;const outsideExamples=[];
    const rr=selected.r*Math.max(c.width,c.height)+2;
    for(let i=0;i<a.length;i++){if(a[i]!==b[i]){changed++;const px=(i>>2)%c.width,py=Math.floor((i>>2)/c.width);if(Math.hypot(px+.5-selected.x*c.width,py+.5-selected.y*c.height)>rr){outside++;if(outsideExamples.length<12)outsideExamples.push([px,py,i%4,b[i],a[i]]);}}parity=Math.max(parity,Math.abs(a[i]-e[i]));identityDiff=Math.max(identityDiff,Math.abs(u[i]-b[i]));}
    const center=(y*c.width+x)*4,brightness=d=>(d[center]+d[center+1]+d[center+2])/3;
    // The real Editor working-source path must consume the transferred operations
    // before preview, native-detail loupe and tiled export render their pixels.
    curItem().img=c;
    // Apply the journal recipe through the real recipe consumer, never assign its
    // retouch array directly: this fails if batch sync uses a session-only field.
    applyUISnapshot(synced);
    if(JSON.stringify(curItem().heal)!==JSON.stringify(synced.heal))throw Error('Recipe application did not restore synced healing');
    if(JSON.stringify(getUISnapshot().heal)!==JSON.stringify(synced.heal))throw Error('Healing did not survive canonical snapshot roundtrip');
    updateWork();
    const work=fxWork,P=getFXParams(),oldParams=getFXParams,oldTileSize=fxExportTileSize;
    for(const key of ['grain','halation','bloom','artifacts'])if(P[key])P[key].enabled=false;
    P.masks=[];P.redEyeOps=[];
    const readCanvas=cv=>{const copy=document.createElement('canvas');copy.width=cv.width;copy.height=cv.height;copy.getContext('2d').drawImage(cv,0,0);return data(copy);};
    const maxDiff=(a,b)=>{if(a.length!==b.length)throw Error('render dimensions differ');let m=0;for(let i=0;i<a.length;i++)m=Math.max(m,Math.abs(a[i]-b[i]));return m;};
    let previewDiff,loupeDiff,tileDiff,tiles=0;
    try {
      getFXParams=()=>P;
      fxLoupe=false;renderPreview();const pw=FX.cv.width,ph=FX.cv.height,preview=readCanvas(FX.cv);
      previewDiff=maxDiff(preview,data(await processToCanvas(P,work,pw,ph)));
      fxLoupe=true;fxZoom=1;loupeCX=.3;loupeCY=.4;renderLoupe();const lw=FX.cv.width,lh=FX.cv.height,loupe=readCanvas(FX.cv);
      const crop=document.createElement('canvas');crop.width=lw;crop.height=lh;
      const ox=Math.min(work.width-lw,Math.max(0,Math.round(loupeCX*work.width-lw/2))),oy=Math.min(work.height-lh,Math.max(0,Math.round(loupeCY*work.height-lh/2)));
      crop.getContext('2d').drawImage(work,ox,oy,lw,lh,0,0,lw,lh);
      loupeDiff=maxDiff(loupe,data(await processToCanvas(P,crop,lw,lh)));
      const full=data(await processToCanvas(P,work,work.width,work.height));
      fxExportTileSize=()=>256;
      const tiled=await renderTiled(P,work,work.width,work.height,()=>{tiles++;});
      tileDiff=maxDiff(full,data(tiled));
    } finally {getFXParams=oldParams;fxExportTileSize=oldTileSize;fxLoupe=false;}
    return {width:c.width,height:c.height,changed,outside,outsideExamples,parity,identityDiff,before:brightness(b),after:brightness(a),canvasCount:document.querySelectorAll('canvas').length,previewDiff,loupeDiff,tileDiff,tiles};
  },{fixture,batch,original,untouched});
  console.log('Rendered dust transfer:',JSON.stringify(pixels));
  assert.ok(pixels.changed>0,'transferred dust recipe produced no pixel repair');
  assert.ok(pixels.after>pixels.before,'dark dust center did not brighten');
  assert.equal(pixels.outside,0,'dust transfer changed pixels outside spot');
  assert.equal(pixels.parity,0,'synced recipe diverged from direct per-target repair');
  assert.equal(pixels.identityDiff,0,'unapproved target pixels changed');
  assert.ok(pixels.canvasCount>0);
  assert.ok(pixels.previewDiff<=1,'preview differs from repaired source render');
  assert.ok(pixels.loupeDiff<=1,'loupe differs from repaired source detail');
  assert.ok(pixels.tileDiff<=1,'tile boundaries differ from full repaired export');
  assert.ok(pixels.tiles>1,'export did not exercise multiple tiles');
  await page.evaluate(()=>window.chromasmithRecipeBatchHistory());
  await page.locator(`dialog[open] [data-batch="${batch.id}"]`).click();
  await page.locator('dialog[open] [data-action="undo"]').click();
  await waitJournal(page,list=>list.some(b=>b.id===batch.id&&b.status==='undone'));
  for(const path of paths){assert.equal((await page.evaluate(path=>window.libtestRecipeBatchInvoke('get_sidecar',{path}),path)).recipe,original.recipe);}
  await page.locator('dialog[open] [data-action="close"]').click();
  // A known different capture day must prevent approval, while unknown metadata above
  // allowed explicit approval. Drive the real context menu on the date-spread mock.
  await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=6&libdates=1&deskx=1`);
  await page.locator('#lib-grid .lib-card[data-path]').first().waitFor();
  await page.waitForTimeout(1000);
  await page.evaluate(()=>{const s=getUISnapshot();s.heal=[{x:.3,y:.4,r:.02,sx:.5,sy:.5,mode:'heal'}];window.__copiedRecipe=btoa(unescape(encodeURIComponent(JSON.stringify(s))));window.__copiedRecipeOrigin={path:'/mock/IMG_0999.jpg',recipe:window.__copiedRecipe};});
  await page.locator('#lib-grid .lib-card[data-path]').first().click({button:'right'});
  await page.getByText('Edit',{exact:true}).last().hover();
  await page.getByText('Sync sensor dust (review each photo)…',{exact:true}).click();
  await page.locator('#dust-sync-review [data-spot]').check();
  assert.equal(await page.locator('#dust-sync-review [data-approve]').isDisabled(),true);
  assert.match(await page.locator('#dust-sync-review [data-count]').innerText(),/different camera\/capture day/);
  await page.locator('#dust-sync-review [data-close]').click();
  assert.deepEqual(pageErrors,[]);
  console.log(`PASS reviewed dust selection, approval invalidation, two approved/one untouched, whole-batch UI undo (${Date.now()-started} ms)`);
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
