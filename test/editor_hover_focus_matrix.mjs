// T43 (editor_ux_spec.json): hover/focus states as a MATRIX across component types. ui_audit.mjs
// checks resting-state contrast/tap-target and one focus-indicator pass, but nothing before this
// hovered/focused every interactive class and asserted the visual state actually CHANGED and
// stayed legible — a real, documented blind spot even at mature design-QA shops per the spec's
// source note.
//
// For each selector in COMPONENT_CLASSES, this finds the first visible instance, reads its
// resting computed style, then (a) hovers it and re-reads, (b) focuses it and re-reads. A finding
// fires when:
//   - NO-CHANGE: hover/focus changed nothing observable (background, color, border, outline,
//     box-shadow, opacity, transform all identical to resting) — the state is invisible to a
//     sighted user relying on it.
//   - LOW-CONTRAST-FOCUS: a focused element's outline (or box-shadow acting as a focus ring) has
//     effectively zero size/opacity — keyboard users get no visible indicator at all.
//
// Known limits: single representative instance per selector (not every element matching it —
// same "representative, not exhaustive" scope as ui_audit.mjs's own contrast pass). Static
// resting/hover/focus snapshot only, no screenshot diffing/baseline (that's T51's job, over
// this same component list).
import { bootEditor } from './editor_state_harness.mjs';

const COMPONENT_CLASSES = [
  '.btn', '.fx-toggle', '.fx-sec-btn', '.fx-rail-btn', '.fx-act', '.fx-select',
  '.look-cell', '.fs-thumb', '.hdr-btn', '.fx-chip', '.fx-preset-chev',
];

function readRestState(sel) {
  const el = [...document.querySelectorAll(sel)].find((e) => {
    const b = e.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  });
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    found: true,
    rest: {
      bg: cs.backgroundColor, color: cs.color, border: cs.borderColor,
      outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor,
      boxShadow: cs.boxShadow, opacity: cs.opacity, transform: cs.transform,
    },
  };
}
function findVisible(sel) {
  return [...document.querySelectorAll(sel)].find((e) => {
    const b = e.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  });
}
function snapStyle(el) {
  const cs = getComputedStyle(el);
  return { bg: cs.backgroundColor, color: cs.color, border: cs.borderColor, outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, boxShadow: cs.boxShadow, opacity: cs.opacity, transform: cs.transform };
}

const b = await bootEditor();
const { page } = b;
const findings = [];

for (const sel of COMPONENT_CLASSES) {
  const info = await page.evaluate(readRestState, sel);
  if (!info || !info.found) { findings.push({ kind: 'MISSING', sel, detail: 'no visible instance found to test' }); continue; }

  const rest = info.rest;
  const handle = await page.evaluateHandle(findVisible, sel);
  const box = await handle.asElement()?.boundingBox();
  if (!box) { findings.push({ kind: 'MISSING', sel, detail: 'element vanished before hover' }); continue; }

  // Hover
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
  const hoverSnap = await handle.evaluate(snapStyle);
  await page.mouse.move(5, 5); // reset

  const hoverChanged = JSON.stringify(hoverSnap) !== JSON.stringify(rest);
  if (!hoverChanged) findings.push({ kind: 'NO-CHANGE-HOVER', sel, detail: 'hover state is visually identical to resting state' });

  // Focus
  await handle.evaluate((el) => el.focus && el.focus());
  await page.waitForTimeout(100);
  const focusSnap = await handle.evaluate(snapStyle);
  await handle.evaluate((el) => el.blur && el.blur());

  const focusChanged = JSON.stringify(focusSnap) !== JSON.stringify(rest);
  const outlineIsNone = /^(none|0px)/.test(focusSnap.outline) && (focusSnap.boxShadow === 'none' || focusSnap.boxShadow === rest.boxShadow);
  if (!focusChanged) {
    findings.push({ kind: 'NO-CHANGE-FOCUS', sel, detail: 'focus state is visually identical to resting state — keyboard users get no indicator' });
  } else if (outlineIsNone) {
    findings.push({ kind: 'LOW-CONTRAST-FOCUS', sel, detail: `focus changed something, but outline is "${focusSnap.outline}" and box-shadow unchanged — indicator may not be an outline/ring at all` });
  }
}

await b.close();

console.log(`editor:hover-focus-matrix — ${COMPONENT_CLASSES.length} component classes checked`);
if (findings.length) {
  console.log(`\n${findings.length} finding(s):`);
  for (const f of findings) console.log(`  [${f.kind}] ${f.sel}: ${f.detail}`);
  console.log('\nADVISORY: a representative-instance static snapshot, not exhaustive or screenshot-diffed (see T51 for baseline coverage). Run with --strict to fail on any finding.');
  if (process.argv.includes('--strict')) process.exit(1);
} else {
  console.log('PASS: every checked component class shows a visible hover AND focus state change.');
}
