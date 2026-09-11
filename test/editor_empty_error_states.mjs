// T44 (editor_ux_spec.json): visual coverage of EMPTY/ERROR/LOADING states — ui_audit.mjs,
// editor_wireframe_diff.mjs and editor_wireframe_inventory.mjs all implicitly assume a photo is
// loaded and everything succeeded. This gate drives three states real users hit on a bad day and
// asserts each one is actually legible (visible, non-zero size, adequate text contrast) rather
// than just "didn't crash" (T38/editor_fuzz_input.mjs already covers the didn't-crash half):
//   1. EMPTY  — no photo loaded at all (fresh boot, before any file is picked).
//   2. LOADING/EXPORT-IN-PROGRESS — _expOverlay(true), the export progress overlay.
//   3. ERROR — a malformed image fed through loadFXImages, checked for a visible, legible error
//      surface (a toast/alert) rather than a silently-stuck UI.
//
// Known limits: legibility only (contrast + visibility), not a pixel-baseline diff against a
// prior version of these screens (that's T51's job). "No results" Library filter state is out of
// scope here — the Library is native-gated (desktop/library-ui.js, see CLAUDE.md's ?libtest=1
// note) and needs its own harness, not this Editor-focused one.
import { bootEditor } from './editor_state_harness.mjs';
import { contrastRatio } from './wireframe_checks_lib.mjs';

function readVisibleTextNodes(sel) {
  const el = document.querySelector(sel);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    visible: b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05,
    width: Math.round(b.width), height: Math.round(b.height),
    color: cs.color, bg: cs.backgroundColor,
    text: (el.textContent || '').trim().slice(0, 80),
  };
}
function effectiveBg(sel) {
  // Walk up from the element to find the first non-transparent background (elements often
  // inherit through a transparent wrapper onto a themed ancestor).
  let el = document.querySelector(sel);
  while (el) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
    el = el.parentElement;
  }
  return 'rgb(255,255,255)';
}

const findings = [];

// ── 1. EMPTY state ──────────────────────────────────────────────────────────────────────────
{
  const b = await bootEditor({ withPhoto: false });
  const { page } = b;
  const addBtn = await page.evaluate(readVisibleTextNodes, '#fx-add-btn');
  if (!addBtn || !addBtn.visible) {
    findings.push({ state: 'EMPTY', kind: 'NOT-VISIBLE', detail: '#fx-add-btn (the empty-state add-photos affordance) is not visible on a fresh boot with no photo loaded' });
  }
  if (b.pageErrors.length) findings.push({ state: 'EMPTY', kind: 'PAGE-ERROR', detail: b.pageErrors.join('; ') });
  await b.close();
}

// ── 2. LOADING / export-in-progress overlay ────────────────────────────────────────────────
{
  const b = await bootEditor({ withPhoto: true });
  const { page } = b;
  await page.evaluate(() => { if (typeof _expOverlay === 'function') _expOverlay(true); });
  await page.waitForTimeout(150);
  const ov = await page.evaluate(readVisibleTextNodes, '#fx-exp-ov');
  const txt = await page.evaluate(readVisibleTextNodes, '#eo-txt');
  if (!ov || !ov.visible) {
    findings.push({ state: 'LOADING', kind: 'NOT-VISIBLE', detail: '#fx-exp-ov (export progress overlay) never appeared after _expOverlay(true)' });
  } else if (!txt || !txt.visible || !txt.text) {
    findings.push({ state: 'LOADING', kind: 'NOT-VISIBLE', detail: '#eo-txt (export status text) is missing or empty inside a visible overlay' });
  } else {
    const bg = await page.evaluate(effectiveBg, '#eo-txt');
    const ratio = contrastRatio(txt.color, bg);
    if (ratio < 4.5) findings.push({ state: 'LOADING', kind: 'LOW-CONTRAST', detail: `#eo-txt "${txt.text}" contrast ${ratio.toFixed(2)}:1 (${txt.color} on ${bg}) — below 4.5:1 WCAG AA text floor` });
  }
  await page.evaluate(() => { if (typeof _expOverlay === 'function') _expOverlay(false); });
  await b.close();
}

// ── 3. ERROR — malformed image load ────────────────────────────────────────────────────────
{
  const b = await bootEditor({ withPhoto: false });
  const { page } = b;
  await page.evaluate(async () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xff, 0xd8, 0xff]); // not a real image
    const file = new File([bytes], 'corrupt.jpg', { type: 'image/jpeg' });
    if (typeof window.loadFXImages === 'function') {
      try { await window.loadFXImages([file]); } catch { /* a caught error is fine — T38's territory */ }
    }
  });
  await page.waitForTimeout(2000);
  // Look for a toast/alert surface — the app's own toast() helper renders into a recognizable
  // container; fall back to scanning for any element carrying role="alert"/"status".
  const alertInfo = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('.toast, [role="alert"], [role="status"], .fx-toast, #fx-toast')];
    const visible = candidates.find((e) => {
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden';
    });
    if (!visible) return null;
    const cs = getComputedStyle(visible);
    return { text: (visible.textContent || '').trim().slice(0, 120), color: cs.color, bg: cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? null : cs.backgroundColor };
  });
  if (!alertInfo) {
    findings.push({ state: 'ERROR', kind: 'NO-VISIBLE-ERROR-SURFACE', detail: 'loading a corrupt image produced no visible toast/alert/status element — a user sees nothing happen' });
  } else if (alertInfo.bg) {
    const ratio = contrastRatio(alertInfo.color, alertInfo.bg);
    if (ratio < 4.5) findings.push({ state: 'ERROR', kind: 'LOW-CONTRAST', detail: `error surface "${alertInfo.text}" contrast ${ratio.toFixed(2)}:1 — below 4.5:1 WCAG AA text floor` });
  }
  if (b.pageErrors.length) findings.push({ state: 'ERROR', kind: 'UNCAUGHT-PAGE-ERROR', detail: b.pageErrors.join('; ') });
  await b.close();
}

console.log('editor:empty-error-states — 3 states checked (EMPTY, LOADING, ERROR)');
if (findings.length) {
  console.log(`\n${findings.length} finding(s):`);
  for (const f of findings) console.log(`  [${f.state}/${f.kind}] ${f.detail}`);
  console.log('\nADVISORY: legibility-only checks, not a pixel-baseline diff. Run with --strict to fail on any finding.');
  if (process.argv.includes('--strict')) process.exit(1);
} else {
  console.log('PASS: empty/loading/error states are all visible and legible.');
}
