// Pre-commit two-way sync between chromasmith-22.html and src/app/, done on the INDEX so other
// sessions' unstaged edits are never staged (same approach as bump-build.py).
//   base = HEAD's html. If only the staged html changed -> re-split into src/app.
//   If only staged src/app changed -> rebuild html. Both changed and disagree -> exit 1.
// Working-tree files are refreshed only when they carry no unstaged edits.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { splitText, buildText, TARGETS } from './app-lib.mjs';

const git = (args, input) => execFileSync('git', args, { input, maxBuffer: 1 << 30 });
const show = ref => { try { return git(['show', ref]).toString('utf8'); } catch { return null; } };
const stagedList = DIR => git(['ls-files', '--', DIR]).toString().split('\n').filter(Boolean);
const mode = p => git(['ls-files', '-s', '--', p]).toString().split(/\s/)[0] || '100644';
const clean = p => { try { git(['diff', '--quiet', '--', p]); return true; } catch { return false; } };
const put = (p, content) => {
  const blob = git(['hash-object', '-w', '--stdin'], Buffer.from(content, 'utf8')).toString().trim();
  git(['update-index', '--add', '--cacheinfo', `${mode(p)},${blob},${p}`]);
};

let failed = false;
function syncOne(cfg) {
  const { target: TARGET, dir: DIR } = cfg;
  const files = stagedList(DIR);
  const headHtml = show('HEAD:' + TARGET);
  const stagedHtml = show(':' + TARGET);
  if (headHtml === null || stagedHtml === null) return;
  if (!files.includes(DIR + '/manifest.json')) { // first commit of src/app: seed from html
    const { files: f } = splitText(stagedHtml, cfg); for (const [n, c] of Object.entries(f)) put(`${DIR}/${n}`, c);
    console.log('app-sync: seeded src/app'); return;
  }
  const manifest = JSON.parse(show(`:${DIR}/manifest.json`));
  const built = buildText(manifest, n => show(`:${DIR}/${n}`));
  if (built === stagedHtml) return;

  let htmlChanged = stagedHtml !== headHtml, srcChanged = built !== headHtml;
  if (htmlChanged && srcChanged) {
    console.error('BLOCKED: staged chromasmith-22.html and src/app disagree and both differ from HEAD.\n' +
      'Edit one side only, or run `node tools/scripts/app-split.mjs` (html wins) / `node tools/scripts/app-build.mjs` (src wins), re-stage, and retry.');
    { failed = true; return; };
  }
  if (htmlChanged) { // html is the edited side -> refresh src/app
    const { files: f } = splitText(stagedHtml, cfg);
    const wasClean = Object.fromEntries(Object.keys(f).map(n => [n, clean(`${DIR}/${n}`)]));
    for (const p of files) if (!(p.slice(DIR.length + 1) in f)) git(['update-index', '--force-remove', '--', p]);
    for (const [n, c] of Object.entries(f)) put(`${DIR}/${n}`, c);
    for (const [n, c] of Object.entries(f)) if (wasClean[n]) { fs.mkdirSync(`${DIR}/${n}`.replace(/\/[^/]*$/, ''), { recursive: true }); fs.writeFileSync(`${DIR}/${n}`, c); }
    console.log('app-sync: target edited -> src refreshed');
  } else { // src edited -> rebuild html
    const wasClean = clean(TARGET);
    put(TARGET, built);
    if (wasClean) fs.writeFileSync(TARGET, built);
    console.log('app-sync: src edited -> target rebuilt');
  }

}
TARGETS.forEach(syncOne);
process.exit(failed ? 1 : 0);
