// Photo-local status lifecycle for Editor decode and on-demand analysis.
import { bootEditor } from './editor_state_harness.mjs';

const b = await bootEditor({ withPhoto: true });
const { page, pageErrors } = b;
const failures = [];
try {
  const initial = await page.evaluate(() => {
    const el = document.getElementById('db-title-status');
    const item = curItem();
    const finish = fxPhotoActivity(item, 'Estimating depth…');
    return { text: el?.textContent, role: el?.getAttribute('role'), live: el?.getAttribute('aria-live'), finish: typeof finish };
  });
  if (initial.text !== 'Estimating depth…') failures.push(`analysis label not shown: ${JSON.stringify(initial)}`);
  if (initial.role !== 'status' || initial.live !== 'polite') failures.push(`status is not announced accessibly: ${JSON.stringify(initial)}`);
  if (initial.finish !== 'function') failures.push('photo activity did not return a completion callback');
  await page.evaluate(() => {
    const finish = fxPhotoActivity(curItem(), 'Finding face features…');
    finish();
  });
  await page.waitForFunction(() => !document.getElementById('db-title-status')?.textContent.includes('Finding face'));
  const restored = await page.locator('#db-title-status').textContent();
  if (!restored?.includes('×')) failures.push(`completion did not restore photo dimensions: ${restored}`);

  const narrow = await page.evaluate(() => {
    document.getElementById('fx-deskbar-title').style.display = 'none';
    fxDeskbarTitle(curItem().name, 'Opening photo…', true);
    const status = document.getElementById('fx-photo-work-status');
    return { statusVisible: !!status && !status.hidden, text: status?.textContent, live: status?.getAttribute('aria-live') };
  });
  if (!narrow.statusVisible || !narrow.text?.includes('Opening photo…') || narrow.live !== 'polite') failures.push(`hidden title has no visible accessible local loading status: ${JSON.stringify(narrow)}`);
  await page.evaluate(() => {
    fxDeskbarTitle(curItem().name, fxDimsFmt(curItem().name, curItem().img, curItem().ext), false);
    document.getElementById('fx-deskbar-title').style.display = '';
  });
  if (await page.locator('#fx-photo-work-status').isVisible()) failures.push('narrow viewport loading status did not clear');

  await page.evaluate(() => {
    const f = new File([new Uint8Array([0, 1, 2, 3])], 'broken.jpg', { type: 'image/jpeg' });
    Object.defineProperty(f, 'arrayBuffer', { value: () => new Promise((resolve) => { window.__finishPhotoRead = () => resolve(new Uint8Array([0, 1, 2, 3]).buffer); }) });
    window.__photoLoadPromise = loadFXImages([f]);
  });
  await page.waitForFunction(() => document.getElementById('db-title-status')?.textContent === 'Opening photo…', undefined, { timeout: 5000 });
  await page.evaluate(() => window.__finishPhotoRead());
  await page.evaluate(() => window.__photoLoadPromise);
  await page.waitForFunction(() => !document.getElementById('db-title-status')?.textContent.includes('Opening photo'));

  if (pageErrors.length) failures.push(`page errors: ${pageErrors.join('; ')}`);
} finally {
  await b.close();
}

if (failures.length) {
  console.error(`FAIL: ${failures.length} finding(s)`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('PASS: Editor photo status is accessible and clears after analysis and decode failure.');
