import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../desktop/library-ui.js', import.meta.url), 'utf8');
const begin = '// CHR-177 contact-sheet geometry begin';
const end = '// CHR-177 contact-sheet geometry end';
const startAt = source.indexOf(begin), endAt = source.indexOf(end, startAt);
assert.ok(startAt >= 0 && endAt > startAt, 'contact-sheet layout helpers are present');
const geometrySource = source.slice(startAt + begin.length, endAt);
const helpers = new Function(`${geometrySource}; return { CONTACT_SHEET_MAX_PHOTOS, contactSheetOrder, contactSheetLayout, contactSheetContainRect };`)();

assert.deepEqual(helpers.contactSheetOrder(['/c.jpg', '/a.jpg', '/b.jpg', '/a.jpg'], [
  { path: '/a.jpg' }, { path: '/b.jpg' }, { path: '/c.jpg' },
]), ['/a.jpg', '/b.jpg', '/c.jpg'], 'selection follows visible Library order and removes duplicate paths');
assert.deepEqual(helpers.contactSheetOrder(['/outside-b.jpg', '/outside-a.jpg'], []), ['/outside-b.jpg', '/outside-a.jpg'], 'unlisted paths keep their selection order');

for (const count of [1, 2, 5, 12]) {
  const page = helpers.contactSheetLayout(count);
  assert.equal(page.width, 2480);
  assert.equal(page.height, 3508);
  assert.equal(page.cells.length, count);
  for (const cell of page.cells) {
    assert.ok(cell.x >= page.margin && cell.y >= page.margin + page.header, `cell within safe page margins for ${count}`);
    assert.ok(cell.x + cell.width <= page.width - page.margin, `cell right edge within page for ${count}`);
    assert.ok(cell.y + cell.height <= page.height - page.margin - 80, `cell bottom within page for ${count}`);
    assert.ok(cell.image.width > 0 && cell.image.height > 0 && cell.caption.height === 76);
  }
}
assert.equal(helpers.contactSheetLayout(12).columns, 3, 'dense contact sheets use a readable three-column grid');
assert.equal(helpers.contactSheetLayout(12).rows, 4, 'dense contact sheets fit the twelve-photo page limit');
assert.throws(() => helpers.contactSheetLayout(0), /Select 1–12 photos/);
assert.throws(() => helpers.contactSheetLayout(13), /Select 1–12 photos/);

const box = { x: 100, y: 50, width: 600, height: 400 };
const landscape = helpers.contactSheetContainRect(1200, 600, box);
assert.deepEqual(landscape, { x: 100, y: 100, width: 600, height: 300 }, 'landscape image is fully contained and centered');
const portrait = helpers.contactSheetContainRect(600, 1200, box);
assert.deepEqual(portrait, { x: 300, y: 50, width: 200, height: 400 }, 'portrait image is fully contained and centered');
assert.throws(() => helpers.contactSheetContainRect(0, 600, box), /dimensions must be positive/);

assert.match(source, /exportMenu\.subItem\('Contact sheet…'/);
assert.match(source, /chromasmithRenderCurrentGraded\(1600\)/);
assert.match(source, /'★'\.repeat\(Math\.min\(5, sc\.rating\)\)/);
console.log('PASS contact-sheet selection order, A4-ratio grid margins/captions, photo containment, range limits and graded-render wiring.');
