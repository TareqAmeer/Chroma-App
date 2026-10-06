#!/usr/bin/env node
// Regression: background-work progress must live in the #lib-bottom status bar, and a job
// appearing/disappearing must not flip #lib-top between full and compact at a wide window.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const ROOT = process.cwd();
const server = createServer(async (req, res) => {
  try { const u = decodeURIComponent(req.url.split('?')[0]); const d = await readFile(path.join(ROOT, u.slice(1)));
    res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' }[path.extname(u)] || 'application/octet-stream' }); res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libcat=1&libn=60&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#lib-grid .lib-card', { timeout: 20000 }).catch(() => {});
await page.evaluate(() => { document.querySelectorAll('button').forEach((x) => { if (x.textContent.trim() === 'Got it') x.click(); }); document.getElementById('lib-overlay')?.classList.add('full'); });
await page.waitForTimeout(800);
const fails = [];
const snap = () => page.evaluate(() => ({ cls: document.getElementById('lib-top').className, topAct: !!document.querySelector('#lib-top #lib-activity, #lib-top #lib-thumb-progress, #sk2-act'),
  bottomVis: (() => { const e = document.getElementById('lib-bottom'); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; })(),
  inBottom: !!document.querySelector('#lib-bottom #lib-thumb-progress'), progTxt: document.getElementById('lib-thumb-progress')?.textContent || '' }));
const base = await snap();
const states = [];
for (let i = 0; i < (process.env.SHOT ? 5 : 6); i++) {
  await page.evaluate((on) => { const e = document.getElementById('lib-thumb-progress'); e.textContent = on ? 'Indexing thumbnails 1,234 / 5,678 (22%)' : ''; }, i % 2 === 0);
  await page.waitForTimeout(250);
  states.push((await snap()).cls);
}
if (base.topAct) fails.push('progress indicator is inside the top bar');
if (!base.bottomVis) fails.push('#lib-bottom status bar is hidden');
if (!base.inBottom) fails.push('#lib-thumb-progress is not in #lib-bottom');
if (/lib-top-compact|tight|overflow/.test(base.cls) || new Set(states).size > 1) fails.push('top bar folded/flipped at 1440px: ' + JSON.stringify([base.cls, ...states]));
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
await b.close(); server.close();
if (fails.length) { console.log('FAIL\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('PASS');
