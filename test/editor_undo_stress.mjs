// T36 (editor_ux_spec.json, 2026-09-11): one behavioural test exercises undo/redo functionally
// (a single click, a single undo); nothing hammers it — many edits, undo-to-start, redo-to-end —
// to confirm the history array actually stays bounded under real load (fxHistory.length>20 caps
// it, chromasmith-22.html:14924) and that the round trip lands on the exact value it started at,
// not an off-by-one from a stack/index bug that a single-edit test can't expose.
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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&deskx=1`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.evaluate(() => { if (typeof fxSection === 'function') fxSection('adjust', true); });

const fixtureB64 = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
await page.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const file = new File([bytes], 'portrait.png', { type: 'image/png' });
  if (typeof window.loadFXImages === 'function') await window.loadFXImages([file]);
}, fixtureB64);
await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages && fxImages.length > 0, { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(300);

const N = 30; // comfortably past the 20-entry cap, so a growth regression can't hide inside it
const startValue = await page.locator('#sl-adj-exp').inputValue();

for (let i = 1; i <= N; i++) {
  const lenBefore = await page.evaluate(() => fxHistory.length);
  await page.evaluate((v) => {
    const sl = document.getElementById('sl-adj-exp');
    sl.value = String(v);
    sl.dispatchEvent(new Event('input', { bubbles: true })); // oninput="fxUpdate()" — real slider-drag path
  }, i % 100 - 50); // keep inside a plausible -50..50 exposure range
  // fxUpdate()'s own history push is debounced ~400ms after the LAST input (chromasmith-22.html's
  // own comment on _fxHistPushTimer), but real elapsed time to fire is variable under main-thread
  // load (render/GPU-readback work queued ahead of the timer callback — confirmed live, a fixed
  // 800ms sleep sometimes wasn't enough). Poll for the actual length change instead of guessing a
  // sleep duration, with generous headroom; each edit still must fully settle before the next one
  // or this would just be re-testing the debounce collapsing a fast drag into one push.
  await page.waitForFunction((prev) => fxHistory.length > prev, lenBefore, { timeout: 3000 }).catch(() => {});
}
await page.waitForTimeout(200);

const historyLenAfterEdits = await page.evaluate(() => typeof fxHistory !== 'undefined' ? fxHistory.length : null);
// With N=30 edits and a 20-entry cap, the earliest state (the pre-edit "Start" snapshot, plus
// the first ~10 edits) has already been shifted out by design (chromasmith-22.html:14924) — undo
// can only walk back to the OLDEST SURVIVING entry, not all the way to the original value. Read
// that entry's own exposure value out of the live history instead of assuming it's the pre-edit
// start, so this test verifies the real (correct) capped-history contract rather than a wrong
// expectation of infinite undo depth.
const expectedAfterFullUndo = await page.evaluate(() => {
  const snap = JSON.parse(fxHistory[0].j);
  return String(snap.sliders?.['adj-exp'] ?? '');
});

// Undo all the way back, then redo all the way forward.
const maxSteps = N + 5; // headroom so this can't silently under-undo if idx tracking is off
for (let i = 0; i < maxSteps; i++) {
  const idx = await page.evaluate(() => fxHistIdx);
  if (idx <= 0) break;
  await page.evaluate(() => { if (typeof fxUndo === 'function') fxUndo(); });
  await page.waitForTimeout(15);
}
await page.waitForTimeout(300);
const afterFullUndo = await page.locator('#sl-adj-exp').inputValue();

for (let i = 0; i < maxSteps; i++) {
  const idx = await page.evaluate(() => fxHistIdx);
  const len = await page.evaluate(() => fxHistory.length);
  if (idx >= len - 1) break;
  await page.evaluate(() => { if (typeof fxRedo === 'function') fxRedo(); });
  await page.waitForTimeout(15);
}
await page.waitForTimeout(300);
const afterFullRedo = await page.locator('#sl-adj-exp').inputValue();

await browser.close();
server.close();

const findings = [];
if (historyLenAfterEdits === null) findings.push('could not read fxHistory from the page — check the global still exists as a bare var');
else if (historyLenAfterEdits > 21) findings.push(`fxHistory grew to ${historyLenAfterEdits} entries after ${N} edits — the length>20 cap (chromasmith-22.html:14924) did not hold`);
if (afterFullUndo !== expectedAfterFullUndo) findings.push(`undo-to-oldest-surviving-entry landed on "${afterFullUndo}", expected "${expectedAfterFullUndo}" (history was capped, so this isn't the pre-edit "${startValue}")`);
const lastEditValue = String((N % 100) - 50);
if (afterFullRedo !== lastEditValue) findings.push(`redo-to-end landed on "${afterFullRedo}", expected the last edit's "${lastEditValue}"`);
if (errors.length) findings.push(...errors.map((e) => `uncaught page error: ${e}`));

console.log('EDITOR UNDO/REDO STRESS (T36)');
console.log('='.repeat(78));
console.log(`  ${N} edits pushed, fxHistory settled at ${historyLenAfterEdits} entries (cap: 20)`);
if (findings.length) {
  findings.forEach((f) => console.log('  ' + f));
  console.log(`\n${findings.length} finding(s).`);
  console.log('RESULT: FAIL');
  process.exit(1);
} else {
  console.log('History stayed bounded under load; undo-to-oldest-surviving-entry and redo-to-end both landed exactly.');
  console.log('RESULT: PASS');
}
