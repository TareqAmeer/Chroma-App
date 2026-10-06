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
  await page.waitForFunction(() => window.__libState?.()?.on && document.querySelectorAll('#lib-grid .lib-card[data-path]').length > 2, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelectorAll("#cs-modal-ov, .cs-modal-ov").forEach((m) => m.remove())); // first-run modal would swallow the wheel
  const box = await page.evaluate(() => { const r = document.getElementById('lib-grid').getBoundingClientRect(); return { x: r.left + r.width / 2, y: Math.max(r.top, 0) + 200 }; });
  await page.mouse.move(box.x, box.y);
  console.log(await page.evaluate(({x,y}) => { const g=document.getElementById("lib-grid"); const e=document.elementFromPoint(x,y); const p=g.parentElement; return [e?.tagName, e?.closest("[id]")?.id, p.id, p.scrollHeight, p.clientHeight, getComputedStyle(p).overflowY, document.documentElement.scrollHeight]; }, box));
  // Per-frame sampler: scrollTop plus the content position of one tracked photo. A smooth scroll
  // means scrollTop only rises, and photos move exactly -dScrollTop (no content jump).
  await page.evaluate(() => {
    const grid = document.getElementById('lib-grid');
    const sc = grid.parentElement.scrollHeight > grid.parentElement.clientHeight ? grid.parentElement : document.documentElement;
    window.__samples = []; window.__shifts = 0;
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__shifts += e.value; }).observe({ type: 'layout-shift', buffered: false }); } catch {}
    let prev = null;
    const tick = (t) => {
      const st = sc.scrollTop;
      const cards = [...grid.querySelectorAll('.lib-card[data-path]')];
      const idx = new Map(cards.map((c) => [c.dataset.path, c]));
      let jump = 0;
      if (prev && idx.has(prev.path)) {
        const y = idx.get(prev.path).getBoundingClientRect().top;
        jump = (y - prev.y) + (st - prev.st);
      }
      const c = cards[Math.floor(cards.length / 2)];
      window.__samples.push({ t, st, jump, sh: sc.scrollHeight });
      prev = c ? { path: c.dataset.path, y: c.getBoundingClientRect().top, st } : null;
      if (!window.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const trace = []; for (let i = 0; i < 60; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(16); trace.push(await page.evaluate(() => document.getElementById("lib-main").scrollTop)); }
  console.log("trace", trace.join(" "));
  console.log("diag", JSON.stringify(await page.evaluate(() => { const g = document.getElementById("lib-grid"); const s = window.__libState(); const cards = [...g.querySelectorAll(".lib-card[data-path]")]; const tops = [...new Set(cards.map((c) => c.offsetTop))]; const pitches = tops.slice(1).map((t, i) => t - tops[i]); return { m: s.m, n: s.n, pitches: [...new Set(pitches)], heights: [...new Set(cards.map((c) => c.offsetHeight))], kids: [...g.children].filter((c) => !c.classList.contains("lib-card")).map((c) => c.className + ":" + c.offsetHeight + ":" + getComputedStyle(c).gridRow), ga: getComputedStyle(g).overflowAnchor + "/" + getComputedStyle(g.parentElement).overflowAnchor, rowGap: getComputedStyle(g).rowGap }; })));
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => { window.__stop = true; return { s: window.__samples, shifts: window.__shifts }; });
  const s = r.s;
  let backs = 0, jumps = 0, maxJump = 0, shChanges = 0;
  for (let i = 1; i < s.length; i++) {
    if (s[i].st < s[i - 1].st - 0.5) backs++;
    if (Math.abs(s[i].jump) > 1) { console.log("jump@", i, JSON.stringify(s[i-1]), JSON.stringify(s[i])); jumps++; maxJump = Math.max(maxJump, Math.abs(s[i].jump)); }
    if (s[i].sh !== s[i - 1].sh) shChanges++;
  }
  console.log(JSON.stringify({ frames: s.length, finalTop: s.at(-1).st, backwardSteps: backs, contentJumps: jumps, maxJump, scrollHeightChanges: shChanges, cls: r.shifts }));
  if (backs || jumps || s.at(-1).st < 3000) { console.error('FAIL: gallery scroll is not smooth'); process.exitCode = 1; }
  else console.log('PASS: monotonic scroll, no content jumps');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
