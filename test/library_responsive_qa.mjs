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

const ROOT = process.cwd();
const DUMP_JSON = process.argv.includes('--json');

// Deliberately includes widths well below any realistic desktop window, down to a phone-class
// width — not because the Library targets phones (the mobile shell in CLAUDE.md §4 is a
// different, dedicated layout), but because "how small can the DESKTOP shell go before it
// visibly breaks" needs an actual floor, and this repo had none. `deskx=1` and `libtest=1&
// libcat=1&libn=60` mirror wireframe_inventory.mjs's own fixture so findings are comparable.
const VIEWPORTS = [
  { w: 1440, h: 900, label: '1440x900 (normal)' },
  { w: 1024, h: 768, label: '1024x768 (small laptop)' },
  { w: 820, h: 700, label: '820x700 (narrow — the squeeze floor)' },
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
    const visibleKids = Array.from(top.children).filter((el) => {
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
          out.overlaps.push([visibleKids[i].id || visibleKids[i].className, visibleKids[j].id || visibleKids[j].className, Math.round(ix)]);
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
      const label = btn.querySelector('.lbl, span');
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
    for (const el of side.querySelectorAll('.lib-coll-lb, .rn, span')) {
      const b = el.getBoundingClientRect();
      if (b.width === 0) continue;
      if (el.scrollWidth > el.clientWidth + 1) {
        const cs = getComputedStyle(el);
        if (cs.textOverflow !== 'ellipsis' || cs.whiteSpace !== 'nowrap') {
          out.noEllipsisTruncation.push({ text: el.textContent.trim().slice(0, 30), textOverflow: cs.textOverflow, whiteSpace: cs.whiteSpace });
        }
      }
    }
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

for (const vp of VIEWPORTS) {
  await page.setViewportSize({ width: vp.w, height: vp.h });
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
    findings.push({ viewport: vp.label, kind: 'NO_ELLIPSIS', detail: `sidebar text "${t.text}" overflows its box without ellipsis truncation (text-overflow:${t.textOverflow}, white-space:${t.whiteSpace})` });
  }
}

await page.close();
await b.close();
server.close();

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
