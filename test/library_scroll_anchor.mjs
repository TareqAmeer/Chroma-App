import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    // Serve the edited renderer source, not a potentially stale generated dist copy.
    const file = path.join(root, relative === 'desktop/dist/library-ui.js' ? 'desktop/library-ui.js' : relative);
    const body = await readFile(file);
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=719`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => {
    const grid = document.getElementById('lib-grid');
    const state = window.__libState?.();
    const cards = [...(grid?.querySelectorAll('.lib-card[data-path]') || [])];
    if (state?.n !== 719 || cards.length < 2 || !state.m) return false;
    const firstTop = cards[0].getBoundingClientRect().top;
    const cols = cards.findIndex((card) => Math.abs(card.getBoundingClientRect().top - firstTop) > 1);
    return state.on && cols > 0 && state.m.cols === cols;
  }, { timeout: 20000 });

  const before = await page.evaluate(async () => {
    const grid = document.getElementById('lib-grid');
    const scroller = grid.parentElement && grid.parentElement.scrollHeight > grid.parentElement.clientHeight
      ? grid.parentElement : (grid.closest('#lib-overlay') || document.documentElement);
    scroller.scrollTop = 9000;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const bounds = scroller.getBoundingClientRect();
    const card = [...grid.querySelectorAll('.lib-card[data-path]')].find((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > bounds.top && r.top < bounds.bottom;
    });
    return { path: card?.dataset.path, offset: card ? card.getBoundingClientRect().top - bounds.top : null };
  });
  if (!before.path) throw new Error('No photo was mounted in the scrolled viewport.');

  await page.evaluate(() => window.__libRenderGrid());
  const after = await page.evaluate(() => {
    const grid = document.getElementById('lib-grid');
    const scroller = grid.parentElement && grid.parentElement.scrollHeight > grid.parentElement.clientHeight
      ? grid.parentElement : (grid.closest('#lib-overlay') || document.documentElement);
    const bounds = scroller.getBoundingClientRect();
    const card = [...grid.querySelectorAll('.lib-card[data-path]')].find((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > bounds.top && r.top < bounds.bottom;
    });
    return { path: card?.dataset.path, offset: card ? card.getBoundingClientRect().top - bounds.top : null };
  });
  if (after.path !== before.path || Math.abs(after.offset - before.offset) > 2) {
    throw new Error(`scroll anchor moved: before=${JSON.stringify(before)}, after=${JSON.stringify(after)}`);
  }
  console.log(`PASS: ${before.path} stayed at the same viewport offset (${before.offset.toFixed(1)}px) after a virtual-grid refresh.`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
