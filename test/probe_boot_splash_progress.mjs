// Regression probe: the desktop boot splash must visibly progress on a real launch against the
// real library (user report 2026-10-06: "starts on zero bars, stuck ~a minute, then jumps").
// Launches the built .app, polls the live splash via the automation channel, and FAILS if the
// splash sat on one percentage for >8s, or hid having lit fewer than 3 of its 11 wedge bars
// while boot took over 4s, or if the watchdog (not a ready gallery) hid it.  Usage: node test/probe_boot_splash_progress.mjs [runs=1]
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os'; import path from 'node:path'; import { randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
const T=tmpdir(), F=k=>path.join(T,`chromasmith_automation_${k}.json`);
const APP='desktop/src-tauri/target/release/bundle/macos/Chromasmith.app';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const token=randomBytes(18).toString('hex'); const w=(p,v)=>{writeFileSync(p+'.t',JSON.stringify(v));renameSync(p+'.t',p);};
async function ev(code,t=3000){const id=randomBytes(8).toString('hex');w(F('command'),{id,token,action:'eval',code});const e=Date.now()+t;while(Date.now()<e){try{const r=JSON.parse(readFileSync(F('result'),'utf8'));if(r.id===id)return r.ok?r.result:{err:r.error};}catch(_){}await sleep(40);}return null;}
const PROBE=`(()=>{const s=document.getElementById('boot-splash');const wg=document.getElementById('boot-splash-wedge');
 return {t:Math.round(performance.now()),gone:!s,pct:(document.getElementById('boot-splash-percent')||{}).textContent,
 stage:(document.getElementById('boot-splash-stage')||{}).textContent,bars:wg?[...wg.children].filter(c=>c.style.background).length:-1,
 marks:window._bootMarks||null}})()`;
const runs=+process.argv[2]||1; let fail=false;
for(let r=0;r<runs;r++){
  w(F('enable'),{token});
  spawnSync('pkill',['-x','chromasmith']); await sleep(2500);
  const t0=Date.now(); execFileSync('open',['-n',APP]);
  const log=[]; let last=null, maxBars=0, stuck=0, lastChange=null, end=null;
  while(Date.now()-t0<150000){
    const s=await ev(PROBE,2000); if(!s||s.err){await sleep(150);continue;}
    s.wall=Date.now()-t0;
    if(!last||s.pct!==last.pct||s.stage!==last.stage){log.push(s);if(lastChange!=null)stuck=Math.max(stuck,s.wall-lastChange);lastChange=s.wall;}
    if(!s.gone)maxBars=Math.max(maxBars,s.bars);
    last=s; if(s.gone||(s.marks&&s.marks.some(x=>x[0]==='reveal'))){end=s;break;} await sleep(200);
  }
  // The automation channel itself can lag boot under IPC load, so judge from the page's own
  // boot timeline (window._bootMarks: phase changes, each newly-lit bar, the reveal).
  const m=(end&&end.marks)||[]; const rev=m.find(x=>x[0]==='reveal');
  console.log(`run ${r+1}: marks ${JSON.stringify(m)}`);
  if(!rev){console.log('  FAIL no reveal recorded');fail=true;continue;}
  const pre=m.filter(x=>x[1]<=rev[1]); let gap=0; for(let i=1;i<pre.length;i++)gap=Math.max(gap,pre[i][1]-pre[i-1][1]);
  const bars=pre.filter(x=>x[0]==='bar').length;
  console.log(`  reveal at ${rev[1]}ms, ${bars} bars lit, longest gap with no progress ${gap}ms`);
  if(gap>8000){console.log('  FAIL splash sat still for '+gap+'ms');fail=true;}
  if(pre.some(x=>x[0]==='watchdog')){console.log('  FAIL watchdog hid the splash - the gallery was not ready');fail=true;}
  if(!pre.some(x=>x[0]==='firstpaint')){console.log('  FAIL splash hid before the gallery\'s first paint');fail=true;}
  if(rev[1]>4000&&bars<3){console.log('  FAIL only '+bars+' bars lit before reveal');fail=true;}
}
process.exit(fail?1:0);
