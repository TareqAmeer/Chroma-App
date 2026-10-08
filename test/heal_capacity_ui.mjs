// CHR-246 practical-unbounded spot workload and arbitrary-row edit/delete regression.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json', '.bin': 'application/octet-stream', '.cube': 'text/plain', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const file = path.resolve(ROOT, `.${urlPath.replaceAll('/', path.sep)}`);
    if (!file.startsWith(`${ROOT}${path.sep}`)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.on('listening', resolve));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); localStorage.setItem('chromasmith-first-edit-stage-v1', 'done'); } catch {}
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof window.loadFXImages === 'function' && typeof window.healAdd === 'function');
  const photo = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
  await page.evaluate(async b64 => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    await loadFXImages([new File([bytes], 'portrait.png', { type: 'image/png' })]);
    document.body.classList.add('fx-single');
    document.getElementById('panel-fx')?.classList.add('active');
  }, photo);
  await page.locator('.rail button[aria-label="Texture"],[aria-label="Texture"]').first().click();
  await page.waitForFunction(() => document.getElementById('ff-retouch')?.offsetParent !== null);
  await page.locator('#btn-heal-paint').click();
  assert.equal(await page.evaluate(() => healMode), true, 'retouch mode arms on the real photo');

  const box = await page.locator('#fx-canvas').boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, 'loaded portrait has a visible editor canvas');
  const started = performance.now();
  const columns = 16, rows = 8;
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const nx = .06 + col * .0587, ny = .10 + row * .112;
    await page.mouse.click(box.x + nx * box.width, box.y + ny * box.height);
  }
  const elapsedMs = performance.now() - started;
  const workload = await page.evaluate(() => ({
    operations: healOps().length,
    rows: document.querySelectorAll('#heal-list [data-heal-id]').length,
    count: document.getElementById('heal-count').textContent,
    ids: healOps().map(op => op.id),
    width: curItem().img.naturalWidth,
    height: curItem().img.naturalHeight,
  }));
  assert.equal(workload.operations, 128, 'no low fixed spot limit truncates additions');
  assert.equal(workload.rows, 128, 'all 128 repair operations remain listed');
  assert.match(workload.count, /128 spots/);
  assert.equal(new Set(workload.ids).size, 128, 'every spot has its own stable ID');

  await page.locator('#heal-list [data-heal-id]').nth(73).click();
  await page.evaluate(() => {
    const slider = document.getElementById('sl-heal-size');
    slider.value = '9';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.ok(Math.abs(await page.evaluate(() => healOps()[73].r) - .09) < 1e-6, 'an arbitrary middle spot remains editable');
  await page.locator('#btn-heal-del').click();
  assert.equal(await page.evaluate(() => healOps().length), 127, 'arbitrary selected spot deletes without losing neighbors');
  assert.equal(await page.locator('#heal-list [data-heal-id]').count(), 127);
  assert.equal(errors.length, 0, `zero browser/page errors: ${errors.join('; ')}`);
  console.log(`CHR-246 Heal capacity PASS: real ${workload.width}×${workload.height} photo; 128/128 spots listed with unique IDs; 128 UI clicks in ${elapsedMs.toFixed(0)}ms; middle spot edit/delete retained 127 neighbors; zero browser/page errors.`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
