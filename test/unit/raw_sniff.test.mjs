// CHR-250: loadRw2 reads make/model from the RAW header to skip the throw-away linear decode when no
// bundled DCP can apply. These pin the header reader and the deliberately loose "rules out" check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './extract.mjs';

const app = load(['rawSniffMakeModel', 'CAMERA_DCP_PREFIXES', 'rawSniffRulesOutBundledDcp']);

// Minimal TIFF: header + one IFD holding Make (271) and Model (272) as out-of-line ASCII.
function tiff(make, model, le = true, magic = 42) {
  const strs = [make + '\0', model + '\0'];
  const ifd = 8, data = ifd + 2 + 2 * 12 + 4;
  const buf = new Uint8Array(data + strs[0].length + strs[1].length + 8);
  const d = new DataView(buf.buffer);
  buf.set(le ? [0x49, 0x49] : [0x4d, 0x4d]); d.setUint16(2, magic, le); d.setUint32(4, ifd, le);
  d.setUint16(ifd, 2, le);
  let off = data;
  [271, 272].forEach((tag, i) => {
    const e = ifd + 2 + 12 * i;
    d.setUint16(e, tag, le); d.setUint16(e + 2, 2, le); d.setUint32(e + 4, strs[i].length, le); d.setUint32(e + 8, off, le);
    for (const ch of strs[i]) buf[off++] = ch.charCodeAt(0);
  });
  return buf;
}

test('reads Make/Model from little- and big-endian TIFF-structured RAWs (incl. RW2 magic 0x55)', () => {
  assert.deepEqual({ ...app.rawSniffMakeModel(tiff('NIKON CORPORATION', 'NIKON D7200')) }, { make: 'NIKON CORPORATION', model: 'NIKON D7200' });
  assert.deepEqual({ ...app.rawSniffMakeModel(tiff('Canon', 'Canon EOS 40D', false)) }, { make: 'Canon', model: 'Canon EOS 40D' });
  assert.deepEqual({ ...app.rawSniffMakeModel(tiff('Panasonic', 'DC-S9', true, 0x55)) }, { make: 'Panasonic', model: 'DC-S9' });
});

test('reads the model from a Fuji RAF header', () => {
  const b = new Uint8Array(256);
  b.set([...'FUJIFILMCCD-RAW 0201FF383501'].map((c) => c.charCodeAt(0)));
  b.set([...'X-Pro2'].map((c) => c.charCodeAt(0)), 0x1c);
  assert.deepEqual({ ...app.rawSniffMakeModel(b) }, { make: 'FUJIFILM', model: 'X-Pro2' });
});

test('unknown containers and truncated files give no hint', () => {
  const cr3 = new Uint8Array(64); cr3.set([...'\0\0\0\x18ftypcrx '].map((c) => c.charCodeAt(0)));
  assert.equal(app.rawSniffMakeModel(cr3), null);
  assert.equal(app.rawSniffMakeModel(tiff('Canon', 'X').slice(0, 20)), null);
  assert.equal(app.rawSniffMakeModel(new Uint8Array(4)), null);
});

test('only a header that cannot be a bundled-DCP camera skips the linear decode', () => {
  assert.equal(app.rawSniffRulesOutBundledDcp({ make: 'NIKON CORPORATION', model: 'NIKON D7200' }), true);
  assert.equal(app.rawSniffRulesOutBundledDcp({ make: 'Panasonic', model: 'DC-GH5S' }), true);
  assert.equal(app.rawSniffRulesOutBundledDcp({ make: 'Panasonic', model: 'DC-S9' }), false);
  assert.equal(app.rawSniffRulesOutBundledDcp({ make: 'SONY', model: 'DSC-RX100M5' }), false);
  assert.equal(app.rawSniffRulesOutBundledDcp({ make: 'Sony', model: 'Sony DSC-RX100M5A' }), false);
  assert.equal(app.rawSniffRulesOutBundledDcp(null), false);
  assert.equal(app.rawSniffRulesOutBundledDcp({ make: 'Canon', model: '' }), false);
});
