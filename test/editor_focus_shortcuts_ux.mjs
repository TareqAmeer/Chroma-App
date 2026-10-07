// CHR-264 / CHR-266 / CHR-196 behavioural gate (real browser, real keyboard/pointer input):
//  1. Focus mode key hides bars/panel/rail/filmstrip, MEASURED photo-footprint gain per width x theme,
//     and the same key restores the exact prior geometry without touching stored sizes.
//  2. Focus mode is a registry action: rebindable, shown in the shortcut editor.
//  3. Slider reset: double-click, touch/pen hold, and Alt/Shift fine/coarse arrow stepping.
//  4. Command palette shows live shortcut bindings; shortcut editor shows rebinding conflicts inline.
//  5. Tool names agree between panel titles, palette section entries and aliases.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => { errors.push('unexpected dialog: ' + d.message()); d.dismiss(); });
await page.goto(pathToFileURL(process.env.APP_HTML || path.join(ROOT, 'chromasmith-22.html')).href, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => typeof window.loadFXImages === 'function', null, { timeout: 30000 });
// A large photo so the preview is layout-bound rather than capped by a tiny fixture's pixel size.
await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
  const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 3000, 2000); gr.addColorStop(0, '#d98'); gr.addColorStop(1, '#468');
  g.fillStyle = gr; g.fillRect(0, 0, 3000, 2000);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  await loadFXImages([new File([blob], 'big.png', { type: 'image/png' })]);
});
await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length > 0, null, { timeout: 20000 });
await page.evaluate(() => { try { localStorage.removeItem('chromasmith-shortcuts-v1'); } catch (_) {} });
// Dismiss the first-edit guide if it appears, then make sure nothing holds keyboard focus.
await page.keyboard.press('Escape');
await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });

const geom = () => page.evaluate(() => {
  const r = (id) => { const e = document.getElementById(id) || document.querySelector(id); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height), getComputedStyle(e).display]; };
  const cv = document.getElementById('fx-canvas').getBoundingClientRect();
  return { canvas: Math.round(cv.width * cv.height), deskbar: r('fx-deskbar'), panel: r('.fx-panel'), rail: r('fx-toolrail'), filmstrip: r('fx-filmstrip'), store: [localStorage.getItem('cs_panelw'), localStorage.getItem('cs_railmode')] };
});
async function settled() {
  let prev = '', n = 0;
  for (let i = 0; i < 40; i++) { await page.waitForTimeout(100); const g = JSON.stringify((await geom()).canvas); n = g === prev ? n + 1 : 0; if (n >= 3) return; prev = g; }
}

// ---- 1. focus mode: measured gain, exact restore ----------------------------------------
const rows = [];
for (const width of [1280, 1440, 1920]) {
  await page.setViewportSize({ width, height: 900 });
  for (const theme of ['dark', 'light']) {
    await page.evaluate((light) => document.body.classList.toggle('light', light), theme === 'light');
    await settled();
    const before = await geom();
    await page.keyboard.press('Shift+F');
    await settled();
    const during = await page.evaluate(() => document.body.classList.contains('cs-focus'));
    const focus = await geom();
    assert(during, 'Shift+F enters focus mode');
    for (const k of ['deskbar', 'panel', 'rail']) assert(focus[k] === null || focus[k][4] === 'none', `${k} hidden in focus mode`);
    assert(focus.filmstrip === null || focus.filmstrip[4] === 'none' || focus.filmstrip[3] === 0, 'filmstrip hidden in focus mode');
    assert.equal(await page.isVisible('#cs-focus-exit'), true, 'exit chip is visible');
    const gain = focus.canvas / before.canvas - 1;
    rows.push(`${width}px ${theme}: photo ${before.canvas} -> ${focus.canvas} px2 (+${(gain * 100).toFixed(1)}%)`);
    assert(gain >= 0.10, `focus gives at least 10% more photo area at ${width}/${theme}: ${gain}`);
    await page.keyboard.press('Shift+F');
    await settled();
    const after = await geom();
    assert.deepEqual(after, before, `second press restores the exact layout at ${width}/${theme}`);
  }
}
console.log('FOCUS MODE MEASURED PHOTO AREA\n  ' + rows.join('\n  '));
// restore also survives an in-focus resize and a user-sized panel; stored sizes are never rewritten
await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => fxPanelWidth(400));
await settled();
const sized = await geom();
await page.keyboard.press('Shift+F');
await page.setViewportSize({ width: 1280, height: 900 });
await settled();
assert.deepEqual((await geom()).store, sized.store, 'focus mode does not rewrite stored panel/rail sizes');
await page.setViewportSize({ width: 1440, height: 900 });
await page.click('#cs-focus-exit');
await settled();
assert.deepEqual(await geom(), sized, 'exit chip restores a custom-sized layout exactly');

