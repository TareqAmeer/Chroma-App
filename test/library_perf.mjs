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
// Correctness: clusterByHash was rewritten from a plain O(n^2) nested loop (444M comparisons at
// n=~30,000, measured ~1.7s and — worse — main-thread-blocking on every folder open) into exact
// pigeonhole/banded bucketing (8 bands of 8 bits; BANDS > DUPE_HAMMING_THRESHOLD=6 guarantees no
// true match is ever missed). "Exact" is a claim worth checking, not trusting: a faster clusterer
// that silently drops a real duplicate group would look identical to a correct one until a user
// noticed their duplicates stopped being found. This calls the REAL clusterByHash (exposed as
// window.__libClusterByHash under ?libtest=1, not a reimplementation) and diffs its grouping
// against an independent brute-force O(n^2) BigInt reference on synthetic data engineered to
// exercise the boundary: some fully random hashes, plus deliberate clusters at every Hamming
// distance 0..8 (straddling the threshold=6 cutoff on both sides), plus duplicate/near-duplicate
// hex strings and edge-case all-zero/all-f hashes.
{
  const p=await b.newPage();
  await p.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=20`,{waitUntil:'domcontentloaded',timeout:120000});
  await p.waitForTimeout(1200);
  const r=await p.evaluate(()=>{
    const THRESH=6;
    const rnd=()=>Array.from({length:16},()=>'0123456789abcdef'[(Math.random()*16)|0]).join('');
    const flipBits=(hex,k)=>{let v=BigInt('0x'+hex);for(let i=0;i<k;i++)v^=(1n<<BigInt((i*11+3)%64));return v.toString(16).padStart(16,'0');};
    const hashes=[];
    for(let i=0;i<300;i++)hashes.push(rnd());
    // Deliberate clusters around several distinct base hashes, at every distance 0..8 — some
    // strictly inside the threshold (must cluster), some strictly outside (must not).
    const bases=['0f1e2d3c4b5a6978','ffffffffffffffff','0000000000000000','a1b2c3d4e5f60718'];
    for(const base of bases){for(let d=0;d<=8;d++)hashes.push(flipBits(base,d));}
    hashes.push('0000000000000000'); // exact duplicate of a base — distance 0
    const pairs=hashes.map((h,i)=>[`p${i}`,h]);
    // Independent brute-force reference, BigInt-based (no popcount32, no bands) — deliberately
    // NOT sharing any code path with the implementation under test.
    const ref=(a,b)=>{let x=BigInt('0x'+a)^BigInt('0x'+b);let n=0n;while(x){n+=x&1n;x>>=1n;}return Number(n);};
    const parent=new Map();pairs.forEach(([p])=>parent.set(p,p));
    const find=(x)=>{while(parent.get(x)!==x)x=parent.get(x);return x;};
    const union=(a,b)=>{const ra=find(a),rb=find(b);if(ra!==rb)parent.set(ra,rb);};
    for(let i=0;i<pairs.length;i++)for(let j=i+1;j<pairs.length;j++){
      if(ref(pairs[i][1],pairs[j][1])<=THRESH)union(pairs[i][0],pairs[j][0]);
    }
    const refGroups=new Map();pairs.forEach(([p])=>{const r=find(p);if(!refGroups.has(r))refGroups.set(r,new Set());refGroups.get(r).add(p);});
    const refSig=Array.from(refGroups.values()).map(s=>Array.from(s).sort().join(',')).filter(g=>g.includes(',')).sort();

    const fastGroups=window.__libClusterByHash(pairs);
    const fastSig=Array.from(fastGroups.values()).map(g=>g.slice().sort().join(',')).filter(g=>g.includes(',')).sort();
    return {refSig,fastSig,n:pairs.length};
  });
  const same = JSON.stringify(r.refSig) === JSON.stringify(r.fastSig);
  console.log(`clusterByHash exactness: n=${r.n}, ${r.refSig.length} real groups (brute-force)  ${same?'PASS':'FAIL'}`);
  if(!same){
    failures.push(`clusterByHash's banded implementation disagrees with the brute-force reference`);
    console.error('  reference groups:', r.refSig);
    console.error('  fast groups:     ', r.fastSig);
  }
  await p.close();
}
// Regression guard for the pathological case that actually froze the app: a large cluster of
// near-identical/identical hashes (a burst sequence, brackets, timelapse frames — exactly what a
// real library accumulates) sharing most or all of the 8 bands at once. A first version of
// clusterByHash deduped a candidate pair verified via more than one shared band using a Set keyed
// on the STRING `i+','+j` — harmless for scattered hashes, but on a cluster this large it meant
// millions of ad-hoc heap-allocated string keys, which a live stack sample of a real ~57k-photo
// library's WebContent process showed dominating the main thread (71% of samples inside
// JavaScriptCore's operationSetGet doing string equality) for MINUTES — "app not responding",
// not just slow. This asserts clusterByHash stays fast even when every hash in a 3,000-photo
// cluster is pairwise identical (the worst case: every pair shares all 8 bands, so the old
// string-Set path would have paid its full cost here).
{
  const p=await b.newPage();
  await p.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=20`,{waitUntil:'domcontentloaded',timeout:120000});
  await p.waitForTimeout(1200);
  const r=await p.evaluate(()=>{
    const N=3000;
    const pairs=[];
    for(let i=0;i<N;i++)pairs.push([`dup${i}`,'0f1e2d3c4b5a6978']); // all identical -> one big cluster, shares every band
    const t0=performance.now();
    const groups=window.__libClusterByHash(pairs);
    const ms=performance.now()-t0;
    const sizes=Array.from(groups.values()).map(g=>g.length).sort((a,b)=>b-a);
    return {ms,n:pairs.length,biggest:sizes[0]||0,groupCount:groups.size};
  });
  const BUDGET_MS=5000;
  const ok = r.ms<=BUDGET_MS && r.biggest===r.n && r.groupCount===1;
  console.log(`clusterByHash worst-case (n=${r.n}, one big identical cluster): ${r.ms.toFixed(0)}ms <=${BUDGET_MS}ms, cluster size ${r.biggest}/${r.n}  ${ok?'PASS':'FAIL'}`);
  if(!ok){
    failures.push(`clusterByHash worst-case took ${r.ms.toFixed(0)}ms (budget ${BUDGET_MS}ms) or produced the wrong cluster (size ${r.biggest}/${r.n}, groups ${r.groupCount})`);
  }
  await p.close();
}
// Fix 1 of the catalog-backed-grid plan: ordinary folder browsing (openFolder) used to run its
// OWN independent, uncached filesystem walk (list_dir/listDirRecursive) on every single open —
// completely separate from the SQLite catalog's own walk-skip-optimized scan, which is why every
// earlier round of "make the catalog's walk faster" work never changed what was actually on
// screen. It now reads the grid's entries from catalog_query instead, registering/scanning the
// folder into the catalog first. This asserts the fix stayed fixed: reopening an ALREADY-
// registered folder must fire catalog_query, and must NOT fire list_dir/listDirRecursive at all —
// not "fires fewer times", zero, since any nonzero count here is exactly the redundant live walk
// this fix exists to remove.
{
  const p=await b.newPage();
  p.on('pageerror',e=>console.log('[pageerror]',e.message));
  await p.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=25`,{waitUntil:'domcontentloaded',timeout:120000});
  await p.waitForTimeout(1500); // let the boot sequence's own first openFolder settle
  const before = await p.evaluate(() => window.__libtestCallCounts());
  await p.evaluate((path) => window.__libOpenFolder(path), '/test/Photos');
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => window.__libtestCallCounts());
  const cards = await p.evaluate(() => document.querySelectorAll('#lib-grid .lib-card').length);
  const listDirFired = after.listDir > before.listDir;
  const catalogQueryFired = after.catalogQuery > before.catalogQuery;
  const ok = !listDirFired && catalogQueryFired && cards > 0;
  console.log(`reopen already-cataloged folder: list_dir calls +${after.listDir-before.listDir}, catalog_query calls +${after.catalogQuery-before.catalogQuery}, cards ${cards}  ${ok?'PASS':'FAIL'}`);
  if(!ok){
    failures.push(`reopening a folder fired list_dir ${after.listDir-before.listDir} time(s) (must be 0) or catalog_query didn't fire or the grid stayed empty (cards=${cards})`);
  }
  await p.close();
}

