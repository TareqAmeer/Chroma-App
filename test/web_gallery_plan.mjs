// CHR-239: pure web-gallery helpers from desktop/library-ui.js — settings normalisation, stable
// asset names, the fingerprint that decides re-rendering, the incremental plan and captions.
// Run: node test/web_gallery_plan.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../desktop/library-ui.js', import.meta.url), 'utf8');
const begin = '// CHR-239 web-gallery plan begin', end = '// CHR-239 web-gallery plan end';
const a = source.indexOf(begin), b = source.indexOf(end, a);
assert.ok(a >= 0 && b > a, 'web-gallery helpers are present');
const h = new Function(`${source.slice(a + begin.length, b)}; return { WEB_GALLERY_MANIFEST, webGalleryNormalize, webGalleryHash, webGalleryAssetName, webGalleryFingerprint, webGalleryPlan, webGalleryManifest, webGalleryCaption };`)();

const d = h.webGalleryNormalize();
assert.deepEqual([d.template, d.palette, d.columns, d.size, d.quality, d.captionFilename, d.captionRating], ['grid', 'light', 3, 2048, 85, true, false]);
const n = h.webGalleryNormalize({ template: '<x>', palette: 'neon', columns: 40, size: 99999, quality: 2, watermarkOpacity: 0, title: 'x'.repeat(999) });
assert.deepEqual([n.template, n.palette, n.columns, n.size, n.quality, n.watermarkOpacity, n.title.length], ['grid', 'light', 8, 4096, 40, 5, 120]);

assert.equal(h.webGalleryHash('a'), h.webGalleryHash('a'));
assert.notEqual(h.webGalleryHash('a'), h.webGalleryHash('b'));
assert.match(h.webGalleryHash('x'), /^[0-9a-f]{16}$/);

const nameA = h.webGalleryAssetName('/Users/me/Pictures/Trip/IMG 0001 (copy).RW2');
assert.match(nameA, /^img-0001-copy-[0-9a-f]{8}\.jpg$/);
assert.notEqual(h.webGalleryAssetName('/a/IMG_1.jpg'), h.webGalleryAssetName('/b/IMG_1.jpg'), 'same name in two folders -> two files');
assert.match(h.webGalleryAssetName('C:\\Photos\\été.jpg'), /^ete-[0-9a-f]{8}\.jpg$/, 'Windows paths and accents');
assert.match(h.webGalleryAssetName('/x/日本.jpg'), /^photo-[0-9a-f]{8}\.jpg$/, 'non-Latin names fall back to a safe slug');
assert.ok(!nameA.includes('/') && !nameA.includes('Users'));

const s = { size: 1600, quality: 85 };
const fp = h.webGalleryFingerprint('/p.jpg', 'R', 10, s);
assert.equal(fp, h.webGalleryFingerprint('/p.jpg', 'R', 10, { ...s, title: 'other', palette: 'dark', captionRating: true, columns: 5 }), 'page-only settings do not invalidate images');
for (const changed of [['/q.jpg', 'R', 10, s], ['/p.jpg', 'R2', 10, s], ['/p.jpg', 'R', 11, s], ['/p.jpg', 'R', 10, { ...s, size: 1200 }], ['/p.jpg', 'R', 10, { ...s, quality: 70 }], ['/p.jpg', 'R', 10, { ...s, watermark: '©' }]]) {
  assert.notEqual(h.webGalleryFingerprint(...changed), fp, `fingerprint changes for ${JSON.stringify(changed)}`);
}
assert.equal(h.webGalleryFingerprint('/p.jpg', 'R', 10, { ...s, watermarkOpacity: 20 }), fp, 'opacity without a watermark is irrelevant');

const items = [{ path: '/a.jpg', fingerprint: 'A1' }, { path: '/b.jpg', fingerprint: 'B1' }];
const first = h.webGalleryPlan(items, null);
assert.deepEqual(first.entries.map((e) => e.render), [true, true]);
assert.deepEqual(first.stale, []);
first.entries.forEach((e) => { e.width = 800; e.height = 600; });
const manifest = JSON.parse(JSON.stringify(h.webGalleryManifest({}, first.entries)));
assert.equal(manifest.version, 1);
assert.deepEqual(manifest.order, first.entries.map((e) => e.file));
assert.ok(!JSON.stringify(manifest).includes('/a.jpg'), 'manifest carries no source paths');
const same = h.webGalleryPlan(items, manifest);
assert.deepEqual(same.entries.map((e) => [e.render, e.width, e.height]), [[false, 800, 600], [false, 800, 600]], 'unchanged photos are reused with their stored size');
const edited = h.webGalleryPlan([{ path: '/b.jpg', fingerprint: 'B2' }, { path: '/c.jpg', fingerprint: 'C1' }], manifest);
assert.deepEqual(edited.entries.map((e) => e.render), [true, true]);
assert.deepEqual(edited.stale, [h.webGalleryAssetName('/a.jpg')], 'dropped photo is reported stale');
const broken = JSON.parse(JSON.stringify(manifest)); broken.photos[first.entries[0].file].width = 0;
assert.equal(h.webGalleryPlan(items, broken).entries[0].render, true, 'an entry without a size is re-rendered');
assert.deepEqual(h.webGalleryPlan(items, { version: 2, photos: manifest.photos }).entries.map((e) => e.render), [true, true], 'unknown manifest version -> full export');
assert.throws(() => h.webGalleryPlan([{ path: '/a.jpg', fingerprint: '1' }, { path: '/a.jpg', fingerprint: '2' }], null), /same gallery file/);

assert.equal(h.webGalleryCaption('/x/IMG_1.jpg', { rating: 3 }, {}), 'IMG_1.jpg');
assert.equal(h.webGalleryCaption('/x/IMG_1.jpg', { rating: 9 }, { captionRating: true, captionCopyright: true, copyright: ' © Me ' }), 'IMG_1.jpg\n★★★★★\n© Me');
assert.equal(h.webGalleryCaption('/x/IMG_1.jpg', null, { captionFilename: false, captionRating: true }), '');
assert.match(source, /exportMenu\.subItem\('Web gallery…', \(\) => createWebGallery\(paths\)\)/, 'Library Export submenu offers Web gallery…');
assert.equal(h.WEB_GALLERY_MANIFEST, 'chromasmith-gallery.json');
console.log('PASS web-gallery settings, asset names, fingerprints, incremental plan, manifest and captions');
