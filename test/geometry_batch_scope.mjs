// CHR-193: exercise counted geometry copy as one history edge, including stale context and
// timeline preview/commit. The browser-owned images are tiny PNG fixtures; no RAW/native decode
// is involved in this behavior contract.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { startServer } from './editor_state_harness.mjs';

export const GEOMETRY_FIXTURES = [
  ['chart.png', 'chart.png'],
  ['portrait.png', 'portrait.png'],
  ['orientation_panorama.png', 'panorama.png'],
];

export async function loadGeometryFixtures(page, root = process.cwd()) {
  await page.evaluate(() => {
    document.querySelector('#cs-modal-ov #cs-modal-x')?.click();
    if (typeof applyFxLayout === 'function') applyFxLayout();
  });
  await page.keyboard.press('Escape');
  const files = await Promise.all(GEOMETRY_FIXTURES.map(async ([fixture, name]) => ({
    name,
    type: 'image/png',
    bytes: [...await readFile(path.join(root, 'test', 'fixtures', fixture))],
  })));
  await page.evaluate(async entries => {
    const files = entries.map(entry => new File([new Uint8Array(entry.bytes)], entry.name, { type: entry.type }));
    if (typeof loadFXImages !== 'function') throw new Error('loadFXImages is unavailable');
    localStorage.setItem('chromasmith-tour-seen-v1', '1');
    localStorage.setItem('chromasmith-first-edit-guide-v1', '1');
    localStorage.setItem('chromasmith-first-edit-stage-v1', 'skipped');
    if (typeof fxSection === 'function') fxSection('rotate', true);
    await loadFXImages(files);
  }, files);
  await page.waitForFunction(() => Array.isArray(fxImages) && fxImages.length === 3 && fxCurIdx === 0, null, { timeout: 15000 });
}

