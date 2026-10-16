// Reassembles chromasmith-22.html from src/app/. Usage: node tools/scripts/app-build.mjs [--check] [--out file]
//   --check  exit 1 if src/app does not reproduce the committed chromasmith-22.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildText, DIR } from './app-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, DIR);
const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const built = buildText(m, f => fs.readFileSync(path.join(dir, f), 'utf8'));
const target = path.join(root, m.target);
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== built) { console.error('src/app does not reproduce ' + m.target); process.exit(1); }
  console.log('src/app reproduces ' + m.target + ' byte-for-byte'); process.exit(0);
}
const oi = process.argv.indexOf('--out');
fs.writeFileSync(oi > 0 ? path.resolve(process.argv[oi + 1]) : target, built);
console.log('built', built.length, 'chars');
