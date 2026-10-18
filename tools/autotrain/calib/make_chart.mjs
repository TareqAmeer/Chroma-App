#!/usr/bin/env node
// Builds a Lightroom calibration kit: ONE chart image of known pixel values plus a set of Lightroom
// presets that each move exactly one slider to a known value. Apply each preset to the chart in
// Lightroom, export as a plain JPG (edits baked in), then run analyze.mjs on the export folder.
//
//   node tools/autotrain/calib/make_chart.mjs [outDir=tools/autotrain/data/calibration]
//
// Writes: chart.png, chart_layout.json, presets/*.xmp (import via Lightroom > Presets > Import Presets)
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const out = process.argv[2] || 'tools/autotrain/data/calibration';
mkdirSync(path.join(out, 'presets'), { recursive: true });

// ── chart: 16 x 11 grid of 96px patches (1536 x 1056) ───────────────────────────────────────────
const COLS = 16, ROWS = 11, P = 96, W = COLS * P, H = ROWS * P;
const patches = []; // {name, rgb:[r,g,b]} in grid order
const hsl = (h, s, l) => { const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1))); }; return [f(0), f(8), f(4)].map(v => Math.round(v * 255)); };
// rows 0-1: 32 neutral steps (5..250), rows 2-3: 32 finer steps in the shadows and highlights
for (let i = 0; i < 32; i++) { const v = Math.round(5 + (245 * i) / 31); patches.push({ name: `gray${v}`, rgb: [v, v, v] }); }
for (let i = 0; i < 16; i++) { const v = Math.round(2 + (60 * i) / 15); patches.push({ name: `shadow${v}`, rgb: [v, v, v] }); }
for (let i = 0; i < 16; i++) { const v = Math.round(190 + (65 * i) / 15); patches.push({ name: `high${v}`, rgb: [v, v, v] }); }
// rows 4-7: 16 hues at 4 lightness levels, saturated and muted
for (const [s, l] of [[0.9, 0.3], [0.9, 0.5], [0.9, 0.7], [0.4, 0.5]]) for (let k = 0; k < 16; k++) patches.push({ name: `hue${k * 22.5}_s${s}_l${l}`, rgb: hsl(k * 22.5, s, l) });
// rows 8-9: skin-like tones (light..dark) and foliage/sky-like colours
const skin = [[255, 224, 196], [241, 194, 160], [224, 172, 138], [198, 134, 96], [160, 104, 72], [122, 78, 54], [88, 56, 40], [60, 38, 28]];
skin.forEach((c, i) => patches.push({ name: `skin${i}`, rgb: c }));
[[96, 130, 70], [60, 100, 50], [135, 170, 210], [90, 130, 190], [200, 190, 160], [140, 120, 100], [230, 120, 90], [70, 70, 90]].forEach((c, i) => patches.push({ name: `scene${i}`, rgb: c }));
// row 10: smooth ramp (not a patch): handled below; keep patch list length = 160
while (patches.length < COLS * (ROWS - 1)) patches.push({ name: 'pad', rgb: [128, 128, 128] });

const px = Buffer.alloc(W * H * 3);
for (let i = 0; i < patches.length; i++) {
  const c = i % COLS, r = Math.floor(i / COLS), [R, G, B] = patches[i].rgb;
  for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) { const o = ((r * P + y) * W + c * P + x) * 3; px[o] = R; px[o + 1] = G; px[o + 2] = B; }
}
for (let y = (ROWS - 1) * P; y < H; y++) for (let x = 0; x < W; x++) { const v = Math.round((255 * x) / (W - 1)), o = (y * W + x) * 3; px[o] = px[o + 1] = px[o + 2] = v; }

function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'latin1'); d.copy(b, 8); b.writeUInt32BE(crc32(Buffer.concat([Buffer.from(t, 'latin1'), d])) >>> 0, 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
writeFileSync(path.join(out, 'chart.png'), png(W, H, px));
writeFileSync(path.join(out, 'chart_layout.json'), JSON.stringify({ width: W, height: H, patch: P, cols: COLS, rows: ROWS, rampRow: ROWS - 1, patches }, null, 1));

// ── presets: one slider per preset ───────────────────────────────────────────────────────────────
const TESTS = [ // 18 presets: enough to read each slider's strength and direction without a marathon of exports
  ['Exposure2012', 'exposure', [-1, 1]],
  ['Contrast2012', 'contrast', [-50, 50]],
  ['Highlights2012', 'highlights', [-100, -50, 50]],
  ['Shadows2012', 'shadows', [-50, 50, 100]],
  ['Whites2012', 'whites', [-50, 50]],
  ['Blacks2012', 'blacks', [-50, 50]],
  ['Vibrance', 'vibrance', [-50, 50]],
  ['Saturation', 'saturation', [-50, 50]],
];
const fmt = (k, v) => (k === 'Exposure2012' ? (v >= 0 ? '+' : '') + v.toFixed(2) : (v >= 0 ? '+' : '') + String(v));
const presets = [];
for (const [crs, label, values] of TESTS) for (const v of values) {
  const name = `CAL ${label} ${v >= 0 ? '+' : ''}${v}`, file = `CAL_${label}_${v >= 0 ? 'p' : 'm'}${Math.abs(v)}.xmp`.replace('.', '_').replace('_xmp', '.xmp');
  const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
   xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   crs:PresetType="Normal"
   crs:Cluster=""
   crs:UUID="${randomUUID().toUpperCase()}"
   crs:SupportsAmount="False"
   crs:SupportsColor="True"
   crs:SupportsMonochrome="True"
   crs:SupportsHighDynamicRange="True"
   crs:SupportsNormalDynamicRange="True"
   crs:SupportsSceneReferred="True"
   crs:SupportsOutputReferred="True"
   crs:CameraModelRestriction=""
   crs:Copyright=""
   crs:ContactInfo=""
   crs:Version="15.4"
   crs:ProcessVersion="15.4"
   crs:${crs}="${fmt(crs, v)}">
   <crs:Name><rdf:Alt><rdf:li xml:lang="x-default">${name}</rdf:li></rdf:Alt></crs:Name>
   <crs:ShortName><rdf:Alt><rdf:li xml:lang="x-default"/></rdf:Alt></crs:ShortName>
   <crs:SortName><rdf:Alt><rdf:li xml:lang="x-default"/></rdf:Alt></crs:SortName>
   <crs:Group><rdf:Alt><rdf:li xml:lang="x-default">Calibration</rdf:li></rdf:Alt></crs:Group>
   <crs:Description><rdf:Alt><rdf:li xml:lang="x-default"/></rdf:Alt></crs:Description>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`;
  writeFileSync(path.join(out, 'presets', file), xml); presets.push(name);
}
console.log(`wrote ${out}/chart.png (${W}x${H}), chart_layout.json, ${presets.length} presets in ${out}/presets/`);
