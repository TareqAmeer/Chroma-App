// T30 (editor_ux_spec.json) — static check for the mskRebuild()/fxEnsureDepthMap() infinite-loop
// bug SHAPE, not just that one instance.
//
// The actual bug (2026-09-10): mskRebuild()'s Depth Range UI block called
// `fxEnsureDepthMap().then(()=>{ if(typeof mskRebuild==='function')mskRebuild(); })` with no
// attempt/memoization guard. fxEnsureDepthMap() failed instantly every time (wrong native-platform
// check), so every mskRebuild() call re-entered the same branch and rescheduled ANOTHER
// mskRebuild() off the resolved promise — forever. The general shape: a function F chains
// `somePromise().then(()=>{ ... F(...) ... })`, calling itself again (by name) once that promise
// settles, with nothing in F's own body tracking whether this has already been tried. If the
// promise's resolution doesn't change the condition that triggered the call, this loops forever
// and pins the render thread — see test/editor_hang_diagnose.mjs, built the same day, for how to
// confirm a suspected instance is a REAL loop rather than legitimate recursion.
//
// This is a HEURISTIC, not a proof (documented in T30's own backlog note) — it flags a pattern by
// text-scanning function bodies, not by reasoning about control flow. False positives are
// possible for real, intentional recursion that already has adequate guards this scanner's crude
// keyword check happens not to recognise; that's why findings are printed for review, not treated
// as fatal without human judgment. Still catches the exact class of bug that shipped.
//
// Scans chromasmith-22.html's inline <script> bodies for: a named function F whose body contains
// `.then(` followed (within a bounded lookahead window) by a call to `F(` again — i.e. F
// reschedules itself off a promise it started — AND whose body contains none of the recognised
// guard-keyword substrings (attempt/running/pending/inflight/debounc), case-insensitive, which
// would indicate the author already thought about "don't do this again while/after doing it once".
//
// Usage: node test/editor_self_reschedule_check.mjs [chromasmith-22.html]

import { readFile } from 'node:fs/promises';

const FILE = process.argv[2] || 'chromasmith-22.html';
const GUARD_KEYWORDS = ['attempt', 'running', 'pending', 'inflight', 'in_flight', 'debounc'];
const THEN_LOOKAHEAD = 400; // chars scanned after each `.then(` for a call back to the same function

// Extracts top-level `function NAME(...) { ... }` declarations from a JS source string, with a
// small brace/string/template-literal aware scanner (naive but good enough for this codebase's
// style — no nested-function-boundary edge case has broken editor_html_validity_check.mjs's
// similarly naive tag tokenizer either, and false negatives here are safe: this check is a
// heuristic aid, not a hard gate).
function extractFunctions(src) {
  const fns = [];
  const declRe = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = declRe.exec(src))) {
    const name = m[1];
    // find the matching closing paren of the parameter list, then the function's opening brace
    let i = declRe.lastIndex;
    let depth = 1;
    while (i < src.length && depth > 0) { if (src[i] === '(') depth++; else if (src[i] === ')') depth--; i++; }
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== '{') continue; // arrow-fn-shaped false match or destructured default, skip
    const bodyStart = i + 1;
    const bodyEnd = findMatchingBrace(src, i);
    if (bodyEnd === -1) continue;
    fns.push({ name, body: src.slice(bodyStart, bodyEnd) });
  }
  return fns;
}

// Walks forward from `openIdx` (index of an opening `{`) to find the index of its matching `}`,
// skipping braces that appear inside string/template literals or comments.
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

  // ⚠️ The guard-keyword check must look NEAR the `.then(` call, not anywhere in the whole
  // function body. mskRebuild() itself is 367 lines and builds unrelated UI for every mask
  // control; checking its ENTIRE body for the word "attempt" would have silently suppressed the
  // real finding here too, since `attemptedImg`/`alreadyAttempted` exist elsewhere in the same
  // function for a DIFFERENT purpose than actually guarding this specific `.then()`. Confirmed by
  // testing this checker against a reverted (pre-fix) copy of chromasmith-22.html: a whole-body
  // keyword search reported PASS on the exact bug that shipped, which defeats the point.
  const GUARD_WINDOW_BEFORE = 300;
  for (const { name, body } of fns) {
    let thenIdx = body.indexOf('.then(');
    while (thenIdx !== -1) {
      const after = body.slice(thenIdx, thenIdx + THEN_LOOKAHEAD);
      const selfCallRe = new RegExp(`\\b${name}\\s*\\(`);
      if (selfCallRe.test(after)) {
        const before = body.slice(Math.max(0, thenIdx - GUARD_WINDOW_BEFORE), thenIdx);
        const localWindow = (before + after).toLowerCase();
        const hasLocalGuard = GUARD_KEYWORDS.some((kw) => localWindow.includes(kw));
        if (!hasLocalGuard) {
          findings.push({ name, snippet: after.slice(0, 160).replace(/\s+/g, ' ').trim() });
          break; // one finding per function is enough to flag it for review
        }
      }
      thenIdx = body.indexOf('.then(', thenIdx + 1);
    }
  }

  if (!findings.length) {
    console.log('editor:self-reschedule-check — PASS (no unguarded self-rescheduling .then() chains found)');
    process.exit(0);
  }

  console.log(`editor:self-reschedule-check — ${findings.length} finding(s) (heuristic — review each, not all are real bugs):\n`);
  for (const f of findings) {
    console.log(`  [${f.name}] calls itself inside a .then() with no attempt/running/pending/inflight/debounce guard anywhere in its body:`);
    console.log(`    ...${f.snippet}...\n`);
  }
  console.log('If a finding above is legitimate (a real guard exists under a name this heuristic');
  console.log('does not recognise), either rename the guard to include one of: ' + GUARD_KEYWORDS.join('/') + ',');
  console.log('or add a short comment near the .then() explaining why it is safe — this check has no');
  console.log('allowlist by design (T30\'s whole point is catching the NEXT instance of this shape,');
  console.log('not just the one that already shipped), so review each finding rather than suppressing it.');
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
