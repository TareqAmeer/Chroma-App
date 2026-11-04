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

  // CHR-197: your own saved Looks get Rename / Export / Delete, like Edit Styles.
  await page.evaluate(async () => {
    const lut = new Float32Array(SZ * SZ * SZ * 3).fill(1);
    await lutLibPut('My Look', lutToBytes(lut));
    await refreshLUTSelect('l:My Look');
    // A Style that points at the look must follow a rename.
    stylesSave([...stylesList(), { version: 2, name: 'Uses Look', recipe: { sliders: {}, toggles: {}, selects: { 'sel-lut': 'l:My Look' }, colors: {} }, keys: [] }]);
  });
  const ownRow = (name) => page.locator('#pm-body .pm-name[title="' + name + '"]').locator('xpath=../..');
  await page.evaluate(() => presetsManagerOpen('looks'));
  assert.deepEqual(await ownRow('My Look').locator('button').allTextContents(), ['Apply', 'Rename', 'Export', 'Delete']);
  // libtest runs with the mocked desktop shell, so dl() goes through saveFile's native path:
  // capture what is handed to saveFile rather than waiting for a browser download.
  await page.evaluate(() => { window.saveFile = async (content, fname) => { window.__saved = { content: String(content), fname }; }; });
  await ownRow('My Look').locator('button', { hasText: 'Export' }).click();
  await page.waitForFunction(() => !!window.__saved);
  const saved = await page.evaluate(() => window.__saved);
  assert.equal(saved.fname, 'My_Look.cube');
  const cube = saved.content;
  assert.match(cube, /LUT_3D_SIZE 33/); assert.match(cube, /^1.000000 1.000000 1.000000$/m, 'exported .cube carries the saved LUT');
  await ownRow('My Look').locator('button', { hasText: 'Rename' }).click();
  await page.fill('#fx-ask-input', 'Film/Renamed Look');
  await page.click('#fx-ask-ok');
  await page.waitForSelector('#pm-body .pm-name[title="Film/Renamed Look"]');
  assert.deepEqual(await page.evaluate(async () => [(await lutLibList()).sort(), document.getElementById('sel-lut').value, stylesList().find((s) => s.name === 'Uses Look').recipe.selects['sel-lut']]),
    [['Film/Renamed Look'], 'l:Film/Renamed Look', 'l:Film/Renamed Look'], 'rename moves the library entry, keeps the selection and updates Styles that use it');
  await ownRow('Film/Renamed Look').locator('button', { hasText: 'Delete' }).click();
  await page.click('#fx-confirm-ok');
  await page.waitForFunction(async () => (await lutLibList()).length === 0);
  await page.waitForFunction(() => !document.querySelector('#pm-body .pm-name[title="Film/Renamed Look"]'));
  assert.equal(await page.evaluate(() => document.getElementById('sel-lut').value), '', 'deleting the selected look clears the selection');
  await close();

  // Edit Styles tab: "Export all" writes the existing multi-Style bundle.
  await page.evaluate(() => presetsManagerOpen('styles'));
  const bundleP = page.waitForEvent('download');
  await page.locator('#pm-body button', { hasText: 'Export all' }).click();
  const bundle = JSON.parse(await (await import('node:fs/promises')).readFile(await (await bundleP).path(), 'utf8'));
  assert.equal(bundle.format, 'chromasmith-style-bundle');
  assert.deepEqual(bundle.styles.map((s) => s.name).sort(), ['Loose', 'Street/Grit', 'Uses Look', 'Wedding/Cool', 'Wedding/Warm']);
  await close();
  assert.deepEqual(errors, [], errors.join('; '));
  console.log(`PASS: presets manager defaults to Looks, groups folders, ${labels.length} picker labels are human.`);
} finally {
  if (browser) await browser.close();
  server.close();
}
