#!/usr/bin/env node
// Responsive/squeeze audit for the Library — the thing ui_audit.mjs has never covered.
//
// ui_audit.mjs sweeps chromasmith-22.html's editor `.fx-panel` sections at three window sizes
// (?deskx=1) and has done so since it was written; it has never once pointed at the Library. So
// the rule "buttons/search never overlap, text never wraps to two lines, narrow widths get
// ellipsis truncation instead" (HANDOVER 2026-09-08 items #13/#14) had NO gate anywhere. This is
// that gate, scoped to the Library topbar/sidebar, modelled on ui_audit.mjs's own OVERLAP/FONT
// checks and Vercel's web-interface-guidelines ("MUST: Verify mobile, laptop, ultra-wide").
//
//   node test/library_responsive_qa.mjs              # PASS/FAIL table, exit 1 on any finding
//   node test/library_responsive_qa.mjs --json        # dump the full finding list
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS, settleForCapture } from './wireframe_diff_lib.mjs';
import { checkClipping, checkResizerCoverage } from './wireframe_checks_lib.mjs';

const ROOT = process.cwd();
const DUMP_JSON = process.argv.includes('--json');

// Deliberately includes widths well below any realistic desktop window, down to a phone-class
// width — not because the Library targets phones (the mobile shell in CLAUDE.md §4 is a
// different, dedicated layout), but because "how small can the DESKTOP shell go before it
// visibly breaks" needs an actual floor, and this repo had none. `deskx=1` and `libtest=1&
// libcat=1&libn=60` mirror wireframe_inventory.mjs's own fixture so findings are comparable.
// ⚠️ Sampling four widely-spaced widths let a real defect hide BETWEEN sample points: at 900px
// the search input measures 76px (below this file's own 80px floor) while at both 1024 and 820
// it is comfortably wide — the topbar's compact fallback engages somewhere in between, and the
// worst moment is the width just before it does. Widths are now dense enough around the
// wireframe's own compact breakpoint (1060, Library View.html:458) to catch that.
const VIEWPORTS = [
  { w: 1440, h: 900, label: '1440x900 (normal)' },
  { w: 1200, h: 800, label: '1200x800' },
  { w: 1100, h: 800, label: '1100x800 (just above the wireframe compact breakpoint)' },
  { w: 1059, h: 800, label: '1059x800 (wireframe compacts at <1060)' },
  { w: 1024, h: 768, label: '1024x768 (small laptop)' },
  { w: 960, h: 760, label: '960x760' },
  { w: 900, h: 760, label: '900x760 (the width the old 4-point sweep skipped)' },
  { w: 860, h: 720, label: '860x720' },
  { w: 820, h: 700, label: '820x700 (narrow — the squeeze floor)' },
  { w: 720, h: 700, label: '720x700' },
  { w: 640, h: 700, label: '640x700 (below the floor — must degrade gracefully, not overlap)' },
];