// ---- 2. registry: rebindable and listed in the shortcut editor --------------------------
const def = await page.evaluate(() => window.chromasmithShortcutRegistry.actions().find((a) => a.id === 'editor.focus-mode'));
assert(def && def.binding === 'Shift+F' && /Focus mode/.test(def.label), 'focus mode is a registry action');
await page.evaluate(() => csOpenShortcuts());
assert.equal(await page.locator('[data-shortcut-row]', { hasText: 'Focus mode' }).count(), 1, 'shortcut editor lists focus mode');
await page.keyboard.press('Escape');
await page.evaluate(() => window.chromasmithShortcutRegistry.set('editor.focus-mode', 'Shift+K'));
await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
await page.keyboard.press('Shift+F');
assert.equal(await page.evaluate(() => document.body.classList.contains('cs-focus')), false, 'old binding no longer toggles');
await page.keyboard.press('Shift+K');
assert.equal(await page.evaluate(() => document.body.classList.contains('cs-focus')), true, 'rebound key toggles focus mode');
assert.match(await page.textContent('#cs-focus-exit'), /K/, 'exit chip reflects the live binding');
await page.keyboard.press('Shift+K');
await page.evaluate(() => window.chromasmithShortcutRegistry.unassign('editor.focus-mode'));
await settled();

// ---- 3. sliders ---------------------------------------------------------------------------
await page.evaluate(() => {
  document.body.classList.add('fx-single');
  document.getElementById('panel-fx')?.classList.add('active');
  document.querySelector('.fx-ctrl[data-fxsec="adjust"]')?.classList.add('sec-active');
  const t = document.getElementById('tg-adjust'); if (t && !t.classList.contains('on')) toggleFX('adjust');
});
const val = (id) => page.evaluate((i) => parseFloat(document.getElementById(i).value), id);
const setVal = (id, v) => page.evaluate(([i, x]) => { const s = document.getElementById(i); s.value = x; s.dispatchEvent(new Event('input', { bubbles: true })); }, [id, v]);
const SL = 'sl-adj-con';
const defVal = await page.evaluate((i) => parseFloat(document.getElementById(i).defaultValue), SL);
await setVal(SL, 40);
await page.dblclick('#' + SL, { force: true });
assert.equal(await val(SL), defVal, 'double-click resets the slider to its default');
const touch = (type, x, y) => page.evaluate(([t, px, py]) => document.getElementById('sl-adj-con').dispatchEvent(new PointerEvent(t, { pointerType: 'touch', pointerId: 7, clientX: px, clientY: py, bubbles: true, cancelable: true })), [type, x, y]);
const box = await page.locator('#' + SL).boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await setVal(SL, 40);
await touch('pointerdown', cx, cy); await page.waitForTimeout(250); await touch('pointerup', cx, cy); await page.waitForTimeout(500);
assert.equal(await val(SL), 40, 'a short tap does not reset');
await touch('pointerdown', cx, cy); await page.waitForTimeout(150); await touch('pointermove', cx + 30, cy); await page.waitForTimeout(700); await touch('pointerup', cx + 30, cy);
assert.equal(await val(SL), 40, 'dragging disarms hold-to-reset');
await touch('pointerdown', cx, cy); await page.waitForTimeout(800); await touch('pointerup', cx, cy);
assert.equal(await val(SL), defVal, 'a still touch hold resets to default');
await page.focus('#' + SL);
await setVal(SL, 0);
await page.focus('#' + SL);
const steps = {};
for (const [name, mod] of [['plain', ''], ['coarse', 'Shift+'], ['fine', 'Alt+']]) {
  await setVal(SL, 0); await page.focus('#' + SL);
  await page.keyboard.press(mod + 'ArrowRight');
  steps[name] = await val(SL);
}
assert(Math.abs(steps.plain - 0.1) < 1e-6 && Math.abs(steps.coarse - 1) < 1e-6 && Math.abs(steps.fine - 0.01) < 1e-6, 'arrow step: plain 0.1, Shift coarse 1, Alt fine 0.01: ' + JSON.stringify(steps));

