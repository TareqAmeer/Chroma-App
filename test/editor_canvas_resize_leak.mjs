// T33 (editor_ux_spec.json, 2026-09-11): resizing an on-screen WebGL canvas is a documented
// WebKit/iOS Safari memory-leak trigger (Apple Developer Forums thread 668999) — directly
// relevant here since the shipping desktop/iOS engine IS WebKit. Nothing resized the FXR preview
// canvas repeatedly and watched for growth. Chromium (this gate's engine) doesn't reproduce the
// WebKit-specific bug itself, but a genuine leak in the app's OWN resize handling (fxLiveFit,
// renderPreview re-allocating GL resources per resize) would still show up as heap growth here —
// this is a general safety net, and T34's webkit-smoke is the complementary engine-specific one.
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

// --enable-precise-memory-info + --js-flags=--expose-gc so we can force a GC before each sample —
// without a forced collection, heap-growth noise from ordinary allocation/collection timing would
// swamp a real leak signal at this sample count.
const browser = await chromium.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&deskx=1`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const fixtureB64 = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
await page.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const file = new File([bytes], 'portrait.png', { type: 'image/png' });
  if (typeof window.loadFXImages === 'function') await window.loadFXImages([file]);
}, fixtureB64);
await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages && fxImages.length > 0, { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(500);

async function sampleHeap() {
  return page.evaluate(async () => {
    if (typeof window.gc === 'function') { window.gc(); await new Promise((r) => setTimeout(r, 30)); window.gc(); }
    return performance.memory ? performance.memory.usedJSHeapSize : null;
  });
}

const SIZES = [{ width: 1200, height: 900 }, { width: 900, height: 700 }, { width: 1400, height: 1000 }, { width: 1000, height: 800 }];
const N_CYCLES = 15;

const samples = [];
const first = await sampleHeap();
if (first === null) {
  console.log('SKIP: performance.memory unavailable (needs Chromium with --enable-precise-memory-info) — cannot measure heap growth.');
  await browser.close();
  server.close();
  process.exit(0);
}
samples.push(first);

for (let i = 0; i < N_CYCLES; i++) {
  const size = SIZES[i % SIZES.length];
  await page.setViewportSize(size);
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(250); // fxLiveFit/renderPreview settle
  samples.push(await sampleHeap());
}

await browser.close();
server.close();

// Trend, not a single before/after delta — a one-off allocation spike on the first few resizes is
// normal (texture pool warmup); a genuine leak shows as monotonic growth across the WHOLE run.
// Compare the mean of the first third against the mean of the last third.
const third = Math.floor(samples.length / 3) || 1;
const early = samples.slice(0, third);
const late = samples.slice(-third);
const meanOf = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
const earlyMean = meanOf(early), lateMean = meanOf(late);
const growthPct = ((lateMean - earlyMean) / earlyMean) * 100;

console.log('EDITOR CANVAS-RESIZE MEMORY CHECK (T33)');
console.log('='.repeat(78));
console.log(`  ${N_CYCLES} resize cycles; heap early-mean ${(earlyMean / 1e6).toFixed(2)}MB, late-mean ${(lateMean / 1e6).toFixed(2)}MB (${growthPct.toFixed(1)}%)`);

const findings = [];
// 40% is a deliberately loose threshold — this is a trend smoke test, not a tight budget (heap
// behaviour under SwiftShader/software GL is noisier than a real GPU), tuned to catch a genuine
// monotonic leak while tolerating normal allocator variance.
if (growthPct > 40) findings.push(`heap grew ${growthPct.toFixed(1)}% from early to late resize cycles — possible leak in resize handling`);
if (errors.length) findings.push(...errors.map((e) => `uncaught page error: ${e}`));

if (findings.length) {
  findings.forEach((f) => console.log('  ' + f));
  console.log(`\n${findings.length} finding(s).`);
  console.log('RESULT: FAIL');
  process.exit(1);
} else {
  console.log('No significant heap growth across repeated canvas resizes.');
  console.log('RESULT: PASS');
}
