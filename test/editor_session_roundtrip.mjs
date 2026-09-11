// T37 (editor_ux_spec.json, 2026-09-11): loadSession()/saveSession() and the per-feature state
// (masks, curves, HSL bands, wheels, point colours — each with its own snapshot path per
// CLAUDE.md §6.11's typed-array/snapshot lesson) are load-bearing but nothing round-trips a
// session with several features touched at once, reloads the REAL PAGE (not just re-applies a
// snapshot in the same JS context), and diffs restored state against what was saved.
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
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.evaluate(() => { if (typeof fxSection === 'function') fxSection('adjust', true); });

// Touch several DIFFERENT feature families in one pass — a session bug is often per-family
// (one snapshot path broken, the rest fine), so a single-slider round-trip wouldn't catch it.
const setValues = await page.evaluate(() => {
  const sl = document.getElementById('sl-adj-exp'); sl.value = '37'; sl.dispatchEvent(new Event('input', { bubbles: true }));
  const cl = document.getElementById('cl-b1'); if (cl) { cl.value = '#3355ff'; cl.dispatchEvent(new Event('input', { bubbles: true })); }
  // HSL band: nudge the 'r' (red) band's saturation via fxState directly — same field
  // saveSession()/loadSession() round-trip (s._hsl), independent of which band is UI-selected.
  if (typeof fxState !== 'undefined' && fxState.hsl && fxState.hsl.r) fxState.hsl.r.s = 42;
  return {
    exp: document.getElementById('sl-adj-exp').value,
    color: document.getElementById('cl-b1') ? document.getElementById('cl-b1').value : null,
    hslR: fxState.hsl && fxState.hsl.r ? fxState.hsl.r.s : null,
  };
});

// Force an immediate save rather than waiting on sessionAutosave's 2s debounce — this test is
// about the round-trip's CORRECTNESS, not the debounce timing (that's a separate concern, same
// distinction editor_undo_stress.mjs draws for fxHistoryPush's own debounce).
const saveOk = await page.evaluate(() => {
  try { if (typeof saveSession === 'function') { saveSession(true); return true; } return 'saveSession not found';
  } catch (e) { return e.message; }
});

// Real reload — a fresh JS realm reading the same localStorage, exactly what a user's browser
// restart or tab reload does. This is the part a same-context snapshot/restore test can't prove.
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const restored = await page.evaluate(() => ({
  exp: document.getElementById('sl-adj-exp') ? document.getElementById('sl-adj-exp').value : null,
  color: document.getElementById('cl-b1') ? document.getElementById('cl-b1').value : null,
  hslR: (typeof fxState !== 'undefined' && fxState.hsl && fxState.hsl.r) ? fxState.hsl.r.s : null,
}));

await browser.close();
server.close();

const findings = [];
if (saveOk !== true) findings.push(`saveSession() did not run cleanly: ${saveOk}`);
if (restored.exp !== setValues.exp) findings.push(`slider (sl-adj-exp): saved "${setValues.exp}", restored "${restored.exp}"`);
if (restored.color !== setValues.color) findings.push(`colour (cl-b1): saved "${setValues.color}", restored "${restored.color}"`);
if (restored.hslR !== setValues.hslR) findings.push(`HSL band (hsl.r.s): saved ${setValues.hslR}, restored ${restored.hslR}`);
if (errors.length) findings.push(...errors.map((e) => `uncaught page error: ${e}`));

console.log('EDITOR SESSION ROUND-TRIP (T37)');
console.log('='.repeat(78));
if (findings.length) {
  findings.forEach((f) => console.log('  ' + f));
  console.log(`\n${findings.length} finding(s).`);
  console.log('RESULT: FAIL');
  process.exit(1);
} else {
  console.log('Slider, colour, and HSL-band state all round-tripped exactly through a real page reload.');
  console.log('RESULT: PASS');
}
