// Phase 1 of docs/plans/refactor-plan.md. Splits chromasmith-22.html into src/app/ segments
// (markup/CSS chunks and one file per <script> block) + manifest.json (order). Lossless:
// app-build.mjs reassembles the identical bytes.
// Usage: node tools/scripts/app-split.mjs [--out dir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : path.join(root, 'src/app');
const text = fs.readFileSync(path.join(root, 'chromasmith-22.html'), 'utf8');
const lines = text.split('\n');

// Cut points: a segment starts at each line beginning "<script" and the following segment starts
// on the line after the one that closes it.
const segs = [];
let start = 0, inScript = false;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (!inScript && /^<script(\s[^>]*)?>/.test(l)) {
    if (i > start) segs.push({ kind: 'html', from: start, to: i });
    start = i;
    if (/<\/script>\s*$/.test(l)) { segs.push({ kind: 'script', from: i, to: i + 1 }); start = i + 1; }
    else inScript = true;
  } else if (inScript && /<\/script>\s*$/.test(l)) {
    segs.push({ kind: 'script', from: start, to: i + 1 }); start = i + 1; inScript = false;
  }
}
if (start < lines.length) segs.push({ kind: 'html', from: start, to: lines.length });

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const manifest = [];
segs.forEach((s, i) => {
  const name = String(i).padStart(2, '0') + '-' + s.kind + (s.kind === 'script' ? '.js.html' : '.html');
  fs.writeFileSync(path.join(OUT, name), lines.slice(s.from, s.to).join('\n'));
  manifest.push({ file: name, kind: s.kind, firstLine: s.from + 1, lines: s.to - s.from });
});
// Segments are joined with "\n"; the split above puts every "\n" between two segments.
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ target: 'chromasmith-22.html', join: '\n', parts: manifest.map(m => m.file), info: manifest }, null, 1) + '\n');
console.log(segs.length, 'segments ->', path.relative(root, OUT));
