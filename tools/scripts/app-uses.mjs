// "What uses X?" — definitions and references of an identifier across the src/ section files, grouped by
// file, so a change's blast radius is visible before editing. Reads the committed parts, no build needed.
// Usage: node tools/scripts/app-uses.mjs <identifier> [--lines] [--all]
//   --lines  list every referencing line (default: per-file counts + first hit)
//   --all    also search desktop/*.js, test/ and tools/ (callers outside the web app)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const name = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!name || !/^[\w$]+$/.test(name)) { console.error('usage: app-uses.mjs <identifier> [--lines] [--all]'); process.exit(2); }
const showLines = process.argv.includes('--lines');
const esc = name.replace(/\$/g, '\\$');
const re = new RegExp('(?<![\\w$])' + esc + '(?![\\w$])');
const defRe = new RegExp('^\\s*(?:async\\s+)?(?:function\\*?\\s+' + esc + '\\b|(?:const|let|var|class)\\s+' + esc + '\\b)');

const dirs = ['src/app', 'src/library-ui'];
if (process.argv.includes('--all')) dirs.push('test', 'tools', 'desktop/desktop-native.js', 'desktop/header-menus.js');
const files = execFileSync('git', ['ls-files', '--', ...dirs], { cwd: root }).toString().split('\n')
  .filter(f => f && /\.(part|html|m?js)$/.test(f) && !f.endsWith('manifest.json') && !f.startsWith('src/app/manifest'));

const defs = [], uses = new Map();
for (const f of files) {
  let text; try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
  if (!text.includes(name)) continue;
  text.split('\n').forEach((l, i) => {
    if (l.length > 2000 || !re.test(l)) return;
    if (defRe.test(l)) defs.push(`${f}:${i + 1}  ${l.trim().slice(0, 100)}`);
    else { if (!uses.has(f)) uses.set(f, []); uses.get(f).push([i + 1, l.trim().slice(0, 110)]); }
  });
}
console.log(`# ${name}\n\ndefined (${defs.length}):`);
defs.forEach(d => console.log('  ' + d));
const total = [...uses.values()].reduce((s, a) => s + a.length, 0);
console.log(`\nreferenced ${total}x in ${uses.size} file(s):`);
for (const [f, a] of [...uses].sort((x, y) => y[1].length - x[1].length)) {
  console.log(`  ${String(a.length).padStart(4)}  ${f}`);
  if (showLines) a.forEach(([n, t]) => console.log(`        ${n}: ${t}`)); else console.log(`        first: ${a[0][0]}: ${a[0][1]}`);
}
if (!defs.length && !total) console.log('  (no matches — check spelling; object methods and DOM ids are not identifiers)');
