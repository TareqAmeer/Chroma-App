// Shared split/build logic for chromasmith-22.html <-> src/app/ (docs/plans/refactor-plan.md, Phase 1).
export const TARGET = 'chromasmith-22.html';
export const DIR = 'src/app';

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
  const files = {}, info = [];
  segs.forEach((s, i) => {
    const name = String(i).padStart(2, '0') + '-' + s.kind + (s.kind === 'script' ? '.js.html' : '.html');
    files[name] = lines.slice(s.from, s.to).join('\n');
    info.push({ file: name, kind: s.kind, firstLine: s.from + 1, lines: s.to - s.from });
  });
  const manifest = { target: TARGET, join: '\n', parts: info.map(m => m.file), info };
  files['manifest.json'] = JSON.stringify(manifest, null, 1) + '\n';
  return { files, manifest };
}

// (manifest, readPart(name)) -> text
export function buildText(manifest, readPart) {
  return manifest.parts.map(readPart).join(manifest.join);
}
