import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '');
    const sourcePath = pathname === 'desktop/dist/library-ui.js' ? 'desktop/library-ui.js' : pathname;
    const body = await readFile(path.join(root, sourcePath));
    const type = sourcePath.endsWith('.html') ? 'text/html' : sourcePath.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/desktop/dist/index.html?libtest=1&libn=18&deskx=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  await page.evaluate(() => document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); }));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#lib-grid .lib-card'));
  const initial = await page.evaluate(() => ({
    unified: document.body.classList.contains('lib-unified-view'),
    full: document.getElementById('lib-overlay').classList.contains('full'),
    previewVisible: getComputedStyle(document.querySelector('.fx-preview-col')).display !== 'none',
    saved: localStorage.getItem('chromasmith_lib_unified_view'),
  }));
  if (initial.unified || initial.previewVisible === false || initial.saved !== null) {
    throw new Error(`default Gallery view changed unexpectedly: ${JSON.stringify(initial)}`);
  }

  await page.locator('#lib-expand').evaluate((el) => el.click());
  await page.waitForFunction(() => document.getElementById('lib-overlay').classList.contains('full'));
  await page.evaluate(() => window.__libToggleUnifiedView(true));
  await page.waitForFunction(() => document.body.classList.contains('lib-unified-view'));
  await page.waitForTimeout(100);

  const unified = await page.evaluate(() => {
    const overlay = document.getElementById('lib-overlay');
    const preview = document.querySelector('.fx-preview-col');
    const grid = document.querySelector('.fx-layout');
    const lib = overlay.getBoundingClientRect(), editor = preview.getBoundingClientRect();
    return { saved: localStorage.getItem('chromasmith_lib_unified_view'), full: overlay.classList.contains('full'),
      overlayVisible: getComputedStyle(overlay).display !== 'none', topVisible: getComputedStyle(document.getElementById('lib-top')).display !== 'none',
      gridVisible: getComputedStyle(document.getElementById('lib-grid')).display !== 'none', previewVisible: editor.width > 100,
      split: getComputedStyle(grid).gridTemplateColumns, libWidth: lib.width, editorWidth: editor.width,
      resizer: getComputedStyle(document.getElementById('lib-unified-resizer')).display };
  });
  if (unified.saved !== '1' || unified.full || !unified.overlayVisible || !unified.topVisible || !unified.gridVisible || !unified.previewVisible || unified.libWidth < 600 || unified.editorWidth < 300) {
    throw new Error(`unified workspace did not expose both usable panes: ${JSON.stringify(unified)}`);
  }

  const selectedPath = await page.locator('#lib-grid .lib-card').first().getAttribute('data-path');
  await page.locator('#lib-grid .lib-card').first().evaluate((el) => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await page.waitForTimeout(350);
  const opened = await page.evaluate(() => ({ mode: document.body.classList.contains('lib-unified-view'), visible: getComputedStyle(document.getElementById('lib-overlay')).display !== 'none', editorPanelVisible: getComputedStyle(document.querySelector('.fx-preview-col')).display !== 'none', selectedPath: document.getElementById('fx-fname')?.textContent || '', canvas: document.getElementById('fx-canvas')?.getBoundingClientRect().width, count: document.querySelectorAll('#lib-grid .lib-card').length }));
  if (!opened.mode || !opened.visible || !opened.editorPanelVisible || opened.count < 1 || !selectedPath) throw new Error(`opening a photo changed or hid unified mode: ${JSON.stringify(opened)}`);

  const before = await page.locator('#lib-overlay').evaluate((el) => el.getBoundingClientRect().width);
  const separator = page.locator('#lib-unified-resizer');
  const bounds = await separator.boundingBox();
  await page.evaluate(() => {
    const handle = document.getElementById('lib-unified-resizer');
    const rect = handle.getBoundingClientRect();
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'mouse', clientX: rect.x + rect.width / 2, clientY: 420 }));
    for (const clientX of [rect.x + 50, rect.x + 20, rect.x - 10, rect.x - 40]) window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, pointerType: 'mouse', clientX, clientY: 420 }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse', clientX: rect.x - 40, clientY: 420 }));
  });
  await page.waitForTimeout(150);
  const after = await page.locator('#lib-overlay').evaluate((el) => el.getBoundingClientRect().width);
  if (Math.abs(after - before) < 30 || Number(await page.evaluate(() => localStorage.getItem('chromasmith_lib_unified_w'))) < 300) throw new Error(`unified divider did not resize the Gallery pane: ${before} -> ${after}`);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); }));
  const persisted = await page.evaluate(() => ({ enabled: localStorage.getItem('chromasmith_lib_unified_view') === '1', width: Number(localStorage.getItem('chromasmith_lib_unified_w')), mode: document.body.classList.contains('lib-unified-view') }));
  if (!persisted.enabled || !persisted.mode || Math.abs(persisted.width - after) > 3) throw new Error(`unified preference/width was not restored after reload: ${JSON.stringify(persisted)}`);
  await page.waitForFunction(() => document.body.classList.contains('lib-unified-view') && document.querySelector('#lib-grid .lib-card'), { timeout: 45000 });
  const restored = await page.locator('#lib-overlay').evaluate((el) => el.getBoundingClientRect().width);
  if (Math.abs(restored - after) > 3 || errors.length) throw new Error(`unified preference/width did not restore cleanly; width=${restored}, errors=${errors.join('; ')}`);

  console.log(`PASS: default remains standard; unified mode + width persist; Library (${Math.round(after)}px) and Editor coexist; divider resizes.`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