export async function exerciseGeometryBatch(page) {
  const waitGeometry = async expected => {
    try {
      await page.waitForFunction(geoms => JSON.stringify(fxImages.map(item => item.geom)) === JSON.stringify(geoms), expected, { timeout: 5000 });
    } catch {
      const actual = await page.evaluate(() => fxImages.map(item => item.geom));
      assert.deepEqual(actual, expected, `geometry transition did not settle as expected; actual=${JSON.stringify(actual)}`);
    }
  };
  const waitTargetGeometry = async expected => {
    try {
      await page.waitForFunction(geoms => JSON.stringify(fxImages.slice(1).map(item => item.geom)) === JSON.stringify(geoms), expected, { timeout: 5000 });
    } catch {
      const actual = await page.evaluate(() => fxImages.slice(1).map(item => item.geom));
      assert.deepEqual(actual, expected, `target geometry transition did not settle; actual=${JSON.stringify(actual)}`);
    }
  };
  const original = await page.evaluate(() => {
    const geometries = [
      { rot: 90, flipH: true, flipV: false, angle: 3.25, crop: { x: .1, y: .12, w: .75, h: .7 } },
      { rot: 180, flipH: false, flipV: true, angle: -4.5, crop: { x: .05, y: .08, w: .8, h: .77 } },
      { rot: 270, flipH: true, flipV: true, angle: 1.75, crop: { x: .2, y: .1, w: .65, h: .7 } },
    ];
    fxImages.forEach((item, index) => { item.geom = structuredClone(geometries[index]); });
    fxCurIdx = 0;
    buildFilmstrip();
    // Capture these deliberately seeded per-photo states as the pre-operation snapshot so a
    // normal history Undo restores the same source-side geometry used by the batch edge.
    fxHistoryPush({ force: true, label: 'Geometry batch test baseline' });
    const before = fxImages.map(item => structuredClone(item.geom));
    return { before, historyIndex: fxHistIdx, historyLength: fxHistory.length, source: curItem().name,
      targets: fxImages.slice(1).map(item => item.name) };
  });
  assert.equal(original.targets.length, 2);

  // Cancel must leave every loaded geometry and the edit-history cursor/length untouched.
  await page.locator('#btn-geom-apply-all').click();
  const cancelText = await page.locator('#fx-confirm-msg').innerText();
  assert.match(cancelText, /“chart”/);
  assert.match(cancelText, /2 other loaded photos/);
  assert.match(cancelText, /Targets: portrait, panorama/);
  assert.match(cancelText, /crop, rotation, flip, and straighten/);
  assert.equal(await page.locator('#fx-confirm-ok').innerText(), 'Apply to 2 photos');
  await page.locator('#fx-confirm-cancel').click();
  await page.locator('#fx-confirm-modal').waitFor({ state: 'hidden' });
  let state = await page.evaluate(() => ({ geoms: fxImages.map(item => item.geom), index: fxHistIdx, length: fxHistory.length }));
  assert.deepEqual(state.geoms, original.before, 'cancel must preserve all geometry');
  assert.equal(state.index, original.historyIndex, 'cancel must not move history');
  assert.equal(state.length, original.historyLength, 'cancel must not add history');

  // A delayed confirmation belongs to the exact source/photo batch that opened it.
  await page.locator('#btn-geom-apply-all').click();
  await page.evaluate(() => fxSelectImage(1));
  await page.locator('#fx-confirm-ok').click();
  await page.locator('#fx-confirm-modal').waitFor({ state: 'hidden' });
  state = await page.evaluate(() => ({ geoms: fxImages.map(item => item.geom), index: fxHistIdx, length: fxHistory.length }));
  assert.deepEqual(state.geoms, original.before, 'stale confirmation must not copy onto a changed source selection');
  assert.equal(state.index, original.historyIndex);
  assert.equal(state.length, original.historyLength);
  await page.evaluate(() => fxSelectImage(0));

  await page.locator('#btn-geom-apply-all').click();
  await page.locator('#fx-confirm-ok').click();
  await page.locator('#fx-confirm-modal').waitFor({ state: 'hidden' });
  await page.waitForFunction(index => fxHistIdx === index, original.historyIndex + 1, { timeout: 5000 });
  const applied = await page.evaluate(() => ({
    source: structuredClone(fxImages[0].geom), targets: fxImages.slice(1).map(item => structuredClone(item.geom)),
    index: fxHistIdx, length: fxHistory.length, label: fxHistory[fxHistIdx]?.label,
  }));
  assert.deepEqual(applied.source, original.before[0], 'copy must leave source geometry unchanged');
  assert.deepEqual(applied.targets, [original.before[0], original.before[0]], 'both loaded targets must match the source');
  assert.equal(applied.index, original.historyIndex + 1, 'batch should create exactly one history edge');
  assert.equal(applied.length, original.historyLength + 1, 'batch should create exactly one history entry');
  assert.equal(applied.label, 'Geometry applied to 2 photos');

  await page.locator('#btn-undo-db').click();
  await page.waitForFunction(idx => fxHistIdx === idx, applied.index - 1, { timeout: 5000 });
  await waitGeometry(original.before);
  let targets = await page.evaluate(() => fxImages.slice(1).map(item => item.geom));
  assert.deepEqual(targets, original.before.slice(1), 'one Undo must restore both targets together');
  await page.locator('#btn-redo-db').click();
  await page.waitForFunction(idx => fxHistIdx === idx, applied.index, { timeout: 5000 });
  await waitGeometry([original.before[0], original.before[0], original.before[0]]);
  targets = await page.evaluate(() => fxImages.slice(1).map(item => item.geom));
  assert.deepEqual(targets, [original.before[0], original.before[0]], 'one Redo must reapply both targets together');

  // Timeline range input is a non-committing preview; change commits the prior batch edge.
  await page.locator('#btn-undo-db').click({ delay: 600 });
  const rail = page.locator('#fx-timeline-popover input[type="range"]');
  await rail.waitFor({ state: 'visible' });
  const undoIndex = applied.index - 1;
  await rail.evaluate((el, value) => { el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true })); }, undoIndex);
  await page.evaluate(() => _fxTimelinePreviewQueue);
  // The preview is deliberately inspected against the post-batch model: previewing a snapshot
  // must not mutate other photo objects or move the committed cursor.
  const preview = await page.evaluate(() => ({ index: fxHistIdx, targets: fxImages.slice(1).map(item => item.geom) }));
  assert.equal(preview.index, applied.index, 'timeline input preview must not commit the history cursor');
  assert.deepEqual(preview.targets, [original.before[0], original.before[0]], 'timeline input preview must leave target geometry committed');
  await rail.evaluate((el, value) => { el.value = String(value); el.dispatchEvent(new Event('change', { bubbles: true })); }, undoIndex);
  await page.waitForFunction(idx => fxHistIdx === idx, undoIndex, { timeout: 5000 });
  await page.evaluate(() => _fxTimelinePreviewQueue);
  await waitGeometry(original.before);
  targets = await page.evaluate(() => fxImages.slice(1).map(item => item.geom));
  assert.deepEqual(targets, original.before.slice(1), 'timeline commit to before the batch must restore target geometry');
  await rail.evaluate((el, value) => { el.value = String(value); el.dispatchEvent(new Event('change', { bubbles: true })); }, applied.index);
  await page.waitForFunction(idx => fxHistIdx === idx, applied.index, { timeout: 5000 });
  await page.evaluate(() => _fxTimelinePreviewQueue);
  await waitGeometry([original.before[0], original.before[0], original.before[0]]);
  targets = await page.evaluate(() => fxImages.slice(1).map(item => item.geom));
  assert.deepEqual(targets, [original.before[0], original.before[0]], 'timeline commit across the edge must reapply target geometry');

  // A rendered-image promotion (for example fit proxy -> full-resolution decode) keeps the same
  // photo entry and must not invalidate its geometry history just because the img object changed.
  await page.evaluate(async () => {
    const old = fxImages[1].img;
    const canvas = document.createElement('canvas');
    canvas.width = old.naturalWidth || old.width; canvas.height = old.naturalHeight || old.height;
    canvas.getContext('2d').drawImage(old, 0, 0);
    const promoted = new Image();
    promoted.src = canvas.toDataURL('image/png');
    if (promoted.decode) await promoted.decode();
    fxImages[1].img = promoted;
  });
  await page.locator('#btn-undo-db').click();
  await page.waitForFunction(idx => fxHistIdx === idx, undoIndex, { timeout: 5000 });
  await waitGeometry(original.before);
  targets = await page.evaluate(() => fxImages.slice(1).map(item => item.geom));
  assert.deepEqual(targets, original.before.slice(1), 'same-photo image promotion must retain the batch undo edge');
  await page.locator('#btn-redo-db').click();
  await page.waitForFunction(idx => fxHistIdx === idx, applied.index, { timeout: 5000 });

  // Replacing one photo entry invalidates only that photo's batch record. The other original
  // target still follows the history edge; no matching image pixels can impersonate old identity.
  await page.evaluate(() => {
    const old = fxImages[1];
    window.__geometryOriginalItem = old;
    fxImages[1] = { ...old, geom: { rot: 0, flipH: false, flipV: false, angle: 0, crop: null } };
    window.__geometryReplacedItem = fxImages[1];
  });
  await page.locator('#btn-undo-db').click();
  await page.waitForFunction(idx => fxHistIdx === idx, undoIndex, { timeout: 5000 });
  const replaced = await page.evaluate(() => ({ replaced: fxImages[1].geom, remaining: fxImages[2].geom }));
  assert.deepEqual(replaced.replaced, { rot: 0, flipH: false, flipV: false, angle: 0, crop: null }, 'replaced photo entry must not receive an old history edge');
  assert.deepEqual(replaced.remaining, original.before[2], 'the still-matching target must undo normally');

  // Restore the original photo object after the stale-edge case, then prove Reset All itself is
  // a counted geometry history edge: Undo recovers copied target geometry and Redo restores the
  // targets' pre-copy geometry.
  await page.evaluate(() => { fxImages[1] = window.__geometryOriginalItem; });
  await page.locator('#btn-redo-db').click();
  await page.waitForFunction(idx => fxHistIdx === idx, applied.index, { timeout: 5000 });
  await waitGeometry([original.before[0], original.before[0], original.before[0]]);
  await page.locator('#btn-undo-db').click({ delay: 600 });
  await page.locator('#fx-timeline-popover').getByText('Reset all edits', { exact: true }).click();
  await page.waitForFunction(() => fxHistory[fxHistIdx]?.label === 'Reset all edits', null, { timeout: 5000 });
  const resetIndex = await page.evaluate(() => fxHistIdx);
  const resetGeom = { rot: 0, flipH: false, flipV: false, angle: 0, crop: null };
  await waitGeometry([resetGeom, original.before[1], original.before[2]]);
  await page.locator('#btn-undo-db').click();
  await page.waitForFunction(idx => fxHistIdx === idx, resetIndex - 1, { timeout: 5000 });
  await waitTargetGeometry([original.before[0], original.before[0]]);
  await page.locator('#btn-redo-db').click();
  await page.waitForFunction(idx => fxHistIdx === idx, resetIndex, { timeout: 5000 });
  await waitGeometry([resetGeom, original.before[1], original.before[2]]);
  return { source: original.source, targetCount: original.targets.length, historyLabel: applied.label, staleConfirmation: 'unchanged', timeline: 'preview-only then committed', samePhotoPromotion: 'undo retained', replacedPhoto: 'stale edge skipped', resetAll: 'undo restores copied target geometry; redo restores pre-copy geometry' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { server, port } = await startServer();
  let browser;
  try {
    browser = await chromium.launch({
      ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
      args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1000);
    await loadGeometryFixtures(page);
    const result = await exerciseGeometryBatch(page);
    assert.deepEqual(errors, [], 'browser must not report uncaught page errors');
    console.log('GEOMETRY BATCH SCOPE (CHR-193)');
    console.log(JSON.stringify({ result: 'PASS', ...result }));
  } finally {
    await browser?.close().catch(() => {});
    server.close();
  }
}

