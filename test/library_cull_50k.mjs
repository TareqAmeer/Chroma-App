// CHR-267 scale gate: load a 50k catalog-backed folder through the real Library, select it with
// the user's Ctrl+A path, and measure the capture-time cull picker without mounting the library.
// The browser harness data is synthetic; this validates UI scaling, not native catalog throughput.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/desktop/dist/index.html' || pathname === '/desktop/dist/') {
      const html = await readFile(path.join(root, 'desktop/dist/index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return;
    }
    const relative = pathname.replace(/^\/+/, '');
    const source = relative === 'desktop/dist/library-ui.js' ? 'desktop/library-ui.js' : relative;
    const body = await readFile(path.join(root, source));
    const type = source.endsWith('.html') ? 'text/html' : /\.(?:m?js)$/.test(source) ? 'text/javascript' : source.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));

const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const elapsed = (start) => Number((performance.now() - start).toFixed(1));
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  await page.addInitScript(() => { try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); } catch {} });
  page.on('pageerror', (error) => errors.push(error.message));
  const url = `http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=50000&libtime=1`;
  let start = performance.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.__libOpenFolder === 'function', { timeout: 30000 });
  await page.evaluate(async () => { if (!window.chromasmithLibraryIsOpen()) await window.chromasmithToggleLibrary(); });
  await page.evaluate(() => window.__libOpenFolder('/test/Photos'));
  await page.waitForFunction(() => window.__libState()?.n === 50000 && document.querySelectorAll('#lib-grid .lib-card[data-path]').length > 0, { timeout: 60000 });
  const openMs = elapsed(start);
  const opened = await page.evaluate(() => ({
    state: window.__libState(),
    cards: document.querySelectorAll('#lib-grid .lib-card[data-path]').length,
    gridNodes: document.querySelectorAll('#lib-grid *').length,
    dom: document.querySelectorAll('*').length,
    title: document.getElementById('lib-count')?.textContent?.trim(),
  }));
  assert.equal(opened.state.n, 50000, 'catalog-backed folder loaded all 50k synthetic records');
  assert.equal(opened.title, '50,000 of 50,000 photos', 'Library count represents the full synthetic folder');
  assert.ok(opened.state.on, '50k grid virtualization is active');
  assert.ok(opened.cards <= 240, `mounted grid cards stay bounded (got ${opened.cards})`);
  assert.ok(opened.gridNodes <= opened.cards * 32 + 100, `virtual grid subtree scales with mounted cards, not 50k records (cards=${opened.cards}, nodes=${opened.gridNodes})`);

  // Scroll well beyond the first viewport to prove the virtual grid can move while retaining a
  // bounded mounted window. The catalog mock returns all entries in one response, so this does
  // not simulate the native DB's page latency or storage cost.
  const scroll = await page.evaluate(async () => {
    const grid = document.getElementById('lib-grid');
    const scroller = grid.parentElement && grid.parentElement.scrollHeight > grid.parentElement.clientHeight
      ? grid.parentElement : (grid.closest('#lib-overlay') || document.documentElement);
    const before = scroller.scrollTop;
    scroller.scrollTop = Math.min(scroller.scrollHeight - scroller.clientHeight, 50000);
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    return { before, after: scroller.scrollTop, cards: grid.querySelectorAll('.lib-card[data-path]').length, range: window.__libState().range };
  });
  assert.ok(scroll.after > scroll.before, 'grid scroller advances through the large library');
  assert.ok(scroll.cards <= 240, `scrolling preserves mounted-card cap (got ${scroll.cards})`);

  start = performance.now();
  await page.keyboard.press('Control+A');
  await page.waitForFunction(() => document.querySelector('#lib-batchbar .sk2-bb-n')?.textContent.includes('50000'), { timeout: 30000 });
  const selectMs = elapsed(start);
  await page.locator('#lib-batchbar [data-act="cull"]').click();
  await page.waitForFunction(() => window.__libSurveyState()?.groupPicker === true, { timeout: 30000 });
  const picker = await page.evaluate(() => ({
    groups: window.__libCullTimeGroups().length,
    shown: document.querySelectorAll('#lib-cull-time-groups [data-time-group]').length,
    groupNodes: document.querySelectorAll('#lib-cull-time-groups *').length,
    dom: document.querySelectorAll('*').length,
    selected: document.getElementById('lib-cull-time-count')?.textContent?.trim(),
    text: document.querySelector('.lib-cull-time-page span')?.textContent?.trim(),
  }));
  assert.equal(picker.selected, '50000 selected');
  assert.equal(picker.groups, 2, '60-second threshold chains known capture times and isolates missing time');
  assert.equal(picker.shown, 2);
  assert.ok(picker.groupNodes < 600, `group picker subtree stays bounded (got ${picker.groupNodes} nodes)`);

  start = performance.now();
  await page.selectOption('#lib-cull-time-gap', '15');
  const regroupMs = elapsed(start);
  const fine = await page.evaluate(() => ({
    groups: window.__libCullTimeGroups().length,
    shown: document.querySelectorAll('#lib-cull-time-groups [data-time-group]').length,
    lastUnknown: window.__libCullTimeGroups().at(-1)?.unknown,
    text: document.querySelector('.lib-cull-time-page span')?.textContent?.trim(),
  }));
  assert.equal(fine.groups, 16668, '15-second threshold retains one group per capture instant plus missing-time group');
  assert.equal(fine.shown, 50, 'only one 50-group page is mounted');
  assert.equal(fine.lastUnknown, true, 'missing capture time is isolated on the final group');
  assert.match(fine.text, /Groups 1–50 of 16668/);

  const nextPageMs = await page.evaluate(async () => {
    const start = performance.now();
    document.querySelector('[data-group-page="1"]').click();
    await new Promise(requestAnimationFrame);
    return Number((performance.now() - start).toFixed(1));
  });
  const page2 = await page.evaluate(() => ({
    first: document.querySelector('#lib-cull-time-groups [data-time-group]')?.dataset.timeGroup,
    count: document.querySelectorAll('#lib-cull-time-groups [data-time-group]').length,
    groupNodes: document.querySelectorAll('#lib-cull-time-groups *').length,
    dom: document.querySelectorAll('*').length,
  }));
  assert.equal(page2.first, '50', 'Next groups advances to the next 50 groups');
  assert.equal(page2.count, 50);
  assert.ok(page2.groupNodes < 600, `second group page subtree stays bounded (got ${page2.groupNodes} nodes)`);
  assert.ok(nextPageMs < 1000, `group-page button click paints within one second (got ${nextPageMs}ms)`);
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log(`PASS CHR-267 50k synthetic Library/cull scale gate: open=${openMs}ms cards=${opened.cards}/240 gridNodes=${opened.gridNodes} pageDOM=${opened.dom}; scroll=${scroll.after}px mounted=${scroll.cards}; select=${selectMs}ms; groups=${picker.groups}→${fine.groups}, regroup=${regroupMs}ms, visible=${fine.shown}/50; next-page=${nextPageMs}ms; errors=0.`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
