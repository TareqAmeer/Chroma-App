// T5/T10 (editor_ux_spec.json, combined per T10's note that a single static-analysis pass over
// all of :root's token categories is more efficient to build than colour alone first): scans the
// <style> block of chromasmith-22.html for hex colours, and for border-radius/gap/padding px
// literals, that don't resolve to any of :root's own custom-property values — the "never invent a
// colour/spacing value" rule CLAUDE.md §3b states but that, until now, only manual review enforced.
//
// Scope and known limits (read before treating a finding as gospel):
// - Only the <style> block (no inline `style=` attributes, no JS-built CSS strings) is scanned.
// - @font-face `src:url(data:...)` payloads are stripped first — a base64 font blob contains long
//   runs that incidentally match `#[0-9a-f]{3,6}`-shaped substrings if not removed.
// - A literal is "matched" only if it is BYTE-IDENTICAL to a :root value (e.g. `#e0e0e0` matches
//   `--bdr:#e0e0e0`) or numerically identical for px values (`8px` matches `--sp-2:8px`). A colour
//   that's a manual shade of an existing token (not exactly equal) still flags — that's the actual
//   bug class this exists to catch, not a false positive.
// - rgba()/rgb() with an alpha channel are compared to :root's own rgba() values the same way
//   (string-normalized, whitespace-insensitive) — a hand-typed rgba with a slightly different
//   alpha than the matching token is a real finding, not noise.
// - This is advisory-shaped by design: legitimate one-off literals exist (e.g. a shadow's rgba
//   black, `transparent`, `currentColor`, `#fff`/`#000` used as absolute white/black rather than a
//   themed colour). Triage findings against ALLOWLIST below rather than assuming every hit is a bug.
//
// Role-mismatch pass (added alongside scripts/build-tokens.mjs): the checks above only catch a
// literal that isn't ANY token. They miss a token used for the WRONG role — e.g. a legacy .bpri
// primary-button rule painted with --err (state.danger) instead of --acc (action.primary). This
// second pass reads design/tokens.json's $extensions.chromasmith.role per appVar and flags a
// var(--x) reference whose role family doesn't match what the selector's name implies (primary/
// danger/success/muted). Heuristic and selector-name-driven, so it only catches selectors that
// self-describe their role in the class/id name — advisory, same as the rest of this file.
import { readFileSync } from 'node:fs';

const html = readFileSync('chromasmith-22.html', 'utf8');
const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
if (!styleMatch) { console.log('FAIL: no <style> block found'); process.exit(1); }
let css = styleMatch[1];
// Strip @font-face data: URIs — huge base64 blobs that are not CSS colour/spacing literals.
css = css.replace(/url\(data:[^)]*\)/g, 'url(DATA_URI_STRIPPED)');

// Literals already known-intentional and not worth flagging (absolute black/white, transparent,
// currentColor, and the handful of raw shadow-alpha blacks used across many rules deliberately).
const ALLOWLIST_COLORS = new Set(['#fff', '#ffffff', '#000', '#000000', 'transparent', 'currentcolor']);

function extractRootTokens() {
  const rootBlocks = [...css.matchAll(/:root(?:\.[a-zA-Z-]+)?\s*\{([^}]*)\}/g)].map((m) => m[1]);
  const colorTokens = new Set();
  const pxTokens = new Set();
  for (const block of rootBlocks) {
    for (const decl of block.split(';')) {
      const m = decl.match(/--[a-zA-Z0-9-]+\s*:\s*(.+)/);
      if (!m) continue;
      const val = m[1].trim().toLowerCase();
      if (/^#[0-9a-f]{3,8}$/.test(val) || /^rgba?\(/.test(val)) colorTokens.add(val.replace(/\s+/g, ''));
      if (/^-?\d+(\.\d+)?px$/.test(val)) pxTokens.add(val);
    }
  }
  return { colorTokens, pxTokens };
}
const { colorTokens, pxTokens } = extractRootTokens();

// Only look inside normal rule bodies (not :root itself — that's the source of truth, not a finding).
const ruleBodies = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((m) => !/:root/.test(m[1]))
  .map((m) => ({ selector: m[1].trim(), body: m[2] }));

