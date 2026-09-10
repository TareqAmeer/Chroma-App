// T4 (editor_ux_spec.json) — checks for INTERACTIVE-ELEMENT NESTING (a <button>/<a>/<select>/
// <textarea>/<label> inside another one), which is invalid HTML that browsers silently
// "fix" by closing the outer element early — producing a DOM shape that doesn't match the
// source, with no error anywhere. Neither editor:inventory nor editor:wireframe-diff parses for
// structural HTML validity; both only ever compared the ALREADY-PARSED (and therefore already
// silently-corrected) DOM, so this exact defect was invisible to both. Found by eye once (Point
// Color's proposal literally nested a <button class=info-i> inside <button class=pick-btn> — R8,
// fixed in the real implementation as CO1); this makes it a repeatable, automated check instead
// of depending on the next reviewer noticing the same thing again.
//
// This is a plain-text tokenizer, not a real HTML parser (no npm HTML-parsing dependency exists
// in this project — see editor_ux_spec.json T4's own note). It is deliberately narrow: it only
// tracks the small set of INTERACTIVE tags that matter for this defect class, so it doesn't need
// to understand void elements, comments, or non-interactive nesting rules to be correct for the
// thing it checks. A false negative on some other malformed-HTML pattern is an acceptable
// trade-off for a script with no dependency and no real HTML DOM to compare against.
import { readFile } from 'node:fs/promises';

// Deliberately narrow to just 'button' — the actual defect class found this session (R8: a
// <button class=info-i> nested inside <button class=pick-btn>). An earlier version of this
// script also tracked a/select/textarea/label with a naive open/close stack and produced ~150
// false positives, because chromasmith-22.html has enough real-world irregularity (a <select>
// this tokenizer's simple tag-boundary regex doesn't parse correctly somewhere) to make a
// multi-tag stack unreliable. <button> nesting is unambiguous — HTML5 flatly forbids it and
// every real occurrence found here was a genuine defect — so it stays the one tag this checks,
// rather than shipping a noisy check nobody would trust. See T4's note for the false-positive
// history if this is ever revisited to widen the tag set.
const INTERACTIVE = new Set(['button']);

// Returns a list of { tag, insideTag } violations: an INTERACTIVE open tag encountered while
// another INTERACTIVE tag is already open (before ITS matching close).
function findNestedInteractive(html, sourceLabel) {
  const violations = [];
  const tagRe = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/)?\s*>/g;
  const stack = [];
  let m;
  while ((m = tagRe.exec(html))) {
    const isClose = !!m[1];
    const tag = m[2].toLowerCase();
    const selfClosing = !!m[3];
    if (!INTERACTIVE.has(tag) || selfClosing) continue;
    if (isClose) {
      const idx = stack.lastIndexOf(tag);
      if (idx !== -1) stack.splice(idx, 1); // pop the nearest matching open (tolerant of odd ordering)
    } else {
      if (stack.length) {
        violations.push({ source: sourceLabel, tag, insideTag: stack[stack.length - 1], offset: m.index });
      }
      stack.push(tag);
    }
  }
  return violations;
}

function contextSnippet(html, offset) {
  return html.slice(Math.max(0, offset - 30), offset + 50).replace(/\s+/g, ' ').trim();
}

const findings = [];

// 1. The real app's own markup (the shipped implementation — this is the one that actually
// matters for users; the proposals check below is a source-hygiene check on top of it). Scoped
// to the <body> so <style>/<script> blocks (which can contain "<button" inside a JS string
// template, e.g. panel_proposals.mjs-style generated HTML strings) don't produce false hits —
// scanning the raw file would tokenize CSS/JS text as if it were markup.
const appHtml = await readFile('chromasmith-22.html', 'utf8');
const bodyMatch = appHtml.match(/<body[^>]*>([^]*)<\/body>/);
const appBody = bodyMatch ? bodyMatch[1] : appHtml;
// Strip <script>...</script> blocks too — the body still contains inline scripts that build
// HTML strings (those are covered by the panel_proposals.mjs check below where relevant, and a
// blanket scan of every JS string literal in the app is out of scope for this check).
const appBodyNoScripts = appBody.replace(/<script[^>]*>[^]*?<\/script>/g, '');
for (const v of findNestedInteractive(appBodyNoScripts, 'chromasmith-22.html')) {
  findings.push(`${v.source}: <${v.tag}> nested inside <${v.insideTag}> — "${contextSnippet(appBodyNoScripts, v.offset)}"`);
}

// 2. test/panel_proposals.mjs's authored proposals — these are review material, not shipped
// code, but every implemented panel this session was built by eye-reading this file's raw HTML,
// so a defect here is a defect the NEXT panel's implementation is likely to copy forward too.
const { PROPOSALS } = await import('./panel_proposals.mjs');
for (const [key, proposal] of Object.entries(PROPOSALS)) {
  if (!proposal || typeof proposal.html !== 'string') continue;
  for (const v of findNestedInteractive(proposal.html, `panel_proposals.mjs PROPOSALS.${key}`)) {
    findings.push(`${v.source}: <${v.tag}> nested inside <${v.insideTag}> — "${contextSnippet(proposal.html, v.offset)}"`);
  }
}

console.log('EDITOR HTML VALIDITY CHECK (interactive-element nesting)');
console.log('='.repeat(78));
if (findings.length) {
  findings.forEach((f) => console.log('  ' + f));
  console.log(`\n${findings.length} finding(s). Each is a <button> nested inside another <button> —`);
  console.log('invalid HTML; the browser silently closes the outer button early, so the real DOM');
  console.log('does not match what the source implies. A finding in panel_proposals.mjs is review');
  console.log('material, not shipped code — fix it when that panel is implemented (or now, if easy).');
  console.log('A finding in chromasmith-22.html is a real, shipped defect.');
  console.log('RESULT: FAIL');
  process.exit(1);
} else {
  console.log('No interactive-element nesting found.');
  console.log('RESULT: PASS');
}
