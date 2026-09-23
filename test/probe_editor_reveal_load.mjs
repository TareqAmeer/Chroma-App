// Regression: opening a Library photo with transitions enabled must still install editor pixels,
// and the docked filmstrip must retain each thumbnail's intrinsic aspect ratio.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
    const ext = path.extname(name);
    const body = await readFile(path.join(root, name));
    res.writeHead(200, { 'Content-Type': ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [], pageErrors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=6&deskx=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card img.loaded').length > 1, null, { timeout: 20000 });
  await page.locator('#lib-grid .lib-card').first().click();
  await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length === 1 && fxImages[0]?.img?.naturalWidth > 0, null, { timeout: 20000 });
  const result = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#lib-grid .lib-card')];
    const geometry = cards.slice(0, 3).map((card) => {
      const img = card.querySelector('img'), wrap = card.querySelector('.lib-thumb-wrap');
      const ir = img.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      return { imageRatio: ir.width / ir.height, wrapRatio: wr.width / wr.height };
    });
    return { canvasWidth: fxImages[0].img.naturalWidth, geometry };
  });
  if (!result.canvasWidth) failures.push('opening a Library image did not install editor pixels');
  if (result.geometry.some(({ imageRatio, wrapRatio }) => Math.abs(imageRatio - wrapRatio) > .03)) failures.push('docked filmstrip distorted thumbnail aspect ratio');
  if (pageErrors.length) failures.push(`page errors: ${pageErrors.join(' | ')}`);
  await page.close();
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
if (failures.length) { console.error(`FAIL: ${failures.join('; ')}`); process.exit(1); }
console.log('PASS: Editor install and docked filmstrip aspect ratio survive photo transitions.');