const server = createServer(async (req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const d = await readFile(path.join(ROOT, u.slice(1)));
    const ext = path.extname(u);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.otf': 'font/otf', '.wasm': 'application/wasm' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const port = server.address().port;

const b = await chromium.launch({ args: DETERMINISTIC_LAUNCH_ARGS });
const findings = []; // { viewport, kind, detail }

// Serialized in the page. Returns:
//   overlaps   — pairs of visible #lib-top children whose rects intersect (Vercel: avoid
//                unwanted scrollbars/overflow; general "buttons never collide" rule)
//   wrapped    — a button/label whose text renders on more than one line, where the wireframe's
//                own convention (and every desktop toolbar's) is single-line-or-truncate
//   searchTooNarrow — the search input's rendered width, checked against a floor below
//   noEllipsisTruncation — a sidebar row whose text overflows its box WITHOUT text-overflow:
//                ellipsis (i.e. it's just clipped or wrapping, not truncated with the trailing …
//                the wireframe and every dense list UI uses)
const AUDIT_FN = `() => {
  const out = { overlaps: [], wrapped: [], searchWidth: null, noEllipsisTruncation: [] };
  const top = document.getElementById('lib-top');
  if (top) {
    // WARNING: only DIRECT children were compared, so any pair inside a wrapper — the sort pill and
    // its menu share a position:relative div, and .lib-flagrow/.lib-zoomrow/.lib-seg each group
    // several controls — could collide entirely invisibly to this check. Descend into wrappers
    // that hold more than one control and compare the real leaf controls instead.
    // BUG (found live, not by design): recursing on el.children also recurses INTO an <svg>'s
    // own internal primitives (circle/path/rect are real DOM children of an svg element) — the
    // logo mark's <circle>/<path> were being extracted as separate top-level "controls" and
    // compared for overlap against unrelated buttons, producing nonsense findings. An SVG (and
    // anything inside one — svg.children can nest further, e.g. a <g>) is always a leaf.
    const leaves = (root) => Array.from(root.children).flatMap((el) => {
      if (el instanceof SVGElement) return [el];
      const isControl = /^(BUTTON|INPUT|SELECT|A)$/.test(el.tagName);
      const kids = Array.from(el.children).filter((k) => k.getBoundingClientRect().width > 0);
      return (!isControl && kids.length > 1) ? leaves(el) : [el];
    });
    const visibleKids = leaves(top).filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0;
    });
    for (let i = 0; i < visibleKids.length; i++) {
      for (let j = i + 1; j < visibleKids.length; j++) {
        const a = visibleKids[i].getBoundingClientRect(), b = visibleKids[j].getBoundingClientRect();
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ix > 1 && iy > 1) {
          // className is an SVGAnimatedString on <svg>, which stringifies to "[object Object]".
          var nm = function (el) {
            if (el.id) return '#' + el.id;
            var t = (el.getAttribute && el.getAttribute('title')) || '';
            var c = typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '');
            var lbl = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 18);
            return (c ? '.' + c.trim().split(/\s+/).join('.') : el.tagName.toLowerCase())
              + (t ? ' "' + t + '"' : (lbl ? ' "' + lbl + '"' : ''));
          };
          out.overlaps.push([nm(visibleKids[i]), nm(visibleKids[j]), Math.round(ix)]);
        }
      }
    }
    // A button's own single-line height is its line-height (or ~1.2x font-size as a fallback);
    // anything visibly TALLER than that is wrapping its label onto a second line.
    for (const btn of top.querySelectorAll('button')) {
      const cs = getComputedStyle(btn);
      const b = btn.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
      // WARNING: ".lbl, span" took the FIRST span in document order — which on an icon+label button
      // is often the icon wrapper, so the check measured the icon and never saw the label wrap.
      // Prefer the explicit .lbl; fall back to the last span that actually holds text.
      const label = btn.querySelector('.lbl')
        || [...btn.querySelectorAll('span')].reverse().find((sp) => sp.textContent.trim());
      if (!label) continue;
      const lb = label.getBoundingClientRect();
      if (lb.height > lh * 1.6 && lb.width > 0) {
        out.wrapped.push({ id: btn.id || btn.className, text: label.textContent.trim().slice(0, 30), h: Math.round(lb.height), lineH: Math.round(lh) });
      }
    }
    const search = document.getElementById('lib-search');
    if (search) out.searchWidth = Math.round(search.getBoundingClientRect().width);
  }
  const side = document.getElementById('lib-side');
  if (side) {
    // REWRITTEN. The previous version gated on "scrollWidth > clientWidth", which is only
    // ever true for an element that ALREADY has the overflow:hidden + white-space:nowrap it was
    // checking for the absence of. A label that simply WRAPS has scrollWidth === clientWidth, so
    // the exact defect this was written for could never be seen. (It also looked for ".rn",
    // a wireframe-only class that does not exist in the app, and bare "span"s whose
    // clientWidth is 0.) It now PROVES the behaviour: substitute a 60-character label into a
    // real row and measure whether the row grows taller.
    const LONG = 'A deliberately long folder name for truncation testing';
    for (const el of side.querySelectorAll('.lib-coll-lb, .lib-tree-lb')) {
      const row = el.closest('.lib-coll-row, .lib-tree-row') || el.parentElement;
      if (!row || row.getBoundingClientRect().width === 0) continue;
      const before = row.getBoundingClientRect().height;
      const orig = el.textContent;
      el.textContent = LONG;
      const after = row.getBoundingClientRect().height;
      el.textContent = orig;
      if (after > before + 2) {
        const cs = getComputedStyle(el);
        out.noEllipsisTruncation.push({ text: orig.trim().slice(0, 24), cls: el.className,
          grew: Math.round(before) + 'px -> ' + Math.round(after) + 'px', textOverflow: cs.textOverflow, whiteSpace: cs.whiteSpace });
      }
      break; // one representative row per class is enough — they share a stylesheet rule
    }
    // The sidebar can also be dragged narrow independently of the window; a label that fits at
    // the default 230px may not at the 150px floor. Nothing exercised that path before.
    out.sideWidth = Math.round(side.getBoundingClientRect().width);
  }
  return out;
}`;

const SEARCH_MIN_WIDTH = 80; // px — below this a search box isn't usable at all; Vercel's own
// guideline is "if the whole label doesn't fit, switch to an icon", i.e. the search box should
// either hold a sane floor width or the row should restructure — never just keep shrinking.

const page = await b.newPage({ ...DETERMINISTIC_CONTEXT_OPTIONS });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libcat=1&libn=60&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#lib-grid .lib-card', { timeout: 20000 }).catch(() => {});
await page.evaluate(() => {
  document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); });
  document.getElementById('lib-overlay')?.classList.add('full');
});
await settleForCapture(page);