// ---- 4. palette shows live bindings; shortcut editor shows conflicts inline -----------------
const paletteRow = async (q) => {
  await page.keyboard.press('Control+K');
  await page.fill('#cp-input', q);
  const r = await page.evaluate(() => [...document.querySelectorAll('#cp-list .cp-row')].map((x) => ({ label: x.querySelector('span').textContent, kbd: x.querySelector('.cp-kbd').textContent, group: x.lastElementChild.lastElementChild.textContent })));
  await page.keyboard.press('Escape');
  return r;
};
let r = await paletteRow('undo');
assert(r.some((x) => x.label === 'Undo' && /Z/.test(x.kbd) && x.group === 'Action'), 'palette shows Undo with its binding: ' + JSON.stringify(r));
r = await paletteRow('focus');
assert(r[0].label.startsWith('Focus mode') && r[0].kbd === '', 'unassigned binding shows no hint');
await page.evaluate(() => window.chromasmithShortcutRegistry.set('editor.focus-mode', 'Shift+K'));
r = await paletteRow('focus');
assert(/K/.test(r[0].kbd), 'palette reflects a rebound key live: ' + JSON.stringify(r[0]));
r = await paletteRow('ctrl+z');
assert(r.some((x) => x.label === 'Undo'), 'bindings are searchable');
r = await paletteRow('');
assert.equal(r[0].group, 'Action', 'empty query lists actions first');
// palette entry for a registry action runs it
await page.keyboard.press('Control+K'); await page.fill('#cp-input', 'focus mode'); await page.keyboard.press('Enter');
assert.equal(await page.evaluate(() => document.body.classList.contains('cs-focus')), true, 'palette runs focus mode');
await page.click('#cs-focus-exit');

await page.evaluate(() => csOpenShortcuts());
const redoRow = page.locator('[data-shortcut-row]', { hasText: 'Redo' }).first();
await redoRow.locator('[data-rebind]').click();
await page.keyboard.press('Control+Z');
const msg = redoRow.locator('.cs-sc-msg');
await msg.waitFor({ timeout: 3000 });
assert.match(await msg.textContent(), /already used by "Undo"/, 'conflict explained inline next to the row');
await redoRow.locator('[data-keep]').click();
assert.equal(await page.evaluate(() => window.chromasmithShortcutRegistry.binding('editor.redo')), 'CmdOrCtrl+Shift+Z', 'Keep current leaves redo untouched');
await page.locator('[data-shortcut-row]', { hasText: 'Redo' }).first().locator('[data-rebind]').click();
await page.keyboard.press('Control+Z');
await page.locator('[data-shortcut-row]', { hasText: 'Redo' }).first().locator('[data-reassign]').click();
const after = await page.evaluate(() => ({ redo: window.chromasmithShortcutRegistry.binding('editor.redo'), undo: window.chromasmithShortcutRegistry.binding('editor.undo') }));
assert.equal(after.redo, 'Ctrl+Z', 'Reassign moves the key'); assert.equal(after.undo, null, 'previous owner becomes unassigned');
await page.keyboard.press('Escape');
await page.evaluate(() => { localStorage.removeItem('chromasmith-shortcuts-v1'); });

// ---- 5. one name per tool ---------------------------------------------------------------------
const names = await page.evaluate(() => {
  const out = [];
  const cmds = _cpCommands();
  document.querySelectorAll('.fx-ctrl[data-fxsec]').forEach((c) => {
    const k = c.dataset.fxsec, t = c.querySelector('.fx-ctrl-title'); if (!t) return;
    const clone = t.cloneNode(true); clone.querySelectorAll('button,select,input,.fx-info-i,[class*="reset"]').forEach((x) => x.remove());
    const title = clone.textContent.replace(/\s*Reset(\|All)?\s*$/, '').trim();
    const hit = cmds.find((x) => x.group === 'Section' && x.label.replace(/^Export: /, '') === CS_NAMES[k]);
    out.push({ k, title, name: CS_NAMES[k], inPalette: !!hit });
  });
  return out;
});
for (const n of names) { assert(n.name, `tool ${n.k} has a canonical name`); assert(n.inPalette, `tool ${n.k} appears in the palette as "${n.name}"`); assert.equal(n.title.replace(/\s+/g, ' '), n.name, `panel title for ${n.k} equals canonical name`); }
r = await paletteRow('red eye');
assert(r.some((x) => x.label === 'Red Eye' && x.group === 'Section'), 'Red Eye reachable from palette');
for (const [q, want] of [['brightness', 'Light'], ['exposure', 'Light'], ['tone', 'Light'], ['basic', 'Light'], ['vignette', 'Effects']]) {
  r = await paletteRow(q);
  assert(r.length && r.slice(0, 3).some((x) => x.label === want), `"${q}" reaches ${want}: ` + JSON.stringify(r.slice(0, 3)));
}
assert.deepEqual(errors, [], 'no page errors or dialogs');
await browser.close();
console.log('EDITOR FOCUS/SHORTCUT/PALETTE UX: PASS');
