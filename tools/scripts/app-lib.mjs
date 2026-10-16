// Shared split/build logic for chromasmith-22.html <-> src/app/ (docs/plans/refactor-plan.md, Phase 1).
export const TARGET = 'chromasmith-22.html';
export const DIR = 'src/app';
const BIG = 2000; // script segments longer than this are cut at section headers

// text -> { files: {name: content}, manifest }  (lossless: join(parts, '\n') === text)
export function splitText(text) {
  const lines = text.split('\n');
  const segs = [];
  let start = 0, inScript = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!inScript && /^<script(\s[^>]*)?>/.test(l)) {
      if (i > start) segs.push({ kind: 'html', from: start, to: i });
      start = i;
      if (/<\/script>\s*$/.test(l)) { segs.push({ kind: 'script', from: i, to: i + 1 }); start = i + 1; }
      else inScript = true;
    } else if (inScript && /<\/script>\s*$/.test(l)) {
      segs.push({ kind: 'script', from: start, to: i + 1 }); start = i + 1; inScript = false;
    }
  }
  if (start < lines.length) segs.push({ kind: 'html', from: start, to: lines.length });
  const files = {}, info = [], used = new Set();
  const add = (name, kind, from, to) => {
    files[name] = lines.slice(from, to).join('\n');
    info.push({ file: name, kind, firstLine: from + 1, lines: to - from });
  };
  segs.forEach((s, i) => {
    const base = String(i).padStart(2, '0') + '-' + s.kind;
    const ext = s.kind === 'script' ? '.js.html' : '.html';
    if (s.kind !== 'script' || s.to - s.from < BIG) return add(base + ext, s.kind, s.from, s.to);
    // Big script: cut at every column-0 "// ── " section header. Pure text cuts (parts re-join with
    // "\n"), named by header slug so adding/removing a section doesn't rename its neighbours.
    const cuts = [s.from];
    for (let n = s.from + 1; n < s.to; n++) if (lines[n].startsWith('// ── ')) cuts.push(n);
    cuts.push(s.to);
    cuts.forEach((from, k) => {
      if (k === cuts.length - 1) return;
      let slug = k === 0 ? 'head' : lines[from].slice(6).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'section';
      let name = base + '--' + slug + ext, d = 2;
      while (used.has(name)) name = base + '--' + slug + '-' + d++ + ext;
      used.add(name);
      add(name, 'script', from, cuts[k + 1]);
    });
  });
  const manifest = { target: TARGET, join: '\n', parts: info.map(m => m.file), info };
  files['manifest.json'] = JSON.stringify(manifest, null, 1) + '\n';
  return { files, manifest };
}

// (manifest, readPart(name)) -> text
export function buildText(manifest, readPart) {
  return manifest.parts.map(readPart).join(manifest.join);
}
