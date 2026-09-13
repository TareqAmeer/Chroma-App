// Runtime counterpart to scripts/build-component-registry.mjs. It exercises the major app
// pages/layouts plus dynamic Masks/catalog content, records component variants actually present
// in Chromium, and maps each appearance to a source declaration where a stable selector permits.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS } from './wireframe_diff_lib.mjs';

const ROOT = process.cwd();
const CHECK = process.argv.includes('--check');
const OUT = path.join(ROOT, 'design/components-runtime.json');
const sourceRegistry = JSON.parse(await readFile(path.join(ROOT, 'design/components.json'), 'utf8'));
const server = createServer(async (req, res) => {
  try { const u = decodeURIComponent(req.url.split('?')[0]); const d = await readFile(path.join(ROOT, u.slice(1))); res.writeHead(200, { 'Content-Type': u.endsWith('.html') ? 'text/html' : u.endsWith('.js') ? 'text/javascript' : u.endsWith('.css') ? 'text/css' : 'application/octet-stream' }); res.end(d); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}/desktop/dist/index.html`;
const browser = await chromium.launch({ args: DETERMINISTIC_LAUNCH_ARGS });
const appearances = [];

const SCAN = `(state) => {
  const defs = [
    ['section-card','.fx-ctrl'],['control-row','.fx-row'],['toggle','.fx-toggle,.opt-toggle'],
    ['slider','input[type=range],.fx-slider'],['select','select,.fx-select'],['segmented-control','.seg,.lib-seg'],
    ['button','button,.btn,.lib-btn'],['icon-button','.btn-icon,.lib-btn-icon,.lib-iconchip'],
    ['chip','.lib-chip'],['info-button','.fx-info-i'],['search-input','.lib-search-wrap'],
    ['menu','.lib-menu,.fx-settings-menu,.fx-bgmenu']
  ];
  const out=[];
  const esc=(v)=>CSS.escape(v);
  for(const [family,sel] of defs) for(const el of document.querySelectorAll(sel)){
    const r=el.getBoundingClientRect(), cs=getComputedStyle(el);
    if(r.width<=0||r.height<=0||cs.display==='none'||cs.visibility==='hidden')continue;
    const stable=el.id?'#'+esc(el.id):['data-fxsec','data-act','data-fgrp','data-fval','aria-label'].map(k=>el.getAttribute(k)?'['+k+'="'+esc(el.getAttribute(k))+'"]':null).find(Boolean)||null;
    const semantic=stable||[family,el.getAttribute('role')||el.tagName.toLowerCase(),(el.getAttribute('aria-label')||el.title||el.textContent||'').trim().replace(/\\s+/g,' ').slice(0,80)].join('::');
    out.push({family,state,semantic,selector:stable,tag:el.tagName.toLowerCase(),classes:[...el.classList].sort(),label:(el.getAttribute('aria-label')||el.title||el.textContent||'').trim().replace(/\\s+/g,' ').slice(0,100),disabled:!!el.disabled});
  }
  return out;
}`;
async function scan(page, state) { appearances.push(...await page.evaluate(`(${SCAN})(${JSON.stringify(state)})`)); }
async function boot(query = '?libtest=1&deskx=1', viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport, ...DETERMINISTIC_CONTEXT_OPTIONS });
  await page.goto(base + query, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => { document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); }); if (typeof applyFxLayout === 'function') applyFxLayout(); });
  await page.keyboard.press('Escape');
  return page;
}
const page = await boot();
const fixture = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
await page.evaluate(async (b64) => { const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)); await loadFXImages([new File([bytes],'portrait.png',{type:'image/png'})]); }, fixture);
for (const tab of ['fx','match','copy','collage','guide']) { await page.evaluate((x) => switchTab(x), tab); await page.waitForTimeout(80); await scan(page, `page:${tab}`); }
await page.evaluate(() => {
  switchTab('fx'); fxSection('local', true); fxUpdate=()=>{};
  const core=window.__TAURI__&&window.__TAURI__.core;
  if(core&&!core.__componentRuntimeWrapped){const real=core.invoke.bind(core);core.invoke=(cmd,args)=>/^(sam_|sam2_|depth_|faceparse_)/.test(cmd)?Promise.reject(new Error('offline runtime registry')):real(cmd,args);core.__componentRuntimeWrapped=true;}
});
for (const type of ['radial','linear','brush','sky','skin','coat','ai','color','lum','depth']) {
  await page.evaluate((t) => { fxState.masks=[]; mskSel=0; if(t==='depth'&&curItem()?.img)curItem().img._depthMapAttempted=true; mskAdd(t); }, type);
  await scan(page, `editor:masks-${type}`);
}
await page.evaluate(() => { if (window.chromasmithForceLibraryReady) chromasmithForceLibraryReady(); document.getElementById('lib-overlay')?.classList.add('on','full'); });
await page.waitForTimeout(150); await scan(page, 'library:full');
await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => { document.getElementById('lib-overlay')?.classList.remove('full'); if(typeof applyFxLayout==='function')applyFxLayout(); }); await page.waitForTimeout(100); await scan(page, 'mobile');
await page.close();
const catalog = await boot('?catalog=1&libtest=1&deskx=1'); await scan(catalog, 'catalog'); await catalog.close();
await browser.close(); server.close();

const bySelector = new Map();
for (const x of sourceRegistry.instances) if (x.selector) { if(!bySelector.has(x.selector))bySelector.set(x.selector,[]); bySelector.get(x.selector).push(x.key); }
const unique = new Map();
for (const x of appearances) {
  const key = `${x.state}|${x.family}|${x.semantic}`;
  if (!unique.has(key)) unique.set(key, { ...x, sourceDeclarations: x.selector ? (bySelector.get(x.selector) || []) : [], unresolved: !x.selector || !(bySelector.get(x.selector) || []).length });
}
const instances = [...unique.values()].sort((a,b)=>a.state.localeCompare(b.state)||a.family.localeCompare(b.family)||a.semantic.localeCompare(b.semantic));
const variants = [...new Set(instances.map((x)=>`${x.family}|${x.tag}|${x.classes.join('.')}`))].sort();
const doc = { schemaVersion: 1, states: [...new Set(instances.map((x)=>x.state))], appearanceCount: instances.length, declarationCount: new Set(instances.flatMap((x)=>x.sourceDeclarations)).size, variants, unresolved: instances.filter((x)=>x.unresolved).map((x)=>({state:x.state,family:x.family,semantic:x.semantic})), instances };
const rendered = JSON.stringify(doc, null, 2) + '\n';
if (CHECK) {
  const old = await readFile(OUT, 'utf8').catch(()=> '');
  if (old !== rendered) { console.error(`runtime component registry changed: ${instances.length} appearances, ${variants.length} variants; run npm run components:build and review design/components-runtime.json`); process.exit(1); }
  console.log(`runtime component registry: ${instances.length} appearances across ${doc.states.length} states; ${variants.length} variants unchanged`);
} else {
  await writeFile(OUT, rendered);
  console.log(`runtime component registry: wrote ${instances.length} appearances across ${doc.states.length} states; ${variants.length} variants`);
}
