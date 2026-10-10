import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { enumerate, alreadyAtReplayDestination, fingerprint, setColorInput } from './sweep_lib.mjs';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS } from './wireframe_diff_lib.mjs';

const browser = await chromium.launch({ args: DETERMINISTIC_LAUNCH_ARGS });
try {
  const page = await browser.newPage(DETERMINISTIC_CONTEXT_OPTIONS);
  await page.setContent(`<!doctype html><button id="toggle" aria-pressed="false">Toggle</button>
    <button id="open">Open dialog</button><dialog id="dialog"><button>Close</button></dialog>
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
  assert.ok((await page.evaluate(enumerate)).some((c) => c.label === 'Shadow clipping'), 'opening summary exposes histogram controls');
  const colorBefore = await page.evaluate(fingerprint);
  const colorControl = (await page.evaluate(enumerate)).find((c) => c.label === '#color');
  assert.equal(colorControl.kind, 'color');
  assert.equal(await page.evaluate(setColorInput, colorControl), true);
  assert.notEqual(await page.evaluate(fingerprint), colorBefore, 'color input action changes the fixture state');
  console.log('control:sweep:replay — PASS (toggle destinations, ordinary dialog, stable keys, summary, color input)');
} finally {
  await browser.close();
}
