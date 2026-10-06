import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
    const file = path.join(root, relative);
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('chromasmith-tour-seen-v1', '1'));
  await page.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html?deskx=1`, {
    waitUntil: 'domcontentloaded', timeout: 120000,
  });
  await page.waitForFunction(() => typeof window.uiDensitySet === 'function', { timeout: 20000 });
  await page.waitForTimeout(1000);

  const comfortable = await page.evaluate(() => {
    const fixture = document.createElement('div');
    fixture.innerHTML = '<section class="fx-ctrl"><header class="fx-ctrl-title">Example</header><div class="fx-row">Control</div><div class="fx-row">Second control</div></section>';
    document.body.appendChild(fixture);
    const control = fixture.querySelector('.fx-ctrl');
    const row = fixture.querySelector('.fx-row');
    const values = {
      mode: document.body.dataset.uiDensity,
      sectionGap: getComputedStyle(control).marginBottom,
      stackGap: getComputedStyle(row).marginBottom,
      rowGap: getComputedStyle(row).rowGap,
    };
    fixture.remove();
    appearanceBuild();
    return values;
  });
  assert.equal(comfortable.mode, 'comfortable', 'new users get the reviewed Comfortable default');
  assert.equal(comfortable.sectionGap, '20px');
  assert.equal(comfortable.stackGap, '8px');
  assert.equal(comfortable.rowGap, '8px');
  assert.equal(await page.locator('#fx-appearance-menu [aria-pressed="true"]').count(), 1);
  await mkdir(path.join(root, 'test/output'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'test/output/chr265-editor-comfortable.png') });

  await page.evaluate(() => {
    settingsToggle();
    settingsShowCat('appearance');
  });
  await page.locator('#fx-appearance-menu button[onclick="uiDensitySet(\'compact\')"]').click();
  const compact = await page.evaluate(() => {
    const fixture = document.createElement('div');
    fixture.innerHTML = '<section class="fx-ctrl"><header class="fx-ctrl-title">Example</header><div class="fx-row">Control</div><div class="fx-row">Second control</div></section>';
    document.body.appendChild(fixture);
    const values = {
      mode: document.body.dataset.uiDensity,
      sectionGap: getComputedStyle(fixture.querySelector('.fx-ctrl')).marginBottom,
      stackGap: getComputedStyle(fixture.querySelector('.fx-row')).marginBottom,
      rowGap: getComputedStyle(fixture.querySelector('.fx-row')).rowGap,
      saved: localStorage.getItem('chromasmith_ui_density'),
    };
    fixture.remove();
    return values;
  });
  assert.equal(compact.mode, 'compact');
  assert.equal(compact.sectionGap, '12px');
  assert.equal(compact.stackGap, '4px');
  assert.equal(compact.rowGap, '4px');
  assert.equal(compact.saved, 'compact', 'density selection persists');
  assert.equal(await page.locator('#fx-appearance-menu button[aria-pressed="true"]').innerText(), 'Compact');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.uiDensityGet === 'function');
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(() => uiDensityGet()), 'compact', 'saved density is restored after reload');
  await page.screenshot({ path: path.join(root, 'test/output/chr265-editor-compact.png') });

  const libraryUi = await readFile(path.join(root, 'desktop/library-ui.js'), 'utf8');
  assert.match(libraryUi, /\.lib-tree-row\{[^}]*min-height:28px/s,
    'Compact preserves the Library tree row minimum target height');
  assert.match(libraryUi, /#lib-filters-panel\{[^}]*gap:var\(--sp-control-stack\)/s,
    'Library filter controls consume the shared stack-gap token');
  assert.match(libraryUi, /\.lib-fp-label\{[^}]*margin-top:var\(--sp-panel-section\)/s,
    'Library filter sections consume the shared section-gap token');
  console.log('PASS: density mode changes semantic gaps, is exposed in shared Appearance settings, persists, and preserves 28px Library row targets.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
