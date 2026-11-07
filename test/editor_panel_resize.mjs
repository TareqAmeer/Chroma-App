#!/usr/bin/env node
// CHR-264: the editor panel resizer clamps at 220/440px, defaults to 320px, persists across reload,
// and the photo grows as the panel shrinks.
import { chromium } from 'playwright';
import { createServer } from 'node:http';import { readFile } from 'node:fs/promises';import path from 'node:path';
import { fileURLToPath } from 'node:url';import { mkdir } from 'node:fs/promises';import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),S=path.join(root,'test/output/photo-area');await mkdir(S,{recursive:true});
const server=createServer(async(q,r)=>{try{const f=path.join(root,decodeURIComponent(new URL(q.url,'http://x').pathname));r.setHeader('Cross-Origin-Opener-Policy','same-origin');r.setHeader('Cross-Origin-Embedder-Policy','require-corp');r.end(await readFile(f));}catch{r.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const b=await chromium.launch({args:['--use-gl=swiftshader','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
for(const [w,h] of [[1280,800],[1920,1080]]){
  const ctx=await b.newContext({viewport:{width:w,height:h}});
  await ctx.addInitScript(()=>{localStorage.setItem('chromasmith-tour-seen-v1','1');localStorage.setItem('cs_install_seen','1');});
  const p=await ctx.newPage();
  const open=async()=>{await p.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`);await p.waitForFunction(()=>typeof fxSection==='function');
    await p.setInputFiles('#in-fx-img',{name:'g.png',mimeType:'image/png',buffer:await p.evaluate(async()=>{const c=document.createElement('canvas');c.width=3000;c.height=2000;c.getContext('2d').fillRect(0,0,3000,2000);const b=await new Promise(r=>c.toBlob(r,'image/png'));return [...new Uint8Array(await b.arrayBuffer())];}).then(a=>Buffer.from(a))});
    await p.waitForFunction(()=>{const c=document.getElementById('fx-canvas');return c&&c.width>0;},null,{timeout:30000});
    await p.evaluate(()=>{document.querySelector('[data-tour-action="close"]')?.click();document.getElementById('cs-modal-ov')?.remove();});await p.waitForTimeout(800);};
  const st=()=>p.evaluate(()=>({panel:Math.round(document.querySelector('.fx-panel').getBoundingClientRect().width),photo:Math.round(document.getElementById('fx-canvas').getBoundingClientRect().width)}));
  const drag=async dx=>{const r=await p.locator('#fx-panel-resizer').boundingBox();const x=r.x+r.width/2,y=r.y+r.height/2;await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x+dx,y,{steps:8});await p.mouse.up();await p.waitForTimeout(700);};
  await open();const d=await st();assert.equal(d.panel,320,`default panel 320px at ${w}`);
  await drag(-600);const max=await st();assert.equal(max.panel,440,`max 440px at ${w}`);
  await drag(300);const min=await st();assert.equal(min.panel,220,`min 220px at ${w}`);
  await drag(400);assert(await p.evaluate(()=>document.body.classList.contains('panel-closed')),`dragging below 60px closes the panel at ${w}`);
  const closed=await st();assert(closed.photo>=min.photo,`closing the panel never shrinks the photo at ${w}`);
  await p.locator('#fx-toolrail .fx-rail-btn').first().click();await p.waitForTimeout(600);
  assert(!(await p.evaluate(()=>document.body.classList.contains('panel-closed'))),`a rail button reopens the panel at ${w}`);assert.equal((await st()).panel,220,`reopens at its last width at ${w}`);
  assert(min.photo>=d.photo&&d.photo>=max.photo,`photo grows as the panel shrinks at ${w}: ${max.photo}/${d.photo}/${min.photo}`);
  await open();const re=await st();assert.equal(re.panel,220,`width persists across reload at ${w}`);
  console.log(`${w}px: panel 220/320/440 -> photo ${min.photo}/${d.photo}/${max.photo}px wide; closed ${closed.photo}px; persisted ${re.panel}px`);
  await ctx.close();
}
console.log('PASS editor panel resizer: min/default/max, close/reopen and persistence');
await b.close();server.close();
