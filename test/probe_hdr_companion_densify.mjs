// HDR companion cache (library.rs hdrext): the editor rebuilds the dense scene-linear buffer from
// the cached RGBA8 frame + sparse f16 overlay. Pins the wire layout the Rust writer produces
// (see hdr_companion_round_trip_and_mismatch_rejection) and the mismatch rejections.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../desktop/library-ui.js', import.meta.url), 'utf8');
const a = src.indexOf('function hdrCompanionDensify');
const b = src.indexOf('window.chromasmithHdrCompanionDensify');
if (a < 0 || b < 0) { console.error('FAIL: hdrCompanionDensify not found'); process.exit(1); }
const densify = new Function(src.slice(a, b) + '; return hdrCompanionDensify;')();
const w = 4, h = 2, count = 2;
const blob = new ArrayBuffer(24 + count * 10), dv = new DataView(blob);
new Uint8Array(blob).set([0x43, 0x48, 0x58, 0x31]);
dv.setUint32(12, w, true); dv.setUint32(16, h, true); dv.setUint32(20, count, true);
dv.setUint32(24, 1, true); dv.setUint32(28, 5, true);                       // pixel indices
[0x3c29, 0x3c00, 0x3c00, 0x4100, 0x3d00, 0x3c00].forEach((v, i) => dv.setUint16(32 + 2 * i, v, true)); // 1.04.., 2.5, 1.25
const px = new Uint8ClampedArray(w * h * 4).fill(128);
const out = densify(blob, px, w, h);
const fail = (m) => { console.error('FAIL: ' + m); process.exit(1); };
if (Math.abs(out[0] - 128 / 255) > 1e-6) fail('non-overlaid pixel should be rgba/255');
if (out[5 * 3] !== 2.5 || out[5 * 3 + 1] !== 1.25 || out[5 * 3 + 2] !== 1) fail('overlay pixel 5: ' + [...out.slice(15, 18)]);
if (!(out[3] > 1.0 && out[3] < 1.05)) fail('overlay pixel 1 red: ' + out[3]);
for (const [name, args] of [['size', [blob, px, w + 1, h]], ['truncated', [blob.slice(0, 40), px, w, h]]]) {
  let threw = false; try { densify(...args); } catch { threw = true; }
  if (!threw) fail('mismatch not rejected: ' + name);
}
console.log('probe_hdr_companion_densify: PASS');
