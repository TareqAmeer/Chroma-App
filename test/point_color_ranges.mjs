#!/usr/bin/env node
// CHR-259: Point Colour ranges can be switched off, duplicated and limited to a lightness band; each
// changes the rendered colour (off leaves the pixel untouched).
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
  const page=await browser.newPage({viewport:{width:1440,height:900}});const errs=[];page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`,{waitUntil:'load'});
  await page.setInputFiles('#in-fx-img', path.join(root,'test/fixtures/chart.png'));
  await page.waitForFunction(()=>{const c=document.getElementById('fx-canvas');return c&&c.width>0;},null,{timeout:30000});
  await page.evaluate(()=>{document.querySelector('[data-tour-action="close"]')?.click();document.getElementById('cs-modal-ov')?.remove();});
  await page.evaluate(()=>{fxSection('pointcolor');if(!document.getElementById('tg-pointcolor').classList.contains('on'))toggleFX('pointcolor');
    const[h,s]=r2hsv(0.8,0.2,0.2);fxState.pointColors=[{h,s,rgb:[204,51,51],hue:0,sat:-100,lum:0,range:35,smoothness:50}];pcSel=0;pcRebuild();pcSyncUI();bakeHsl();fxUpdate();});
  const base=await page.evaluate(()=>applyPointColors(0.8,0.2,0.2,[]).map(v=>Math.round(v*1000)));
  const on=await page.evaluate(()=>applyPointColors(0.8,0.2,0.2,fxState.pointColors).map(v=>Math.round(v*1000)));
  assert.notDeepEqual(on,base,'an active range desaturates the picked red');
  await page.locator('#btn-pc-enable').click();
  assert.equal(await page.locator('#btn-pc-enable').textContent(),'Turn on');
  assert.deepEqual(await page.evaluate(()=>applyPointColors(0.8,0.2,0.2,fxState.pointColors).map(v=>Math.round(v*1000))),base,'off = untouched');
  await page.locator('#btn-pc-enable').click();
  await page.evaluate(()=>{const s=document.getElementById('sl-pc-llo');s.value=90;s.dispatchEvent(new Event('input'));});
  assert.deepEqual(await page.evaluate(()=>applyPointColors(0.8,0.2,0.2,fxState.pointColors).map(v=>Math.round(v*1000))),base,'a red darker than the band is left alone');
  await page.locator('text=Duplicate').first().click();
  const pts=await page.evaluate(()=>fxState.pointColors.length+':'+document.querySelectorAll('#pc-list .pc-chip').length+':'+fxState.pointColors[1].lumLo);
  assert.equal(pts,'2:2:90','duplicate copies the range with its settings');
  // Name: typed into the panel, shown on the chip, saved with the recipe (snapshot round-trip and
  // history), never part of the render.
  const cube0=await page.evaluate(()=>Array.from(FX._hslSnapshot||[]).join(','));
  await page.locator('#in-pc-name').fill('  Warm   skin ');await page.locator('#in-pc-name').press('Enter');
  assert.equal(await page.evaluate(()=>fxState.pointColors[1].name),'Warm skin');
  assert.equal(await page.locator('#pc-list .pc-chip').nth(1).getAttribute('title'),'Warm skin');
  assert.equal(await page.evaluate(()=>fxHistory[fxHistIdx].snap.pointColors[1].name),'Warm skin','rename is an undoable step');
  assert.equal(await page.evaluate(()=>Array.from(FX._hslSnapshot||[]).join(',')),cube0,'a name does not change the baked cube');
  assert.equal(await page.evaluate(()=>fxState.pointColors[0].name),undefined,'only the selected range is renamed');
  const saved=await page.evaluate(()=>JSON.stringify(getUISnapshot()));
  await page.evaluate(()=>{fxState.pointColors[1].name='x';});
  await page.evaluate((j)=>{applyUISnapshot(JSON.parse(j));pcSel=1;pcSyncUI();},saved);
  assert.equal(await page.evaluate(()=>fxState.pointColors[1].name),'Warm skin','name survives a recipe round-trip');
  assert.equal(await page.locator('#in-pc-name').inputValue(),'Warm skin');
  await page.locator('text=Duplicate').first().click();
  assert.equal(await page.evaluate(()=>fxState.pointColors[2].name),'Warm skin copy');
  await page.locator('#in-pc-name').fill('');await page.locator('#in-pc-name').press('Enter');
  assert.equal(await page.evaluate(()=>'name' in fxState.pointColors[2]),false,'clearing removes the name');
  assert.equal(await page.locator('#pc-list .pc-chip').nth(2).getAttribute('title'),'Point 3');
  assert.deepEqual(errs,[]);
  console.log('PASS point colour on/off, lightness band, duplicate and name');
}finally{await browser.close();server.close();}
