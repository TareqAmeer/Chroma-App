import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
    const sourcePath = pathname === 'desktop/dist/library-ui.js' ? 'desktop/library-ui.js' : pathname;
    const body = await readFile(path.join(root, sourcePath));
    const type = sourcePath.endsWith('.html') ? 'text/html' : /\.(?:m?js)$/.test(sourcePath) ? 'text/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));

const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  for (const scenario of [
    { query: 'libtest=1&libn=3', source: /Original available/, render: /Full resolution ready/ },
    { query: 'libtest=1&libn=3&libforceoffline=1', source: /Reduced-quality offline preview/, render: /Full resolution unavailable/ },
  ]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(() => localStorage.setItem('chromasmith-tour-seen-v1', '1'));
    await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?${scenario.query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => typeof window.__libOpenFolder === 'function', { timeout: 30000 });
    await page.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });
    await page.evaluate(() => window.__libOpenFolder('/test/Photos'));
    await page.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length >= 2, { timeout: 30000 });
    await page.locator('#lib-grid .lib-card').first().dblclick();
    await page.waitForFunction(() => window.chromasmithGetOpenedPaths?.().length > 0, { timeout: 30000 });
    const status = page.locator('#cs-source-render-state');
    await page.waitForFunction(() => {
      const el = document.getElementById('cs-source-render-state');
      return el && !el.hidden && !/Checking source|Loading preview/.test(el.textContent);
    }, { timeout: 30000 });
    const text = await status.innerText();
    assert.match(text, scenario.source, `source status for ${scenario.query}: ${text}`);
    assert.match(text, scenario.render, `render status for ${scenario.query}: ${text}`);
    if (scenario.query.includes('libforceoffline')) {
      assert.equal(await page.evaluate(() => window.chromasmithFullQualityReady), false, 'a reduced offline thumbnail must not be export-ready as a full-resolution render');
    }
    await page.close();
  }
  console.log('PASS original/full-resolution and reduced offline-preview source/render states');
} finally {
  await browser.close();
  server.close();
}
