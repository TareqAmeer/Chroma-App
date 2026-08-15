// Library-grid budgets, each anchored to a real pre-optimisation measurement on a synthetic
// folder (?libtest=1&libn=N — see the list_dir mock).
//
//   entries   DOM nodes            folder open
//     200     5,114 -> 5,114       (unchanged: below VIRT_MIN, deliberately the old path)
//   1,000    17,914 ->  1,994      4.3s -> 3.0s
//   5,000    never loaded          >30s TIMEOUT -> 3.2s
//
// Two independent faults, both measured rather than guessed. The grid built a card per file
// (~18 DOM nodes each), and clusterByHash compared every pair of perceptual hashes by allocating
// two BigInts and counting bits one at a time — 12.5M times at n=5,000.
//
// The popcount check is here for the same reason perf_bench pairs its timings with correctness
// guards: a faster hamming that returns DIFFERENT distances would silently re-cluster the user's
// duplicates, and would still look like a win on a stopwatch.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const ROOT=process.cwd();
const server=createServer(async(req,res)=>{try{const u=req.url.split('?')[0];const d=await readFile(path.join(ROOT,decodeURIComponent(u).slice(1)));
  res.writeHead(200,{'Content-Type':u.endsWith('.html')?'text/html':u.endsWith('.js')?'text/javascript':u.endsWith('.css')?'text/css':'application/octet-stream'});res.end(d);}catch{res.writeHead(404);res.end();}}).listen(0,'127.0.0.1');
await new Promise(r=>server.on('listening',r));
const port=server.address().port;
const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
let failures=[];
const BUDGET={200:{dom:8000},1000:{dom:6000},5000:{dom:6000,ms:20000}};
console.log('kind        n      budget        actual   status');
console.log('-'.repeat(58));
for (const n of [200,1000,5000]) {
  const p=await b.newPage();
  p.on('pageerror',e=>console.log('[pageerror]',e.message));
  const t0=Date.now();
  await p.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=${n}`,{waitUntil:'domcontentloaded',timeout:180000});
  await p.waitForTimeout(2500);
  const loadMs=Date.now()-t0;
  const r=await p.evaluate(()=>({dom:document.querySelectorAll('*').length,
    cards:document.querySelectorAll('#lib-grid .lib-card').length}));
  const bud=BUDGET[n];
  const domOk=r.dom<=bud.dom, msOk=bud.ms?loadMs<=bud.ms:true;
  if(!domOk)failures.push(`n=${n} DOM ${r.dom} > ${bud.dom}`);
  if(!msOk)failures.push(`n=${n} open ${loadMs}ms > ${bud.ms}ms`);
  console.log(`domNodes  ${String(n).padEnd(6)} <=${String(bud.dom).padEnd(10)} ${String(r.dom).padEnd(8)} ${domOk?'PASS':'FAIL'}`);
  if(bud.ms)console.log(`openMs    ${String(n).padEnd(6)} <=${String(bud.ms).padEnd(10)} ${String(loadMs).padEnd(8)} ${msOk?'PASS':'FAIL'}`);
  if(n===5000&&r.cards>200)failures.push(`n=5000 mounted ${r.cards} cards — virtualisation not active`);
  await p.close();
}
// Correctness: the SWAR popcount must agree with the original BigInt hamming exactly.
{
  const p=await b.newPage();
  await p.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=20`,{waitUntil:'domcontentloaded',timeout:120000});
  await p.waitForTimeout(1200);
  const r=await p.evaluate(()=>{
    const ref=(a,b)=>{let x=BigInt('0x'+a)^BigInt('0x'+b);let n=0n;while(x){n+=x&1n;x>>=1n;}return Number(n);};
    const pop=(v)=>{v=v-((v>>>1)&0x55555555);v=(v&0x33333333)+((v>>>2)&0x33333333);return (((v+(v>>>4))&0x0f0f0f0f)*0x01010101)>>>24;};
    const rnd=()=>Array.from({length:16},()=>'0123456789abcdef'[(Math.random()*16)|0]).join('');
    const hs=[];for(let i=0;i<400;i++)hs.push(rnd());
    const base='0f1e2d3c4b5a6978';
    for(let d=0;d<=8;d++){let v=BigInt('0x'+base);for(let k=0;k<d;k++)v^=(1n<<BigInt(k*7%64));hs.push(v.toString(16).padStart(16,'0'));}
    let mism=0,checked=0;
    for(let i=0;i<hs.length;i++)for(let j=i+1;j<hs.length;j++){
      const hi1=parseInt(hs[i].slice(0,8),16)|0,lo1=parseInt(hs[i].slice(8,16),16)|0;
      const hi2=parseInt(hs[j].slice(0,8),16)|0,lo2=parseInt(hs[j].slice(8,16),16)|0;
      checked++; if(ref(hs[i],hs[j])!==pop(hi1^hi2)+pop(lo1^lo2))mism++;
    }
    return {checked,mism};
  });
  console.log('-'.repeat(58));
  console.log(`popcount vs BigInt reference: ${r.checked} pairs, ${r.mism} mismatches  ${r.mism?'FAIL':'PASS'}`);
  if(r.mism)failures.push(`hamming popcount disagrees with the BigInt reference on ${r.mism} pairs`);
  await p.close();
}
await b.close();server.close();
console.log('-'.repeat(58));
if(failures.length){console.error('RESULT: FAIL');failures.forEach(f=>console.error('  '+f));process.exit(1);}
console.log('RESULT: PASS');
