// CHR-197: Export Recipes get file export/import in the Presets manager, matching Edit Styles.
// Real clicks: export a recipe (download), re-import it (file chooser) -> renamed "(imported)"
// copy with identical settings; the machine-local destination folder never enters the file;
// a malformed file changes nothing. Desktop layout, both themes.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'cs-exprec-'));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'] });
const errors = [];
const KEY = 'chromasmith-export-presets-v1';
const seed = [
  { name: 'Web/Small', settings: { fmt: 'jpg', q: '82', size: '2048', sharp: '1', keepGps: false, dest: '/Users/someone/Private/Out' } },
  { name: 'Print', settings: { fmt: 'png', q: '99', size: '0', sharp: '0', keepGps: true, dest: '' } },
];
for (const theme of ['dark', 'light']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  page.on('pageerror', (e) => errors.push(String(e)));
  // Mark the welcome tour as seen: it opens on a timer after load and would replace the Presets modal.
  await page.addInitScript(() => { try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); } catch (_) {} });
  await page.goto(pathToFileURL(process.env.APP_HTML || path.join(ROOT, 'chromasmith-22.html')).href + '?deskx=1', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof presetsManagerOpen === 'function' && typeof exportRecipesImportText === 'function', null, { timeout: 30000 });
  await page.evaluate(([k, s, t]) => { localStorage.setItem(k, JSON.stringify(s)); fxSetTheme(t); document.querySelectorAll('#cs-modal-ov').forEach((x) => x.remove()); }, [KEY, seed, theme]);
  await page.evaluate(() => presetsManagerOpen('export'));
  const exportBtn = page.locator(`#pm-body button[onclick='exportRecipeExport("Web/Small")']`);
  assert.equal(await exportBtn.innerText(), 'Export', `${theme}: the recipe row has an Export action`);
  const [dl] = await Promise.all([page.waitForEvent('download'), exportBtn.click()]);
  const file = path.join(tmp, `${theme}-${dl.suggestedFilename()}`);
  await dl.saveAs(file);
  const json = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(json.format, 'chromasmith-export-recipes', `${theme}: file format tag`);
  assert.deepEqual(json.recipes.map((r) => r.name), ['Web/Small'], `${theme}: only the clicked recipe is exported`);
  assert.equal('dest' in json.recipes[0].settings, false, `${theme}: destination path is not written to the file`);

  // The button appends its own hidden file input and clicks it; set the file on that input
  // (Playwright's filechooser event proved unreliable right after a download in this context).
  const importVia = async (f) => {
    await page.locator('#pm-body [data-pm="export-import"]').click();
    const inp = page.locator('body > input[type=file][accept*="json"]').last();
    await inp.waitFor({ state: 'attached', timeout: 3000 });
    await inp.setInputFiles(f);
  };
  await importVia(file);
  await page.waitForFunction((k) => JSON.parse(localStorage.getItem(k)).length === 3, KEY, { timeout: 5000 });
  const after = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  const imp = after.find((p) => p.name === 'Web/Small (imported)');
  assert(imp, `${theme}: a name clash imports as "(imported)"`);
  assert.deepEqual(imp.settings, { fmt: 'jpg', q: '82', size: '2048', sharp: '1', keepGps: false }, `${theme}: settings round-trip, no destination`);
  assert.equal(after.find((p) => p.name === 'Web/Small').settings.dest, '/Users/someone/Private/Out', `${theme}: original recipe untouched`);
  assert(await page.locator('#pm-body').getByText('Small (imported)').count(), `${theme}: manager re-renders with the imported recipe`);

  const bad = path.join(tmp, 'bad.json');
  await writeFile(bad, JSON.stringify({ format: 'chromasmith-export-recipes', version: 1, recipes: [{ name: 'ok', settings: { fmt: 'jpg', q: '80', size: '0', sharp: '0' } }, { name: 'x', settings: { fmt: 'bmp', q: '80', size: '0', sharp: '0' } }] }));
  await importVia(bad);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).length, KEY), 3, `${theme}: an invalid file imports nothing (atomic)`);
  console.log(`  ${theme}: ok`);
  await page.close();
}
await browser.close();
assert.deepEqual(errors, [], 'no page errors');
console.log('EXPORT RECIPE FILES: PASS');