// ── Layout matrix (added 2026-09-11, same reason as editor_responsive_qa.mjs's): CLIP runs at
// every viewport x every sidebar width (library-ui.js clamps --lib-side-w to 150-420, default
// 230), and checkResizerCoverage fails if the page has a resizer this list doesn't name.
// lib-dock-resizer belongs to the DOCKED filmstrip, which editor_responsive_qa.mjs's matrix covers.
const SIDE_WIDTHS = [150, 230, 420];
// fx-panel-resizer / fx-rail-resizer are the Editor's, present in this DOM too; editor_responsive_qa.mjs covers them.
findings.push(...await checkResizerCoverage(page, ['lib-side-resizer', 'lib-dock-resizer', 'fx-panel-resizer', 'fx-rail-resizer'], 'page load'));
for (const vp of VIEWPORTS) {
  await page.setViewportSize({ width: vp.w, height: vp.h });
  for (const sw of SIDE_WIDTHS) {
    await page.evaluate((w) => document.getElementById('lib-overlay')?.style.setProperty('--lib-side-w', w + 'px'), sw);
    await page.waitForTimeout(80);
    for (const f of await checkClipping(page, '#lib-overlay', vp.label)) findings.push({ ...f, detail: `${f.detail} (sidebar ${sw}px)` });
  }
  await page.evaluate(() => document.getElementById('lib-overlay')?.style.setProperty('--lib-side-w', '230px'));
  await page.waitForTimeout(200); // let any resize-driven layout (fxPreviewMaxH etc.) settle
  const result = await page.evaluate(`(${AUDIT_FN})()`);

  for (const [a, bId, overlapPx] of result.overlaps) {
    findings.push({ viewport: vp.label, kind: 'OVERLAP', detail: `"${a}" overlaps "${bId}" by ${overlapPx}px` });
  }
  for (const w of result.wrapped) {
    findings.push({ viewport: vp.label, kind: 'WRAP', detail: `button "${w.id}" label "${w.text}" wrapped to a second line (${w.h}px tall vs ${w.lineH}px line-height)` });
  }
  if (result.searchWidth != null && result.searchWidth < SEARCH_MIN_WIDTH) {
    findings.push({ viewport: vp.label, kind: 'SEARCH_FLOOR', detail: `search input is ${result.searchWidth}px, below the ${SEARCH_MIN_WIDTH}px usability floor` });
  }
  for (const t of result.noEllipsisTruncation) {
    findings.push({ viewport: vp.label, kind: 'NO_ELLIPSIS', detail: `sidebar row .${t.cls} (sidebar ${result.sideWidth}px wide) GROWS ${t.grew} when given a 60-character label — it wraps instead of truncating (text-overflow:${t.textOverflow}, white-space:${t.whiteSpace})` });
  }

  // ── MENU_OVERFLOW: an open sort/gear menu must stay inside the viewport at every swept
  // width, not just the 1440px width wireframe_inventory.mjs happens to check. A menu
  // positioned via `right:0` on its topbar wrapper can clip off the LEFT edge once the wrapper
  // itself has been pushed close to the window's left side by a squeezed layout — the opposite
  // direction from what a right-anchored menu's own math naturally guards against.
  for (const m of [{ id: 'lib-sort-menu', btn: 'lib-sort-btn' }, { id: 'lib-view-menu', btn: 'lib-view-menu-btn' }]) {
    await page.click('#' + m.btn).catch(() => {});
    await page.waitForTimeout(120);
    const box = await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el || getComputedStyle(el).display === 'none') return null;
      const b = el.getBoundingClientRect();
      return { left: Math.round(-b.left), right: Math.round(b.right - window.innerWidth) };
    }, m.id);
    await page.click('#' + m.btn).catch(() => {});
    await page.waitForTimeout(80);
    if (!box) continue;
    if (box.left > 1) findings.push({ viewport: vp.label, kind: 'MENU_OVERFLOW', detail: `#${m.id} clips ${box.left}px past the LEFT edge of the viewport` });
    if (box.right > 1) findings.push({ viewport: vp.label, kind: 'MENU_OVERFLOW', detail: `#${m.id} extends ${box.right}px past the RIGHT edge of the viewport` });
  }
}

