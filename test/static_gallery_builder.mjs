import assert from 'node:assert/strict';
import { buildStaticGallery, STATIC_GALLERY_TEMPLATES, STATIC_GALLERY_PALETTES } from '../desktop/static-gallery.mjs';

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
// CHR-239 settings: palette, description, footer/copyright, web contact link, intrinsic sizes.
assert.deepEqual([...STATIC_GALLERY_PALETTES], ['light', 'dark', 'grey']);
for (const palette of STATIC_GALLERY_PALETTES) {
  const html = buildStaticGallery({ palette, photos });
  assert.match(html, new RegExp(`data-palette="${palette}"`));
  assert.match(html, new RegExp(`color-scheme" content="${palette === 'light' ? 'light' : 'dark'}"`));
}
assert.match(buildStaticGallery({ palette: '<evil>', photos: [] }), /data-palette="light"/);
assert.match(buildStaticGallery({ palette: 'dark', photos: [] }), /background:#141414/);
const rich = buildStaticGallery({ description: 'Long <i>walk</i>', footer: '© 2026 <Me>', contact: 'https://example.test/me?a=1&b=2', photos: [{ src: 'a.jpg', width: 800.4, height: 600, caption: 'line1\nline2' }, { src: 'b.jpg', width: 0, height: 10 }] });
assert.match(rich, /<p class="description">Long &lt;i&gt;walk&lt;\/i&gt;<\/p>/);
assert.match(rich, /<footer>© 2026 &lt;Me&gt;<\/footer>/);
assert.match(rich, /href="https:\/\/example\.test\/me\?a=1&amp;b=2"/, 'web contact link kept as a link, escaped');
assert.match(buildStaticGallery({ contact: 'https://x.test/"onmouseover=1', photos: [] }), /href="mailto:/, 'a URL with a quote is not trusted as a link');
assert.match(rich, /src="a\.jpg" alt="line1\nline2" width="800" height="600"/);
assert.doesNotMatch(rich, /src="b\.jpg"[^>]*width=/, 'no size attributes without a valid size');
assert.match(rich, /white-space:pre-line/, 'multi-line captions render as lines');
assert.match(buildStaticGallery({ contact: 'javascript:alert(1)', photos: [] }), /href="mailto:javascript%3Aalert\(1\)"/, 'non-http contact never becomes a script link');
assert.doesNotMatch(buildStaticGallery({ photos: [] }), /<footer>|class="description"/);
console.log('static gallery builder checks passed');
