// Shared split/build logic for chromasmith-22.html <-> src/app/ (docs/plans/refactor-plan.md, Phase 1).
// Each target is a committed generated file with a src dir that can be edited instead (two-way sync, app-sync.mjs).
export const TARGETS = [
  { target: 'chromasmith-22.html', dir: 'src/app', mode: 'html' },
  { target: 'desktop/library-ui.js', dir: 'src/library-ui', mode: 'text', cutRe: /^ {0,2}\/\/ ── / },
  { target: 'desktop/src-tauri/src/catalog.rs', dir: 'src/catalog', mode: 'text', cutRe: /^\/\/ ── / },
  { target: 'desktop/src-tauri/src/library.rs', dir: 'src/library', mode: 'text', cutRe: /^\/\/ ── / },
  { target: 'desktop/src-tauri/src/main.rs', dir: 'src/main-rs', mode: 'text', cutRe: /^\/\/ ── / },
];
const TARGET = 'chromasmith-22.html';
// Domain folders for the cut sections of the big script, by header-slug regex (first match wins; default "editor").
// Pure layout: order of parts is in manifest.json, so this never changes the built file.
const DOMAINS = [
  ['masks', /mask|brush|coat|retouch|selective|eyedropper|pointer-photo/],
  ['subjects-ai', /subject|face|eye-detect|depth|skin|ai-brush|taught|scan-every|confirm-reject|small-client|film-negative/],
  ['color-raw', /dcp|raw|icc|oklab|prophoto|hlg|lut|calibrated|halation|built-in-preset|auto-enhance|wb-|hue-pop|panasonic|a19|gamut|c4-|auto-seed/],
  ['export-io', /export|dpi|splice|exif|metadata|native-save|capacitor|google-photos|pkce|import|upload|plain-export|tauri/],
  ['history-presets', /history|versions|copy-on-write|session|b2-|b3-|chr-197|chr-203|styles|all-fx|named-export|presets|b1-/],
  ['shell-ui', /theme|layout|deskx|sheet|live-fit|command-palette|accessib|first-timer|about|app-height|fx-editor|slider|workspace|a15|a18/],
];
const domainOf = slug => (DOMAINS.find(([, re]) => re.test(slug)) || ['editor'])[0];
const BIG = 2000; // script segments longer than this are cut at section headers

// text -> { files: {name: content}, manifest }  (lossless: join(parts, '\n') === text)
const slugOf = l => l.replace(/^\s*\/\/ ── /, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'section';

// Generic text target: cut at every line matching cfg.cutRe; parts re-join with "\n".
function splitPlain(text, cfg) {
  const lines = text.split('\n'), cuts = [0];
  for (let n = 1; n < lines.length; n++) if (cfg.cutRe.test(lines[n])) cuts.push(n);
  cuts.push(lines.length);
  const files = {}, info = [], used = new Set();
  for (let k = 0; k < cuts.length - 1; k++) {
    let base = k === 0 ? 'head' : slugOf(lines[cuts[k]]), name = base + '.part', d = 2;
    while (used.has(name)) name = base + '-' + d++ + '.part';
    used.add(name);
    files[name] = lines.slice(cuts[k], cuts[k + 1]).join('\n');
    info.push({ file: name, firstLine: cuts[k] + 1, lines: cuts[k + 1] - cuts[k] });
  }
  const manifest = { target: cfg.target, join: '\n', parts: info.map(m => m.file), info };
  files['manifest.json'] = JSON.stringify(manifest, null, 1) + '\n';
  return { files, manifest };
}

export function splitText(text, cfg = TARGETS[0]) {
  if (cfg.mode === 'text') return splitPlain(text, cfg);
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
      let name = base + '/' + (k === 0 ? 'head' : domainOf(slug) + '/' + slug) + ext, d = 2;
      while (used.has(name)) name = base + '/' + (k === 0 ? 'head' : domainOf(slug) + '/' + slug) + '-' + d++ + ext;
      used.add(name);
      add(name, 'script', from, cuts[k + 1]);
    });
  });
  const manifest = { target: cfg.target, join: '\n', parts: info.map(m => m.file), info };
  files['manifest.json'] = JSON.stringify(manifest, null, 1) + '\n';
  return { files, manifest };
}

// (manifest, readPart(name)) -> text
export function buildText(manifest, readPart) {
  return manifest.parts.map(readPart).join(manifest.join);
}
