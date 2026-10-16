// Splits generated targets into their src dirs (see app-lib.mjs TARGETS).
// Usage: node tools/scripts/app-split.mjs [targetFile ...]   (default: all)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitText, TARGETS } from './app-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const want = process.argv.slice(2);
for (const cfg of TARGETS.filter(t => !want.length || want.includes(t.target))) {
  const OUT = path.join(root, cfg.dir);
  const { files } = splitText(fs.readFileSync(path.join(root, cfg.target), 'utf8'), cfg);
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const [n, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(OUT, n)), { recursive: true }); fs.writeFileSync(path.join(OUT, n), c); }
  console.log(cfg.target, '->', cfg.dir, Object.keys(files).length - 1, 'parts');
}
