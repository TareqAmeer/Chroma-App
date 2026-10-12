// Regression probe: gallery -> studio -> gallery round trip must not scroll #lib-overlay
// horizontally. Card.scrollIntoView() in scrollLibraryToPath() (renderGrid -> toggleExpandedView)
// used to scroll the overflow:hidden #lib-overlay by ~197px, shifting the whole gallery
// (sidebar pushed off-screen left, header/logo cut off). Usage: node test/probe_lib_roundtrip_scroll.mjs [port]
import { chromium } from 'playwright';
const port = process.argv[2] || '4500';
const W = +(process.env.PROBE_W || 1438), H = +(process.env.PROBE_H || 849);
const br = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await br.newPage({ viewport: { width: W, height: H } });
pg.on('pageerror', e => console.log('pageerror', e.message));
await pg.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=400&deskx=1`, { waitUntil: 'load', timeout: 120000 });
await pg.waitForTimeout(3000);
await pg.evaluate(() => document.querySelectorAll('button').forEach(b => { if (b.textContent.trim() === 'Got it') b.click(); }));
await pg.keyboard.press('Escape');
await pg.waitForSelector('#lib-overlay', { state: 'attached', timeout: 60000 });
await pg.waitForTimeout(1500);
await pg.locator('.lib-card').first().dblclick().catch(e => console.log('open photo:', e.message.split('\n')[0]));
await pg.waitForTimeout(2000);
const state = () => pg.evaluate(() => {
  const ov = document.getElementById('lib-overlay'), side = document.getElementById('lib-side');
  return { scrollLeft: ov.scrollLeft, sideLeft: Math.round(side.getBoundingClientRect().left), full: ov.classList.contains('full') };
});
await pg.evaluate(() => document.getElementById('cs-tog-lib').click()); await pg.waitForTimeout(1200);
const g0 = await state(); console.log('after open', JSON.stringify(g0));
const g1 = await state();
await pg.evaluate(() => document.getElementById('cs-tog-studio').click()); await pg.waitForTimeout(1200);
await pg.evaluate(() => document.getElementById('cs-tog-lib').click()); await pg.waitForTimeout(1500);
const g2 = await state();
await br.close();
console.log(JSON.stringify({ before: g1, afterRoundTrip: g2 }));
if (g2.scrollLeft !== 0 || g2.sideLeft < 0) { console.error(`FAIL: #lib-overlay scrollLeft=${g2.scrollLeft}, #lib-side left=${g2.sideLeft} (expected 0 / >=0)`); process.exit(1); }
console.log('PASS');