// ── Second pass: the sidebar dragged to its own narrow floor, at a normal window width. A
// label that fits the default 230px sidebar can still wrap at 150px, and nothing exercised the
// resizer before — the sweep only ever shrank the WINDOW.
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(150);
await page.evaluate(() => {
  const ov = document.getElementById('lib-overlay');
  if (ov) ov.style.setProperty('--lib-side-w', '150px');
});
await page.waitForTimeout(200);
{
  const result = await page.evaluate(`(${AUDIT_FN})()`);
  for (const t of result.noEllipsisTruncation) {
    findings.push({ viewport: '1440x900, sidebar dragged to its 150px floor', kind: 'NO_ELLIPSIS', detail: `sidebar row .${t.cls} GROWS ${t.grew} when given a 60-character label at the narrow sidebar floor` });
  }
  // ── SIDEBAR_OVERLAP: at the floor width, the sidebar's own right edge must not extend past
  // where the main content column (#lib-main) begins — a CSS grid-template-columns var that
  // doesn't track --lib-side-w exactly (or a stale cached column width) would let the two
  // regions overlap instead of the grid genuinely narrowing, invisible to every check above
  // since none of them compare the sidebar against ANYTHING outside itself.
  const overlap = await page.evaluate(() => {
    const side = document.getElementById('lib-side');
    const main = document.getElementById('lib-main');
    if (!side || !main) return null;
    const sb = side.getBoundingClientRect(), mb = main.getBoundingClientRect();
    return Math.round(sb.right - mb.left);
  });
  if (overlap != null && overlap > 1) {
    findings.push({ viewport: '1440x900, sidebar dragged to its 150px floor', kind: 'SIDEBAR_OVERLAP', detail: `#lib-side's right edge sits ${overlap}px INSIDE #lib-main — the grid didn't actually narrow to match --lib-side-w` });
  }
}

await page.close();
await b.close();
server.close();

{ // the same cut-off repeated once per thumbnail is one defect, not forty
  const seen = new Set(); const uniq = [];
  for (const f of findings) { const k = f.viewport + '|' + f.kind + '|' + f.detail; if (!seen.has(k)) { seen.add(k); uniq.push(f); } }
  findings.length = 0; findings.push(...uniq);
}
if (DUMP_JSON) {
  console.log(JSON.stringify(findings, null, 2));
} else {
  const byKind = new Map();
  for (const f of findings) { if (!byKind.has(f.kind)) byKind.set(f.kind, []); byKind.get(f.kind).push(f); }
  console.log(`library_responsive_qa: ${findings.length} finding(s) across ${VIEWPORTS.length} viewports\n`);
  for (const [kind, list] of byKind) {
    console.log(`  ${kind} (${list.length})`);
    for (const f of list.slice(0, 15)) console.log(`    [${f.viewport}] ${f.detail}`);
    if (list.length > 15) console.log(`    ...and ${list.length - 15} more`);
  }
  console.log(findings.length ? '\nRESULT: FAIL' : '\nRESULT: PASS');
}
process.exit(findings.length ? 1 : 0);
