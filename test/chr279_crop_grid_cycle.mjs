// CHR-279: the crop-grid cycle reuses the existing preview-only grid choices and shortcut registry.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../chromasmith-22.html', import.meta.url), 'utf8');
assert.match(html, /\['editor\.crop-grid','Cycle crop grid overlay','Tools','editor','Shift\+G'\]/,
  'grid cycling is discoverable and remappable in the shared shortcut editor');
assert.match(html, /csShortcutRegister\('editor\.crop-grid',\(\)=>\{if\(!fxImages\.length\)return false;cropGridCycle\(\);\}\);/,
  'grid cycling uses the shared registry and does not consume the shortcut without a photo');

const start = html.indexOf("let cropGrid='3x3'");
const end = html.indexOf('// ── DPI read/write', start);
assert(start >= 0 && end > start, 'existing crop-grid functions are present');

const persisted = new Map();
const overlay = { style: { display: 'none' }, innerHTML: '', querySelectorAll: () => [] };
const select = { value: '3x3' };
const document = { getElementById: id => id === 'fx-grid-overlay' ? overlay : id === 'sel-crop-grid' ? select : null };
const context = {
  document,
  localStorage: { getItem: key => persisted.get(key) ?? null, setItem: (key, value) => persisted.set(key, value) },
  curItem: () => ({ img: {} }),
  cropMode: false,
};
vm.runInNewContext(html.slice(start, end), context);

for (const mode of ['4x4', '9x9', 'golden', 'off', '3x3']) {
  context.cropGridCycle();
  assert.equal(vm.runInContext('cropGrid', context), mode, `cycle advances to ${mode}`);
  assert.equal(select.value, mode, `crop grid control reflects ${mode}`);
  assert.equal(persisted.get('chromasmith_crop_grid'), mode, `${mode} persists with existing preference`);
  assert.equal(overlay.style.display, mode === 'off' ? 'none' : 'block', `${mode} overlay visibility`);
}

console.log('CHR-279 crop grid cycle: PASS (5 grid modes, preference and overlay state)');
