// Generate the :root / body.light token blocks in chromasmith-22.html and the DS token block
// in desktop/library-ui.js from design/tokens.json, writing between CSS-comment markers.
//
//   node scripts/build-tokens.mjs           # write
//   node scripts/build-tokens.mjs --check   # exit 1 if regenerating would change either file
//
// Marker-injection pattern reused from site/build-page.mjs (HTML-comment markers there,
// CSS-comment markers here since these regions sit inside <style>/a JS template literal, not
// raw HTML). Everything outside a marker pair is untouched.
//
// Each declaration's exact position/comment is driven by scripts/token-layout.json (the
// mechanical order + inter-declaration whitespace, captured once from the file as it existed
// when this generator was built) plus design/tokens.json's per-token value and, where the
// source had a hand-written rationale comment immediately before it, its
// $extensions.chromasmith.emit.<block>.commentBefore (copied verbatim, including the comment
// markers and indentation — see design/tokens.json, not this file, to edit that prose).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TOKENS_PATH = path.join(ROOT, 'design', 'tokens.json');
const LAYOUT_PATH = path.join(__dirname, 'token-layout.json');
const HTML_PATH = path.join(ROOT, 'chromasmith-22.html');
const LIBUI_PATH = path.join(ROOT, 'desktop', 'library-ui.js');

function replaceRegion(text, name, body) {
  const start = `/* TOKENS:${name}:START`, end = `/* TOKENS:${name}:END */`;
  const a = text.indexOf(start);
  const startEnd = text.indexOf('*/', a) + 2;
  const b = text.indexOf(end);
  if (a === -1 || b === -1) throw new Error(`missing TOKENS:${name} markers`);
  return text.slice(0, startEnd) + body + text.slice(b);
}

function indexByVar(doc) {
  const byVar = {};
  (function walk(o) {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o && typeof o === 'object') {
      const ext = o.$extensions && o.$extensions.chromasmith;
      if (ext && ext.appVar) byVar[ext.appVar] = o;
      for (const k of Object.keys(o)) walk(o[k]);
    }
  })(doc);
  return byVar;
}

function valueFor(tok, mode) {
  const ext = tok.$extensions.chromasmith;
  if (mode === 'flat') return tok.$value;
  const modes = ext.modes;
  return (modes && modes[mode]) ?? tok.$value;
}

function renderBlock(layout, byVar, block, mode) {
  let out = '';
  for (const item of layout) {
    if (item.trailing !== undefined) { out += item.trailing; continue; }
    const tok = byVar[item.var];
    if (!tok) throw new Error(`design/tokens.json has no token for ${item.var} (block ${block})`);
    const emit = tok.$extensions.chromasmith.emit;
    const commentBefore = emit && emit[block] && emit[block].commentBefore;
    out += commentBefore != null ? commentBefore : (item.pre ?? '');
    out += `${item.var}:${valueFor(tok, mode)}${item.hadSemi ? ';' : ''}`;
  }
  return out;
}

const [tokensDoc, layout, html0, libui0] = await Promise.all([
  readFile(TOKENS_PATH, 'utf8').then(JSON.parse),
  readFile(LAYOUT_PATH, 'utf8').then(JSON.parse),
  readFile(HTML_PATH, 'utf8'),
  readFile(LIBUI_PATH, 'utf8'),
]);
const byVar = indexByVar(tokensDoc);

const rootBody = renderBlock(layout.root, byVar, 'root', 'dark');
const bodyLightBody = renderBlock(layout.bodyLight, byVar, 'bodyLight', 'light');
const dsBody = renderBlock(layout.ds, byVar, 'ds', 'flat');

let html = replaceRegion(html0, 'ROOT', rootBody);
html = replaceRegion(html, 'BODYLIGHT', bodyLightBody);
const libui = replaceRegion(libui0, 'DS', dsBody);

const check = process.argv.includes('--check');
const htmlChanged = html !== html0;
const libuiChanged = libui !== libui0;

if (check) {
  if (htmlChanged || libuiChanged) {
    console.error('build-tokens: OUT OF DATE —', [htmlChanged && 'chromasmith-22.html', libuiChanged && 'desktop/library-ui.js'].filter(Boolean).join(', '), 'would change. Run `node scripts/build-tokens.mjs`.');
    process.exit(1);
  }
  console.log('build-tokens: up to date.');
  process.exit(0);
}

if (htmlChanged) await writeFile(HTML_PATH, html);
if (libuiChanged) await writeFile(LIBUI_PATH, libui);
console.log(`build-tokens: chromasmith-22.html ${htmlChanged ? 'updated' : 'unchanged'}, desktop/library-ui.js ${libuiChanged ? 'updated' : 'unchanged'}.`);
