// T52 (editor_ux_spec.json), cheap first step per its own note: static scan of the <style> block
// for hand-typed transition/animation durations and timing-functions that don't resolve to
// :root's --dur-1/--dur-2/--ease tokens — same drift-detection shape as editor_token_check.mjs
// (T5/T10) applied to motion tokens instead of colour/spacing. Does NOT attempt frame-timing
// jank measurement (T52's note calls that a separate, larger lift needing a DevTools Performance
// trace) — this only catches token drift in `transition`/`animation`/`transition-duration`/
// `transition-timing-function`/`animation-duration`/`animation-timing-function` declarations.
import { readFileSync } from 'node:fs';

const html = readFileSync('chromasmith-22.html', 'utf8');
const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
if (!styleMatch) { console.log('FAIL: no <style> block found'); process.exit(1); }
let css = styleMatch[1];
css = css.replace(/url\(data:[^)]*\)/g, 'url(DATA_URI_STRIPPED)');

const rootMatch = css.match(/:root\s*\{([^}]*)\}/);
if (!rootMatch) { console.log('FAIL: no :root block found'); process.exit(1); }
const rootBlock = rootMatch[1];
const durTokens = new Set();
const easeTokens = new Set();
for (const decl of rootBlock.split(';')) {
  const m = decl.match(/--(dur-\d+)\s*:\s*(.+)/);
  if (m) durTokens.add(m[2].trim());
  const e = decl.match(/--ease(-[a-z0-9-]+)?\s*:\s*(.+)/);
  if (e) easeTokens.add(e[2].trim().replace(/\s+/g, ''));
}
console.log(`editor:motion-token-check — ${durTokens.size} duration token(s), ${easeTokens.size} easing token(s) in :root`);

// Allow trivial/zero-motion values that aren't "a duration concept" (matches token-check's
// 0px/1px/2px allowance for spacing).
const ALLOWED_BARE = new Set(['0s', '0ms', 'none', 'linear']);

// Strip comments before splitting into rules so a selector immediately after a /* ... */ block
// doesn't drag the whole comment body into the reported selector text.
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
const ruleBodies = [...cssNoComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((m) => !/:root/.test(m[1]))
  .map((m) => ({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] }));

const findings = [];
for (const { selector, body } of ruleBodies) {
  for (const decl of body.split(';')) {
    const m = decl.match(/^\s*([a-zA-Z-]+)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const [, prop, rawVal] = m;
    if (rawVal.includes('var(--')) continue;
    if (!/^(transition|transition-duration|transition-timing-function|animation|animation-duration|animation-timing-function)$/i.test(prop)) continue;

    const durs = rawVal.match(/-?(?:\d+\.\d+|\.\d+|\d+)m?s/g) || [];
    for (const d of durs) {
      if (ALLOWED_BARE.has(d)) continue;
      if (!durTokens.has(d)) findings.push({ kind: 'duration', selector, prop, value: d });
    }
    const cubics = rawVal.match(/cubic-bezier\([^)]*\)/g) || [];
    for (const c of cubics) {
      const norm = c.replace(/\s+/g, '');
      if (!easeTokens.has(norm)) findings.push({ kind: 'easing', selector, prop, value: c });
    }
    const keywords = rawVal.match(/\b(ease|ease-in|ease-out|ease-in-out)\b/g) || [];
    for (const k of keywords) {
      if (ALLOWED_BARE.has(k)) continue;
      findings.push({ kind: 'easing', selector, prop, value: k });
    }
  }
}

if (findings.length) {
  console.log(`\n${findings.length} motion literal(s) not matching any :root token:`);
  for (const f of findings.slice(0, 200)) console.log(`  [${f.kind}] ${f.selector} { ${f.prop}: ${f.value} }`);
  if (findings.length > 200) console.log(`  ... and ${findings.length - 200} more`);
  console.log('\nADVISORY: not auto-failing — same triage-not-gospel posture as editor:token-check. Run with --strict to fail on any finding.');
  console.log('NOTE: this does not measure actual frame-timing/jank (T52) — token drift only.');
  if (process.argv.includes('--strict')) process.exit(1);
} else {
  console.log('PASS: no hand-typed transition/animation duration or easing outside :root motion tokens.');
}
