// Rebuilds generated targets from their src dirs. Usage: node tools/scripts/app-build.mjs [--check] [targetFile ...]
//   --check  exit 1 if a src dir does not reproduce its committed target
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildText, TARGETS } from './app-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const check = process.argv.includes('--check');
const want = process.argv.slice(2).filter(a => !a.startsWith('--'));
let bad = 0;
for (const cfg of TARGETS.filter(t => !want.length || want.includes(t.target))) {
  const dir = path.join(root, cfg.dir), tp = path.join(root, cfg.target);
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue;
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const built = buildText(m, f => fs.readFileSync(path.join(dir, f), 'utf8'));
  if (check) {
    if (fs.readFileSync(tp, 'utf8') !== built) { console.error(cfg.dir + ' does not reproduce ' + cfg.target); bad = 1; }
    else console.log(cfg.dir + ' reproduces ' + cfg.target + ' byte-for-byte');
  } else { fs.writeFileSync(tp, built); console.log('built', cfg.target, built.length, 'chars'); }
}
process.exit(bad);
