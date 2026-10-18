#!/usr/bin/env node
// Generates a SYNTHETIC "Lightroom-edited" folder to test the pipeline mechanics end to end
// (XMP parsing, thumbnails, features, training, comparison). The labels come from a made-up rule,
// NOT from Adobe, so results say nothing about real Auto quality — they only prove the plumbing.
//
//   node tools/autotrain/synth.mjs <outFolder> [count=120]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { writeBmp } from './lib.mjs';

const out = process.argv[2], count = parseInt(process.argv[3] || '120', 10);
if (!out) { console.error('usage: synth.mjs <outFolder> [count]'); process.exit(2); }
mkdirSync(out, { recursive: true });
let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

for (let n = 0; n < count; n++) {
  const w = 160, h = 120, base = 25 + rnd() * 190, spread = 20 + rnd() * 140, tint = [rnd() * 30 - 15, rnd() * 20 - 10, rnd() * 30 - 15];
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = base + spread * ((x / w) * 0.7 + (y / h) * 0.3 - 0.5) + (rnd() - 0.5) * 8;
    for (let c = 0; c < 3; c++) rgb[(y * w + x) * 3 + c] = Math.max(0, Math.min(255, v + tint[c]));
  }
  // The made-up "editor": brighten dark images, pull highlights on bright ones, add contrast to flat ones.
  const exposure = Math.max(-2, Math.min(2, (128 - base) / 70)), contrast = Math.round(Math.max(-30, Math.min(40, (110 - spread) * 0.5)));
  const highlights = Math.round(base + spread / 2 > 215 ? -50 : -5), shadows = Math.round(base - spread / 2 < 40 ? 45 : 5);
  const name = `img_${String(n).padStart(4, '0')}`;
  writeFileSync(path.join(out, name + '.bmp'), writeBmp(w, h, rgb));
  writeFileSync(path.join(out, name + '.xmp'),
    `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:Exposure2012="${exposure.toFixed(2)}" crs:Contrast2012="${contrast}" crs:Highlights2012="${highlights}" crs:Shadows2012="${shadows}" crs:Whites2012="0" crs:Blacks2012="0" crs:Vibrance="0"/></rdf:RDF></x:xmpmeta>`);
}
// one un-edited photo (no tone settings) that collect.mjs must skip, not learn as zeros
writeFileSync(path.join(out, 'unedited.bmp'), writeBmp(8, 8, new Uint8Array(8 * 8 * 3).fill(120)));
writeFileSync(path.join(out, 'unedited.xmp'), '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:Rating="3"/></rdf:RDF></x:xmpmeta>');
console.log(`wrote ${count} synthetic edited photos (+1 unedited) to ${out}`);
