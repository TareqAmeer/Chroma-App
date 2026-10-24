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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.on('console', (m) => { if (/rowH/.test(m.text())) console.log(m.text()); });
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

  // 1) A one-row scroll keeps the cards still inside the virtual window: same DOM nodes, not a teardown + rebuild.
  const r = await page.evaluate(async () => {
    const grid = document.getElementById('lib-grid');
    const scroller = grid.parentElement && grid.parentElement.scrollHeight > grid.parentElement.clientHeight
      ? grid.parentElement : (grid.closest('#lib-overlay') || document.documentElement);
    await new Promise((r) => setTimeout(r, 1500)); scroller.scrollTop = 6000; await new Promise((r) => setTimeout(r, 1200));
    const nodes = new Map([...grid.querySelectorAll('.lib-card[data-path]')].map((el) => [el.dataset.path, el]));
    const rowH = window.__libState().m.rowH; console.log('rowH', rowH, scroller.scrollTop);
    scroller.scrollTop += rowH * 2; await new Promise((r) => setTimeout(r, 400));
    const after = [...grid.querySelectorAll('.lib-card[data-path]')]; console.log('rowH dbg', scroller.scrollTop, [...nodes.keys()].slice(0,2), [...nodes.keys()].slice(-1), after.slice(0,2).map(e=>e.dataset.path), after.slice(-1).map(e=>e.dataset.path), JSON.stringify(window.__libState()));
    const kept = after.filter((el) => nodes.get(el.dataset.path) === el).length;
    const sameButRebuilt = after.filter((el) => nodes.has(el.dataset.path) && nodes.get(el.dataset.path) !== el).length;
    const tab0 = after.filter((el) => el.tabIndex === 0).length, tabAll = after.every((el) => el.hasAttribute('tabindex'));
    return { before: nodes.size, after: after.length, kept, sameButRebuilt, tab0, tabAll };
  });
  console.log(JSON.stringify(r));
  if (r.kept < r.after / 2 || r.sameButRebuilt > 0) throw new Error('scroll-only window shift rebuilt cards that should have been reused: ' + JSON.stringify(r));
  if (r.tab0 < 1) throw new Error('the grid needs exactly one roving tab stop'); if (!r.tabAll) throw new Error('every grid card must carry a tabindex (keyboard focus)');
  // 2) A forced render (state change path) still rebuilds everything: no stale node can survive it.
  const f = await page.evaluate(async () => {
    const grid = document.getElementById('lib-grid');
    const old = new Set([...grid.querySelectorAll('.lib-card[data-path]')]);
    window.__libRenderGrid(); await new Promise((r) => setTimeout(r, 400));
    return [...grid.querySelectorAll('.lib-card[data-path]')].filter((el) => old.has(el)).length;
  });
  if (f !== 0) throw new Error(`forced render reused ${f} stale card nodes`);
  console.log('PASS: scroll shifts reuse card nodes, forced renders rebuild all, cards are focusable.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