// Approved boot-sequence storyboard, scenario 1: a true first launch (no folder ever added) must
// show the in-app two-button empty state — NOT pop the OS folder picker unprompted, and not the
// bare editor dropzone either. See renderLibraryNoRoot() and its call site in toggleLibrary().
{
  const p=await b.newPage();
  p.on('pageerror',e=>console.log('[pageerror]',e.message));
  await p.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libnoroot=1`,{waitUntil:'domcontentloaded',timeout:120000});
  await p.waitForTimeout(1000);
  const r = await p.evaluate(() => ({
    addPhotos: !!document.getElementById('lib-empty-addphotos'),
    addFolder: !!document.getElementById('lib-empty-addfolder'),
  }));
  const ok = r.addPhotos && r.addFolder;
  console.log(`first-launch empty state: Add photos button ${r.addPhotos}, Add a folder button ${r.addFolder}  ${ok?'PASS':'FAIL'}`);
  if(!ok) failures.push(`first-launch empty state is missing a required button: ${JSON.stringify(r)}`);
  await p.close();
}

// Scenario 4: a disconnected drive must still show the FULL grid (from cache), not an empty or
// blocked view, with a persistent bottom status bar naming what's true — and each cached-only
// card carries the drive-disconnected badge, not a text label (see OFFLINE_BADGE_HTML).
{
  const p=await b.newPage();
  p.on('pageerror',e=>console.log('[pageerror]',e.message));
  await p.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=12&liboffline=1`,{waitUntil:'domcontentloaded',timeout:120000});
  await p.waitForTimeout(1200);
  const r = await p.evaluate(() => ({
    cards: document.querySelectorAll('#lib-grid .lib-card').length,
    badges: document.querySelectorAll('#lib-grid .lib-offline-badge').length,
    bar: document.getElementById('lib-offline-bar')?.textContent || null,
  }));
  const ok = r.cards === 12 && r.badges === 12 && r.bar && /drive not connected/i.test(r.bar);
  console.log(`disconnected drive: ${r.cards} cards, ${r.badges} offline badges, status bar ${r.bar ? 'present' : 'MISSING'}  ${ok?'PASS':'FAIL'}`);
  if(!ok) failures.push(`disconnected-drive scenario didn't render as expected: ${JSON.stringify(r)}`);
  await p.close();
}

