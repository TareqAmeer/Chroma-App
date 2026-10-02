// library:visual — docs/test-everything-plan.md Layer 3 (CHR-232). Pixel-diff baselines for the
// Library, which only became reachable off-screen once ?libtest=1 had stand-ins for its native
// commands. Every state × theme × width, in BOTH Chromium and Playwright WebKit (the engine family
// the real app renders with). A diff that appears only in WebKit is an engine bug, not a redesign.
//
//   node test/library_visual.mjs              # capture + compare against test/baselines/library_visual/
//   node test/library_visual.mjs --baseline   # (re)record baselines — only when a change is intended
//   node test/library_visual.mjs --engine=webkit --state=grid
//
// Widths are derived from the running app (see deriveWidths below), not typed in.
import { chromium, webkit } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { startServer } from './editor_state_harness.mjs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const BASELINE = process.argv.includes('--baseline');
const BASE_DIR = 'test/baselines/library_visual', OUT_DIR = 'test/output/library_visual';
const MAX_DIFF = 0.002; // fraction of pixels allowed to differ (anti-aliasing noise)

// States: each is a query + an optional in-page setup. Driven through the real UI controls.
const STATES = {
  grid: { q: 'libtest=1&libshapes=1&libn=24&deskx=1' },
  catalog: { q: 'libtest=1&libshapes=1&libcat=1&libn=24&deskx=1' },
  offline: { q: 'libtest=1&libshapes=1&libn=12&deskx=1&liboffline=1' },
  filters: { q: 'libtest=1&libshapes=1&libn=24&deskx=1', click: '#lib-filters-btn' },
  viewmenu: { q: 'libtest=1&libshapes=1&libn=24&deskx=1', click: '#lib-view-menu-btn' },
  selected: { q: 'libtest=1&libshapes=1&libn=24&deskx=1', clickFirst: '[data-path]' },
};
const ENGINES = { chromium, webkit };
const only = { engine: arg('engine'), state: arg('state'), width: arg('width') };

const { server, port } = await startServer();

// Widths come from the running app, not a typed list: the Library top bar collapses in stages
// (lib-top-tight1 ... lib-top-overflow3) measured from real overflow, so sweep the window width
// and keep the first width of every distinct stage, plus a common desktop width.
async function deriveWidths() {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1920, height: 900 } });
  await p.addInitScript(() => { try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); } catch (_) {} });
  await p.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=24&deskx=1`, { waitUntil: 'load' });
  await p.waitForTimeout(1800);
  await p.keyboard.press('Escape'); await p.click('#cs-tog-lib'); await p.waitForTimeout(800);
  const seen = new Map();
  for (let w = 1920; w >= 760; w -= 20) {
    await p.setViewportSize({ width: w, height: 900 }); await p.waitForTimeout(120);
    const stage = await p.evaluate(() => { const t = document.getElementById('lib-top'); return t ? [...t.classList].filter((c) => c.startsWith('lib-top-')).sort().join(' ') : ''; });
    if (!seen.has(stage)) seen.set(stage, w);
  }
  await b.close();
  return { widths: [...new Set([...seen.values(), 1440])].sort((x, y) => x - y), stages: seen };
}
const { widths: WIDTHS, stages } = only.width ? { widths: [+only.width], stages: new Map() } : await deriveWidths();
for (const [st, w] of stages) console.log(`  stage "${st || 'full'}" first at ${w}px`);
let fail = 0, total = 0, created = 0;
const rows = [];
for (const [ename, engine] of Object.entries(ENGINES)) {
  if (only.engine && only.engine !== ename) continue;
  const launchOpts = ename === 'chromium' ? { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] } : {};
  let browser = await engine.launch(launchOpts);
  for (const theme of ['dark', 'light']) for (const width of WIDTHS) for (const [sname, st] of Object.entries(STATES)) {
    if ((only.state && only.state !== sname) || (only.width && +only.width !== width)) continue;
    // Layout collapse is a top-bar/grid question: every state at the common width, only the grid at
    // each collapse stage — 44 shots instead of 144, same coverage of what the widths change.
    if (width !== 1440 && sname !== 'grid' && !only.state) continue;
    let shot;
    const name = `${ename}/${theme}_${width}_${sname}.png`;
    try {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC' });
    await ctx.addInitScript((t) => { try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); localStorage.setItem('csTheme', t); localStorage.setItem('csThemeGallery', t); localStorage.setItem('csThemeEditor', t); } catch (_) {} }, theme);
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?${st.q}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(1800);
    await page.keyboard.press('Escape');
    // deskx boots into the Studio; the Gallery is one toggle away.
    await page.click('#cs-tog-lib', { timeout: 5000 });
    await page.waitForFunction(() => { const t = [...document.querySelectorAll('#lib-overlay [data-path] img')]; return t.length >= 8 && t.every((i) => i.complete && i.classList.contains('loaded')); }, null, { timeout: 20000 }).catch(() => {});
    if (st.click) await page.click(st.click, { timeout: 5000 }).catch(() => {});
    if (st.clickFirst) await page.locator(st.clickFirst).first().click({ timeout: 5000 }).catch(() => {});
    // Freeze anything time-based so two runs of the same state are pixel-identical.
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
    await page.waitForTimeout(600);
    shot = await page.screenshot();
    await ctx.close();
    } catch (e) {
      // A crashed WebKit page/browser must not take the remaining shots down with it.
      fail++; total++; rows.push(`ERROR ${ename}/${theme}_${width}_${sname}  ${e.message.split('\n')[0]}`);
      await browser.close().catch(() => {}); browser = await engine.launch(launchOpts);
      continue;
    }
    const basePath = path.join(BASE_DIR, name);
    total++;
    if (BASELINE || !existsSync(basePath)) {
      mkdirSync(path.dirname(basePath), { recursive: true }); writeFileSync(basePath, shot); created++;
      continue;
    }
    const a = PNG.sync.read(readFileSync(basePath)), b = PNG.sync.read(shot);
    if (a.width !== b.width || a.height !== b.height) { fail++; rows.push(`SIZE  ${name}`); continue; }
    const diff = new PNG({ width: a.width, height: a.height });
    const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
    const frac = n / (a.width * a.height);
    if (frac > MAX_DIFF) {
      fail++;
      const out = path.join(OUT_DIR, name.replace('.png', '')); mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out + '.actual.png', shot); writeFileSync(out + '.diff.png', PNG.sync.write(diff));
      rows.push(`DIFF  ${name}  ${(frac * 100).toFixed(2)}%`);
    }
  }
  await browser.close();
}
server.close();
console.log(`library:visual — widths ${WIDTHS.join(', ')}; ${total} screenshots, ${created} baseline(s) written`);
rows.forEach((r) => console.log('  ' + r));
console.log(fail ? `library:visual — FAIL (${fail} differ; see ${OUT_DIR})` : 'library:visual — PASS');
process.exit(fail ? 1 : 0);
