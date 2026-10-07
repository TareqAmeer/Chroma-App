import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
    if (pathname.endsWith('coi-serviceworker.min.js')) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(''); return; }
    if (pathname.endsWith('/favicon.ico')) { res.writeHead(204); res.end(); return; }
    const sourcePath = pathname === 'desktop/dist/library-ui.js' ? 'desktop/library-ui.js' : pathname;
    const body = await readFile(path.join(root, sourcePath));
    const type = sourcePath.endsWith('.html') ? 'text/html' : /\.(?:m?js)$/.test(sourcePath) ? 'text/javascript' : sourcePath.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(body);
  } catch (error) { console.error('HARNESS_404', req.url, error.message); res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
try {
  for (const theme of ['dark', 'light']) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = [];
    page.on('pageerror', (error) => { errors.push(error.message); console.error('PAGEERROR', error.message); });
    page.on('console', (msg) => { if (msg.type() === 'error') console.error('CONSOLE', msg.text()); });
    await page.addInitScript((value) => { localStorage.setItem('chromasmith-tour-seen-v1', '1'); localStorage.setItem('chromasmith_test_preference', 'saved'); localStorage.setItem('chromasmith_oauth_access_token', 'must-not-export'); localStorage.setItem('csTheme', value); }, theme);
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=5`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof window.__libOpenFolder === 'function', { timeout: 30000 });
  await page.evaluate(() => window.__libOpenFolder('/test/Photos'));
  await page.waitForSelector('#lib-grid .lib-card');
  await page.locator('#lib-view-menu-btn').click();
  const create = page.locator('#lib-backup-create');
  await create.waitFor({ state: 'visible' });
  assert.match(await page.locator('#lib-backup-last').textContent(), /Last backup/);

  await page.evaluate(() => { window.__libtestDialogResults = ['/test/Backups']; });
  await create.click();
  await page.waitForFunction(() => (window.__libtestCalls || []).some(([cmd]) => cmd === 'library_backup_create'));
  const backupCall = await page.evaluate(() => window.__libtestCalls.find(([cmd]) => cmd === 'library_backup_create'));
  const prefs = JSON.parse(backupCall[1].preferencesJson);
  assert.equal(prefs.values.chromasmith_test_preference, 'saved');
  assert.equal(Object.keys(prefs.values).some((key) => /oauth_access_token/i.test(key)), false, 'credential-like preferences are excluded');
  assert.match(backupCall[1].destination, /^\/test\/Backups\/Chromasmith Library Backup /);
  await page.waitForFunction(() => document.querySelector('#lib-backup-last')?.textContent.includes('/test/Backups/Chromasmith Library Backup'));

  await page.locator('#lib-view-menu-btn').click();
  const restore = page.locator('#lib-backup-restore');
  await restore.waitFor({ state: 'visible' });
  await page.evaluate(() => { window.__libtestDialogResults = ['/test/Backup', '/test/Restores']; });
  await restore.click();
  await page.waitForFunction(() => (window.__libtestCalls || []).some(([cmd]) => cmd === 'library_backup_restore'));
  const restoreCalls = await page.evaluate(() => window.__libtestCalls.filter(([cmd]) => cmd === 'library_backup_verify' || cmd === 'library_backup_restore'));
  assert.deepEqual(restoreCalls.map(([cmd]) => cmd), ['library_backup_verify', 'library_backup_restore'], 'restore verifies the source before writing a separate copy');
  assert.match(restoreCalls[1][1].destination, /^\/test\/Restores\/Chromasmith Restored Library /);
  assert.deepEqual(errors, [], 'backup actions produce no uncaught page errors');
    console.log(`PASS (${theme} theme, 1366x768): backup creation, credential exclusion, verify-before-restore, separate destination, no uncaught UI errors`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