// The new "Loading cached thumbnails" boot phase (prefetchThumbnails) must actually run BEFORE
// the grid renders, not after — otherwise it's just relabeling the same lazy per-card loads the
// splash was already hiding. Verified by the grid's own cards: every one should already carry
// .loaded (thumbCacheGet hit) the moment renderGrid() finishes, not fill in a beat later.
{
  const p=await b.newPage();
  p.on('pageerror',e=>console.log('[pageerror]',e.message));
  await p.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=15`,{waitUntil:'domcontentloaded',timeout:120000});
  await p.waitForTimeout(1200);
  const r = await p.evaluate(() => {
    const imgs = document.querySelectorAll('#lib-grid .lib-card img');
    return { total: imgs.length, loaded: Array.from(imgs).filter(i=>i.classList.contains('loaded')).length };
  });
  const ok = r.total > 0 && r.loaded === r.total;
  console.log(`cache-prefetch warms every card before first paint: ${r.loaded}/${r.total} loaded  ${ok?'PASS':'FAIL'}`);
  if(!ok) failures.push(`prefetchThumbnails didn't warm every card before renderGrid: ${JSON.stringify(r)}`);
  await p.close();
}

// Regression guard for the exact bug that got reported live: prefetchThumbnails (the "Loading
// cached thumbnails" boot phase) had no per-call timeout, so a single get_thumbnail_or_offline
// call that never resolved hung the ENTIRE boot sequence forever — confirmed by sampling the real
// running process: both it and its render process sat fully idle, not busy, waiting on a promise
// nothing would ever settle. The splash's own watchdog then hid the splash after its grace period
// (working as designed), revealing the app before the Library had actually finished loading —
// exactly the "stuck on the empty editor" symptom. Runs it twice — one hung call, and EVERY
// call hung — because the fix's actual claim is that the worst case is bounded by concurrency
// (PREFETCH_BUDGET_MS + one PREFETCH_CALL_TIMEOUT_MS per worker), not multiplied by how many
// items are stuck. If that claim were wrong, only the "all hung" run would show it — the
// single-item case would look fine either way.
for (const [label, hangParam] of [['one', 'IMG_1003'], ['every', 'all']]) {
  const p=await b.newPage();
  p.on('pageerror',e=>console.log('[pageerror]',e.message));
  const t0=Date.now();
  await p.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=25&libhangthumb=${hangParam}`,{waitUntil:'domcontentloaded',timeout:120000});
  // .lib-card.lib-skel (libSkeletonHtml's placeholder rows, also 25 of them by coincidence at
  // this libn) matches the same selector as a real card — wait for a REAL one (data-path is only
  // ever set on an actual rendered entry) so this doesn't pass on the pre-render skeleton state.
  await p.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card[data-path]').length > 0, {timeout: 15000}).catch(()=>{});
  const elapsedMs = Date.now()-t0;
  const cards = await p.evaluate(() => document.querySelectorAll('#lib-grid .lib-card[data-path]').length);
  const BUDGET_MS = 9000; // PREFETCH_BUDGET_MS (4s) + PREFETCH_CALL_TIMEOUT_MS (1.2s) + real margin — must NOT scale with hung-item count
  const ok = cards === 25 && elapsedMs <= BUDGET_MS;
  console.log(`${label} thumbnail call(s) hung permanently: grid rendered in ${elapsedMs}ms (<=${BUDGET_MS}ms), ${cards}/25 cards  ${ok?'PASS':'FAIL'}`);
  if(!ok) failures.push(`hangParam=${hangParam}: a hung get_thumbnail_or_offline call stalled boot: ${elapsedMs}ms elapsed, ${cards}/25 cards rendered`);
  await p.close();
}

// Boot readiness (RC-1, "library appears before it's usable"): the OLD boot gate resolved once
// toggleLibrary()'s promise chain settled — which only guarantees cards exist in the DOM, not
// that they have pixels, since loadThumb() queues each card's decode and returns immediately.
// That gap is exactly why the Library used to reveal a screenful of empty grey cards. This
// intercepts the real hideBootSplash() call (via an init script, so it's wrapped before
// library-ui.js's boot IIFE ever runs) and snapshots every MOUNTED card's <img> state at the
// instant the splash actually comes down — the assertion that never existed before: firstPaintReady()
// (library-ui.js) must resolve only once every mounted card has settled, loaded or failed.
// ⚠️ At libn=30 (a realistic first-screenful size, below PREFETCH_CAP=100) this mock's own
// prefetchThumbnails call already warms every card before renderGrid runs, so this specific case
// can't tell a correctly-gated boot from the old ungated one — verified by hand (not asserted
// here, since it would just be re-testing the mock's own instant-resolving promises) that forcing
// entries past PREFETCH_CAP surfaces cards still mid-decode when the old gate fired. What THIS
// assertion guards going forward is the invariant itself: nobody may reintroduce a path where
// hideBootSplash() runs before every mounted card is settled, regardless of why.
{
  const p=await b.newPage();
  p.on('pageerror',e=>console.log('[pageerror]',e.message));
  await p.addInitScript(() => {
    window.__bootSnapshot = null;
    Object.defineProperty(window, '__hideBootSplashReal', { value: undefined, writable: true, configurable: true });
    const install = () => {
      if (typeof window.hideBootSplash !== 'function' || window.__hideBootSplashWrapped) return;
      window.__hideBootSplashWrapped = true;
      const orig = window.hideBootSplash;
      window.hideBootSplash = function (...args) {
        const imgs = Array.from(document.querySelectorAll('#lib-grid .lib-card[data-path] img'));
        window.__bootSnapshot = {
          total: imgs.length,
          settled: imgs.filter(i => i.classList.contains('loaded') || i.classList.contains('thumb-error')).length,
        };
        return orig.apply(this, args);
      };
    };
    // hideBootSplash is defined inline in chromasmith-22.html before library-ui.js loads, but
    // poll briefly in case script order ever changes rather than depending on it.
    const t = setInterval(() => { install(); if (window.__hideBootSplashWrapped) clearInterval(t); }, 5);
    setTimeout(() => clearInterval(t), 5000);
  });
  await p.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=30`,{waitUntil:'domcontentloaded',timeout:120000});
  await p.waitForFunction(() => window.__bootSnapshot !== null, {timeout: 20000}).catch(()=>{});
  const snap = await p.evaluate(() => window.__bootSnapshot);
  const ok = !!snap && snap.total > 0 && snap.settled === snap.total;
  console.log(`boot readiness: splash hid with ${snap ? `${snap.settled}/${snap.total}` : 'NO SNAPSHOT'} mounted cards settled  ${ok?'PASS':'FAIL'}`);
  if(!ok) failures.push(`hideBootSplash() fired before every mounted card settled: ${JSON.stringify(snap)}`);
  await p.close();
}

await b.close();server.close();
console.log('-'.repeat(58));
if(failures.length){console.error('RESULT: FAIL');failures.forEach(f=>console.error('  '+f));process.exit(1);}
console.log('RESULT: PASS');
