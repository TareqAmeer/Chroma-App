// Splits chromasmith-22.html into src/app/ (see app-lib.mjs). Usage: node tools/scripts/app-split.mjs [--out dir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitText, TARGET, DIR } from './app-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const oi = process.argv.indexOf('--out');
const OUT = oi > 0 ? path.resolve(process.argv[oi + 1]) : path.join(root, DIR);
const { files } = splitText(fs.readFileSync(path.join(root, TARGET), 'utf8'));
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(OUT, n), c);
console.log(Object.keys(files).length - 1, 'segments ->', path.relative(root, OUT));
