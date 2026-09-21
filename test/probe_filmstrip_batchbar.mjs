// CHR-118: floating Reject/Pick/Clear flag bar (#lib-batchbar) must not appear over docked filmstrip.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const srv = createServer(async (q,r)=>{try{r.setHeader('content-type',q.url.includes('.html')?'text/html':q.url.includes('.js')?'text/javascript':'application/octet-stream');r.end(await readFile(path.join(process.cwd(),decodeURIComponent(q.url.split('?')[0]))))}catch{r.statusCode=404;r.end()}}).listen(0);
const br = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const pg = await br.newPage({viewport:{width:1440,height:900}});
await pg.goto(`http://localhost:${srv.address().port}/desktop/dist/index.html?libtest=1&deskx=1`);
await pg.waitForTimeout(2000);
await pg.evaluate(()=>document.querySelectorAll('button').forEach(b=>{if(b.textContent.trim()==='Got it')b.click()}));
await pg.keyboard.press('Escape');
const b64=(await readFile('test/fixtures/portrait.png')).toString('base64');
await pg.evaluate(async b=>{const f=new File([Uint8Array.from(atob(b),c=>c.charCodeAt(0))],'p.png',{type:'image/png'});await window.loadFXImages([f])},b64);
await pg.waitForTimeout(1500);
const cards=()=>pg.$$('#lib-grid [data-path], #lib-grid .lib-card, #lib-grid > *');
const probe=async(label,shot)=>{
  const c=(await cards())[0]; if(c){await c.click({modifiers:['Control']}).catch(()=>{});await c.click().catch(()=>{}); await c.hover().catch(()=>{});}
  await pg.waitForTimeout(500);
  const r=await pg.evaluate(()=>({full:document.getElementById('lib-overlay').classList.contains('full'),cards:document.querySelectorAll('#lib-grid > *').length,bar:!!document.getElementById('lib-batchbar')}));
  console.log(label,JSON.stringify(r)); await pg.screenshot({path:shot});};
await probe('docked',process.argv[2]+'/docked.png');
await pg.evaluate(()=>window.chromasmithToggleExpandedView());
await pg.waitForTimeout(1000);
await pg.mouse.click(700,450); await pg.keyboard.press('Meta+a'); await pg.keyboard.press('Control+a');
await pg.waitForTimeout(500);
const r=await pg.evaluate(()=>({full:document.getElementById('lib-overlay').classList.contains('full'),bar:!!document.getElementById('lib-batchbar')}));
console.log('full',JSON.stringify(r)); await pg.screenshot({path:process.argv[2]+'/full.png'});
await br.close();srv.close();
