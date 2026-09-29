// Regression probe for: "opening an image would sometimes then load a completely different image".
// Mechanism: openInEditorInner trusted fxImages[0] after `await loadFXImages([file])`, but a decode
// failure makes loadFXImages return without installing anything - fxImages[0] is still the
// PREVIOUS photo, which was then stamped with the NEW path, cached in imgCache under it, and had
// the new photo's recipe applied. Photo 2's decode is forced to fail here.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const server = await new Promise(r => {
  const s = createServer(async (req, res) => {
    try {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const d = await readFile(path.join(ROOT, u.slice(1)));
      const ext = path.extname(u);
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm' };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      res.end(d);
    } catch { res.writeHead(404); res.end(); }
  }).listen(0, '127.0.0.1', () => r(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
const br = await chromium.launch();
const pg = await br.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
pg.on('pageerror', e => errors.push(e.message));

await pg.goto(`${base}/desktop/dist/index.html?libtest=1&libn=3&deskx=1`, { waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(1500);
await pg.evaluate(() => { document.querySelectorAll('button').forEach(b => { if (b.textContent.trim() === 'Got it') b.click(); }); });
await pg.keyboard.press('Escape');
await pg.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length > 0, null, { timeout: 15000 });
const cards = pg.locator('#lib-grid .lib-card');
await cards.nth(0).dblclick();
await pg.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages && fxImages[0] && fxImages[0].path, null, { timeout: 15000 });
const p1 = await pg.evaluate(() => fxImages[0].path);
await pg.evaluate(() => { window.loadImg = async () => { throw new Error('forced decode failure'); }; });
await cards.nth(1).dblclick();
await pg.waitForTimeout(1500);
const after = await pg.evaluate(() => ({ p: fxImages[0].path, count: fxImages.length }));
console.log(JSON.stringify({ p1, after, pageErrors: errors }, null, 1));
await br.close(); server.close();
if (after.p !== p1) {
  console.error(`FAIL: photo 2's decode failed but the editor's image was re-labelled ${after.p} (was ${p1}) - old pixels stamped with the new photo's path.`);
  process.exit(1);
}
console.log('PASS: failed open leaves the previous photo correctly labelled.');
