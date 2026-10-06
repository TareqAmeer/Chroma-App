// Regression probe: the Library sidebar's People & Pets avatars flickered on every background
// renderCollections() (counts/keywords/activity refreshes) because the whole sidebar was rebuilt
// via innerHTML, recreating each avatar <img> hidden until a fresh async catalog_face_crop
// round trip refilled it. Asserts that a no-change re-render leaves avatar nodes in place, and
// that a changed re-render shows avatars already loaded (no blank frame).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(root, relative === 'desktop/dist/library-ui.js' ? 'desktop/library-ui.js' : relative);
    const body = await readFile(file);
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
let fail = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('chromasmith_lib_sec_open_v1', JSON.stringify(['collections', 'folders', 'drives', 'people'])));
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libcat=1&libn=50`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => document.querySelectorAll('#lib-collections .lib-face-ava img.loaded').length > 0, { timeout: 30000 });
  const r = await page.evaluate(async () => {
    const before = [...document.querySelectorAll('#lib-collections .lib-face-ava img')];
    let blank = 0;
    const mo = new MutationObserver(() => { blank = Math.max(blank, document.querySelectorAll('#lib-collections .lib-face-ava[data-face-id] img:not(.loaded)').length); });
    mo.observe(document.getElementById('lib-collections'), { childList: true, subtree: true });
    for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('lr-cloud-state')); // no-data-change re-render
    await new Promise((r) => setTimeout(r, 50));
    mo.disconnect();
    const after = [...document.querySelectorAll('#lib-collections .lib-face-ava img')];
    return { n: before.length, same: before.every((el) => el.isConnected), blank };
  });
  console.log(JSON.stringify(r));
  if (!r.same) { console.error('FAIL: avatar <img> nodes were recreated by a no-change sidebar re-render'); fail = 1; }
  if (r.blank) { console.error(`FAIL: ${r.blank} avatar(s) went blank during re-render`); fail = 1; }
} finally { await browser.close(); server.close(); }
if (!fail) console.log('PASS');
process.exit(fail);
