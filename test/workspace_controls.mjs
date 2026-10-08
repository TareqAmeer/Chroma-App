// CHR-272 bounded workspace slice: customization moves/hides original controls, and hidden
// controls remain reachable through the command palette and recipe copy/paste paths.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.CHROMASMITH_PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  page.on('pageerror', error => { throw error; });
  await page.addInitScript(() => localStorage.setItem('chromasmith-tour-seen-v1', '1'));
  await page.goto(`${pathToFileURL(path.join(root, 'chromasmith-22.html')).href}?libtest=1`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof csWorkspaceCustomizeOpen === 'function' && typeof getUISnapshot === 'function', null, { timeout: 30000 });
  await page.evaluate(() => {
    localStorage.removeItem('cs_workspace_controls_v1');
    switchTab('fx');
    document.body.classList.add('fx-single');
    const exp = document.getElementById('sl-adj-exp');
    exp.value = '31';
    exp.dispatchEvent(new Event('input', { bubbles: true }));
    window.__workspaceOriginalExposure = exp;
    window.__workspaceInputEvents = 0;
    exp.addEventListener('input', () => window.__workspaceInputEvents++);
  });

  await page.evaluate(() => csWorkspaceCustomizeOpen());
  const exposureToggle = page.locator('#cs-workspace-list [data-ws-show-control="sl-adj-exp"]');
  await exposureToggle.evaluate(input => { input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); });
  const hiddenCheck = await page.evaluate(() => {
    const row = document.getElementById('sl-adj-exp').closest('.fx-row');
    const snapshot = getUISnapshot();
    const snap = snapshot.sliders['adj-exp'];
    const pasted = pasteEditSelectiveApply(snapshot, { sliders: { 'adj-exp': '-42' } }, ['slider:adj-exp']);
    return {
      hidden: row.hidden,
      value: document.getElementById('sl-adj-exp').value,
      snap,
      copied: pasted.sliders['adj-exp'],
      identity: document.getElementById('sl-adj-exp') === window.__workspaceOriginalExposure,
      workspaceCapturedByNamedLayout: _csLayoutKeys().includes('cs_workspace_controls_v1'),
    };
  });
  assert.equal(hiddenCheck.hidden, true, 'customization hides the existing row');
  assert.equal(hiddenCheck.value, '31', 'hiding leaves the live edit value untouched');
  assert.equal(hiddenCheck.snap, '31', 'hidden control remains in the full recipe snapshot');
  assert.equal(hiddenCheck.copied, '-42', 'selective copy/paste includes a hidden control');
  assert.equal(hiddenCheck.identity, true, 'the existing input element is retained');
  assert.equal(hiddenCheck.workspaceCapturedByNamedLayout, true, 'saved named layouts capture workspace customization');

  const moveControl = await page.locator('#cs-workspace-list [data-ws-control-move="1"][data-ws-control-id="sl-adj-exp"]');
  assert.equal(await moveControl.count(), 1, 'customizer offers a down control for the first slider');
  await moveControl.evaluate(button => button.click());
  const reordered = await page.evaluate(() => {
    const card = document.querySelector('.fx-ctrl[data-fxsec="adjust"]');
    const rows = [...card.querySelector('.fx-fields').children].filter(x => x.classList.contains('fx-row'));
    document.getElementById('sl-adj-exp').value = '32';
    document.getElementById('sl-adj-exp').dispatchEvent(new Event('input', { bubbles: true }));
    return {
      ids: rows.slice(0, 2).map(row => row.querySelector('input[id]')?.id),
      identity: document.getElementById('sl-adj-exp') === window.__workspaceOriginalExposure,
      listener: window.__workspaceInputEvents,
      hidden: document.getElementById('sl-adj-exp').closest('.fx-row').hidden,
    };
  });
  assert.deepEqual(reordered.ids, ['sl-adj-con', 'sl-adj-exp'], 'row reorder moves original DOM nodes within their control group');
  assert.equal(reordered.identity, true, 'reordering preserves control identity');
  assert.equal(reordered.listener, 1, 'reordering preserves attached listeners');
  assert.equal(reordered.hidden, true, 'reordering preserves hidden state');

  await page.locator('#cs-workspace-list [data-ws-show-section="adjust"]').evaluate(input => { input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('#cs-workspace-list [data-ws-section-move="-1"][data-ws-section-id="adjust"]').evaluate(button => button.click());
  const hiddenSection = await page.evaluate(() => ({
    hidden: document.querySelector('.fx-ctrl[data-fxsec="adjust"]').hidden,
    commands: _cpCommands().filter(command => command.group === 'Control' && command.label.toLowerCase().includes('exposure')).length,
    order: JSON.parse(localStorage.getItem('cs_workspace_controls_v1')).controlOrder.adjust,
  }));
  assert.equal(hiddenSection.hidden, true, 'section visibility is independently customizable');
  assert.ok(hiddenSection.commands > 0, 'hidden section controls stay searchable by name');
  assert.deepEqual(hiddenSection.order.slice(0, 2), ['sl-adj-con', 'sl-adj-exp'], 'row order is persisted by stable control IDs');

  await page.evaluate(() => {
    const command = _cpCommands().find(item => item.group === 'Section' && item.label === 'Light');
    command.run();
  });
  assert.equal(await page.locator('.fx-ctrl[data-fxsec="adjust"]').evaluate(card => card.hidden), false, 'search result restores a hidden section');
  await page.evaluate(() => {
    const command = _cpCommands().find(item => item.group === 'Control' && item.label.includes('Exposure'));
    command.run();
  });
  assert.equal(await page.locator('#sl-adj-exp').evaluate(control => control.closest('.fx-row').hidden), false, 'search result restores a hidden control');

  const storage = await page.evaluate(() => JSON.parse(localStorage.getItem('cs_workspace_controls_v1')));
  assert.ok(storage.sectionOrder.includes('adjust'), 'section order is stored by stable section key');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof csWorkspaceLayoutGet === 'function' && document.getElementById('sl-adj-exp'), null, { timeout: 30000 });
  assert.equal(await page.locator('#sl-adj-exp').evaluate(control => control.closest('.fx-row').hidden), false, 'the revealed workspace persists across reload');

  // Project rule 8: derive the control set from the live editor DOM, then prove each one remains
  // discoverable through the actual command-palette search after its row and section are hidden.
  const liveScan = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.fx-ctrl[data-fxsec]')];
    const sections = [...new Set(cards.map(card => card.dataset.fxsec))];
    const controls = cards.flatMap(card => [...card.querySelectorAll('.fx-row')].map(row => {
      const control = row.querySelector('input[id],select[id],textarea[id],button[id]');
      if (!control) return null;
      const label = (row.querySelector('.fx-label')?.textContent || control.getAttribute('aria-label') || control.title || control.id).trim().replace(/\s+/g, ' ');
      return { id: control.id, label, section: card.dataset.fxsec };
    }).filter(Boolean));
    const ids = controls.map(control => control.id);
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
    const hidden = csWorkspaceLayoutGet();
    hidden.hiddenControls = [...new Set(ids)];
    hidden.hiddenSections = sections;
    _csWorkspaceSave(hidden);
    const searchable = new Set(_cpCommands().filter(command => command.group === 'Control').map(command => command.label));
    const missing = controls.filter(control => !searchable.has(`Show control: ${control.label}`)).map(control => control.id);
    return { controls, ids: [...new Set(ids)], sections, duplicateIds, missing };
  });
  assert.ok(liveScan.controls.length > 0, 'the live scan discovers editor controls');
  assert.equal(liveScan.duplicateIds.length, 0, `live control IDs are unique (${liveScan.duplicateIds.join(', ')})`);
  assert.deepEqual(liveScan.missing, [], 'every live control has a command-palette search entry while its workspace row is hidden');

  const labelOccurrences = new Map();
  const started = Date.now();
  for (const control of liveScan.controls) {
    const expectedLabel = `Show control: ${control.label}`;
    const occurrence = labelOccurrences.get(expectedLabel) || 0;
    labelOccurrences.set(expectedLabel, occurrence + 1);
    await page.keyboard.press('Control+k');
    await page.locator('#cp-input').fill(expectedLabel);
    const matches = await page.locator('#cp-list .cp-row').evaluateAll((rows, label) => rows
      .map((row, index) => row.firstElementChild?.textContent === label ? index : -1)
      .filter(index => index >= 0), expectedLabel);
    assert.ok(matches.length > occurrence, `palette search returns control ${control.id}`);
    for (let step = 0; step < matches[occurrence]; step++) await page.locator('#cp-input').press('ArrowDown');
    await page.locator('#cp-input').press('Enter');
    await page.waitForFunction(id => {
      const element = document.getElementById(id), row = element?.closest('.fx-row'), card = element?.closest('.fx-ctrl[data-fxsec]');
      return !!row && !!card && !row.hidden && !card.hidden;
    }, control.id, { timeout: 5000 });
    await page.evaluate(({ ids, sections }) => {
      const hidden = csWorkspaceLayoutGet();
      hidden.hiddenControls = ids;
      hidden.hiddenSections = sections;
      _csWorkspaceSave(hidden);
    }, { ids: liveScan.ids, sections: liveScan.sections });
  }
  console.log(`workspace controls: node identity, reorder, hide, search recovery, recipe snapshot, selective paste, and persistence passed; live completeness sweep ${liveScan.controls.length} controls/${liveScan.sections.length} sections in ${Date.now() - started} ms`);
} finally {
  await browser.close();
}
