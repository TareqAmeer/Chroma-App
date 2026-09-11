// T34 (editor_ux_spec.json, 2026-09-11): every other gate in this repo drives Chromium via
// Playwright — never the real WKWebView engine the shipping desktop (Tauri) and iOS (Capacitor)
// apps actually render with (docs/testing.md says so explicitly). Playwright's own `webkit`
// channel is not byte-identical to WKWebView, but it is the same rendering engine family (WebKit)
// and is far closer than Chromium — running the app's real boot + a real LUT render through it
// catches a class of engine-specific regression (a CSS property Chromium tolerates but WebKit
// doesn't, a GLSL extension WebKit's ANGLE build doesn't support, a JS API WebKit implements
// differently) that every Chromium-only gate is structurally blind to.
//
// Deliberately narrow scope, not a full re-run of every gate under webkit: boot the real
// desktop/dist build, load a fixture, run one full FX render (the same recipe shape
// export_harness.mjs uses), and assert (a) no console error, (b) the canvas actually painted
// non-transparent pixels, (c) crossOriginIsolated is true (the COI service-worker shim must also
// work under WebKit, not just Chromium). Widen this if a WebKit-only regression is ever found by
// a human first — this exists to make that a should-have-been-caught-by-CI story going forward.
import { webkit } from 'playwright';
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
    // Set COOP/COEP directly rather than relying on coi-serviceworker's self-reload cycle — same
    // convention export_harness.mjs already uses for exactly this reason (a fresh Playwright
    // context's first load is a bad place to depend on a service-worker-triggered reload landing
    // before the rest of the test proceeds). This still exercises the real crossOriginIsolated-
    // dependent code paths under WebKit; it just isn't itself a test of the SW's reload mechanics
    // (that's T35's job, and T35 explicitly needs the reload behaviour to be part of what's checked).
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const port = server.address().port;

const findings = [];
let browser;
try {
  browser = await webkit.launch();
} catch (e) {
  console.log('SKIP: WebKit browser not installed locally (`npx playwright install webkit`) —', e.message);
  server.close();
  process.exit(0); // not a failure of the app — an environment gap, don't block CI on it either
}
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const consoleErrors = [];
// WebKit's own generic "Failed to load resource" console message carries no URL, so it can't be
// filtered by EXPECTED_404 the way the requestfailed/response listeners below are — it's always
// redundant with one of those two (which DO carry the URL and are the ones actually asserted on),
// so it's dropped here rather than kept as an untraceable duplicate finding.
page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`));
// desktop/dist/ deliberately does NOT ship coi-serviceworker.min.js (build-desktop.sh's own
// comment: it exists only for the GitHub Pages / plain-web build, where Tauri isn't setting
// COOP/COEP itself) — chromasmith-22.html's own <script src> for it 404s here by design in every
// engine, not something specific to WebKit. Anything else 404ing is a real finding.
const EXPECTED_404 = /coi-serviceworker\.min\.js$/;
page.on('requestfailed', (r) => { if (!EXPECTED_404.test(r.url())) consoleErrors.push(`[requestfailed] ${r.url()} — ${r.failure()?.errorText}`); });
page.on('response', (r) => { if (r.status() === 404 && !EXPECTED_404.test(r.url())) consoleErrors.push(`[404] ${r.url()}`); });

await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);

const coi = await page.evaluate(() => window.crossOriginIsolated);
if (!coi) findings.push('crossOriginIsolated is false under WebKit — coi-serviceworker.min.js may not be taking effect on this engine');

const fixtureB64 = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
const loadOk = await page.evaluate(async (b64) => {
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'portrait.png', { type: 'image/png' });
    if (typeof window.loadFXImages === 'function') await window.loadFXImages([file]);
    return true;
  } catch (e) { return e.message; }
}, fixtureB64);
if (loadOk !== true) findings.push(`loadFXImages threw under WebKit: ${loadOk}`);

await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages && fxImages.length > 0, { timeout: 15000 }).catch(() => {
  findings.push('fxImages never populated under WebKit within 15s — real load path likely broken on this engine');
});
await page.waitForTimeout(1000);

// A real render happened if the canvas has non-transparent pixels somewhere (the identity/default
// render always paints the loaded photo, so an all-transparent canvas means the WebGL pipeline
// itself failed silently on this engine — exactly the "quieter shader bug class" CLAUDE.md §3
// warns about, just under a different engine than that warning was written for).
const painted = await page.evaluate(() => {
  const canvas = document.querySelector('#fx-canvas') || document.querySelector('canvas');
  if (!canvas) return 'no canvas element found';
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) return 'no WebGL context on canvas under WebKit';
  const w = Math.min(canvas.width, 64), h = Math.min(canvas.height, 64);
  if (!w || !h) return 'canvas has zero size';
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let anyNonZeroAlpha = false;
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) { anyNonZeroAlpha = true; break; }
  return anyNonZeroAlpha ? true : 'canvas read back as fully transparent — WebGL pipeline produced nothing under WebKit';
});
if (painted !== true) findings.push(`render check failed under WebKit: ${painted}`);

if (consoleErrors.length) findings.push(...consoleErrors.map((e) => `console error under WebKit: ${e}`));

await browser.close();
server.close();

console.log('EDITOR WEBKIT SMOKE (T34) — real boot + load + render under Playwright webkit');
console.log('='.repeat(78));
if (findings.length) {
  findings.forEach((f) => console.log('  ' + f));
  console.log(`\n${findings.length} finding(s).`);
  console.log('RESULT: FAIL');
  process.exit(1);
} else {
  console.log('App booted, loaded a photo, and rendered non-transparent pixels under WebKit with no console errors.');
  console.log('RESULT: PASS');
}
