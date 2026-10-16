// Phase 0 of docs/plans/refactor-plan.md: inventory of chromasmith-22.html script blocks,
// top-level declarations, and cross-block references. Output: docs/plans/app-map.json
// Usage: node tools/scripts/app-map.mjs [--check]   (--check fails if the committed map is stale)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(root, 'chromasmith-22.html');
const OUT = path.join(root, 'docs/plans/app-map.json');
const MAXLINE = 2000; // skip base64/data lines

const lines = fs.readFileSync(SRC, 'utf8').split('\n');
const blocks = [];
let cur = null;
lines.forEach((l, i) => {
  const n = i + 1;
  if (!cur) {
    const m = /^<script(\s[^>]*)?>/.exec(l);
    if (m) {
      cur = { start: n, external: /\ssrc=/.test(m[1] || ''), decls: [] };
      if (/<\/script>/.test(l)) { cur.end = n; blocks.push(cur); cur = null; }
    }
    return;
  }
  if (/^\s*<\/script>/.test(l) || (l.length < MAXLINE && /<\/script>\s*$/.test(l))) {
    cur.end = n; blocks.push(cur); cur = null; return;
  }
  if (l.length >= MAXLINE) return;
  let m = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(l);
  if (m) { cur.decls.push({ name: m[1], kind: 'function', line: n }); return; }
  m = /^(const|let|var|class)\s+([A-Za-z_$][\w$]*)/.exec(l);
  if (m) cur.decls.push({ name: m[2], kind: m[1], line: n });
});

// Declaration -> owning block; skip vendored libs (pako/utif2) when counting references.
const owner = new Map();
blocks.forEach((b, bi) => b.decls.forEach(d => { if (!owner.has(d.name)) owner.set(d.name, bi); }));

// Cross-block references: identifiers in block X naming a decl owned by block Y.
const names = [...owner.keys()].filter(n => n.length > 2);
const re = new RegExp('(?<![\\w$.])(' + names.map(n => n.replace(/\$/g, '\\$')).join('|') + ')(?![\\w$])', 'g');
const edges = {};
blocks.forEach((b, bi) => {
  for (let n = b.start; n <= b.end; n++) {
    const l = lines[n - 1];
    if (l.length >= MAXLINE) continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(l))) {
      const o = owner.get(m[1]);
      if (o !== bi) { const k = bi + '->' + o; edges[k] = (edges[k] || 0) + 1; }
    }
  }
});

const map = {
  source: 'chromasmith-22.html',
  totalLines: lines.length,
  blocks: blocks.map((b, i) => ({
    index: i, start: b.start, end: b.end, lines: b.end - b.start + 1, external: b.external,
    declCount: b.decls.length, decls: b.decls,
  })),
  crossBlockReferences: Object.entries(edges).map(([k, count]) => {
    const [from, to] = k.split('->').map(Number); return { from, to, count };
  }).sort((a, b) => b.count - a.count),
  totals: {
    blocks: blocks.length,
    functions: blocks.reduce((s, b) => s + b.decls.filter(d => d.kind === 'function').length, 0),
    declarations: blocks.reduce((s, b) => s + b.decls.length, 0),
  },
};
const text = JSON.stringify(map, null, 1) + '\n';
if (process.argv.includes('--check')) {
  const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  if (!old || JSON.stringify(old.totals) !== JSON.stringify(map.totals) || old.totalLines !== map.totalLines) {
    console.error('app-map.json is stale — run node tools/scripts/app-map.mjs'); process.exit(1);
  }
  console.log('app-map.json up to date'); process.exit(0);
}
fs.writeFileSync(OUT, text);
console.log(JSON.stringify(map.totals), 'lines', map.totalLines, '->', path.relative(root, OUT));
