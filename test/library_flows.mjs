// library:flows — docs/test-everything-plan.md Layer 4 (CHR-232). Multi-step user journeys
// through the Gallery + Editor in ?libtest=1, each asserting the END state (what the native
// layer was asked to do, what the Editor now points at) rather than just "no error". The
// stand-ins record side-effect commands in window.__libtestCalls for exactly this.
//
//   node test/library_flows.mjs
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startServer } from './editor_state_harness.mjs';

const { server, port } = await startServer();
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
const flow = async (name, fn) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); } catch (_) {} });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=12&deskx=1`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(1800); await page.keyboard.press('Escape');
    const detail = await fn(page);
    if (errs.length) throw new Error('page error: ' + errs[0]);
    results.push([name, true, detail || '']);
  } catch (e) { results.push([name, false, e.message.split('\n')[0]]); }
  await ctx.close();
};
const calls = (page, cmd) => page.evaluate((c) => (window.__libtestCalls || []).filter(([n]) => n === c).map(([, a]) => a), cmd);
const openFromGallery = async (page, i = 0) => {
  await page.locator('[data-path]').nth(i).dblclick();
  await page.waitForFunction(() => typeof FX !== 'undefined' && FX.w > 0 && window.chromasmithHasOpenedPhoto && window.chromasmithHasOpenedPhoto(), null, { timeout: 15000 });
  return page.evaluate(() => window.chromasmithSourcePath);
};

await flow('open from Gallery → Reject flag lands on that photo', async (page) => {
  const p = await openFromGallery(page, 2);
  await page.evaluate(() => window.fxToggleFlag('Red'));
  await page.waitForTimeout(300);
  const flag = await page.evaluate(() => window.chromasmithOpenedFlag());
  if (flag !== 'Red') throw new Error(`expected Red on ${p}, got "${flag}"`);
  return p;
});

await flow('Gallery photo, then a dropped file → flags no longer target the Gallery photo', async (page) => {
  await openFromGallery(page, 1);
  const b64 = (await readFile('test/fixtures/portrait.png')).toString('base64');
  await page.evaluate(async (b) => { await window.loadFXImages([new File([Uint8Array.from(atob(b), (c) => c.charCodeAt(0))], 'dropped.png', { type: 'image/png' })]); }, b64);
  const s = await page.evaluate(() => ({ has: window.chromasmithHasOpenedPhoto(), src: window.chromasmithSourcePath, btn: getComputedStyle(document.getElementById('btn-flag-red')).display }));
  if (s.has || s.src || s.btn !== 'none') throw new Error('still bound to Gallery photo: ' + JSON.stringify(s));
});

await flow('export from a Gallery photo → recorded in that photo\'s export history', async (page) => {
  const p = await openFromGallery(page, 0);
  await page.evaluate(() => window.chromasmithRecordExport('v1', {}, '/test/Exports/out.jpg'));
  const c = await calls(page, 'append_export_history');
  if (!c.some((a) => a.path === p)) throw new Error('no append_export_history for ' + p + ': ' + JSON.stringify(c));
});

await flow('select 3 photos → Merge exposures (HDR) → native merge asked for those 3', async (page) => {
  const tiles = page.locator('[data-path]');
  const paths = [];
  for (let i = 0; i < 3; i++) {
    await tiles.nth(i).click({ modifiers: i ? ['Meta'] : [] });
    paths.push(await tiles.nth(i).getAttribute('data-path'));
  }
  await tiles.nth(2).click({ button: 'right' });
  await page.getByText('Merge into (beta)', { exact: false }).first().hover();
  await page.getByText('Merge exposures (HDR)', { exact: false }).first().click();
  await page.waitForTimeout(800);
  const c = await calls(page, 'merge_hdr_photos');
  if (!c.length) throw new Error('merge_hdr_photos never called');
  const got = [...c[0].paths].sort(), want = [...paths].sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`merged ${got} expected ${want}`);
});

await browser.close(); server.close();
let fail = false;
for (const [n, ok, d] of results) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!ok) fail = true; }
console.log(fail ? 'library:flows — FAIL' : 'library:flows — PASS');
process.exit(fail ? 1 : 0);
