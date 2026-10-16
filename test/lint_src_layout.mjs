// Refactor guard (docs/plans/refactor-plan.md Phase 5): every src/* split dir must rebuild its generated
// target byte-for-byte, and no part file may grow past its ceiling (ratchet: lower a ceiling when you shrink a file).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildText, TARGETS } from '../tools/scripts/app-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CEILING = { 'src/app': 3100, 'src/library-ui': 1500, 'src/catalog': 4300, 'src/library': 1200, 'src/main-rs': 1400 }; // max lines per part
let bad = 0;
for (const cfg of TARGETS) {
  const dir = path.join(root, cfg.dir);
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const built = buildText(m, f => fs.readFileSync(path.join(dir, f), 'utf8'));
  if (built !== fs.readFileSync(path.join(root, cfg.target), 'utf8')) {
    console.error(`FAIL ${cfg.dir} does not reproduce ${cfg.target} — run node tools/scripts/app-split.mjs (target wins) or app-build.mjs (src wins)`); bad = 1;
  }
  for (const i of m.info) if (i.lines > CEILING[cfg.dir]) { console.error(`FAIL ${cfg.dir}/${i.file}: ${i.lines} lines > ${CEILING[cfg.dir]}`); bad = 1; }
  if (!bad) console.log(`ok ${cfg.dir}: ${m.parts.length} parts, max ${Math.max(...m.info.map(i => i.lines))} lines`);
}
process.exit(bad);
