import assert from 'node:assert/strict';
import { buildStaticGallery, STATIC_GALLERY_TEMPLATES } from '../desktop/static-gallery.mjs';

const photos = [
  { src: 'images/one photo.jpg', alt: 'First <photo>', caption: 'Caption & credit' },
  { src: 'images/two.jpg' },
];
for (const template of STATIC_GALLERY_TEMPLATES) {
  const html = buildStaticGallery({ title: 'A <Gallery>', collectionTitle: 'Summer & light', contact: 'a+b@example.test', template, columns: 4, photos });
  assert.match(html, new RegExp(`data-template="${template}"`));
  assert.match(html, /images\/one%20photo\.jpg/);
  assert.match(html, /First &lt;photo&gt;/);
  assert.match(html, /Caption &amp; credit/);
  assert.match(html, /A &lt;Gallery&gt;/);
  assert.match(html, /Summer &amp; light/);
  assert.match(html, /mailto:a%2Bb%40example\.test/);
  assert.match(html, /@media\(max-width:420px\)/);
  assert.match(html, /showModal\(\)/);
  assert.doesNotMatch(html, /https?:\/\//);
}

assert.match(buildStaticGallery({ columns: 99, photos: [] }), /--columns:8/);
assert.match(buildStaticGallery({ columns: -2, photos: [] }), /--columns:1/);
for (const src of ['/absolute.jpg', '../outside.jpg', 'images/../../secret.jpg', 'javascript:alert(1)', 'https://example.test/x.jpg', 'images\\x.jpg', 'x.jpg?raw=1']) {
  assert.throws(() => buildStaticGallery({ photos: [{ src }] }), TypeError, src);
}
assert.throws(() => buildStaticGallery({ photos: [null] }), /must be an object/);
console.log('static gallery builder checks passed');
