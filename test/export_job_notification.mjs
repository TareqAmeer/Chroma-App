import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const nativeSource = await readFile(path.join(root, 'desktop/desktop-native.js'), 'utf8');
const notificationHelper = nativeSource.split('// BEGIN CHR183_EXPORT_NOTIFICATIONS')[1]?.split('// END CHR183_EXPORT_NOTIFICATIONS')[0];
assert.ok(notificationHelper, 'production Tauri export notification helper has extraction markers');

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
    const sourcePath = pathname.endsWith('/favicon.ico') ? 'assets/brand/favicon.svg' : pathname === 'desktop/dist/coi-serviceworker.min.js' ? 'coi-serviceworker.min.js' : pathname;
    const body = await readFile(path.join(root, sourcePath));
    const type = sourcePath.endsWith('.html') ? 'text/html' : sourcePath.endsWith('.svg') ? 'image/svg+xml' : /\.(?:m?js)$/.test(sourcePath) ? 'text/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(body);
  } catch { console.error('HARNESS_404', req.url); res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));

let browser;
try {
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}), args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => console.error('HARNESS_REQUEST_FAILED', request.url(), request.failure()?.errorText));
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libcat=1&libn=20&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.libActivityJob === 'function' && typeof window.libActivityJobDone === 'function', { timeout: 30000 });
  await page.addStyleTag({ content: '#cs-modal-ov{display:none!important;pointer-events:none!important}' });
  await page.evaluate(() => { document.getElementById('lib-overlay')?.classList.add('full'); });

  // Exercise the production Library activity/jobs surface through the same callbacks used by exportFX.
  await page.evaluate(() => window.libActivityJob('export', { jobId: 'export-test-1', label: 'Exporting', stage: 'working', done: 2, total: 4, current: 'Rendering photo 3 of 4' }));
  await page.waitForSelector('#lib-bottom #lib-activity #lib-act-pill');
  assert.match(await page.locator('#lib-act-pill').innerText(), /Exporting/);
  await page.evaluate(() => {
    const pill = document.getElementById('lib-act-pill');
    assertPresent(pill && pill.onclick, 'jobs pill must have its production click handler');
    pill.onclick({ stopPropagation() {} });
    function assertPresent(value, message) { if (!value) throw new Error(message); }
  });
  assert.match(await page.locator('.lib-act-pop').innerText(), /Rendering photo 3 of 4/);
  assert.match(await page.locator('.lib-act-pop').innerText(), /2 of 4/);
  await page.evaluate(() => window.libActivityJobDone('export', { jobId: 'export-test-1', label: 'Exporting', outcome: 'completed', revealPath: '/Users/tester/Pictures/Exports/portrait.jpg' }));
  await page.waitForSelector('.lib-act-pop [data-job-history-id="export-test-1"]');
  assert.match(await page.locator('.lib-act-pop [data-job-history-id="export-test-1"]').innerText(), /Completed[\s\S]*Exporting[\s\S]*2\/4/);
  await page.locator('[data-job-reveal-id="export-test-1"]').click();
  await page.waitForFunction(() => window.__libtestRevealCalls?.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__libtestRevealCalls[0]), { command: 'reveal_in_finder', args: { path: '/Users/tester/Pictures/Exports/portrait.jpg' } });

  // Exercise the exact native notification helper with a browser Notification/IPC mock. The
  // notification delivery and macOS permission sheet are OS-owned and are not simulated here.
  await page.evaluate((source) => {
    const state = { permissionChecks: 0, permissionRequests: 0, notices: [], invokes: [] };
    window.__chr183NotificationTest = state;
    window.CS_PLATFORM = { os: 'macos', revealLabel: 'Finder' };
    window.__TAURI__ = { core: { invoke: async (command, args) => {
      state.invokes.push({ command, args });
      if (command === 'plugin:notification|is_permission_granted') { state.permissionChecks++; return false; }
    } } };
    window.Notification = class MockNotification {
      constructor(title, options) { this.title = title; this.options = options; state.notices.push(this); }
    };
    window.Notification.permission = 'default';
    window.Notification.requestPermission = async () => { state.permissionRequests++; return 'granted'; };
    const invoke = (...args) => window.__TAURI__.core.invoke(...args);
    new Function('window', 'invoke', source)(window, invoke);
  }, notificationHelper);
  assert.equal(await page.evaluate(() => window.chromasmithPrepareExportNotification()), true);
  assert.equal(await page.evaluate(() => window.__chr183NotificationTest.permissionChecks), 1);
  assert.equal(await page.evaluate(() => window.__chr183NotificationTest.permissionRequests), 1);
  await page.evaluate(() => window.csExportDone(2, '/Users/tester/Pictures/Exports/portrait.jpg', false));
  assert.equal(await page.evaluate(() => window.__chr183NotificationTest.notices.length), 1);
  assert.match(await page.evaluate(() => window.__chr183NotificationTest.notices[0].options.body), /2 photos saved to Exports\. Select to Show in Finder\./);
  await page.evaluate(() => window.__chr183NotificationTest.notices[0].onclick());
  await page.waitForFunction(() => window.__chr183NotificationTest.invokes.some(call => call.command === 'reveal_in_finder'));
  assert.equal(await page.evaluate(() => window.__chr183NotificationTest.invokes.at(-1).args.path), '/Users/tester/Pictures/Exports/portrait.jpg');

  // The persistent in-app completion pill keeps its own Show in Finder route as a fallback.
  await page.locator('#cs-export-done button').first().click();
  assert.equal(await page.evaluate(() => window.__chr183NotificationTest.invokes.at(-1).command), 'reveal_in_finder');
  assert.deepEqual(errors, []);
  console.log('PASS CHR-183 export activity UI, completion history, macOS notification permission/click-to-reveal and in-app Finder action (native OS delivery mocked)');
} finally {
  if (browser) await browser.close();
  server.close();
}
