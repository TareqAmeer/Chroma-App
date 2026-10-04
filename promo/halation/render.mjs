// node render.mjs [--preview=t1,t2] — base frames (no glow) + transparent overlay frames + per-frame app params.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {extname, resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => (process.argv.find(a => a.startsWith(k + '=')) || `${k}=${d}`).split('=')[1];
const preview = arg('--preview', '');
const types = {'.html': 'text/html', '.js': 'text/javascript', '.otf': 'font/otf', '.webp': 'image/webp'};
const server = createServer(async (q, r) => { try { const p = resolve(dir, '.' + decodeURIComponent(q.url.split('?')[0])); if (!p.startsWith(dir)) throw 0;
  r.writeHead(200, {'content-type': types[extname(p)] || 'application/octet-stream'}); r.end(await readFile(p)); } catch { r.writeHead(404); r.end(); } }).listen(0);
for (const d of ['base', 'ov']) { await rm(join(dir, d), {recursive: true, force: true}); await mkdir(join(dir, d), {recursive: true}); }
const browser = await chromium.launch({headless: true, args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11']});
const params = [];
try {
  const page = await browser.newPage({viewport: {width: 1920, height: 1080}});
  page.on('pageerror', e => console.error(e)); page.on('console', m => { if (m.type() === 'error') console.error(m.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/film.html`);
  await page.waitForFunction(() => window.ready === true, null, {timeout: 60000});
  const {DUR, FPS} = await page.evaluate(() => ({DUR: window.DUR, FPS: window.FPS}));
  const times = preview ? preview.split(',').map(Number) : Array.from({length: Math.round(DUR * FPS)}, (_, i) => i / FPS);
  for (const [i, t] of times.entries()) {
    const n = String(i).padStart(4, '0');
    params.push(await page.evaluate(t => window.renderAt(t, 'base'), t));
    await page.screenshot({path: join(dir, 'base', n + '.png')});
    await page.evaluate(t => window.renderAt(t, 'overlay'), t);
    await page.screenshot({path: join(dir, 'ov', n + '.png'), omitBackground: true});
    if (i % 96 === 0) console.log(`${i}/${times.length}`);
  }
} finally { await browser.close(); server.close(); }
await writeFile(join(dir, 'params.json'), JSON.stringify(params));
console.log('done', params.length);
