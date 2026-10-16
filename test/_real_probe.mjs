import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os'; import path from 'node:path'; import { randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
const T=tmpdir(), F=k=>path.join(T,`chromasmith_automation_${k}.json`), S=path.join(T,'cs_real_sweep');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const token=randomBytes(18).toString('hex'); const w=(p,v)=>{writeFileSync(p+'.t',JSON.stringify(v));renameSync(p+'.t',p);};
w(F('enable'),{token});
spawnSync('pkill',['-x','chromasmith']); await sleep(1500);
execFileSync('open',['-n','--env',`CS_CATALOG_DIR=${S}/catalog`,'--env',`CS_CACHE_DIR=${S}/cache`,'desktop/src-tauri/target/release/bundle/macos/Chromasmith.app']);
async function ev(code,t=15000){const id=randomBytes(8).toString('hex');w(F('command'),{id,token,action:'eval',code});const e=Date.now()+t;while(Date.now()<e){try{const r=JSON.parse(readFileSync(F('result'),'utf8'));if(r.id===id)return r.ok?r.result:'ERR '+r.error;}catch(_){}await sleep(80);}return 'timeout';}
await sleep(9000);
console.log(await ev(`({root:localStorage.getItem('chromasmith_lib_root'), tiles:document.querySelectorAll('[data-path]').length, sample:[...document.querySelectorAll('[data-path]')].slice(0,6).map(e=>e.className+' '+e.dataset.path+' dir='+e.dataset.isDir), lsKeys:localStorage.length})`));
console.log(await ev(`window.__TAURI__.core.invoke('catalog_query',{q:{}}).then(r=>JSON.stringify(r).slice(0,300)).catch(e=>'qerr '+e)`));
spawnSync('pkill',['-x','chromasmith']);
