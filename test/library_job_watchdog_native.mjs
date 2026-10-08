import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'file:///C:/Users/Tareq/Documents/github/Chroma-App/.worktrees/chr272-reset-integration/node_modules/playwright/index.mjs');
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
const page=browser.contexts()[0].pages()[0];
const saved=await page.evaluate(()=>({history:localStorage.getItem('chromasmith-job-history-v1'),active:localStorage.getItem('chromasmith-active-jobs-v1'),theme:document.body.classList.contains('light')?'light':'dark'}));
try {
 await page.setViewportSize({width:1366,height:768});
 await page.reload();
 await page.waitForFunction(()=>typeof window.libActivityJob==='function');
 const results=[];
 for(const theme of ['dark','light']){
  await page.evaluate(theme=>{window.fxSetTheme(theme);window.__jobClock=Date.now;const base=Date.now();window.__jobNow=base;Date.now=()=>window.__jobNow;window.libActivityJob('export',{jobId:'watch-old',label:'Older export',stage:'working',done:1,total:5});window.__jobNow=base+100000;window.libActivityJob('export',{jobId:'watch-fresh',label:'Fresh export',stage:'working',done:2,total:5});},theme);
  await page.waitForTimeout(5200);
  if(!await page.locator('#lib-activity .lib-act-pop').count())await page.locator('#lib-act-pill').evaluate(el=>el.click());
  let text=await page.locator('#lib-activity').innerText();
  assert.match(text,/No recent progress/);assert.match(text,/not.*confirmed.*fail/i);assert.match(text,/Restart continuation is unavailable/);
  let snapshot=await page.evaluate(()=>window._activityDebugSnapshot());
  assert.equal(snapshot.queued[0][1].noRecentProgress,false);
  assert.equal(snapshot.activity.outcome,null);
  await page.evaluate(()=>{window.__jobNow+=100000;window.libActivityJob('export',{jobId:'watch-old',stage:'working',done:2,total:5});});
  await page.waitForTimeout(5200);
  text=await page.locator('#lib-activity').innerText();
  assert.match(text,/Fresh export · No recent progress/);
  snapshot=await page.evaluate(()=>window._activityDebugSnapshot());assert.equal(snapshot.queued[0][1].noRecentProgress,true);
  await mkdir('test/output',{recursive:true});await page.screenshot({path:`test/output/library-job-watchdog-${theme}.png`});
  await page.evaluate(()=>{window.libActivityJob('export',{jobId:'queued-terminal',stage:'working'});window.libActivityJobDone('export',{jobId:'queued-terminal',outcome:'cancelled'});});
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('chromasmith-active-jobs-v1')).some(j=>j.id==='queued-terminal')),false);
  await page.evaluate(()=>window.libActivityJobDone('export',{jobId:'watch-old',outcome:'cancelled'}));
  assert.match(await page.locator('#lib-activity').innerText(),/cancelled/i);
  await page.waitForTimeout(8500);
  snapshot=await page.evaluate(()=>window._activityDebugSnapshot());assert.equal(snapshot.activity.jobId,'watch-fresh');
  assert.match(await page.locator('#lib-activity').innerText(),/No recent progress/);
  await page.evaluate(()=>{window.libActivityJobDone('export',{jobId:'watch-fresh',outcome:'cancelled'});Date.now=window.__jobClock;});
  await page.waitForTimeout(8500);
  results.push({theme,independentWarnings:true,promotionPreservesAge:true,cancelledDistinct:true});
 }
 await mkdir('test/output',{recursive:true});await writeFile('test/output/library-job-watchdog-native.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await page.evaluate(saved=>{if(window.__jobClock)Date.now=window.__jobClock;window.fxSetTheme(saved.theme);for(const [key,value] of [['chromasmith-job-history-v1',saved.history],['chromasmith-active-jobs-v1',saved.active]]){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}},saved).catch(()=>{});await browser.close();}

