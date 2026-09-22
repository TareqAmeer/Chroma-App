// Browser-level contract for the non-blocking Editor photo reveal. Native RAW timings remain a
// real-app measurement, but this catches broken phase wiring, preference bypass, reduced-motion
// bypass, and interrupted navigation deterministically in the normal libtest surface.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
    const ext = path.extname(name), types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
    const body = await readFile(path.join(root, name));
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=6&deskx=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__chromasmithReveal && document.querySelectorAll('#lib-grid .lib-card').length > 1, null, { timeout: 20000 });
  await page.evaluate(() => {
    const r = window.__chromasmithReveal, img = document.querySelector('#lib-grid img');
    window.__rawPerfLog = [];
    r.begin(3 / 2, '/test/warm.jpg'); r.pixels('thumbnail', img, '/test/warm.jpg'); r.upgrade('/test/warm.jpg');
    // Five rapid navigation events must supersede presentation immediately; decode coalescing is
    // intentionally tested by the existing library flow, not duplicated here.
    for (let i = 0; i < 5; i++) r.begin(i % 2 ? 3 / 2 : 2 / 3, `/test/rapid-${i}.jpg`);
    r.pixels('thumbnail', img, '/test/rapid-4.jpg');
  });
  await page.waitForFunction(() => window.__rawPerfLog.some((x) => x.event === 'reveal-pixels' && x.path === '/test/rapid-4.jpg'), null, { timeout: 8000 });
  await page.evaluate(() => window.__chromasmithReveal.upgrade('/test/rapid-4.jpg'));
  await page.waitForTimeout(450);
  const phaseCheck = await page.evaluate(() => {
    const events = window.__rawPerfLog.filter((x) => x.event.startsWith('reveal-'));
    return { events, visible: !!document.querySelector('#fx-reveal.on'), provisional: !!document.querySelector('#lib-provisional.on') };
  });
  for (const phase of ['reveal-begin', 'reveal-pixels', 'reveal-upgrade']) if (!phaseCheck.events.some((x) => x.event === phase)) failures.push(`missing ${phase}`);
  if (!phaseCheck.events.filter((x) => x.event === 'reveal-begin' && x.path.includes('rapid-')).length) failures.push('rapid navigation did not restart reveal');
  if (phaseCheck.visible || phaseCheck.provisional) failures.push(`completed reveal left a visible layer behind (frame=${phaseCheck.visible}, provisional=${phaseCheck.provisional})`);
  const pref = await page.evaluate(() => {
    localStorage.setItem('chromasmithPhotoTransitions', '0'); window.chromasmithPhotoTransitions = false;
    window.__rawPerfLog = []; window.__chromasmithReveal.begin(1, '/test/off.jpg'); window.__chromasmithReveal.pixels('cached', null, '/test/off.jpg');
    return window.__rawPerfLog.map((x) => x.event);
  });
  if (!pref.includes('reveal-instant')) failures.push('preference OFF did not use the instant path');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await page.evaluate(() => { window.chromasmithPhotoTransitions = true; window.__rawPerfLog = []; window.__chromasmithReveal.begin(1, '/test/reduced.jpg'); return window.__rawPerfLog.map((x) => x.event); });
  if (!reduced.includes('reveal-instant')) failures.push('reduced motion did not use the instant path');
  await page.close();
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
if (failures.length) { console.error(`FAIL: ${failures.join('; ')}`); process.exit(1); }
console.log('PASS: reveal phases, interruption, preference OFF, and reduced motion.');
