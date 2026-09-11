// T40 (editor_ux_spec.json, 2026-09-11): the app can be opened in two tabs against the same
// IndexedDB (the 'chromasmith' DB's lutcache store, session localStorage) — a realistic user
// mistake (open two Chromasmith tabs) — and nothing tested concurrent-write behaviour between
// them. This checks two things stay true when that happens: (1) a write from one tab is visible
// to the other via a fresh read (IndexedDB is meant to support this — a REGRESSION would be data
// corruption or a thrown error, not "last write wins", which is an acceptable, defined outcome),
// and (2) neither tab throws an uncaught error just from the other tab's concurrent activity.
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
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm' };
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const port = server.address().port;
const URL = `http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&deskx=1`;

const browser = await chromium.launch();
const context = await browser.newContext();
const errors = [];
const findings = [];

const pageA = await context.newPage();
pageA.on('pageerror', (e) => errors.push(`tab A: ${e.message}`));
await pageA.goto(URL, { waitUntil: 'domcontentloaded' });
await pageA.waitForTimeout(1200);

const pageB = await context.newPage();
pageB.on('pageerror', (e) => errors.push(`tab B: ${e.message}`));
await pageB.goto(URL, { waitUntil: 'domcontentloaded' });
await pageB.waitForTimeout(1200);

// Write a fake LUT-cache entry from tab A via the same lutTx() the real app uses.
const KEY = '__crosstab_test_key__';
const writeOk = await pageA.evaluate(async (key) => {
  try {
    await lutTx('readwrite', (s) => s.put({ name: key, data: new Uint8Array([1, 2, 3]) }), 'lutcache');
    return true;
  } catch (e) { return e.message; }
}, KEY);
if (writeOk !== true) findings.push(`tab A write failed: ${writeOk}`);

// Read it back from tab B — a genuinely separate JS realm, separate IndexedDB connection.
const readFromB = await pageB.evaluate(async (key) => {
  try {
    const rec = await lutTx('readonly', (s) => s.get(key), 'lutcache');
    return rec ? { ok: true, len: rec.data ? rec.data.length : null } : { ok: false, reason: 'not found' };
  } catch (e) { return { ok: false, reason: e.message }; }
}, KEY);
if (!readFromB.ok) findings.push(`tab B could not read tab A's write: ${readFromB.reason}`);
else if (readFromB.len !== 3) findings.push(`tab B read back wrong data length: ${readFromB.len}, expected 3`);

// Concurrent write race: both tabs write DIFFERENT values to the SAME key at roughly the same
// time. The defined-outcome bar (per this ticket's own framing) is "no corruption, no throw" —
// NOT that a specific tab must win. Assert the key ends up as EXACTLY ONE of the two values, not
// something malformed in between (a real corruption failure mode for a naive read-modify-write).
const [raceA, raceB] = await Promise.all([
  pageA.evaluate(async (key) => {
    try { await lutTx('readwrite', (s) => s.put({ name: key, data: new Uint8Array([9, 9, 9]) }), 'lutcache'); return true; }
    catch (e) { return e.message; }
  }, KEY),
  pageB.evaluate(async (key) => {
    try { await lutTx('readwrite', (s) => s.put({ name: key, data: new Uint8Array([7, 7, 7]) }), 'lutcache'); return true; }
    catch (e) { return e.message; }
  }, KEY),
]);
if (raceA !== true) findings.push(`tab A concurrent write failed: ${raceA}`);
if (raceB !== true) findings.push(`tab B concurrent write failed: ${raceB}`);
const finalVal = await pageA.evaluate(async (key) => {
  const rec = await lutTx('readonly', (s) => s.get(key), 'lutcache');
  return rec && rec.data ? Array.from(rec.data) : null;
}, KEY);
const validOutcomes = [[9, 9, 9], [7, 7, 7]];
if (!finalVal || !validOutcomes.some((v) => JSON.stringify(v) === JSON.stringify(finalVal))) {
  findings.push(`concurrent write from both tabs left the key as ${JSON.stringify(finalVal)}, neither tab's value — possible corruption`);
}

// Clean up the test key so this doesn't pollute a real lutcache used elsewhere.
await pageA.evaluate(async (key) => { try { await lutTx('readwrite', (s) => s.delete(key), 'lutcache'); } catch (e) {} }, KEY);

await context.close();
await browser.close();
server.close();

if (errors.length) findings.push(...errors);

console.log('EDITOR CROSS-TAB INDEXEDDB CHECK (T40)');
console.log('='.repeat(78));
if (findings.length) {
  findings.forEach((f) => console.log('  ' + f));
  console.log(`\n${findings.length} finding(s).`);
  console.log('RESULT: FAIL');
  process.exit(1);
} else {
  console.log('Writes from one tab are visible to another; a concurrent write race resolves to one valid value, no corruption, no uncaught errors.');
  console.log('RESULT: PASS');
}
