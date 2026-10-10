import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { enumerate, alreadyAtReplayDestination, captureReplayDestination, fingerprint, setColorInput, setReplayValue } from './sweep_lib.mjs';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS } from './wireframe_diff_lib.mjs';

const browser = await chromium.launch({ args: DETERMINISTIC_LAUNCH_ARGS });
try {
  const page = await browser.newPage(DETERMINISTIC_CONTEXT_OPTIONS);
  await page.setContent(`<!doctype html><button id="toggle" aria-pressed="false">Toggle</button>
    <button id="hist-setter" data-k="hist" aria-pressed="false">Histogram tab</button>
    <button id="open">Open dialog</button><dialog id="dialog"><button>Close</button></dialog>
    <button id="class-toggle" class="active">Class toggle</button><div class="chip-tap"><button id="value-chip" class="on">As shot</button></div>
    <select id="lens"><option value="">Auto</option><option value="manual">Manual</option></select>
    <button class="sk2x-proof-toggle">Show original</button>
    <div id="fx-settings-history-list"><button><span>0: Start</span><span>09:34:06 AM</span></button></div>
    <details id="sk2-hist"><summary>Histogram</summary><button title="Shadow clipping">Clip</button></details>
    <input id="color" type="color" value="#123456">
    <div id="target" hidden>Target</div>
    <script>
      const toggle = document.querySelector('#toggle');
      toggle.onclick = () => { const next = toggle.getAttribute('aria-pressed') !== 'true'; toggle.setAttribute('aria-pressed', String(next)); document.querySelector('#target').hidden = !next; };
      document.querySelector('#open').onclick = () => document.querySelector('#dialog').showModal();
    </script>`);

  const toggle = async () => (await page.evaluate(enumerate)).find((c) => c.label === '#toggle');
  const setters = await page.evaluate(enumerate);
  assert.equal(setters.find((c) => c.label === '#hist-setter').replayIdempotent, true, 'explicit tab setters are safe to reassert');
  assert.equal(setters.find((c) => c.label === '#class-toggle').replayIdempotent, false, 'generic stateful toggles are not reasserted blindly');
  assert.equal(setters.find((c) => c.label === '#value-chip').replayIdempotent, true, 'value chips set an explicit destination');
  const ordinary = async () => (await page.evaluate(enumerate)).find((c) => c.label === '#open');
  const replay = async (key, destination) => {
    const current = (await page.evaluate(enumerate)).find((c) => c.label === key);
    if (!alreadyAtReplayDestination(destination, current)) await page.locator(key).click();
  };

  await page.locator('#toggle').click();
  const openDestination = (await toggle()).selected;
  assert.equal((await toggle()).stateful, true);
  await page.locator('#toggle').click(); // reset opposite to the discovered destination
  await replay('#toggle', openDestination);
  assert.equal(await page.locator('#target').isVisible(), true, 'replay opens a toggle destination');
  await replay('#toggle', openDestination);
  assert.equal((await toggle()).selected, openDestination, 'already-reached open destination is not undone');

  await page.locator('#toggle').click();
  const closeDestination = (await toggle()).selected;
  await page.locator('#toggle').click(); // reset opposite to the discovered destination
  await replay('#toggle', closeDestination);
  assert.equal(await page.locator('#target').isVisible(), false, 'replay reaches a closed toggle destination');
  await replay('#toggle', closeDestination);
  assert.equal((await toggle()).selected, closeDestination, 'already-reached closed destination is not undone');

  const classToggle = await page.evaluate(enumerate).then((items) => items.find((c) => c.label === '#class-toggle'));
  await page.locator('#class-toggle').evaluate((el) => el.classList.remove('active'));
  const offDestination = await page.evaluate(captureReplayDestination, { key: classToggle.key, statefulEvidence: classToggle.stateful });
  assert.deepEqual(offDestination, { stateful: true, selected: false }, 'class-only off state retains discovery evidence');
  const classToggleNow = await page.evaluate(enumerate).then((items) => items.find((c) => c.label === '#class-toggle'));
  assert.equal(classToggleNow.stateful, false);
  assert.equal(alreadyAtReplayDestination(offDestination, classToggleNow), true, 'recorded class-only off destination is idempotent');

  const lens = await page.evaluate(enumerate).then((items) => items.find((c) => c.label === '#lens'));
  await page.locator('#lens').selectOption('manual');
  const lensDestination = await page.evaluate(captureReplayDestination, { key: lens.key });
  assert.deepEqual(lensDestination, { stateful: true, valueType: 'value', value: 'manual', selected: false });
  await page.locator('#lens').selectOption('');
  let lensNow = await page.evaluate(enumerate).then((items) => items.find((c) => c.label === '#lens'));
  assert.equal(alreadyAtReplayDestination(lensDestination, lensNow), false, 'select replay detects a different surviving preference');
  assert.equal(await page.evaluate(setReplayValue, { key: lens.key, value: lensDestination.value }), true);
  lensNow = await page.evaluate(enumerate).then((items) => items.find((c) => c.label === '#lens'));
  assert.equal(lensNow.stateValue, 'manual');
  assert.equal(alreadyAtReplayDestination(lensDestination, lensNow), true, 'select replay sets the discovered destination exactly');

  const button = await ordinary();
  assert.equal(button.stateful, false);
  await page.locator('#open').click();
  assert.equal(await page.locator('#dialog').evaluate((el) => el.open), true);
  await page.locator('#dialog').evaluate((el) => el.close());
  const current = await ordinary();
  assert.equal(alreadyAtReplayDestination(null, current), false, 'ordinary actions never skip replay');
  await replay('#open', null);
  assert.equal(await page.locator('#dialog').evaluate((el) => el.open), true, 'ordinary replay reopens its dialog');
  await page.locator('#dialog').evaluate((el) => el.close());

  const proof = () => page.evaluate(enumerate).then((items) => items.find((c) => c.label === 'Export proof toggle'));
  const proofKey = (await proof()).key;
  await page.locator('.sk2x-proof-toggle').evaluate((el) => { el.textContent = 'Show edited'; });
  assert.equal((await proof()).key, proofKey, 'soft-proof key survives its changing label');
  const historyKey = (await page.evaluate(enumerate)).find((c) => c.label === 'History row 0: Start').key;
  await page.locator('#fx-settings-history-list button span:last-child').evaluate((el) => { el.textContent = '09:35:08 AM'; });
  assert.equal((await page.evaluate(enumerate)).find((c) => c.label === 'History row 0: Start').key, historyKey, 'history key ignores its volatile timestamp');
  assert.ok((await page.evaluate(enumerate)).some((c) => c.label === 'Histogram'), 'closed details still exposes its summary control');
  await page.locator('#sk2-hist summary').click();
  const summary = await page.evaluate(enumerate).then((items) => items.find((c) => c.label === 'Histogram'));
  const openDetails = await page.evaluate(captureReplayDestination, { key: summary.key, statefulEvidence: summary.stateful });
  assert.deepEqual(openDetails, { stateful: true, selected: true }, 'summary records its details open destination');
  await page.locator('#sk2-hist summary').click();
  let summaryNow = await page.evaluate(enumerate).then((items) => items.find((c) => c.label === 'Histogram'));
  assert.equal(alreadyAtReplayDestination(openDetails, summaryNow), false, 'closed details do not match an open destination');
  await page.locator('#sk2-hist summary').click();
  summaryNow = await page.evaluate(enumerate).then((items) => items.find((c) => c.label === 'Histogram'));
  assert.equal(alreadyAtReplayDestination(openDetails, summaryNow), true, 'open details are not toggled closed during replay');
  assert.ok((await page.evaluate(enumerate)).some((c) => c.label === 'Shadow clipping'), 'opening summary exposes histogram controls');
  const colorBefore = await page.evaluate(fingerprint);
  const colorControl = (await page.evaluate(enumerate)).find((c) => c.label === '#color');
  assert.equal(colorControl.kind, 'color');
  assert.equal(await page.evaluate(setColorInput, colorControl), true);
  assert.notEqual(await page.evaluate(fingerprint), colorBefore, 'color input action changes the fixture state');
  console.log('control:sweep:replay — PASS (toggle destinations, hidden class state, select destination, ordinary dialog, stable keys, summary, color input)');
} finally {
  await browser.close();
}
