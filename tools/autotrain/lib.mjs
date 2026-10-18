// Shared pieces for learning "Auto" from Lightroom: XMP label parsing, thumbnail reading (macOS sips ->
// BMP, no dependencies), image features, and a small ridge regressor. Pure Node, no installs.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Lightroom crs: setting -> Chromasmith slider. Exposure2012 is in stops, Chromasmith's exposure
// slider is stops*20. The rest are -100..100 in both. Temperature/Tint are NOT learned: Lightroom
// stores absolute Kelvin, which has no one-to-one meaning for our relative sliders.
export const LABELS = [
  { crs: 'Exposure2012', key: 'exp', scale: 20 },
  { crs: 'Highlights2012', key: 'hi', scale: 1 },
  { crs: 'Shadows2012', key: 'sh', scale: 1 },
  { crs: 'Contrast2012', key: 'con', scale: 1 },
  { crs: 'Whites2012', key: 'wh', scale: 1 },
  { crs: 'Blacks2012', key: 'bl', scale: 1 },
  { crs: 'Vibrance', key: 'vib', scale: 1 },
];

/** Reads crs:* values from an XMP packet (attribute or element form). Returns {key: sliderValue} or null. */
export function parseXmpLabels(xml) {
  const out = {}; let found = 0;
  for (const { crs, key, scale } of LABELS) {
    const m = xml.match(new RegExp(`(?:crs|dev):${crs}="([-+0-9.]+)"`)) || xml.match(new RegExp(`<(?:crs|dev):${crs}>([-+0-9.]+)</(?:crs|dev):${crs}>`));
    if (m) { out[key] = parseFloat(m[1]) * scale; found++; } else out[key] = 0; // LR omits a setting at its default of 0
  }
  // An XMP with none of the tone settings is not an edited photo — never learn "all zeros" from it.
  return found ? out : null;
}

/** Decodes an uncompressed BMP (24 or 32 bpp) into {w,h,rgb}. */
export function readBmp(buf) {
  if (buf.toString('latin1', 0, 2) !== 'BM') throw new Error('not a BMP');
  const off = buf.readUInt32LE(10), w = buf.readInt32LE(18); let h = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28), comp = buf.readUInt32LE(30);
  if ((bpp !== 24 && bpp !== 32) || (comp !== 0 && comp !== 3)) throw new Error(`unsupported BMP ${bpp}bpp comp ${comp}`);
  const topDown = h < 0; h = Math.abs(h);
  const bytes = bpp / 8, stride = Math.ceil((w * bytes) / 4) * 4, rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const row = off + (topDown ? y : h - 1 - y) * stride;
    for (let x = 0; x < w; x++) { const p = row + x * bytes; rgb.set([buf[p + 2], buf[p + 1], buf[p]], (y * w + x) * 3); }
  }
  return { w, h, rgb };
}

/** Writes a 24-bit BMP (used by the synthetic data generator). */
export function writeBmp(w, h, rgb) {
  const stride = Math.ceil((w * 3) / 4) * 4, size = 54 + stride * h, b = Buffer.alloc(size);
  b.write('BM'); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18); b.writeInt32LE(h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((h - 1 - y) * w + x) * 3, d = 54 + y * stride + x * 3; b[d] = rgb[s + 2]; b[d + 1] = rgb[s + 1]; b[d + 2] = rgb[s];
  }
  return b;
}

/** Thumbnail of any image macOS can decode (jpg/png/tiff/heic/dng/raw), longest side `size`. */
export function thumbnail(file, size = 96) {
  const dir = mkdtempSync(path.join(tmpdir(), 'autotrain-'));
  try {
    const out = path.join(dir, 't.bmp');
    execFileSync('sips', ['-Z', String(size), '-s', 'format', 'bmp', file, '--out', out], { stdio: 'ignore' });
    return readBmp(readFileSync(out));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const s2l = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const FEATURE_NAMES = ['p1', 'p5', 'p25', 'p50', 'p75', 'p95', 'p99', 'logGeo', 'std', 'chroma', 'clip', 'dark', 'rb', 'gb'];

/** Tone/colour summary statistics of an RGB thumbnail (sRGB 0..255). Order = FEATURE_NAMES. */
export function features({ w, h, rgb }) {
  const n = w * h, lum = new Float32Array(n);
  let logSum = 0, chroma = 0, r = 0, g = 0, b = 0, clip = 0, dark = 0;
  for (let i = 0; i < n; i++) {
    const R = rgb[i * 3] / 255, G = rgb[i * 3 + 1] / 255, B = rgb[i * 3 + 2] / 255;
    const l = 0.2126 * R + 0.7152 * G + 0.0722 * B; lum[i] = l;
    logSum += Math.log(0.2126 * s2l(R) + 0.7152 * s2l(G) + 0.0722 * s2l(B) + 1e-4);
    chroma += Math.max(R, G, B) - Math.min(R, G, B); r += R; g += G; b += B;
    if (l > 0.95) clip++; if (l < 0.04) dark++;
  }
  const sorted = Float32Array.from(lum).sort(), q = p => sorted[Math.min(n - 1, Math.floor(n * p))];
  let mean = 0; for (let i = 0; i < n; i++) mean += lum[i]; mean /= n;
  let v = 0; for (let i = 0; i < n; i++) v += (lum[i] - mean) ** 2;
  return [q(.01), q(.05), q(.25), q(.5), q(.75), q(.95), q(.99), logSum / n, Math.sqrt(v / n), chroma / n, clip / n, dark / n, r / (g + 1e-6), b / (g + 1e-6)];
}

// ── ridge regression (multi-output, standardised inputs) ───────────────────────────────────────
export function fitRidge(X, Y, lambda = 1.0) {
  const n = X.length, d = X[0].length, k = Y[0].length;
  const mu = Array(d).fill(0), sd = Array(d).fill(0);
  for (const x of X) x.forEach((v, j) => (mu[j] += v / n));
  for (const x of X) x.forEach((v, j) => (sd[j] += (v - mu[j]) ** 2 / n));
  sd.forEach((v, j) => (sd[j] = Math.sqrt(v) || 1));
  const Z = X.map(x => [...x.map((v, j) => (v - mu[j]) / sd[j]), 1]); // bias column last
  const D = d + 1, A = Array.from({ length: D }, () => Array(D).fill(0)), B = Array.from({ length: D }, () => Array(k).fill(0));
  for (let i = 0; i < n; i++) for (let a = 0; a < D; a++) {
    for (let c = 0; c < D; c++) A[a][c] += Z[i][a] * Z[i][c];
    for (let o = 0; o < k; o++) B[a][o] += Z[i][a] * Y[i][o];
  }
  for (let a = 0; a < d; a++) A[a][a] += lambda; // do not penalise the bias
  const W = solve(A, B);
  return { mu, sd, W }; // W: (d+1) x k
}
export function predictRidge(m, x) {
  const z = [...x.map((v, j) => (v - m.mu[j]) / m.sd[j]), 1], k = m.W[0].length, out = Array(k).fill(0);
  for (let a = 0; a < z.length; a++) for (let o = 0; o < k; o++) out[o] += z[a] * m.W[a][o];
  return out;
}
function solve(A, B) { // Gauss-Jordan with partial pivoting, B has k columns
  const n = A.length, M = A.map((r, i) => [...r, ...B[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const pv = M[c][c] || 1e-12; for (let j = c; j < M[c].length; j++) M[c][j] /= pv;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; if (f) for (let j = c; j < M[r].length; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map(r => r.slice(n));
}
