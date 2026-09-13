// Shared mapping between design/components.json family names and:
//   1. chromasmith-22.html's buildCatalogPage() COMPONENTS keys (the ?catalog=1&live=1&only=<key>
//      live embeds scripts/token-report.mjs uses — see docs/ui-workflow/component-visuals-plan.md)
//   2. design/asbuilt/ (the S6c static-capture pass) via a same-selector-set match, so the report
//      can show "also seen in production at <surface>" without a second screenshot pass.
// Single source of truth for both scripts/token-report.mjs (renders it) and
// scripts/component-visuals-check.mjs (gates it) — duplicating this object between the two would
// let them silently drift, which is exactly the failure mode the gate exists to catch.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

// null = no chromasmith-22.html COMPONENTS entry exists (icon is real SVG glyphs rendered
// separately in scripts/token-report.mjs's iconSections(), never a DOM clone).
export const FAMILY_TO_CATALOG_KEY = {
  'section-card': 'fx-ctrl',
  'control-row': 'fx-row',
  toggle: 'fx-toggle',
  slider: 'slider',
  select: 'select',
  'segmented-control': 'seg',
  button: 'btn',
  'icon-button': 'btn-icon',
  chip: 'chip',
  'info-button': 'fx-info-i',
  'search-input': 'search-input',
  menu: 'menu',
  icon: null,
};

// These 3 families' markup exists only in desktop/library-ui.js — confirmed live (not assumed)
// that their selectors never resolve under the plain web build, only under
// desktop/dist/index.html?libtest=1. See component-visuals-plan.md §5a's implementation-status
// note for how that was found and fixed (catalog bootstrap deferred to window.load, plus a
// FORCE_VISIBLE shim for .lib-menu's .open class).
export const LIBRARY_ONLY_CATALOG_KEYS = new Set(['chip', 'search-input', 'menu']);

// Families whose chromasmith-22.html LIVE_WIRE shim makes the embed clickable (toggle flip,
// section collapse, segmented-control switch) — everything else is still a live embed (native
// slider drag / select open, or hover-only button/icon-button/info-button/chip) but has no click
// affordance worth badging.
export const CATALOG_KEYS_WITH_SHIM = new Set(['fx-toggle', 'fx-ctrl', 'seg']);

// ---------- design/asbuilt/ cross-reference (component-visuals-plan.md §0) ----------
// Parses each captured surface's spec.json element tree (S6c's {tag, id, classes, children}
// shape — see test/surface_capture.mjs) and tests every family selector against every node, so
// the report can point at existing screenshots instead of a family having zero visual evidence
// only because it isn't one of the ~9-12 hand-picked catalogue entries. Selectors here are the
// simple forms design/components.json actually uses (".class", "tag", "tag[attr=...]" — the
// attribute predicate is intentionally ignored, matched on tag alone, since every attr-qualified
// selector in this registry has a class-based sibling selector for the same family that still
// narrows the match correctly).
function selectorMatches(sel, node) {
  const classes = node.classes || [];
  if (sel.startsWith('.')) return classes.includes(sel.slice(1));
  const tag = sel.replace(/\[[^\]]*\]$/, '');
  return node.tag === tag;
}
function walk(node, selectors, hits) {
  if (!node) return;
  if (selectors.some((s) => selectorMatches(s, node))) hits.push(node);
  for (const c of node.children || []) walk(c, selectors, hits);
}
function pickScreenshot(files) {
  const webp = files.filter((f) => f.endsWith('.webp'));
  return webp.find((f) => /_light_crop\.webp$/.test(f))
    || webp.find((f) => /_light\.webp$/.test(f))
    || webp[0]
    || null;
}

// Returns Map<familyName, Array<{ surfaceId, screenshot }>> (screenshot null when that surface
// has no captured image — some S6c entries are spec.json/block.dc.html only).
export async function buildAsbuiltIndex(root, families) {
  const asbuiltDir = path.join(root, 'design/asbuilt');
  const index = new Map(families.map((f) => [f.name, []]));
  let entries;
  try { entries = await readdir(asbuiltDir, { withFileTypes: true }); } catch { return index; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue; // skip _panel_pairs etc.
    const dir = path.join(asbuiltDir, entry.name);
    let spec;
    try { spec = JSON.parse(await readFile(path.join(dir, 'spec.json'), 'utf8')); } catch { continue; }
    if (!spec.tree) continue; // splash-style stand-in entries have no live tree
    let files;
    try { files = await readdir(dir); } catch { files = []; }
    const screenshot = pickScreenshot(files);
    for (const f of families) {
      const hits = [];
      walk(spec.tree, f.selectors || [], hits);
      if (hits.length) index.get(f.name).push({ surfaceId: entry.name, screenshot, matchCount: hits.length });
    }
  }
  return index;
}
