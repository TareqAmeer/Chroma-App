// Reassembles chromasmith-22.html from src/app/ (see app-split.mjs).
// Usage: node tools/scripts/app-build.mjs [--check] [--out file]
//   --check  build in memory, exit 1 if it differs from the committed chromasmith-22.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'src/app');
const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const built = m.parts.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join(m.join);
const target = path.join(root, m.target);
if (process.argv.includes('--check')) {
  const cur = fs.readFileSync(target, 'utf8');
  if (cur !== built) { console.error('src/app does not reproduce ' + m.target + ' (' + cur.length + ' vs ' + built.length + ' chars)'); process.exit(1); }
  console.log('src/app reproduces ' + m.target + ' byte-for-byte'); process.exit(0);
}
const oi = process.argv.indexOf('--out');
fs.writeFileSync(oi > 0 ? path.resolve(process.argv[oi + 1]) : target, built);
console.log('built', built.length, 'chars');
