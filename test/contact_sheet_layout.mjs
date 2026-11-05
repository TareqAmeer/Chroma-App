import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../desktop/library-ui.js', import.meta.url), 'utf8');
const begin = '// CHR-177 contact-sheet geometry begin';
const end = '// CHR-177 contact-sheet geometry end';
const startAt = source.indexOf(begin), endAt = source.indexOf(end, startAt);
assert.ok(startAt >= 0 && endAt > startAt, 'contact-sheet layout helpers are present');
const geometrySource = source.slice(startAt + begin.length, endAt);
const helpers = new Function(`${geometrySource}; return { CONTACT_SHEET_MAX_PHOTOS, contactSheetOrder, contactSheetLayout, contactSheetContainRect, contactSheetNormalize, contactSheetPages, contactSheetPerPage, contactSheetPdf, libNamedPresets };`)();

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
assert.match(source, /libRenderGradedPhoto\(fileByPath\.get\(path\), path, sc, 1600\)/, 'contact-sheet cells come from the isolated graded renderer');
assert.match(source, /async function libRenderGradedPhoto[\s\S]{0,700}chromasmithRenderCurrentGraded\(maxEdge\)/, 'the shared renderer uses the graded export pipeline');

// CHR-177 follow-up: pagination beyond 12, paper/orientation, fixed grids, PDF, templates.
const paths = Array.from({ length: 29 }, (_, i) => `/p${i}.jpg`);
assert.deepEqual(helpers.contactSheetPages(paths, {}).map((p) => p.length), [12, 12, 5], 'auto grid flows 12 per page');
assert.deepEqual(helpers.contactSheetPages(paths, { columns: 4, rows: 5 }).map((p) => p.length), [20, 9], 'fixed grid flows rows x columns per page');
assert.deepEqual(helpers.contactSheetPages(paths, { columns: 4, rows: 0 }).map((p) => p.length), [12, 12, 5], 'half a fixed grid falls back to automatic');
assert.deepEqual(helpers.contactSheetPages(paths, {}).flat(), paths, 'pagination keeps order and drops nothing');
const fixedLast = helpers.contactSheetLayout(9, { columns: 4, rows: 5 }), fixedFull = helpers.contactSheetLayout(20, { columns: 4, rows: 5 });
assert.deepEqual([fixedLast.cells[0].width, fixedLast.cells[0].height], [fixedFull.cells[0].width, fixedFull.cells[0].height], 'a short last page keeps the same cell size');
assert.throws(() => helpers.contactSheetLayout(21, { columns: 4, rows: 5 }), /Select 1–20 photos/);
const letterLand = helpers.contactSheetLayout(12, { paper: 'letter', orientation: 'landscape' });
assert.deepEqual([letterLand.width, letterLand.height, letterLand.ptWidth, letterLand.ptHeight], [3300, 2550, 792, 612]);
for (const cell of letterLand.cells) assert.ok(cell.x + cell.width <= 3300 - 120 && cell.y + cell.height <= 2550 - 200 && cell.image.height > 0, 'landscape letter cells inside margins');
assert.equal(helpers.contactSheetLayout(1, { filename: false, rating: false }).cells[0].caption.height, 0, 'no caption band when captions are off');
const norm = helpers.contactSheetNormalize({ paper: 'tabloid', orientation: 'sideways', columns: 99, rows: -1, format: 'tiff', title: 'x'.repeat(500) });
assert.deepEqual([norm.paper, norm.orientation, norm.columns, norm.rows, norm.format, norm.title.length], ['a4', 'portrait', 0, 0, 'pdf', 120]);

// PDF: a tiny real JPEG (1x1) per page; every xref offset must point at its "n 0 obj".
const jpeg = Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'));
const pdf = helpers.contactSheetPdf([{ jpeg, width: 1, height: 1, ptWidth: 595.28, ptHeight: 841.89 }, { jpeg, width: 1, height: 1, ptWidth: 841.89, ptHeight: 595.28 }], { title: 'Trip (day 1) \\ caf\u00e9', producer: 'Chromasmith' });
const text = Buffer.from(pdf).toString('latin1');
assert.ok(text.startsWith('%PDF-1.4\n') && text.endsWith('%%EOF\n'));
assert.equal((text.match(/\/Type \/Page /g) || []).length, 2);
assert.match(text, /\/MediaBox \[0 0 595\.28 841\.89\]/); assert.match(text, /\/MediaBox \[0 0 841\.89 595\.28\]/);
const xrefAt = Number(/startxref\n(\d+)\n/.exec(text)[1]);
assert.ok(text.slice(xrefAt).startsWith('xref\n0 10\n'), 'startxref points at the xref table');
const offsets = text.slice(xrefAt).split('\n').slice(3, 12).map((l) => Number(l.slice(0, 10)));
offsets.forEach((o, i) => assert.ok(text.startsWith(`${i + 1} 0 obj`, o), `xref offset of object ${i + 1}`));
// /Info dictionary: trailer points at it, Title/Producer are escaped PDF literal strings.
const infoN = Number(/\/Info (\d+) 0 R/.exec(text)[1]);
assert.equal(infoN, 9);
assert.ok(text.includes('9 0 obj\n<< /Title (Trip \\(day 1\\) \\\\ caf?) /Producer (Chromasmith) >>'), 'Info dict with escaped title');
assert.match(Buffer.from(helpers.contactSheetPdf([{ jpeg, width: 1, height: 1, ptWidth: 1, ptHeight: 1 }])).toString('latin1'), /\/Title \(Contact sheet\) \/Producer \(Chromasmith\)/);
assert.throws(() => helpers.contactSheetPdf([]), /at least one page/);
assert.throws(() => helpers.contactSheetPdf([{ jpeg: new Uint8Array([0x89, 0x50]), width: 1, height: 1, ptWidth: 1, ptHeight: 1 }]), /not a JPEG/);

// Templates: named, normalised on save and load, junk storage tolerated.
const mem = new Map(), storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
const tpl = helpers.libNamedPresets(storage, 'k', helpers.contactSheetNormalize);
assert.equal(tpl.save('  Proof  ', { columns: 3, rows: 3, paper: 'letter' }), 'Proof');
assert.deepEqual(tpl.names(), ['Proof']);
assert.equal(tpl.get('Proof').paper, 'letter'); assert.equal(tpl.get('nope'), null);
assert.throws(() => tpl.save('  ', {}), /Name the preset/);
tpl.remove('Proof'); assert.deepEqual(tpl.names(), []);
mem.set('k', '[1,2'); assert.deepEqual(tpl.names(), [], 'corrupt storage reads as empty');
assert.match(source, /'★'\.repeat\(Math\.min\(5, sc\.rating\)\)/);
console.log('PASS contact-sheet selection order, page grid margins/captions, paper/orientation, pagination, PDF structure, templates, photo containment, range limits and graded-render wiring.');
