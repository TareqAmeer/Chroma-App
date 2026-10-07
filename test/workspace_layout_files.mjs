// CHR-272 versioned workspace JSON import/export regression at laptop sizes and both themes.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('chromasmith-tour-seen-v1', '1'));
  await page.goto(`${pathToFileURL(path.join(root, 'chromasmith-22.html')).href}?libtest=1`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof csLayoutImportText === 'function' && typeof csLayoutExportFile === 'function', null, { timeout: 30000 });

  for (const variant of [{ width: 1280, height: 800, light: false }, { width: 1440, height: 900, light: true }]) {
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await page.evaluate(light => document.body.classList.toggle('light', light), variant.light);
    await page.evaluate(() => localStorage.setItem('cs_layouts', JSON.stringify([
      { name: 'Editing', keys: { cs_panelw: '344', cs_railmode: 'full', cs_workspace_controls_v1: '{"sectionOrder":["adjust"]}' } },
      { name: 'Culling', keys: { chromasmith_lib_sidebar: '1' } },
    ])));

    const menu = await page.evaluate(() => csLayoutMenuHtml());
    assert.match(menu, /Export saved layouts/);
    assert.match(menu, /Import layouts/);
    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(() => csLayoutExportFile());
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'chromasmith-workspaces.json');
    const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(exported.format, 'chromasmith-workspaces');
    assert.equal(exported.version, 1);
    assert.deepEqual(exported.layouts.map(layout => layout.name), ['Editing', 'Culling']);

    await page.evaluate(() => localStorage.setItem('cs_layouts', JSON.stringify([{ name: 'Editing', keys: { cs_panelw: '220' } }, { name: 'Keep me', keys: {} }])));
    const chooserPromise = page.waitForEvent('filechooser');
    await page.evaluate(() => csLayoutImportClick());
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: 'chromasmith-workspaces.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('cs_layouts') || '[]').some(layout => layout.name === 'Culling'));
    const layouts = await page.evaluate(() => JSON.parse(localStorage.getItem('cs_layouts')));
    assert.deepEqual(layouts.map(layout => layout.name), ['Keep me', 'Editing', 'Culling'], 'import replaces same-name workspace and preserves other saved layouts');
    assert.equal(layouts.find(layout => layout.name === 'Editing').keys.cs_panelw, '344');

    const beforeInvalid = JSON.stringify(layouts);
    const rejected = await page.evaluate(() => {
      try { csLayoutImportText(JSON.stringify({ format: 'chromasmith-workspaces', version: 1, layouts: [{ name: 'Bad', keys: { attacker_key: 'x' } }] })); return ''; }
      catch (error) { return error.message; }
    });
    assert.match(rejected, /Unsupported workspace setting/);
    assert.equal(await page.evaluate(() => localStorage.getItem('cs_layouts')), beforeInvalid, 'invalid file leaves saved layouts unchanged');
  }
  assert.deepEqual(errors, [], 'no page errors during file import/export');
  console.log('workspace layout files: versioned export/import, replacement/merge, invalid-file atomicity, laptop sizes, dark/light themes passed');
} finally {
  await browser.close();
}
