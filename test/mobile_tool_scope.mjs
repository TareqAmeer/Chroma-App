#!/usr/bin/env node
// Phones get a focused tool set (FX_MOBILE_HIDE); every visible category chip has tools.
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mime={'.html':'text/html','.js':'text/javascript','.png':'image/png'};
const server=createServer(async(req,res)=>{try{const f=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname));
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  res.setHeader('Content-Type',mime[path.extname(f)]||'application/octet-stream');res.end(await readFile(f));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:['--use-gl=swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox','--enable-unsafe-swiftshader']});
try{
  const ctx=await browser.newContext({viewport:{width:375,height:812},hasTouch:true,isMobile:true});
  await ctx.addInitScript(()=>{localStorage.setItem('chromasmith-tour-seen-v1','1');localStorage.setItem('cs_install_seen','1');});
  const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`,{waitUntil:'load'});
  await page.setInputFiles('#in-fx-img', path.join(root,'test/fixtures/gradient.png'));
  await page.waitForFunction(()=>{const c=document.getElementById('fx-canvas');return c&&c.width>0;},null,{timeout:30000});
  await page.evaluate(()=>{document.querySelector('[data-tour-action="close"]')?.click();document.getElementById('cs-modal-ov')?.remove();});
  await page.waitForTimeout(600);
  await page.evaluate(()=>fxToolsOpen());await page.waitForTimeout(300);
  const grid=await page.evaluate(()=>[...document.querySelectorAll('#fx-tool-grid .fx-sec-btn')].map(b=>b.dataset.sec));
  for(const k of ['inprint','filmneg','wheels','pointcolor','nr','deconv','lens','redeye'])assert(!grid.includes(k),k+' is desktop-only');
  for(const k of ['looks','adjust','curves','hsl','grain','hal','bloom','local','retouch','crop'])assert(grid.includes(k),k+' stays on phones');
  const cats=await page.evaluate(()=>[...document.querySelectorAll('#fx-tool-cats button')].map(b=>{fxMobileFilter(b.dataset.cat);return{cat:b.dataset.cat,hidden:b.hidden,n:[...document.querySelectorAll('#fx-tool-grid .fx-sec-btn')].filter(x=>!x.hidden).length};}));
  for(const c of cats)assert(c.hidden||c.n>0,'category '+c.cat+' is visible but empty');
  await page.evaluate(()=>{fxToolsClose();fxMoreMenu();});await page.waitForTimeout(400);
  const more=await page.evaluate(()=>[...document.querySelectorAll('.phone-dialog-content button')].filter(e=>e.offsetParent).map(e=>e.textContent.trim()));
  for(const t of ['All FX settings','Histogram','Metadata','Compare (split view)'])assert(!more.some(x=>x.startsWith(t)),t+' is desktop-only');
  for(const t of ['History','Reset photo'])assert(more.some(x=>x.startsWith(t)),t+' stays in the phone More menu');
  assert.deepEqual(errs,[]);
  console.log('PASS phone tool scope: '+grid.length+' tools, no empty categories; More menu: '+more.length+' items');
}finally{await browser.close();server.close();}
