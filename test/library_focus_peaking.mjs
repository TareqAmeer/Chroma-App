// CHR-172: focus peaking in the Library Quick Look loupe. Feeds a synthetic frame (left half
// finely detailed = "in focus", right half smooth gradient = "soft") and measures real pixels:
// red overlay lands on the sharp half, not the soft one, and toggling off restores the exact
// screen pixels of the un-peaked photo.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
    const sourcePath = pathname === 'desktop/dist/library-ui.js' ? 'desktop/library-ui.js' : pathname;
    const body = await readFile(path.join(root, sourcePath));
    const type = sourcePath.endsWith('.html') ? 'text/html' : sourcePath.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); } catch {} });
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=12`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.__libOpenFolder === 'function', { timeout: 30000 });
  await page.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });
  await page.evaluate(() => window.__libOpenFolder('/test/Photos'));
  await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length >= 2, { timeout: 30000 });
  const first = await page.locator('#lib-grid .lib-card').first().evaluate((c) => c.dataset.path);

  // Synthetic frame: 800x600, left = 2px checker (all edges), right = smooth horizontal ramp.
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 800; c.height = 600;
    const g = c.getContext('2d'); const im = g.createImageData(800, 600);
    for (let y = 0; y < 600; y++) for (let x = 0; x < 800; x++) {
      const i = (y * 800 + x) * 4;
      const v = x < 400 ? ((((x >> 1) + (y >> 1)) & 1) ? 235 : 20) : 60 + (x - 400) * 0.3;
      im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    window.__libtestQuicklookBytes = new Uint8Array(await blob.arrayBuffer());
  });
  await page.evaluate((p) => window.__libShowQuickLook(p), first);
  await page.waitForFunction(() => { const i = document.getElementById('lib-ql-img'); return i && i.classList.contains('loaded') && i.naturalWidth === 800; }, { timeout: 10000 });
  await page.waitForTimeout(400); // opacity transition
  const box = await page.locator('#lib-ql-img').boundingBox();
  const shot = () => page.screenshot({ clip: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) } });
  assert.equal(await page.locator('#lib-ql-peakcv').count(), 0, 'no overlay before toggling');
  const before = await shot();

  await page.keyboard.press('e');
  await page.waitForSelector('#lib-ql-peakcv');
  const m = await page.evaluate(() => {
    const o = document.getElementById('lib-ql-peakcv'); const d = o.getContext('2d').getImageData(0, 0, o.width, o.height).data;
    let left = 0, right = 0;
    for (let y = 0; y < o.height; y++) for (let x = 0; x < o.width; x++) {
      const i = (y * o.width + x) * 4;
      if (d[i + 3] > 0 && d[i] > 200 && d[i + 1] < 80) { if (x < o.width / 2) left++; else right++; }
    }
    return { left, right, w: o.width, h: o.height, pressed: document.getElementById('lib-ql-peak').getAttribute('aria-pressed') };
  });
  assert.equal(m.pressed, 'true');
  assert(m.left > 1000, `sharp half should be heavily marked (got ${m.left})`);
  assert(m.right < m.left * 0.02, `soft half should be nearly clean (left ${m.left}, right ${m.right})`);

  // Real screen pixels: red now appears over the photo's sharp side, not on the soft side.
  const on = await shot();
  assert.notDeepEqual(on, before, 'screen changes while peaking is on');
  const redShare = await page.evaluate(async ([b64, bw]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const half = (x0, x1) => { const d = g.getImageData(x0, 0, x1 - x0, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 90 && d[i + 2] < 90) n++; return n; };
    return { left: half(0, c.width >> 1), right: half(c.width >> 1, c.width) };
  }, [on.toString('base64'), box.width]);
  assert(redShare.left > 500 && redShare.right < redShare.left * 0.05, `screen red pixels: ${JSON.stringify(redShare)}`);

  // Toggle off via the button: overlay gone, screen pixels identical to the un-peaked photo.
  await page.locator('#lib-ql-peak').click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#lib-ql-peakcv').count(), 0, 'overlay removed when toggled off');
  assert.equal(await page.locator('#lib-ql-peak').getAttribute('aria-pressed'), 'false');
  const off = await shot();
  assert(off.equals(before), 'toggling off restores the exact original pixels');
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log(`PASS: peaking marks sharp edges (L ${m.left} / R ${m.right} px) and toggles off cleanly.`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
