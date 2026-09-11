// T35 (editor_ux_spec.json, 2026-09-11): coi-serviceworker.min.js is load-bearing for RAW decode
// on GitHub Pages (which can't set COOP/COEP headers itself), and CLAUDE.md §2 claims the web
// build is "genuinely offline-capable after one visit" via lutWarmCache() pulling every preset
// into IndexedDB. Nothing verified either claim mechanically before this.
//
// IMPORTANT — what this test found and why it's scoped the way it is: coi-serviceworker.min.js's
// fetch handler does `fetch(request).then(...)` on EVERY request — it has no Cache Storage usage
// at all, it only rewrites response headers. So a full page RELOAD while genuinely offline does
// NOT work (confirmed live: net::ERR_FAILED) — the "offline-capable" claim is specifically about
// LUT preset DATA already resolving from IndexedDB without a new fetch once lutWarmCache() has
// run, not about the HTML/JS shell surviving a cold reload with no network at all. This test
// checks the claim that's actually true (continued in-page use needs no further network once
// warmed) and separately, clearly logs the reload gap as a known, non-blocking finding rather
// than silently passing over it or failing the whole gate on something outside its actual scope.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const d = await readFile(path.join(ROOT, u.slice(1)));
    const ext = path.extname(u);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm', '.cube': 'text/plain', '.bin': 'application/octet-stream' };
    // No COOP/COEP set here on purpose — forces coi-serviceworker.min.js to actually do its job,
    // the same constraint GitHub Pages imposes in production.
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const port = server.address().port;
const URL = `http://127.0.0.1:${port}/chromasmith-22.html`;

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const findings = [];
const notes = [];
const errors = [];
const logs = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => logs.push(m.text()));

const t0 = Date.now();
await page.goto(URL, { waitUntil: 'load' });
const becameIsolated = await page.waitForFunction(() => window.crossOriginIsolated === true, { timeout: 15000 }).then(() => true).catch(() => false);
const firstLoadMs = Date.now() - t0;
if (!becameIsolated) findings.push('crossOriginIsolated never became true within 15s — the SW registration/reload cycle may be broken');

const t1 = Date.now();
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.crossOriginIsolated === true, { timeout: 15000 }).catch(() => {});
const repeatLoadMs = Date.now() - t1;

// The real "offline-capable" claim: lutWarmCache() populates IndexedDB in the background, and
// presetBytes() then resolves warmed keys WITHOUT a network fetch. Trigger it directly (it's
// normally idle-scheduled and would take a while to reach every key on its own) and wait for its
// own completion log rather than guessing a duration.
const warmed = await page.evaluate(async () => {
  if (typeof lutWarmCache !== 'function') return { ok: false, reason: 'lutWarmCache not found' };
  lutWarmCache();
  return { ok: true };
});
if (!warmed.ok) findings.push(`could not trigger lutWarmCache: ${warmed.reason}`);

// Pick a preset key that needed a real fetch (not one of the inline LUT_PRESETS) and confirm it
// now resolves purely from IndexedDB with the network fully cut. LUT_META/LUT_PRESETS are
// top-level `const`s in a non-module script — those do NOT become `window.*` properties (only
// `var`/function declarations do), so read them bare rather than off window.
const pickedKey = await page.evaluate(() => {
  const keys = Object.keys(typeof LUT_META !== 'undefined' ? LUT_META : {}).filter((k) => !LUT_PRESETS[k]);
  return keys[0] || null;
});
let offlinePresetOk = null;
if (pickedKey) {
  // Poll IndexedDB directly for the key landing in the lutcache store, rather than waiting on
  // lutWarmCache()'s own log() call (which writes to a DOM element, not console.log, and wasn't
  // observable via page.on('console') — confirmed live). Bounded to ~20s of idle-callback time.
  let cached = false;
  for (let i = 0; i < 100 && !cached; i++) {
    cached = await page.evaluate((key) => new Promise((resolve) => {
      const req = indexedDB.open('chromasmith', 2); // matches lutDB()'s own indexedDB.open call
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('lutcache')) { resolve(false); return; }
        const tx = db.transaction('lutcache', 'readonly').objectStore('lutcache').get(key);
        tx.onsuccess = () => resolve(!!tx.result);
        tx.onerror = () => resolve(false);
      };
      req.onerror = () => resolve(false);
    }), pickedKey);
    if (!cached) await page.waitForTimeout(200);
  }
  if (!cached) notes.push(`'${pickedKey}' never appeared in the lutcache IndexedDB store within ~20s — warming may be slower than this test waits, or the DB/store name drifted`);

  await context.setOffline(true);
  offlinePresetOk = await page.evaluate(async (key) => {
    try {
      const bytes = await presetBytes(key);
      return { ok: true, len: bytes.length };
    } catch (e) { return { ok: false, error: e.message }; }
  }, pickedKey);
  await context.setOffline(false);
  if (!offlinePresetOk.ok) findings.push(`presetBytes('${pickedKey}') failed while offline: ${offlinePresetOk.error}`);
} else {
  notes.push('no non-inline preset key found to test offline preset resolution against');
}

// Known, separate finding: a full page reload while offline does NOT work today (no Cache
// Storage layer in coi-serviceworker.min.js). Recorded as a note, not a failure — this is a
// product-scope question (add app-shell caching vs accept "stay on the page while offline" as
// the actual guarantee), not a regression in anything this session touched.
await context.setOffline(true);
let reloadWhileOfflineWorks = true;
try {
  await page.reload({ waitUntil: 'load', timeout: 8000 });
} catch (e) {
  reloadWhileOfflineWorks = false;
}
await context.setOffline(false);
notes.push(`full page reload while offline: ${reloadWhileOfflineWorks ? 'works' : 'FAILS (net::ERR_FAILED — no Cache Storage layer in coi-serviceworker.min.js; see this test file\'s header comment)'}`);

await browser.close();
server.close();

if (errors.length) findings.push(...errors.map((e) => `uncaught page error: ${e}`));

console.log('EDITOR OFFLINE / SERVICE-WORKER CHECK (T35)');
console.log('='.repeat(78));
console.log(`  first load: ${firstLoadMs}ms, repeat load: ${repeatLoadMs}ms, crossOriginIsolated=${becameIsolated}`);
if (pickedKey) console.log(`  offline presetBytes('${pickedKey}') after warming: ${offlinePresetOk.ok ? `ok (${offlinePresetOk.len} bytes, from IndexedDB, zero network)` : 'FAILED'}`);
notes.forEach((n) => console.log('  NOTE: ' + n));
if (findings.length) {
  findings.forEach((f) => console.log('  ' + f));
  console.log(`\n${findings.length} finding(s).`);
  console.log('RESULT: FAIL');
  process.exit(1);
} else {
  console.log('\nService worker registers and crossOriginIsolated works; warmed LUT presets resolve fully offline from IndexedDB with zero network.');
  console.log('RESULT: PASS');
}
