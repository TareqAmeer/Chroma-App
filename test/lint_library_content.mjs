#!/usr/bin/env node
// Content-rule lint for the Library — source-level checks that don't need a browser, modelled
// on lint_ai_origin.mjs's pattern (a bug class that's cheap to grep for and easy to silently
// reintroduce). Added 2026-09-08 alongside the wireframe_inventory.mjs/wireframe_behaviour.mjs
// expansion: several of Vercel's web-interface-guidelines (github.com/vercel-labs/
// web-interface-guidelines) rules are pure text/attribute conventions no DOM inspection is
// needed for, and a runtime check would just be a slower way to grep the same string.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'desktop/library-ui.js';
const src = await readFile(path.join(ROOT, FILE), 'utf8');
const lines = src.split('\n');
const offenders = []; // { rule, line, text }

// ── Rule 1: real ellipsis character, never three literal dots ─────────────────────────────────
// Vercel: "MUST: Use `…` character (not `...`)". Scoped to double/single-quoted STRING literals
// (menu labels, titles, placeholders) — a `...` inside a // or /* */ comment, or a code
// construct like a spread/rest operator, is not this rule's concern.
{
  const STRING_RE = /(['"])((?:\\.|(?!\1).)*)\1/g;
  lines.forEach((line, i) => {
    const codePart = line.split('//')[0]; // best-effort: strip a trailing line comment
    let m;
    while ((m = STRING_RE.exec(codePart))) {
      if (m[2].includes('...')) offenders.push({ rule: 'ellipsis', line: i + 1, text: line.trim().slice(0, 100) });
    }
  });
}

// ── Rule 2: native <select> needs explicit background-color + color in dark mode ──────────────
// Vercel: "MUST: Native `<select>`: explicit `background-color` and `color` (Windows fix)" — an
// unstyled <select> renders with the OS's own (often light, always un-themed) chrome on Windows
// regardless of the page's dark theme. Checks the CSS block for a rule targeting `select` (bare
// or scoped) that sets both properties; a <select> styled only via a wrapper/appearance reset
// without background-color/color still fails Windows users.
{
  // Scans the WHOLE file rather than one hand-picked template literal — library-ui.js's CSS is
  // split across several `` `...` `` blocks (an earlier version of this check only scanned the
  // first one, up to its first closing backtick, and missed a real rule further down as a
  // result: `.lib-cmp-head select{background:var(--sur2);...;color:var(--txt)}`).
  const selectRules = src.match(/[^{}\n]*\bselect\b[^{}\n]*\{[^{}]*\}/g) || [];
  const hasBg = selectRules.some((r) => /background(-color)?\s*:/.test(r));
  const hasColor = selectRules.some((r) => /(?<!background-)\bcolor\s*:/.test(r));
  if (!hasBg || !hasColor) {
    offenders.push({ rule: 'select-dark-mode', line: 0, text: `no <select> CSS rule sets both background-color and color (found bg:${hasBg} color:${hasColor}) — Windows renders the OS default chrome regardless of theme` });
  }
}

// ── Rule 3: live numeric readouts get tabular-nums ─────────────────────────────────────────────
// Vercel: "MUST: `font-variant-numeric: tabular-nums` for number comparisons" — a count/size
// readout that updates in place (thumbnail size %, selection count, byte totals) jitters
// horizontally as digit widths change unless the font locks to a fixed digit width. Scoped to
// the specific ids already known to render live-updating numbers.
{
  const LIVE_NUMBER_IDS = ['lib-sort-label', 'lib-filters-badge'];
  const css = src;
  for (const id of LIVE_NUMBER_IDS) {
    const re = new RegExp(`#${id}\\s*\\{[^}]*\\}`, 'g');
    const rules = css.match(re) || [];
    const hasTabular = rules.some((r) => /tabular-nums/.test(r));
    if (!hasTabular && rules.length) {
      offenders.push({ rule: 'tabular-nums', line: 0, text: `#${id} has a CSS rule but no font-variant-numeric:tabular-nums` });
    }
  }
}

if (offenders.length) {
  console.error(`✗ lint_library_content: ${offenders.length} finding(s)\n`);
  const byRule = new Map();
  for (const o of offenders) { if (!byRule.has(o.rule)) byRule.set(o.rule, []); byRule.get(o.rule).push(o); }
  for (const [rule, list] of byRule) {
    console.error(`  [${rule}] ${list.length}x`);
    for (const o of list.slice(0, 10)) console.error(`    ${o.line ? `${FILE}:${o.line}: ` : ''}${o.text}`);
    if (list.length > 10) console.error(`    ...and ${list.length - 10} more`);
  }
  process.exit(1);
} else {
  console.log('lint_library_content: PASS — no ellipsis/select-dark-mode/tabular-nums findings');
}