const findings = [];
for (const { selector, body } of ruleBodies) {
  for (const decl of body.split(';')) {
    const m = decl.match(/^\s*([a-zA-Z-]+)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const [, prop, rawVal] = m;
    // Skip anything already referencing a token.
    if (rawVal.includes('var(--')) continue;

    if (/^(color|background|background-color|border-color|border|box-shadow|fill|stroke|outline-color)$/i.test(prop) || /border(-top|-bottom|-left|-right)?-color/i.test(prop)) {
      const hexMatches = rawVal.match(/#[0-9a-fA-F]{3,8}/g) || [];
      const rgbaMatches = rawVal.match(/rgba?\([^)]*\)/g) || [];
      for (const hex of hexMatches) {
        const norm = hex.toLowerCase();
        if (ALLOWLIST_COLORS.has(norm)) continue;
        if (!colorTokens.has(norm)) findings.push({ kind: 'color', selector, prop, value: hex });
      }
      for (const rgba of rgbaMatches) {
        const norm = rgba.toLowerCase().replace(/\s+/g, '');
        if (!colorTokens.has(norm)) findings.push({ kind: 'color', selector, prop, value: rgba });
      }
    }

    if (/^(border-radius|gap|padding|margin|row-gap|column-gap)$/i.test(prop) || /^border(-top|-bottom|-left|-right)?(-left|-right)?-radius$/i.test(prop)) {
      const pxMatches = rawVal.match(/-?\d+(\.\d+)?px/g) || [];
      for (const px of pxMatches) {
        if (px === '0px' || px === '1px' || px === '2px') continue; // hairline/reset values, not a token concept
        if (!pxTokens.has(px)) findings.push({ kind: 'spacing', selector, prop, value: px });
      }
    }
  }
}

// --- Role-mismatch pass ---
function loadRoleByVar() {
  const doc = JSON.parse(readFileSync('design/tokens.json', 'utf8'));
  const roleByVar = {};
  (function walk(o) {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (o && typeof o === 'object') {
      const ext = o.$extensions && o.$extensions.chromasmith;
      if (ext && ext.appVar && ext.role) roleByVar[ext.appVar] = ext.role;
      for (const k of Object.keys(o)) walk(o[k]);
    }
  })(doc);
  return roleByVar;
}
const roleByVar = loadRoleByVar();

// selector-name hint -> the role family(ies) a token used there should belong to.
const ROLE_HINTS = [
  { hint: /\bprimary\b|\bbpri\b|-primary|btn-export/i, expect: /^action\.primary|^action\.accent/, label: 'primary' },
  { hint: /danger|destructive|\berr\b|-error/i, expect: /^state\.danger/, label: 'danger' },
  { hint: /success|\bok\b(?!\w)/i, expect: /^state\.success/, label: 'success' },
  { hint: /warning|\bwarn\b/i, expect: /^state\.warning/, label: 'warning' },
  { hint: /\bmuted\b|-muted|secondary-text/i, expect: /^text\.muted|^text\.secondary/, label: 'muted-text' },
];
const roleFindings = [];
for (const { selector, body } of ruleBodies) {
  const hinted = ROLE_HINTS.find((h) => h.hint.test(selector));
  if (!hinted) continue;
  const varRefs = [...body.matchAll(/var\((--[a-zA-Z0-9-]+)/g)].map((m) => m[1]);
  for (const v of varRefs) {
    const role = roleByVar[v];
    if (!role) continue; // not a tokens.json-tracked var (e.g. a raw --acc2 alias not itself a role holder)
    if (!hinted.expect.test(role)) {
      roleFindings.push({ selector, var: v, role, expectedFamily: hinted.label });
    }
  }
}

console.log(`editor:token-check — ${colorTokens.size} colour tokens, ${pxTokens.size} spacing tokens in :root`);
if (roleFindings.length) {
  console.log(`\n${roleFindings.length} role mismatch(es) — token's role doesn't match what the selector implies:`);
  for (const f of roleFindings.slice(0, 200)) {
    console.log(`  [role] ${f.selector} uses ${f.var} (role: ${f.role}) but selector name implies "${f.expectedFamily}"`);
  }
}
if (findings.length) {
  console.log(`\n${findings.length} literal(s) not matching any :root token:`);
  for (const f of findings.slice(0, 200)) {
    console.log(`  [${f.kind}] ${f.selector} { ${f.prop}: ${f.value} }`);
  }
  if (findings.length > 200) console.log(`  ... and ${findings.length - 200} more`);
}
if (findings.length || roleFindings.length) {
  console.log('\nADVISORY: not auto-failing — triage against ALLOWLIST_COLORS / token set and role hints (T5/T10, editor_ux_spec.json). Run with --strict to fail on any finding.');
  if (process.argv.includes('--strict')) process.exit(1);
} else {
  console.log('PASS: no invented colour/spacing literals or role-mismatched tokens found.');
}
