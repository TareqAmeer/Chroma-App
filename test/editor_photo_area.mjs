#!/usr/bin/env node
// CHR-264: records the photo's share of the window at 1280/1440/1920 in both themes (screenshots in
// test/output/photo-area) and fails if the editor layout stops filling the window width.
import { chromium } from 'playwright';
import { createServer } from 'node:http';import { readFile } from 'node:fs/promises';import path from 'node:path';
import { fileURLToPath } from 'node:url';import { mkdir } from 'node:fs/promises';import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),S=path.join(root,'test/output/photo-area');await mkdir(S,{recursive:true});
const server=createServer(async(q,r)=>{try{const f=path.join(root,decodeURIComponent(new URL(q.url,'http://x').pathname));r.setHeader('Cross-Origin-Opener-Policy','same-origin');r.setHeader('Cross-Origin-Embedder-Policy','require-corp');r.end(await readFile(f));}catch{r.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const b=await chromium.launch({args:['--use-gl=swiftshader','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const tag=process.argv[2]||'now',out=[];
for(const [w,h] of [[1280,800],[1440,900],[1920,1080]])for(const theme of ['dark','light']){
  const ctx=await b.newContext({viewport:{width:w,height:h}});
  await ctx.addInitScript(t=>{localStorage.setItem('chromasmith-tour-seen-v1','1');localStorage.setItem('cs_install_seen','1');localStorage.setItem('csTheme',t);},theme);
  const p=await ctx.newPage();
  await p.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`);
  await p.waitForFunction(()=>typeof fxSection==='function');
  await p.setInputFiles('#in-fx-img',{name:'photo3x2.png',mimeType:'image/png',buffer:await p.evaluate(async()=>{const c=document.createElement('canvas');c.width=3000;c.height=2000;const g=c.getContext('2d'),gr=g.createLinearGradient(0,0,0,2000);gr.addColorStop(0,'#000');gr.addColorStop(1,'#fff');g.fillStyle=gr;g.fillRect(0,0,3000,2000);const b=await new Promise(r=>c.toBlob(r,'image/png'));return [...new Uint8Array(await b.arrayBuffer())];}).then(a=>Buffer.from(a))});
  await p.waitForFunction(()=>{const c=document.getElementById('fx-canvas');return c&&c.width>0;},null,{timeout:30000});
  await p.evaluate(()=>{document.querySelector('[data-tour-action="close"]')?.click();document.getElementById('cs-modal-ov')?.remove();});
  await p.waitForTimeout(1200);
  const m=await p.evaluate(()=>{const r=document.getElementById('fx-canvas').getBoundingClientRect();const box=id=>{const e=document.getElementById(id)||document.querySelector(id);if(!e||!e.offsetWidth)return null;const x=e.getBoundingClientRect();return [Math.round(x.left),Math.round(x.top),Math.round(x.width),Math.round(x.height)];};
    return{deskx:document.body.classList.contains('deskx'),light:document.body.classList.contains('light'),pw:Math.round(r.width),ph:Math.round(r.height),grid:(()=>{const L=document.querySelector('.fx-layout');if(!L)return null;const cs=getComputedStyle(L);return {cols:cs.gridTemplateColumns,kids:[...L.children].filter(c=>c.offsetWidth).map(c=>(c.id||c.className).slice(0,25)+'@'+Math.round(c.getBoundingClientRect().left)+'+'+c.offsetWidth)};})(),bars:{deskbar:box('fx-deskbar'),panel:box('.fx-panel'),rail:box('fx-toolrail'),film:box('fx-filmstrip'),wrap:box('fx-zoom-wrap')}};});
  m.share=+(100*m.pw*m.ph/(w*h)).toFixed(1);
  out.push({w,h,theme,...m});
  await p.screenshot({path:`${S}/${w}-${theme}.png`});
  const right=Math.max(...m.grid.kids.map(k=>{const [a,b]=k.split('@')[1].split('+').map(Number);return a+b;}));
  assert(right>=w-2,`editor layout fills the ${w}px window (ends at ${right}px)`);
  await ctx.close();
}
for(const o of out)console.log(`${o.w}x${o.h} ${o.theme}: photo ${o.pw}x${o.ph} = ${o.share}% of the window`);
console.log('PASS editor photo area: layout fills the window at every width');await b.close();server.close();
