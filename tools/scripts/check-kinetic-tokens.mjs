// Completeness scan for the Swiss Kinetic token freeze: every leaf of
// design/prototypes/swiss-kinetic/approved.json (dark + light) must map to exactly one
// design/tokens.json `kinetic` token with the same value, emitted once in TOKENS:ROOT (dark)
// and once in TOKENS:BODYLIGHT (light); no kinetic token may exist without an approved path.
import { readFileSync } from 'fs';
const A = JSON.parse(readFileSync('design/prototypes/swiss-kinetic/approved.json', 'utf8'));
const T = JSON.parse(readFileSync('design/tokens.json', 'utf8'));
const html = readFileSync('chromasmith-22.html', 'utf8');
const fmt = v => Array.isArray(v) ? `cubic-bezier(${v.join(',')})` : String(v);
function* leaves(o, p = []) {
  if (o && typeof o === 'object') {
    if ('$value' in o) { yield [p.join('.'), fmt(o.$value)]; return; }
    for (const [k, v] of Object.entries(o)) if (k !== '$type') yield* leaves(v, [...p, k]);
  } else yield [p.join('.'), fmt(o)];
}
const toks = [];
(function walk(o) { if (o && typeof o === 'object') { const e = o.$extensions?.chromasmith; if (e?.appVar) toks.push(e); else for (const v of Object.values(o)) walk(v); } })(T.kinetic);
const region = n => { const a = html.indexOf(`/* TOKENS:${n}:START`), b = html.indexOf(`/* TOKENS:${n}:END */`); return html.slice(a, b); };
const blocks = { dark: region('ROOT'), light: region('BODYLIGHT') };
const errs = [], ok = { dark: 0, light: 0 };
for (const mode of ['dark', 'light']) {
  for (const [path, val] of leaves(A[mode])) {
    const m = toks.filter(t => t.approvedPath === path);
    if (m.length !== 1) { errs.push(`${mode} ${path}: ${m.length} tokens`); continue; }
    if (m[0].modes[mode] !== val) { errs.push(`${mode} ${path}: token ${m[0].modes[mode]} != approved ${val}`); continue; }
    const hits = blocks[mode].split(`${m[0].appVar}:`).length - 1;
    const emitted = blocks[mode].includes(`${m[0].appVar}:${val}`);
    if (hits !== 1 || !emitted) { errs.push(`${mode} ${path}: ${m[0].appVar} emitted ${hits}x${emitted ? '' : ', wrong value'}`); continue; }
    ok[mode]++;
  }
}
const approved = new Set([...leaves(A.dark)].map(([p]) => p));
const extra = toks.filter(t => !approved.has(t.approvedPath));
extra.forEach(t => errs.push(`extra token ${t.appVar} (${t.approvedPath})`));
const total = approved.size;
console.log(`kinetic tokens: dark ${ok.dark}/${total}, light ${ok.light}/${total}, extra ${extra.length}`);
if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
