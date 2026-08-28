#!/usr/bin/env node
// Guards the format-extension registry against exactly the drift class that used to exist here:
// the RAW extension list was duplicated in 8 separate places across chromasmith-22.html and the
// desktop Rust code before formats.rs consolidated it into one source of truth (see that file's
// doc comment). Two checks:
//
//   1. chromasmith-22.html's FMT_RAW/FMT_STILL_NATIVE/FMT_STILL_TIFF/FMT_STILL_RUST arrays must
//      set-match desktop/src-tauri/src/formats.rs's RAW_EXTS/STILL_NATIVE_EXTS/STILL_TIFF_EXTS/
//      STILL_RUST_EXTS. (formats.rs's own #[cfg(test)] matches_html_registry does the same
//      comparison from the Rust side — this is the JS-side half, run in `npm test`, not `cargo
//      test`, so a JS-only change is caught without needing a Rust build.)
//   2. No tracked source file outside formats.rs re-introduces a hardcoded RAW-extension literal
//      (a `/\.(rw2|...` regex, or a `"rw2"` sitting next to `"cr3"` in a match/array) — the
//      pattern every one of the 8 original duplicates took.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = false;

function parseJsArray(src, constName) {
  const needle = `const ${constName} = [`;
  const start = src.indexOf(needle);
  if (start === -1) return null;
  const after = src.slice(start + needle.length);
  const end = after.indexOf(']');
  const body = after.slice(0, end);
  return new Set(
    body.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).map(s => s.toLowerCase())
  );
}

function parseRustArray(src, constName) {
  const needle = `pub const ${constName}: &[&str] = &[`;
  const start = src.indexOf(needle);
  if (start === -1) return null;
  const after = src.slice(start + needle.length);
  const end = after.indexOf('];');
  const body = after.slice(0, end);
  return new Set(
    body.split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean).map(s => s.toLowerCase())
  );
}

function diffReport(name, jsSet, rustSet) {
  if (!jsSet) return [`${name}: could not find it in chromasmith-22.html (did the registry move?)`];
  if (!rustSet) return [`${name}: could not find its Rust mirror in formats.rs (did it get renamed?)`];
  const missingFromRust = [...jsSet].filter(x => !rustSet.has(x));
  const missingFromJs = [...rustSet].filter(x => !jsSet.has(x));
  const lines = [];
  if (missingFromRust.length) lines.push(`${name}: in HTML, not formats.rs: ${missingFromRust.join(', ')}`);
  if (missingFromJs.length) lines.push(`${name}: in formats.rs, not HTML: ${missingFromJs.join(', ')}`);
  return lines;
}

const html = await readFile(path.join(ROOT, 'chromasmith-22.html'), 'utf8');
const formatsRs = await readFile(path.join(ROOT, 'desktop/src-tauri/src/formats.rs'), 'utf8');

const pairs = [
  ['FMT_RAW', 'RAW_EXTS'],
  ['FMT_STILL_NATIVE', 'STILL_NATIVE_EXTS'],
  ['FMT_STILL_TIFF', 'STILL_TIFF_EXTS'],
  ['FMT_STILL_RUST', 'STILL_RUST_EXTS'],
];
const diffLines = [];
for (const [jsName, rustName] of pairs) {
  diffLines.push(...diffReport(jsName, parseJsArray(html, jsName), parseRustArray(formatsRs, rustName)));
}
if (diffLines.length) {
  console.error('✗ format registry drift between chromasmith-22.html and formats.rs:');
  for (const l of diffLines) console.error('  ' + l);
  failed = true;
} else {
  console.log('✓ format registry (RAW/STILL_NATIVE/STILL_TIFF/STILL_RUST) matches between chromasmith-22.html and formats.rs');
}

// ── No re-duplication elsewhere ─────────────────────────────────────────────────────────────
// A representative pair from the RAW list that only ever co-occurred in the 8 original
// duplicates — if these two extensions appear adjacent to each other outside formats.rs and
// the html registry itself, someone hardcoded the list again instead of calling into formats.rs.
const DUPLICATE_MARKER = /["']rw2["']\s*[,|]\s*["']raw["']\s*[,|]\s*["']dng["']/;
const SKIP_DIRS = new Set(['node_modules', 'target', '.git', 'dist', 'www', 'Pods', 'build']);
const SKIP_FILES = new Set(['chromasmith-22.html', 'formats.rs', 'lint_formats.mjs']);
const SCAN_ROOTS = ['desktop', 'chromasmith-22.html', 'test'];

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // dir doesn't exist (e.g. SCAN_ROOTS entry is a bare file) — handled by caller
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(js|mjs|rs|html)$/.test(e.name)) yield p;
  }
}

const offenders = [];
for (const root of SCAN_ROOTS) {
  const abs = path.join(ROOT, root);
  const isFile = /\.(js|mjs|rs|html)$/.test(root);
  const files = isFile ? [abs] : [];
  if (!isFile) for await (const f of walk(abs)) files.push(f);
  for (const f of files) {
    const base = path.basename(f);
    if (SKIP_FILES.has(base)) continue;
    const src = await readFile(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (DUPLICATE_MARKER.test(line)) offenders.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
    });
  }
}
if (offenders.length) {
  console.error('✗ a RAW-extension list appears to be duplicated outside formats.rs:');
  for (const o of offenders) console.error('  ' + o);
  console.error('  Use crate::formats::* (Rust) or the FMT_* registry (chromasmith-22.html) instead.');
  failed = true;
} else {
  console.log('✓ no re-duplicated RAW-extension list found outside formats.rs / the HTML registry');
}

// ── The file picker's accept= must not hardcode a list either (see §5b of the format-widening
// work) — it's rebuilt from FMT_ALL at DOMContentLoaded, so the static attribute should be bare.
if (/accept="image\/\*,\.tif,\.tiff,\.rw2,\.raw"/.test(html)) {
  console.error('✗ #in-fx-img still has a hardcoded accept= list — should be accept="image/*" (rebuilt at runtime from FMT_ALL)');
  failed = true;
} else {
  console.log('✓ #in-fx-img accept= is not a hardcoded extension list');
}

process.exit(failed ? 1 : 0);
