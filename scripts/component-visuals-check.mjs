// Gate for the visual side of the Component Registry (component-visuals-plan.md §4): fails when
// a design/components.json family has drifted away from what scripts/token-report.mjs can
// actually show as a live embed. Complements scripts/build-component-registry.mjs --check, which
// only verifies the family/selector/instance data — this checks the PRESENTATION layer stays
// truthful, since a silently-stale mapping there would just show a text placeholder forever
// without anyone noticing (the exact failure mode "text means nothing to me" was reported
// against in the first place).
//
// Usage: node scripts/component-visuals-check.mjs
import { readFile } from 'node:fs/promises';
import { FAMILY_TO_CATALOG_KEY, LIBRARY_ONLY_CATALOG_KEYS, buildAsbuiltIndex } from './component-catalog-map.mjs';

const ROOT = process.cwd();
const componentsDoc = JSON.parse(await readFile(new URL('../design/components.json', import.meta.url), 'utf8'));
const html = await readFile(new URL('../chromasmith-22.html', import.meta.url), 'utf8');

const families = Object.entries(componentsDoc.families).map(([name, def]) => ({ name, ...def }));
const findings = [];

// 1. Every family in the registry must have an explicit mapping (even if explicitly null, like
// `icon`) — a family added to build-component-registry.mjs's FAMILY_DEFS with no corresponding
// entry here would otherwise silently render nothing in the report with no one the wiser.
for (const f of families) {
  if (!(f.name in FAMILY_TO_CATALOG_KEY)) {
    findings.push(`"${f.name}" is in design/components.json but has no entry in scripts/component-catalog-map.mjs's FAMILY_TO_CATALOG_KEY (add one, or map it to null with a comment explaining why it can't be shown).`);
  }
}

// 2. Every non-null catalog key must still exist in chromasmith-22.html's buildCatalogPage()
// COMPONENTS array — catches a rename/removal there that the report's iframe src would otherwise
// point at forever without erroring (the iframe just renders _catItem's "missing selector"
// fallback, which is easy to miss scrolling past a grid of otherwise-working cards).
const componentsArrayMatch = html.match(/const COMPONENTS=\[([\s\S]*?)\];/);
if (!componentsArrayMatch) {
  console.log('FAIL: could not find `const COMPONENTS=[...]` in chromasmith-22.html\'s buildCatalogPage() — has it been renamed?');
  process.exit(1);
}
const catalogKeysInHtml = new Set([...componentsArrayMatch[1].matchAll(/^\s*\[[^,]*,\s*'([^']+)'/gm)].map((m) => m[1]));
for (const [familyName, catalogKey] of Object.entries(FAMILY_TO_CATALOG_KEY)) {
  if (catalogKey === null) continue;
  if (LIBRARY_ONLY_CATALOG_KEYS.has(catalogKey)) continue; // these live in desktop/library-ui.js's own COMPONENTS-equivalent, checked below
  if (!catalogKeysInHtml.has(catalogKey)) {
    findings.push(`FAMILY_TO_CATALOG_KEY maps "${familyName}" -> catalog key "${catalogKey}", but chromasmith-22.html's COMPONENTS array has no entry with that key.`);
  }
}
// LIBRARY_ONLY_CATALOG_KEYS families (chip/search-input/menu) are declared in the SAME
// buildCatalogPage() COMPONENTS array (chromasmith-22.html, shared with library-ui.js at runtime
// via desktop/dist/index.html) — verified they're covered by the same regex above, not a second
// array, so no separate check is needed here beyond confirming the selectors resolve, which the
// registry build already does against desktop/library-ui.js.
for (const catalogKey of LIBRARY_ONLY_CATALOG_KEYS) {
  if (!catalogKeysInHtml.has(catalogKey)) {
    findings.push(`LIBRARY_ONLY_CATALOG_KEYS has "${catalogKey}", but chromasmith-22.html's COMPONENTS array has no entry with that key.`);
  }
}

// 3. Informational only (not a failure): families with zero design/asbuilt/ cross-reference hits
// — either genuinely not captured anywhere yet, or a selector drifted since the S6c pass. Surfaced
// so it's visible without opening the report, not gated, since asbuilt coverage is a snapshot of
// a separate capture pass this script doesn't own.
const asbuiltIndex = await buildAsbuiltIndex(ROOT, families);
const noAsbuiltEvidence = families.filter((f) => (asbuiltIndex.get(f.name) || []).length === 0).map((f) => f.name);

if (findings.length) {
  console.log(`FAIL: ${findings.length} component-visuals mapping issue(s):`);
  for (const f of findings) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`OK — every design/components.json family (${families.length}) has a valid scripts/token-report.mjs mapping.`);
if (noAsbuiltEvidence.length) {
  console.log(`Informational: no design/asbuilt/ cross-reference for: ${noAsbuiltEvidence.join(', ')} (not a failure — see component-visuals-plan.md §0).`);
}
