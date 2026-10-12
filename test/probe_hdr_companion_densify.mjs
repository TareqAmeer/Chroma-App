// HDR companion cache (library.rs hdrext): the editor rebuilds the dense scene-linear buffer from
// the cached RGBA8 frame + sparse f16 overlay. Pins the wire layout the Rust writer produces
// (see hdr_companion_round_trip_and_mismatch_rejection) and the mismatch rejections.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../desktop/library-ui.js', import.meta.url), 'utf8');
const a = src.indexOf('function hdrCompanionDensify');
const b = src.indexOf('window.chromasmithHdrCompanionDensify');
if (a < 0 || b < 0) { console.error('FAIL: hdrCompanionDensify not found'); process.exit(1); }
const densify = new Function(src.slice(a, b) + '; return hdrCompanionDensify;')();
const w = 4, h = 2, count = 2, scale = 0.08;
const blob = new ArrayBuffer(28 + count * 7), dv = new DataView(blob);
new Uint8Array(blob).set([0x43, 0x48, 0x58, 0x32]); // "CHX2"
dv.setUint32(12, w, true); dv.setUint32(16, h, true); dv.setUint32(20, count, true); dv.setFloat32(24, scale, true);
dv.setUint32(28, 1, true); dv.setUint32(32, 5, true);          // pixel indices
[64, 0, 0, 255, 128, 0].forEach((v, i) => dv.setUint8(36 + i, v)); // pixel 1 R=1+64/255*scale; pixel 5 R=1+scale, G=1+128/255*scale, B from frame
const px = new Uint8ClampedArray(w * h * 4).fill(128);
const out = densify(blob, px, w, h);
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };
const near = (a, b) => Math.abs(a - b) < 1e-6;
if (!near(out[0], 128 / 255)) fail('non-overlaid pixel should be rgba/255');
if (!near(out[3], 1 + 64 / 255 * scale)) fail('pixel 1 red: ' + out[3]);
if (!near(out[4], 128 / 255)) fail('pixel 1 green (zero excess) must come from the frame');
if (!near(out[15], 1 + scale) || !near(out[16], 1 + 128 / 255 * scale) || !near(out[17], 128 / 255)) fail('pixel 5: ' + [...out.slice(15, 18)]);
for (const [name, args] of [['size', [blob, px, w + 1, h]], ['truncated', [blob.slice(0, 40), px, w, h]]]) {
  let threw = false; try { densify(...args); } catch { threw = true; }
  if (!threw) fail('mismatch not rejected: ' + name);
}
const old = blob.slice(0); new Uint8Array(old)[3] = 0x31;
let threw = false; try { densify(old, px, w, h); } catch { threw = true; }
if (!threw) fail('old CHX1 format not rejected');
console.log('probe_hdr_companion_densify: PASS');
