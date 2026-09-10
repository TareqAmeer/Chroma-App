// T31 (editor_ux_spec.json) — static check that a function invoking a Tauri desktop command
// gates itself on window.__TAURI__, never on capNative() (the Capacitor/iOS flag).
//
// The actual bug (2026-09-10): fxEnsureDepthMap() called `_samFramedInvoke('depth_run', ...)` —
// a Tauri-only Rust command (main.rs/depth.rs) — but its own native-availability guard was
// `if(!capNative())return null`. capNative() checks window.Capacitor (the iOS shell); Capacitor
// is never present in the desktop Tauri shell, so the guard made the function return null
// immediately, every call, on the one platform depth_run actually runs on. Every OTHER
// _samFramedInvoke/.core.invoke call site in the file gates on window.__TAURI__ — this was the
// only one that didn't, and nothing caught the mismatch.
//
// Scans chromasmith-22.html's inline <script> bodies for functions that call `_samFramedInvoke(`
// or `window.__TAURI__.core.invoke(` AND ALSO use `capNative()` as an apparent early
// native-availability gate (the `if(!capNative())return`/`if(!capNative())` shape) WITHOUT also
// referencing `window.__TAURI__` anywhere in that same function body. Flags a mismatch, not a
// missing gate — a function with no capNative() reference at all is not flagged; the whole point
// is catching "gated on the WRONG platform flag", which is what actually shipped.
//
// Usage: node test/editor_native_gate_check.mjs [chromasmith-22.html]

import { readFile } from 'node:fs/promises';

const FILE = process.argv[2] || 'chromasmith-22.html';
const INVOKE_PATTERNS = [/_samFramedInvoke\s*\(/, /window\.__TAURI__\.core\.invoke\s*\(/, /\bcore\.invoke\s*\(/];
const CAPNATIVE_GATE_RE = /if\s*\(\s*!\s*capNative\s*\(\s*\)\s*\)/;

// Same brace/string/template-literal aware function extractor as editor_self_reschedule_check.mjs
// (T30) — duplicated rather than shared, matching this project's existing convention of each
// test/*.mjs check being self-contained (see editor_html_validity_check.mjs's own tokenizer).
function extractFunctions(src) {
  const fns = [];
  const declRe = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = declRe.exec(src))) {
    const name = m[1];
    let i = declRe.lastIndex;
    let depth = 1;
    while (i < src.length && depth > 0) { if (src[i] === '(') depth++; else if (src[i] === ')') depth--; i++; }
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== '{') continue;
    const bodyStart = i + 1;
    const bodyEnd = findMatchingBrace(src, i);
    if (bodyEnd === -1) continue;
    fns.push({ name, body: src.slice(bodyStart, bodyEnd) });
  }
  return fns;
}

function findMatchingBrace(src, openIdx) {
  let depth = 0, i = openIdx;
  let inSingle = false, inDouble = false, inTemplate = false, inLineComment = false, inBlockComment = false;
  const templateExprDepth = [];
  for (; i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (prev === '*' && c === '/') inBlockComment = false; continue; }
    if (inSingle) { if (c === "'" && prev !== '\\') inSingle = false; continue; }
    if (inDouble) { if (c === '"' && prev !== '\\') inDouble = false; continue; }
    if (inTemplate) {
      if (c === '`' && prev !== '\\') { inTemplate = false; continue; }
      if (c === '$' && src[i + 1] === '{') { templateExprDepth.push(depth); depth++; i++; continue; }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { inLineComment = true; i++; continue; }
    if (c === '/' && src[i + 1] === '*') { inBlockComment = true; i++; continue; }
    if (c === "'") { inSingle = true; continue; }
    if (c === '"') { inDouble = true; continue; }
    if (c === '`') { inTemplate = true; continue; }
    if (c === '{') { depth++; continue; }
    if (c === '}') {
      depth--;
      if (templateExprDepth.length && depth === templateExprDepth[templateExprDepth.length - 1]) {
        templateExprDepth.pop(); inTemplate = true; continue;
      }
      if (depth === 0) return i;
      continue;
    }
  }
  return -1;
}

async function main() {
  const src = await readFile(FILE, 'utf8');
  const scriptRe = /<script>([\s\S]*?)<\/script>/g;
  let scriptMatch, allSrc = '';
  while ((scriptMatch = scriptRe.exec(src))) allSrc += scriptMatch[1] + '\n';

  const fns = extractFunctions(allSrc);
  const findings = [];

  for (const { name, body } of fns) {
    const callsInvoke = INVOKE_PATTERNS.some((re) => re.test(body));
    if (!callsInvoke) continue;
    const gatesOnCapNative = CAPNATIVE_GATE_RE.test(body);
    if (!gatesOnCapNative) continue; // no mismatch to report — this function doesn't use capNative() as a gate at all
    const mentionsTauri = body.includes('window.__TAURI__') || body.includes('__TAURI__');
    if (!mentionsTauri) {
      findings.push({ name });
    }
  }

  if (!findings.length) {
    console.log('editor:native-gate-check — PASS (every capNative()-gated function that invokes a native command also references window.__TAURI__)');
    process.exit(0);
  }

  console.log(`editor:native-gate-check — ${findings.length} finding(s):\n`);
  for (const f of findings) {
    console.log(`  [${f.name}] invokes a Tauri command (_samFramedInvoke/.core.invoke) but gates on capNative()`);
    console.log(`    (window.Capacitor/iOS) with no window.__TAURI__ reference anywhere in the function —`);
    console.log(`    capNative() is always false in the desktop Tauri shell, so this command can never run there.\n`);
  }
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
