// Photo-local loading states in the Library: thumbnail decode plus each per-photo AI analysis
// stage. Uses the real card renderer in ?libtest=1 and its deterministic activity event hook.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = path.join(root, pathname.replace(/^\/+/, ''));
    const body = await readFile(file);
    const type = pathname.endsWith('.html') ? 'text/html' : pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
try {
  for (const theme of ['dark', 'light']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.addInitScript((value) => localStorage.setItem('csTheme', value), theme);
    await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=20&libhangthumb=all`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('#lib-grid .lib-card[data-path]', { timeout: 20000 });
    const first = page.locator('#lib-grid .lib-card[data-path]').first();
    const photoPath = await first.getAttribute('data-path');

    try {
      await first.locator('.lib-photo-work[data-photo-work="thumb"]').waitFor({ state: 'visible', timeout: 8000 });
      const text = (await first.locator('.lib-photo-work[data-photo-work="thumb"]').innerText()).trim();
      if (!text.includes('Loading preview')) failures.push(`${theme}: thumbnail badge text was "${text}"`);
    } catch {
      failures.push(`${theme}: pending thumbnail did not show its card-local loading status`);
    }

    for (const [stage, expected] of [['faces', 'Finding faces'], ['pets', 'Finding pets'], ['embed', 'Analyzing faces'], ['clip', 'Indexing for search']]) {
      await page.evaluate(({ photoPath, stage }) => window.libtestPhotoActivity(photoPath, stage), { photoPath, stage });
      const badge = first.locator('.lib-photo-work[data-photo-work="analysis"]');
      try {
        await badge.waitFor({ state: 'visible', timeout: 3000 });
        const text = (await badge.innerText()).trim();
        if (!text.includes(expected)) failures.push(`${theme}/${stage}: expected "${expected}", got "${text}"`);
        const accessible = await badge.getAttribute('aria-label');
        if (!accessible?.includes(expected.replace('…', ''))) failures.push(`${theme}/${stage}: missing accessible per-photo label`);
      } catch {
        failures.push(`${theme}/${stage}: no local loading badge on the active photo`);
      }
      await page.evaluate(() => window.libtestPhotoActivity('', 'clear'));
      await badge.waitFor({ state: 'detached', timeout: 3000 }).catch(() => failures.push(`${theme}/${stage}: status did not clear on completion`));
    }
    if (pageErrors.length) failures.push(`${theme}: page errors: ${pageErrors.join('; ')}`);
    console.log(`${theme} theme: thumbnail + 4 analysis stages checked`);
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

if (failures.length) {
  console.error(`FAIL: ${failures.length} finding(s)`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('PASS: photo-local loading labels appear and clear in both Library themes.');
