import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const srv = createServer(async (q, r) => { try { const d = await readFile(path.join(process.cwd(), decodeURIComponent(q.url.split('?')[0]).slice(1))); r.writeHead(200, {'Content-Type': q.url.includes('.js')?'text/javascript':q.url.includes('.css')?'text/css':'text/html'}); r.end(d);} catch { r.writeHead(404); r.end(); } }).listen(0,'127.0.0.1');
await new Promise(r => srv.on('listening', r));
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', m =>  console.log('[console.error]', m.text()));
await page.goto(`http://127.0.0.1:${srv.address().port}/desktop/dist/index.html?libtest=1&libcat=1&libn=60`);
await page.locator('#lib-grid .lib-card').first().waitFor({ timeout: 20000 });
await page.evaluate(() => document.querySelectorAll('button').forEach(b => b.textContent.trim()==='Got it' && b.click()));
let fail = 0;
for (const mode of ['full']) {
  await page.evaluate(m => document.getElementById('lib-overlay').classList.toggle('full', m==='full'), mode);
  await page.waitForTimeout(300);
  console.log('MODAL', await page.evaluate(() => [...document.querySelectorAll('.cs-modal-ov')].map(e=>{const c=getComputedStyle(e);return e.outerHTML.slice(0,300)+' | disp='+c.display+' vis='+c.visibility+' op='+c.opacity+' pe='+c.pointerEvents+' z='+c.zIndex+' pos='+c.position}).join('\n')));
  await page.evaluate(() => { const m=document.getElementById('lib-view-menu'); const cl=m.classList; const rm=cl.remove.bind(cl); cl.remove=(...a)=>{console.log('[REMOVE]', new Error().stack.split('\n').slice(1,5).join(' <- ')); return rm(...a);}; document.addEventListener('click',e=>console.log('[DOCCLICK]',e.target.tagName,e.target.id,e.isTrusted,e.eventPhase),true); new MutationObserver(()=>console.log('[MUT] t='+performance.now()+' open='+cl.contains('open'))).observe(m,{attributes:true}); });
  await page.locator('#lib-view-menu-btn').click({ force: true }).catch(e => console.log('click err', e.message));
  const r = await page.evaluate(() => {
    const btn = document.getElementById('lib-view-menu-btn'), m = document.getElementById('lib-view-menu');
    const bb = btn.getBoundingClientRect(), mb = m.getBoundingClientRect();
    const hit = document.elementFromPoint(bb.x+bb.width/2, bb.y+bb.height/2);
    const opt = m.querySelector('.opt,.opt-action'); const ob = opt.getBoundingClientRect();
    const hit2 = document.elementFromPoint(ob.x+ob.width/2, ob.y+ob.height/2);
    return { open: m.classList.contains('open'), display: getComputedStyle(m).display, btn: [bb.x,bb.y,bb.width,bb.height], menu: [mb.x,mb.y,mb.width,mb.height], btnHitOK: btn.contains(hit), hitTag: hit?.id||hit?.className, optHitOK: m.contains(hit2), hit2: hit2?.id||hit2?.className, vw: innerWidth, vh: innerHeight };
  });
  await page.screenshot({path:'/private/tmp/claude-501/gear.png'});
  const cov = await page.evaluate(() => { const m=document.getElementById('lib-view-menu'); return [...m.querySelectorAll('.opt,.opt-action')].map(o=>{const b=o.getBoundingClientRect();const h=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return (o.id||o.textContent.trim().slice(0,20))+' -> '+(m.contains(h)?'ok':(h&&(h.tagName+'#'+h.id+'.'+h.className)))+' '+Math.round(b.y)}); });
  console.log(cov.join('\n'));
  console.log(await page.evaluate(() => { let e=document.getElementById('lib-view-menu'), o=[]; while(e&&e!==document.body){const c=getComputedStyle(e); o.push((e.id||e.className)+' pos='+c.position+' z='+c.zIndex+' tf='+c.transform+' flt='+c.filter+' ct='+c.contain+' iso='+c.isolation+' op='+c.opacity+' wc='+c.willChange+' bf='+c.backdropFilter); e=e.parentElement;} return o.join('\n'); }));
  console.log(await page.evaluate(() => { const m=document.getElementById('lib-view-menu'); const b=m.getBoundingClientRect(); const h=document.elementFromPoint(b.x+100,b.y+100); const path=[]; let e=h; while(e&&e!==document.body){const c=getComputedStyle(e); path.push(e.tagName+'#'+e.id+'.'+e.className+' pos='+c.position+' z='+c.zIndex); e=e.parentElement;} return 'MENU pe='+getComputedStyle(m).pointerEvents+' vis='+getComputedStyle(m).visibility+'\nHIT '+path.join('\n  '); }));
  console.log('ANC', await page.evaluate(() => { let e=document.getElementById('lib-view-menu').parentElement,o=[]; while(e&&e!==document.body){const c=getComputedStyle(e); o.push((e.id||e.className)+' ov='+c.overflow+' clip='+c.clipPath+' cv='+c.contentVisibility+' ct='+c.contain+' h='+c.height+' disp='+c.display+' vis='+c.visibility); e=e.parentElement;} return o.join('\n'); }));
  console.log('STACK', await page.evaluate(() => document.elementsFromPoint(1300,200).slice(0,8).map(e=>e.tagName+'#'+e.id+'.'+e.className).join(' | ')));
  console.log('MENUCS', await page.evaluate(() => { const c=getComputedStyle(document.getElementById('lib-view-menu')); return [c.clipPath,c.visibility,c.opacity,c.display,c.height,c.left,c.right,c.top].join(',')+' parentBox '+JSON.stringify(document.getElementById('lib-settings').getBoundingClientRect()); }));
  console.log(mode, JSON.stringify(r));
  if (!r.open || !r.btnHitOK || !r.optHitOK) fail = 1;
}
await page.screenshot({path:'/private/tmp/claude-501/gear.png'}); await b.close(); srv.close(); process.exit(fail);
