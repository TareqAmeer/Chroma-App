// CHR-162 probe: an iPhone ProRAW DNG rendered through the app's embedded-DNG-profile path
// (parseDngEmbeddedProfile -> bakeDcpLUT -> applyDcpLUT, fed the desktop's native linear16 decode
// from examples/dump_rw2) must land close to Apple's own embedded preview render.
//   node test/probe_dng_color.mjs <file.DNG> <linear16.bin from dump_rw2 ... 8> <preview.bmp sRGB, same size/orientation>
import { readFileSync } from 'node:fs';
const [dngPath, binPath, bmpPath] = process.argv.slice(2);
const html = readFileSync(new URL('../chromasmith-22.html', import.meta.url), 'utf8');
const grab = (sig) => { const i = html.indexOf(sig); if (i < 0) throw new Error('missing ' + sig);
  let d = 0, j = html.indexOf('{', i); for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; } return html.slice(i, j + 1); };
const line = (sig) => { const i = html.indexOf(sig); return html.slice(i, html.indexOf('\n', i)); };
const src = [line('const XYZ2PP='), line('const PP2SRGB='), grab('function srgbG('), grab('function dcpFit('),
  grab('function parseDngEmbeddedProfile('), grab('function parseDngGainTableMap('), grab('function dngGainInputMatrix('), grab('function applyDngGainMap('), grab('function bakeDcpLUT('), grab('function applyDcpLUT(')].join('\n');
const api = new Function(src + '\nreturn{parseDngEmbeddedProfile,dngGainInputMatrix,applyDngGainMap,bakeDcpLUT,applyDcpLUT,dcpFit};')();
const dcp = api.parseDngEmbeddedProfile(new Uint8Array(readFileSync(dngPath)));
if (!dcp) { console.error('FAIL: no embedded profile parsed'); process.exit(1); }
const bin = readFileSync(binPath), hd = new Uint32Array(bin.buffer, bin.byteOffset, 3), w = hd[0], h = hd[1];
const u16 = new Uint16Array(bin.buffer.slice(bin.byteOffset + 12, bin.byteOffset + 12 + w * h * 6));
const fit = api.dcpFit(100, null);
if (dcp.gainMap && !process.env.NOGAIN) api.applyDngGainMap(u16, w, h, dcp.gainMap, api.dngGainInputMatrix(dcp, fit));
else if (!process.env.NOGAIN) console.log('(no ProfileGainTableMap parsed)');
const lut = api.bakeDcpLUT(dcp, fit, 33);
const rgba = api.applyDcpLUT(u16, w, h, lut);
if (process.env.OUT) { const px = Buffer.alloc(w * h * 3); for (let i = 0; i < w * h; i++) for (let k = 0; k < 3; k++) px[3 * i + k] = rgba[4 * i + k];
  (await import('node:fs')).writeFileSync(process.env.OUT, Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`), px])); }
const bmp = readFileSync(bmpPath), off = bmp.readUInt32LE(10), bw = bmp.readInt32LE(18), bh = bmp.readInt32LE(22), bpp = bmp.readUInt16LE(28) / 8;
const stride = Math.ceil(bw * bpp / 4) * 4;
// The decode is oriented; if the reference wasn't (dims swapped), rotate it by the DNG's Orientation
// (6 = 90 CW: display (x,y) <- stored (y, H-1-x)).
const AH = Math.abs(bh), rot = (bw === w && AH === h) ? 1 : ((dcp.gainMap && dcp.gainMap.orient) || 1);
const ref0 = (x, y) => { const yy = bh > 0 ? bh - 1 - y : y, p = off + yy * stride + x * bpp; return [bmp[p + 2], bmp[p + 1], bmp[p]]; };
const ref = (x, y) => rot === 6 ? ref0(y, AH - 1 - x) : rot === 8 ? ref0(bw - 1 - y, x) : rot === 3 ? ref0(bw - 1 - x, AH - 1 - y) : ref0(x, y);
const [rw, rh] = (rot === 6 || rot === 8) ? [AH, bw] : [bw, AH];
if (Math.abs(rw - w) > 2 || Math.abs(rh - h) > 2) { console.error(`FAIL: size mismatch ${w}x${h} vs ${rw}x${rh}`); process.exit(1); }
const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lab = ([r, g, b]) => { const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.9505, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089;
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]; };
const G = 12, m = { a: [0, 0, 0], r: [0, 0, 0] }; let dE = 0, dC = 0, n = 0;
const W = Math.min(w, rw), H = Math.min(h, rh);
for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
  const A = [0, 0, 0], R = [0, 0, 0]; let c = 0;
  for (let y = (gy * H / G) | 0; y < ((gy + 1) * H / G) | 0; y++) for (let x = (gx * W / G) | 0; x < ((gx + 1) * W / G) | 0; x++) {
    const i = 4 * (y * w + x), r = ref(x, y); for (let k = 0; k < 3; k++) { A[k] += rgba[i + k]; R[k] += r[k]; } c++; }
  const la = lab(A.map(v => v / c)), lr = lab(R.map(v => v / c));
  for (let k = 0; k < 3; k++) { m.a[k] += la[k]; m.r[k] += lr[k]; }
  dE += Math.hypot(la[0] - lr[0], la[1] - lr[1], la[2] - lr[2]); dC += Math.hypot(la[1] - lr[1], la[2] - lr[2]); n++;
}
const f = v => v.map(x => (x / n).toFixed(1)).join(',');
console.log(`app  Lab mean ${f(m.a)}\napple Lab mean ${f(m.r)}\nmean patch dE ${(dE / n).toFixed(2)}  mean chroma err ${(dC / n).toFixed(2)}`);
const ok = dC / n < 6 && dE / n < 12;
console.log(ok ? 'PASS' : 'FAIL: embedded-DNG-profile render is far from the camera maker\'s own render');
process.exit(ok ? 0 : 1);
