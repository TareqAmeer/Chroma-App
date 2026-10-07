// CHR-179 / CHR-197: Presets manager opens on Looks (not the last-used tab), shows "Folder/Name"
// presets as real folder groups, and the Save Style picker never shows raw control ids.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.otf': 'font/otf', '.png': 'image/png' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('chromasmith-tour-seen-v1', '1');
    const rec = { sliders: {}, toggles: { grain: true }, selects: {}, colors: {} };
    localStorage.setItem('chromasmith-styles-v1', JSON.stringify([
      { version: 2, name: 'Wedding/Warm', recipe: rec, keys: [] },
      { version: 2, name: 'Wedding/Cool', recipe: rec, keys: [] },
      { version: 2, name: 'Street/Grit', recipe: rec, keys: [] },
      { version: 2, name: 'Loose', recipe: rec, keys: [] },
    ]));
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.presetsManagerOpen === 'function' && typeof exportPresetsSave === 'function');
  await page.evaluate(() => exportPresetsSave([{ name: 'Web/Small', settings: { fmt: 'jpg', q: 80, size: 1600, sharp: 0 } }]));

  const activeTab = () => page.evaluate(() => document.querySelector('#pm-body .seg button.on')?.textContent || '');
  const close = () => page.evaluate(() => document.getElementById('cs-modal-ov')?.remove());

  // Open on Export Recipes once (the Output panel's Manage button), then reopen with no tab:
  // must be Looks, not the sticky last tab.
  await page.evaluate(() => presetsManagerOpen('export'));
  assert.match(await activeTab(), /^Export Recipes/);
  await close();
  await page.evaluate(() => presetsManagerOpen());
  assert.match(await activeTab(), /^Looks/, 'default tab is Looks, not the last-used tab');
  await close();

  // Folder groups in Edit Styles, counted, leaf names on rows.
  await page.evaluate(() => presetsManagerOpen('styles'));
  const groups = await page.$$eval('#pm-body .pm-folder', (els) => els.map((e) => e.textContent.trim()));
  assert.deepEqual(groups, ['Street (1)', 'Wedding (2)']);
  const order = await page.$$eval('#pm-body .pm-folder, #pm-body .pm-name', (els) => els.map((e) => (e.classList.contains('pm-folder') ? '#' : '') + e.textContent.trim()));
  assert.deepEqual(order, ['Loose', '#Street (1)', 'Grit', '#Wedding (2)', 'Cool', 'Warm'], 'ungrouped first, then folders, leaf names under each');
  assert.equal(await page.locator('#pm-body .pm-name[title="Wedding/Warm"]').count(), 1, 'full path kept in the tooltip');
  await close();

  // Export recipes group too.
  await page.evaluate(() => presetsManagerOpen('export'));
  assert.deepEqual(await page.$$eval('#pm-body .pm-folder', (els) => els.map((e) => e.textContent.trim())), ['Web (1)']);
  await close();

  // Save Style picker: every row label is human text, never a raw control id.
  await page.evaluate(() => { window.__pick = _pasteChooseFields('Save Style', _pasteAllFieldKeys(), _pasteAllFieldKeys(), 'Continue'); });
  await page.waitForSelector('.paste-field-cb');
  const labels = await page.$$eval('.paste-field-cb', (cbs) => cbs.map((c) => c.parentElement.textContent.trim()));
  assert(labels.length > 50, `picker lists the fields (${labels.length})`);
  const raw = labels.filter((l) => /^(tg|sel|sl|cl)-/.test(l) || /^[a-z]+(-[a-z0-9]+)+$/.test(l));
  assert.deepEqual(raw, [], `raw control ids shown in picker: ${raw.join(', ')}`);
  assert.deepEqual(await page.evaluate(() => [_fxPrettyId('tg-lut'), _fxPrettyId('tg-hal-white'), _fxPrettyId('tg-grain')]), ['Look', 'Halation: white', 'Grain']);
  await close();
  assert.deepEqual(errors, [], errors.join('; '));
  console.log(`PASS: presets manager defaults to Looks, groups folders, ${labels.length} picker labels are human.`);
} finally {
  if (browser) await browser.close();
  server.close();
}
