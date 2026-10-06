import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const samplePath = path.join(root, 'vendor', 'splash', 'dog-sitting.webp');
const sampleDigestBefore = createHash('sha256').update(await readFile(samplePath)).digest('hex');
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
    const fullPath = path.resolve(root, pathname);
    if (!fullPath.startsWith(root + path.sep)) throw new Error('Path outside project');
    const body = await readFile(fullPath);
    const type = fullPath.endsWith('.html') ? 'text/html' : fullPath.endsWith('.webp') ? 'image/webp' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#cs-modal-ov [data-tour-action="sample"]', { timeout: 30000 });
  const welcome = await page.locator('#cs-modal-ov').innerText();
  assert.match(welcome, /Open a photo/);
  assert.match(welcome, /Try a sample/);
  assert.match(welcome, /optional and separate/i);
  assert.match(welcome, /Sample photo by Tareq Ameer/);
  assert.equal(await page.locator('body').evaluate((el) => el.classList.contains('cs-adv-hidden')), true);
  const panelFits = async () => {
    const box = await page.locator('#cs-modal-ov .cs-modal').boundingBox();
    const viewport = page.viewportSize();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height,
      `welcome dialog should fit ${viewport.width}×${viewport.height}`);
  };
  await panelFits(); // dark theme at laptop width
  await page.setViewportSize({ width: 980, height: 720 });
  await page.locator('body').evaluate((el) => el.classList.add('light'));
  await panelFits(); // light theme at a smaller laptop width

  await page.evaluate(() => {
    window.chromasmithToggleLibrary = async () => {};
    window.chromasmithLibraryIsOpen = () => true;
    const chooseFolder = document.createElement('button');
    chooseFolder.id = 'lib-empty-addfolder';
    chooseFolder.hidden = true;
    chooseFolder.onclick = () => { window.__onboardingFolderClicked = true; };
    document.body.appendChild(chooseFolder);
    window.chromasmithShowTour();
  });
  assert.match(await page.locator('#cs-modal-ov').innerText(), /Browse a folder/);
  await page.locator('#cs-modal-ov [data-tour-action="folder"]').click();
  await page.waitForFunction(() => window.__onboardingFolderClicked === true);

  await page.evaluate(() => {
    window.fxPickPhotos = () => { window.__onboardingPickerClicked = true; };
    window.chromasmithShowTour();
  });
  await page.locator('#cs-modal-ov [data-tour-action="open"]').click();
  assert.equal(await page.evaluate(() => window.__onboardingPickerClicked), true, 'Open a photo reuses the existing picker');

  await page.evaluate(() => window.chromasmithShowTour());
  await page.locator('#cs-modal-ov [data-tour-action="sample"]').click();
  await page.waitForFunction(() => fxImages.length === 1 && document.querySelector('#cs-modal-ov h2')?.textContent.includes('1 of 3'), { timeout: 45000 });
  assert.equal(await page.evaluate(() => fxImages[0].name), 'Chromasmith sample');

  await page.waitForFunction(() => [...document.querySelectorAll('#sel-lut option')].some((option) => option.value.startsWith('p:')), { timeout: 30000 });
  await page.evaluate(async () => {
    const option = [...document.querySelectorAll('#sel-lut option')].find((item) => item.value.startsWith('p:'));
    await selectLUT(option.value);
  });
  await page.waitForFunction(() => document.querySelector('#cs-modal-ov h2')?.textContent.includes('2 of 3'), { timeout: 30000 });
  await page.locator('#cs-modal-ov [data-guide-action]').click();
  await page.waitForFunction(() => fxCompare && document.querySelector('#cs-modal-ov h2')?.textContent.includes('3 of 3'), { timeout: 30000 });
  assert.equal(await page.evaluate(() => localStorage.getItem('chromasmith-first-edit-stage-v1')), 'export');
  assert.equal(await page.locator('body').evaluate((el) => el.classList.contains('cs-adv-hidden')), true,
    'export discovery must not unlock advanced tabs');
  await page.evaluate(() => {
    window.CS_PLATFORM = { revealLabel: 'Explorer' };
    window.__TAURI__ = { core: { invoke: async (command, args) => { window.__onboardingReveal = [command, args.path]; } } };
    csExportDone(1, 'C:\\Exports\\chromasmith-sample.jpg', true);
  });
  assert.match(await page.locator('#cs-export-done').innerText(), /First edit saved to Exports/);
  await page.locator('#cs-export-done button').first().click();
  assert.deepEqual(await page.evaluate(() => window.__onboardingReveal), ['reveal_in_finder', 'C:\\Exports\\chromasmith-sample.jpg']);
  assert.equal(createHash('sha256').update(await readFile(samplePath)).digest('hex'), sampleDigestBefore,
    'opening the sample must not modify its bundled source');
  console.log('Onboarding first edit: sample attribution, local photo open, look, original compare, and explicit advanced tools passed.');
} finally {
  await browser.close();
  server.close();
}
