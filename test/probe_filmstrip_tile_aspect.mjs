// CHR-143: docked Library filmstrip tiles must derive height from the photo's real aspect.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const srv = createServer(async (q, r) => { try { const b = await readFile(path.join(root, decodeURIComponent(q.url.split('?')[0]))); const t = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.otf': 'font/otf', '.wasm': 'application/wasm' }; r.setHeader('content-type', t[path.extname(q.url.split('?')[0])] || 'application/octet-stream'); r.end(b); } catch { r.statusCode = 404; r.end(); } }).listen(0, '127.0.0.1');
const br = await chromium.launch();
const pg = await br.newPage({ viewport: { width: 1400, height: 900 } });
await pg.goto(`http://127.0.0.1:${srv.address().port}/desktop/dist/index.html?libtest=1&libn=6&deskx=1`);
await pg.waitForTimeout(1500);
await pg.keyboard.press('Escape');
await pg.waitForFunction(() => document.querySelectorAll('#lib-grid .lib-card').length > 0, { timeout: 15000 });
await pg.waitForTimeout(800);
let fails = 0;
for (const theme of ['dark', 'light']) for (const av of [false, true]) for (const w of [90, 150, 280]) {
  const res = await pg.evaluate(async ({ w, theme, av }) => {
    document.body.classList.toggle('light', theme === 'light');
    document.querySelector('#lib-overlay').classList.remove('full'); document.querySelector('#lib-grid').classList.toggle('aspect-view', av);
    document.querySelector('.fx-layout')?.style.setProperty('--dock-w-user', w + 'px');
    await new Promise(r => setTimeout(r, 300));
    const dims = [[360, 240], [240, 360], [360, 202], [360, 360]];
    const imgs = [...document.querySelectorAll('#lib-grid .lib-card .lib-thumb-wrap img')].slice(0, 4);
    for (let i = 0; i < imgs.length; i++) {
      const c = document.createElement('canvas'); c.width = dims[i][0]; c.height = dims[i][1];
      c.getContext('2d').fillRect(0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r));
      imgs[i].src = URL.createObjectURL(blob); imgs[i].classList.add('loaded');
      await imgs[i].decode();
    }
    await new Promise(r => setTimeout(r, 200));
    const mb=document.querySelector('#lib-main').getBoundingClientRect(), cs=getComputedStyle(document.querySelector('#lib-main')); const cl=mb.left+parseFloat(cs.paddingLeft), cr=mb.right-parseFloat(cs.paddingRight)-(document.querySelector('#lib-main').offsetWidth-document.querySelector('#lib-main').clientWidth);
    return imgs.map((im, i) => { const cd=im.closest('.lib-card').getBoundingClientRect(); const rc0=im.getBoundingClientRect(); const inside=cd.left>=cl-0.5&&cd.right<=cr+0.5&&rc0.left>=cd.left-0.5&&rc0.right<=cd.right+0.5; const rc = im.getBoundingClientRect(), wr = im.parentElement.getBoundingClientRect(); return { inside, cl, cr, cardL: cd.left, cardR: cd.right, want: dims[i][0] / dims[i][1], imgW: rc.width, imgH: rc.height, wrapW: wr.width, wrapH: wr.height, pos: getComputedStyle(im).position, full: document.querySelector('#lib-overlay').classList.contains('full') }; });
  }, { w, theme, av });
  for (const r of res) { const got = r.wrapW / r.wrapH; const ok = r.inside && Math.abs(got - r.want) / r.want < 0.03; if (!ok) fails++; console.log(theme, w, 'av=' + av, ok ? 'ok ' : 'BAD', JSON.stringify(r)); }
}
await br.close(); srv.close();
if (fails) { console.error('FAIL', fails); process.exit(1); }
