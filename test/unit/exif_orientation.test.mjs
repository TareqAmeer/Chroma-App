import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './extract.mjs';

const { neutralizeExifOrientation } = load(['neutralizeExifOrientation']);
const enc = s => new TextEncoder().encode(s);
function xmpSeg(body) {
  const hdr = enc('http://ns.adobe.com/xap/1.0/\0'), b = enc(body), len = 2 + hdr.length + b.length;
  const seg = new Uint8Array(2 + len); seg[0] = 0xFF; seg[1] = 0xE1; seg[2] = len >> 8; seg[3] = len & 255;
  seg.set(hdr, 4); seg.set(b, 4 + hdr.length); return seg;
}
const text = s => new TextDecoder().decode(s);

test('XMP tiff:Orientation attribute is neutralised to 1 (same length)', () => {
  const s = xmpSeg('<x:xmpmeta><rdf:Description tiff:Orientation="8" tiff:Make="P"/></x:xmpmeta>');
  const o = neutralizeExifOrientation(s);
  assert.equal(o.length, s.length);
  assert.match(text(o), /tiff:Orientation="1"/);
});
test('XMP tiff:Orientation element is neutralised to 1', () => {
  const o = neutralizeExifOrientation(xmpSeg('<tiff:Orientation>6</tiff:Orientation>'));
  assert.match(text(o), /<tiff:Orientation>1<\/tiff:Orientation>/);
});
test('XMP without Orientation is returned untouched', () => {
  const s = xmpSeg('<x:xmpmeta/>'); assert.equal(neutralizeExifOrientation(s), s);
});
