// node render.mjs [--preview t1,t2,...] [--sub=N] — serves this folder, renders frames with Playwright.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile, mkdir, rm} from 'node:fs/promises';
import {extname, resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => (process.argv.find(a => a.startsWith(k + '=')) || `${k}=${d}`).split('=')[1];
const preview = arg('--preview', ''), sub = arg('--sub', '8'), mult = +arg('--mult', '2') /* 2 = 48fps, blended to 24fps in finish.sh */, out = resolve(dir, arg('--out', 'frames'));
const types = {'.html': 'text/html', '.js': 'text/javascript', '.otf': 'font/otf', '.webp': 'image/webp', '.png': 'image/png'};
const server = createServer(async (q, r) => { try { const p = resolve(dir, '.' + decodeURIComponent(q.url.split('?')[0])); if (!p.startsWith(dir)) throw 0;
  r.writeHead(200, {'content-type': types[extname(p)] || 'application/octet-stream'}); r.end(await readFile(p)); } catch { r.writeHead(404); r.end(); } }).listen(0);
await rm(out, {recursive: true, force: true}); await mkdir(out, {recursive: true});
const browser = await chromium.launch({headless: true, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11']});
try {
  const page = await browser.newPage({viewport: {width: 1920, height: 1080}});
  page.on('console', m => { if (m.type() === 'error') console.error(m.text()); }); page.on('pageerror', e => console.error(e));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?sub=${sub}`);
  await page.waitForFunction(() => window.ready === true, null, {timeout: 120000});
  const {DUR, FPS} = await page.evaluate(() => ({DUR: window.DUR, FPS: window.FPS}));
  const times = preview ? preview.split(',').map(Number) : Array.from({length: Math.round(DUR * FPS * mult)}, (_, i) => i / (FPS * mult));
  for (const [i, t] of times.entries()) {
    await page.evaluate(t => window.renderAt(t), t);
    await page.screenshot({path: join(out, `${String(i).padStart(4, '0')}.png`)});
    if (!preview && i % 96 === 0) console.log(`${i}/${times.length}`);
  }
} finally { await browser.close(); server.close(); }
console.log(out);
