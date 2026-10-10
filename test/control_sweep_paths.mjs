// Focused real-app replay checks for the stateful paths found by control_sweep.mjs.
// `libtest=1` explicitly supplies the desktop capability mock used by the browser fixture.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { startServer } from './editor_state_harness.mjs';
import { enumerate, fingerprint, locate, alreadyAtReplayDestination, captureReplayDestination, setReplayValue } from './sweep_lib.mjs';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS } from './wireframe_diff_lib.mjs';

const QUERY = 'libtest=1&deskx=1';
const { server, port } = await startServer();
const browser = await chromium.launch({ args: DETERMINISTIC_LAUNCH_ARGS });
const context = await browser.newContext({ ...DETERMINISTIC_CONTEXT_OPTIONS, viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => { try { localStorage.setItem('chromasmith-tour-seen-v1', '1'); } catch {} });
const page = await context.newPage();
const find = async (key) => {
  const c = (await page.evaluate(enumerate)).find((item) => item.key === key);
  const at = c && await page.evaluate(locate, key);
  return at ? { ...c, ...at } : null;
};
const byLabel = async (label) => {
  const c = (await page.evaluate(enumerate)).find((item) => item.label === label || item.label.startsWith(label));
  return c ? find(c.key) : null;
};
const settle = async () => {
  let previous = null;
  for (let t = 0; t < 2500; t += 150) {
    const current = await page.evaluate(fingerprint).catch(() => null);
    if (current !== null && current === previous) return;
    previous = current; await page.waitForTimeout(150);
  }
};
const waitForLabel = async (label, ms = 5000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { const c = await byLabel(label); if (c) return c; await page.waitForTimeout(100); }
  return null;
};
const boot = async () => {
  await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?${QUERY}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500); await page.keyboard.press('Escape');
  const b64 = (await readFile('test/fixtures/portrait.png')).toString('base64');
  await page.evaluate(async (b) => { const f = new File([Uint8Array.from(atob(b), (c) => c.charCodeAt(0))], 'portrait.png', { type: 'image/png' }); await loadFXImages([f]); }, b64);
  await page.waitForFunction(() => fxImages?.length > 0, undefined, { timeout: 10000 }).catch(() => {});
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('cs-modal-ov')?.checkVisibility(), undefined, { timeout: 3000 });
};
const discoverStep = async (label) => {
  const c = await waitForLabel(label);
  assert.ok(c, `discovery found and hit-tested ${label}`);
  if (c.kind === 'select-one' || c.kind === 'select') {
    await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)?.closest('select'); if (!el) return;
      el.selectedIndex = (el.selectedIndex + 1) % el.options.length;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, c);
  } else await page.mouse.click(c.x, c.y);
  await settle();
  // Capture before enumeration replaces window.__sweepEls, as in the sweep's queue builder.
  const destination = await page.evaluate(captureReplayDestination, { key: c.key, statefulEvidence: c.stateful });
  return { key: c.key, label: c.label, destination, replayIdempotent: c.replayIdempotent };
};
const replay = async (steps, targetLabel) => {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const current = await find(step.key);
    assert.ok(current, `replay found path control ${step.label}`);
    const skip = alreadyAtReplayDestination(step.destination, current);
    let next = skip ? await waitForLabel(i + 1 < steps.length ? steps[i + 1].label : targetLabel, 750) : null;
    if (!skip || (!next && step.replayIdempotent)) {
      if (step.destination?.valueType === 'value') await page.evaluate(setReplayValue, { key: current.key, value: step.destination.value });
      else await page.mouse.click(current.x, current.y);
      await settle();
    }
    if (!next) next = await waitForLabel(i + 1 < steps.length ? steps[i + 1].label : targetLabel);
    assert.ok(next, `replay reached ${targetLabel} after ${step.label}`);
  }
  return waitForLabel(targetLabel);
};

try {
  await boot();
  assert.equal(await page.evaluate(() => !!window.__TAURI__), true, 'the fixture explicitly enables the desktop capability mock');

  const libStep = await discoverStep('#cs-tog-lib');
  const recents = await waitForLabel('Recents');
  assert.ok(recents, 'Library discovery reveals Recents');
  await boot();
  assert.ok(await replay([libStep], 'Recents'), 'Library replay reaches Recents');
  for (const label of ['Recents', 'Offline Photos', 'Favorites']) assert.ok(await waitForLabel(label), `Library replay exposes ${label}`);

  await boot();
  const light = await discoverStep('Light');
  const histogram = await discoverStep('Histogram');
  await waitForLabel('Shadow clipping');
  await boot();
  await replay([light, histogram], 'Shadow clipping');
  assert.ok(await waitForLabel('Highlight clipping'), 'Histogram replay exposes Highlight clipping');

  await boot();
  const texture = await discoverStep('Texture');
  const lens = await discoverStep('#sel-lens-manual');
  assert.ok(lens.destination?.valueType === 'value', 'Manual lens destination records its selected option');
  await waitForLabel('#in-lens-manual-focal');
  await boot();
  await replay([texture, lens], '#in-lens-manual-focal');

  await boot();
  const crop = await discoverStep('Crop');
  const asShot = await discoverStep('As shot');
  await waitForLabel('Cancel');
  await boot();
  await replay([crop, asShot], 'Cancel');

  await boot();
  const exportButton = await discoverStep('#btn-export-db');
  const proof = await waitForLabel('Export proof toggle');
  assert.ok(proof, 'Export discovery reveals its proof toggle');
  await boot();
  await replay([exportButton], 'Export proof toggle');
  const before = await page.evaluate(() => document.querySelector('.sk2x-proof-toggle')?.textContent.trim());
  const proofControl = await waitForLabel('Export proof toggle');
  await page.mouse.click(proofControl.x, proofControl.y);
  await page.waitForFunction(() => document.querySelector('#sk2-export .sk2x-proof canvas')?.getAttribute('aria-label')?.startsWith('Original preview'), undefined, { timeout: 15000 });
  const after = await page.evaluate(() => document.querySelector('.sk2x-proof-toggle')?.textContent.trim());
  assert.notEqual(after, before, 'the proof toggle performs its action after animation');

  console.log('control:sweep:paths — PASS (Library headers, Histogram clips, Manual lens, Crop Cancel, Export proof; explicit libtest desktop mock)');
} finally { await browser.close(); server.close(); }
