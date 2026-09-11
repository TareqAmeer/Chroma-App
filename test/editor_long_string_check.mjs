// T47 (editor_ux_spec.json): text-overflow/localization-length stress. Every existing wireframe/
// behaviour fixture uses the app's own real, short, English copy — nothing tries a longer label
// (German UI strings routinely run 30-40% longer) or a long user-supplied filename/preset name
// against any layout.
//
// Approach: inject artificially long strings into a representative set of labels/filenames/
// preset names actually rendered from data (not static markup — a hardcoded label can't overflow
// from user input, only from a translation, which is out of scope until the app ships one), then
// screenshot-free structural check for CLIPPING (scrollWidth > clientWidth on an `overflow:hidden`
// leaf with no ellipsis) or OVERLAP with a sibling, the same detection shape as
// editor_zoom_check.mjs's auditClipping/auditOverlaps.
import { bootEditor } from './editor_state_harness.mjs';

const LONG_FILENAME = 'IMG_' + 'übermäßig-langer-dateiname-mit-vielen-wörtern-zur-teststreckenbelastung-'.repeat(2) + '2026.RW2';
const LONG_PRESET_NAME = 'Kodachrome II Extra Fine Grain Warm Tone Special Limited Edition Restoration';

function findLeafClipping(scopeSelectors) {
  const out = [];
  for (const scopeSel of scopeSelectors) {
    const scope = document.querySelector(scopeSel);
    if (!scope) continue;
    for (const el of scope.querySelectorAll('*')) {
      if (el.children.length > 0) continue;
      const cs = getComputedStyle(el);
      if (cs.textOverflow === 'ellipsis') continue;
      if (cs.overflow !== 'hidden' && cs.overflowX !== 'hidden') continue;
      if (el.scrollWidth > el.clientWidth + 2 && (el.textContent || '').trim()) {
        out.push({ scope: scopeSel, text: el.textContent.trim().slice(0, 40), tag: el.tagName, cls: el.className });
      }
    }
  }
  return out;
}

function findOverlaps(scopeSelectors) {
  const out = [];
  for (const scopeSel of scopeSelectors) {
    const scope = document.querySelector(scopeSel);
    if (!scope) continue;
    const kids = [...scope.children].filter((k) => {
      const b = k.getBoundingClientRect();
      return b.width > 0 && b.height > 0;
    });
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ix > 2 && iy > 2) out.push({ scope: scopeSel, overlapPx: Math.round(ix) });
      }
    }
  }
  return out;
}

const b = await bootEditor();
const { page } = b;
const findings = [];

// 1. Long filename via the filmstrip (fxImages[].name) — CLAUDE.md §4's multi-photo filmstrip.
await page.evaluate((name) => {
  if (typeof fxImages !== 'undefined' && fxImages && fxImages[0]) {
    fxImages[0].name = name;
    if (typeof buildFilmstrip === 'function') buildFilmstrip();
  }
}, LONG_FILENAME);
await page.waitForTimeout(200);
let clip = await page.evaluate(findLeafClipping, ['#fx-filmstrip', '.filmstrip']);
for (const c of clip) findings.push({ area: 'filmstrip filename', kind: 'CLIPPED', detail: `${c.tag}.${c.cls || ''} — "${c.text}..." clipped with no ellipsis` });

// 2. Long preset/look name — the look-gallery grid's own `.look-nm` caption (CLAUDE.md §3b:
// the one-tap Looks gallery), which already declares text-overflow:ellipsis in CSS — this
// confirms that declaration actually still applies after a real long name, not just that it's
// present in the stylesheet (a stale/overridden rule elsewhere could silently defeat it).
const injectedCount = await page.evaluate((name) => {
  const cells = document.querySelectorAll('.look-nm');
  cells.forEach((el, i) => { if (i < 3) el.textContent = name; });
  return Math.min(cells.length, 3);
}, LONG_PRESET_NAME);
await page.waitForTimeout(150);
if (injectedCount === 0) {
  findings.push({ area: 'look gallery', kind: 'MISSING', detail: 'no .look-nm caption found in the DOM to stress — look gallery may not be open/rendered in this harness config' });
} else {
  const overflowInfo = await page.evaluate((name) => {
    const out = [];
    for (const el of document.querySelectorAll('.look-nm')) {
      if (el.textContent !== name) continue;
      const cs = getComputedStyle(el);
      out.push({ ellipsisApplied: cs.textOverflow === 'ellipsis', overflowsBox: el.scrollWidth > el.clientWidth + 1, w: el.clientWidth, sw: el.scrollWidth });
    }
    return out;
  }, LONG_PRESET_NAME);
  for (const info of overflowInfo) {
    if (info.overflowsBox && !info.ellipsisApplied) {
      findings.push({ area: 'look gallery .look-nm', kind: 'CLIPPED', detail: `text overflows box (${info.sw}px content in ${info.w}px) with NO ellipsis applied — text-overflow rule may have been overridden/defeated` });
    }
  }
}

// 3. Overlap check on the deskbar/toolrail after injection — a long string reflowing a flex
// sibling into another one is exactly the failure mode this exists to catch.
const overlaps = await page.evaluate(findOverlaps, ['#fx-deskbar']);
for (const o of overlaps) findings.push({ area: o.scope, kind: 'OVERLAP', detail: `sibling overlap of ${o.overlapPx}px after long-string injection` });

if (b.pageErrors.length) findings.push({ area: 'page', kind: 'PAGE-ERROR', detail: b.pageErrors.join('; ') });
await b.close();

console.log('editor:long-string-check — long filename + long preset-name stress');
if (findings.length) {
  console.log(`\n${findings.length} finding(s):`);
  for (const f of findings) console.log(`  [${f.area}/${f.kind}] ${f.detail}`);
  console.log('\nADVISORY: not auto-failing — a targeted stress on specific data-driven labels, not every string in the app. Run with --strict to fail on any finding.');
  if (process.argv.includes('--strict')) process.exit(1);
} else {
  console.log('PASS: no clipping or overlap found after injecting an oversized filename/preset name.');
}
