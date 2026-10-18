#!/usr/bin/env node
// Build a training set from Lightroom "Auto" results.
//
// In Lightroom Classic: select a batch of YOUR OWN photos, press Auto (Library: Cmd+U / Develop: Auto),
// then Metadata > Save Metadata to Files (Cmd+S) so each photo gets its .xmp sidecar (DNG/JPEG/TIFF with
// embedded XMP are read from the file itself). Then:
//
//   node tools/autotrain/collect.mjs <folder> [--out tools/autotrain/data/dataset.json]
//
// Photos with no tone settings in their XMP are skipped and counted (never learned as "all zeros").
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseXmpLabels, thumbnail, features, LABELS, FEATURE_NAMES } from './lib.mjs';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : 'tools/autotrain/data/dataset.json';
const root = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
if (!root) { console.error('usage: collect.mjs <folder> [--out file.json]'); process.exit(2); }

const IMG = /\.(jpe?g|png|bmp|tiff?|dng|heic|cr2|cr3|nef|arw|rw2|orf|raf)$/i;
const walk = d => readdirSync(d).flatMap(n => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

function xmpFor(file) {
  const side = file.replace(/\.[^.]+$/, '.xmp');
  if (existsSync(side)) return readFileSync(side, 'utf8');
  if (/\.(jpe?g|tiff?|dng)$/i.test(file)) { // embedded packet
    const s = readFileSync(file).toString('latin1'), i = s.indexOf('<x:xmpmeta'), j = s.indexOf('</x:xmpmeta>');
    if (i >= 0 && j > i) return s.slice(i, j + 12);
  }
  return null;
}

const rows = []; const skipped = { noXmp: 0, noTone: 0, unreadable: 0 };
for (const file of walk(root).filter(f => IMG.test(f))) {
  const xml = xmpFor(file);
  if (!xml) { skipped.noXmp++; continue; }
  const y = parseXmpLabels(xml);
  if (!y) { skipped.noTone++; continue; }
  try {
    const t = thumbnail(file);
    rows.push({ file: path.relative(root, file), x: features(t), y: LABELS.map(l => y[l.key]), w: t.w, h: t.h, rgb: Buffer.from(t.rgb).toString('base64') });
  } catch (e) { skipped.unreadable++; console.error(`skip ${file}: ${e.message}`); }
}
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ featureNames: FEATURE_NAMES, labels: LABELS.map(l => l.key), rows }));
console.log(`collected ${rows.length} photos -> ${out}  (skipped: ${skipped.noXmp} no XMP, ${skipped.noTone} no tone settings, ${skipped.unreadable} unreadable)`);
