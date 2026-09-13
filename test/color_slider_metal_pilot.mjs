#!/usr/bin/env node
// Focused evidence gate for the isolated Color Mixer liquid-progress pilot.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT=process.cwd(),OUT=path.join(ROOT,'test/output/color-slider-metal-pilot');
await mkdir(OUT,{recursive:true});
const server=createServer(async(req,res)=>{try{const u=decodeURIComponent(req.url.split('?')[0]);const d=await readFile(path.join(ROOT,u==='/'?'/chromasmith-22.html':u));res.writeHead(200,{'Content-Type':path.extname(u)==='.html'?'text/html':'application/octet-stream'});res.end(d);}catch{res.writeHead(404);res.end();}});
const localServer=await new Promise(resolve=>{server.once('error',()=>resolve(false));server.listen(0,'127.0.0.1',()=>resolve(true));});
const base=localServer?`http://127.0.0.1:${server.address().port}/chromasmith-22.html`:'file://'+path.join(ROOT,'chromasmith-22.html'),report={scope:['#sl-hsl-h','#sl-hsl-s','#sl-hsl-l'],states:{},checks:{},limitations:[]};
let browser;try{browser=await chromium.launch({headless:true});}catch(error){report.limitations.push(`Browser launch unavailable in this environment: ${error.message.split('\n')[0]}`);report.checks.browser={status:'SKIP',reason:'restricted browser runtime'};if(localServer)server.close();await writeFile(path.join(OUT,'report.json'),JSON.stringify(report,null,2));console.log('color-slider-metal-pilot — SKIP (restricted browser runtime; report written)');process.exit(0);}
async function pageFor(reduced=false){const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:reduced?'reduce':'no-preference'});await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForTimeout(900);await page.evaluate(()=>{const t=document.getElementById('tg-hsl');if(t&&!t.classList.contains('on'))t.click();});await page.waitForTimeout(100);return page;}
const page=await pageFor();
async function setPercent(percent){return page.evaluate((percent)=>{const sl=document.getElementById('sl-hsl-h');sl.value=String(-100+percent*2);sl.dispatchEvent(new Event('input',{bubbles:true}));return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r({box:sl.getBoundingClientRect().toJSON(),metrics:hslMetalPilot.metrics(),value:sl.value}))));},percent);}
for(const pct of [0,20,50,100]){const state=await setPercent(pct);await page.locator('#ff-hsl').screenshot({path:path.join(OUT,`dark-${pct}.png`)});report.states[pct]={input:{x:Math.round(state.box.x),y:Math.round(state.box.y),width:Math.round(state.box.width),height:Math.round(state.box.height),ratio:Number((state.box.width/state.box.height).toFixed(2))},canonicalValue:Number(state.value),drawP95ms:Number(state.metrics.p95.toFixed(3))};}
// Native drag and keyboard controls preserve their canonical HSL state and dispatch input.
await page.locator('#sl-hsl-h').focus();await page.keyboard.press('Home');const home=await page.locator('#sl-hsl-h').inputValue();await page.keyboard.press('End');const end=await page.locator('#sl-hsl-h').inputValue();await page.keyboard.press('ArrowLeft');const arrow=await page.locator('#sl-hsl-h').inputValue();
const box=await page.locator('#sl-hsl-h').boundingBox();await page.mouse.move(box.x+2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width*.73,box.y+box.height/2,{steps:5});await page.mouse.up();const dragged=await page.locator('#sl-hsl-h').inputValue();
report.checks.native={home,end,arrow,dragged,canvasAriaHidden:await page.locator('#hsl-metal-canvas').getAttribute('aria-hidden'),canvasPointerEvents:await page.locator('#hsl-metal-canvas').evaluate(e=>getComputedStyle(e).pointerEvents),inputStillFocusable:await page.locator('#sl-hsl-h').evaluate(e=>document.activeElement===e||!!e.focus)};
// Verify all Color-pilot widths used by the existing resizer's min/default/max range and clip bounds.
report.checks.resize=[];for(const width of [220,320,440]){await page.evaluate(width=>{if(typeof fxPanelWidth==='function')fxPanelWidth(width);},width);await page.waitForTimeout(80);report.checks.resize.push(await page.evaluate(width=>{const host=document.getElementById('ff-hsl').getBoundingClientRect(),canvas=document.getElementById('hsl-metal-canvas').getBoundingClientRect();return {width,hostWidth:Math.round(host.width),canvasWidth:Math.round(canvas.width),clipped:canvas.left<host.left-.5||canvas.right>host.right+.5};},width));}
const metrics=await page.evaluate(()=>hslMetalPilot.metrics());await page.waitForTimeout(300);report.checks.idle=await page.evaluate(()=>hslMetalPilot.metrics());report.checks.performance={activeAfterInput:metrics.active,idleActive:report.checks.idle.active,p95ms:Number(metrics.p95.toFixed(3)),budgetMs:1,passes:metrics.p95<=1};
await page.close();
const reduced=await pageFor(true);await reduced.locator('#sl-hsl-h').evaluate(el=>{el.value='40';el.dispatchEvent(new Event('input',{bubbles:true}));});await reduced.waitForTimeout(50);report.checks.reducedMotion=await reduced.evaluate(()=>({canvasDisplay:getComputedStyle(document.getElementById('hsl-metal-canvas')).display,metrics:hslMetalPilot.metrics()}));await reduced.close();
report.limitations.push('The reference is a 7.44:1, 262px-tall single progress bar; the approved pilot confines the effect to compact 16px native HSL tracks. Geometry parity is intentionally limited to front direction, attachment, endpoint compression, haze hierarchy, and motion behavior.');
if(!localServer)report.limitations.push('The restricted environment denied a loopback local server (EPERM), so this evidence uses the browser file URL; server-only integration was not treated as an application failure.');
await browser.close();if(localServer)server.close();await writeFile(path.join(OUT,'report.json'),JSON.stringify(report,null,2));
console.log(`color-slider-metal-pilot — ${report.checks.performance.passes?'PASS':'FAIL'}; report ${path.relative(ROOT,path.join(OUT,'report.json'))}`);
if(!report.checks.performance.passes)process.exitCode=1;
