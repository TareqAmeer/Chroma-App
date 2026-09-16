// Regression for: "indexing panel shows empty / pill stuck on done while real background work
// (walk/thumb/hash) is genuinely still pending" — reported live alongside "not scanned count
// stuck at 7k". Root cause: hqOfflineDrainLoop() polls catalog_hq_offline on its own 90s
// setInterval, fully independent of catalogRunBackgroundPhases()'s walk/thumb/focus/hash chain,
// but BOTH report through the same activityUpdate('catalog', ...) kind. 50df936 added a rule
// that a phase:"hq_offline" event with total:0 means "nothing pending" and force-clears the
// pill to stage:'done' — but activityUpdate() doesn't check WHICH stage is actually in flight
// before clobbering it, so an hq_offline total:0 report arriving mid-way through a real walk/
// thumb/hash pass (a routine race: the two run on unrelated timers) stomps the real progress to
// 'done', which then auto-hides the whole activity pill after 8s — indistinguishable from "the
// indexing panel is empty" while thousands of photos are still genuinely unindexed.
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=5`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.libtestFireEvent === 'function' && typeof window._activityDebugSnapshot === 'function', { timeout: 20000 });

  // A real, genuinely in-progress walk pass over a large backlog (7000+ photos, matching the
  // live report) — this is catalogRunBackgroundPhases' own chain, well short of done. (Not
  // phase:'thumb' — the handler deliberately skips those raw events, drainCatalogThumbnails owns
  // that stage's display itself; 'walk' goes through the same activityUpdate() call unfiltered.)
  await page.evaluate(() => window.libtestFireEvent('catalog-scan', { phase: 'walk', done: 148, total: 7241, current: '' }));

  // The UNRELATED hq_offline poller (its own 90s setInterval) lands mid-pass and finds nothing
  // in its own small last-100-edited/added candidate set to do right now.
  await page.evaluate(() => window.libtestFireEvent('catalog-scan', { phase: 'hq_offline', done: 0, total: 0, current: '' }));

  const snap = await page.evaluate(() => window._activityDebugSnapshot());

  if (snap.activity.stage === 'done') {
    failures.push(`hq_offline's total:0 report wrongly force-cleared an in-progress 'walk' pass (148/7241) to stage:'done' — snapshot: ${JSON.stringify(snap.activity)}`);
  }
  if (snap.activity.stage !== 'walk' || snap.activity.total !== 7241) {
    failures.push(`expected the real walk progress (148/7241) to still be showing, got: ${JSON.stringify(snap.activity)}`);
  }
  if (pageErrors.length) failures.push(`page errors: ${pageErrors.join('; ')}`);
  console.log('snapshot after race:', JSON.stringify(snap.activity));
  await page.close();
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

if (failures.length) {
  console.error(`FAIL: ${failures.length} finding(s)`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('PASS: an unrelated hq_offline total:0 report no longer clobbers a genuinely in-progress catalog scan.');
