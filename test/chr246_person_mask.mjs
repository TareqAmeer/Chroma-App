import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const polygon = JSON.parse(await readFile(new URL('./fixtures/chr246-real/woman-crossing-mask.json', import.meta.url), 'utf8'));
assert.ok(Array.isArray(polygon) && polygon.length >= 3);
assert.ok(polygon.every(point => Array.isArray(point) && point.length === 2 && point.every(v => Number.isInteger(v) && v >= 0 && v <= 1000)));

function contains(x, y) {
  let inside = false;
  let j = polygon.length - 1;
  for (let i = 0; i < polygon.length; i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    j = i;
  }
  return inside;
}

for (const [x, y, label] of [[540, 300, 'torso'], [640, 350, 'right-side bags'], [590, 800, 'cast shadow']]) {
  assert.ok(contains(x, y), `mask should cover ${label}`);
}
for (const [x, y, label] of [[800, 500, 'right-side background'], [200, 250, 'left-side background']]) {
  assert.ok(!contains(x, y), `mask should leave ${label} untouched`);
}
console.log(`PASS CHR-246 person fixture mask (${polygon.length} normalized polygon points)`);
