#!/usr/bin/env node
// ── UI AUDIT GATE ────────────────────────────────────────────────────────────────────────────
// Loads the REAL chromasmith-22.html in the desktop shell layout (?deskx=1) and walks every
// tool section at three window sizes, asserting a set of layout invariants that are cheap for a
// machine to check and expensive for a human to eyeball.
//
//   node test/ui_audit.mjs              # PASS/FAIL table, exit 1 on regression
//   node test/ui_audit.mjs --baseline   # write test/output/ui_audit_baseline.json instead
//   node test/ui_audit.mjs --json       # dump the full finding list
//
// WHY THIS EXISTS
// Three of the defects this gate covers shipped unnoticed for a long time because they are
// invisible in a screenshot of the DEFAULT panel and only appear once a panel grows tall:
//
//   FRAGMENT  .fx-panel is a CSS multi-column container (chromasmith-22.html `.fx-panel{
//             column-count:2}`) and body.deskx gives it a definite height. Per CSS multicol,
//             content that overflows a definite-height multicol spawns EXTRA COLUMNS along the
//             inline axis instead of scrolling. The result: scrollTop is pinned at 0, the panel
//             cannot be scrolled vertically at all, and everything past the first screenful is
//             rendered off to the right where no affordance reveals it. Measured on the Masks
//             panel at 1440x820 before the fix: scrollWidth 937 vs clientWidth 319 (4 columns).
//
//   ORDER     .fx-label is `order:1` while .fx-slider is `order:3` and .fx-val is `order:2`.
//             Any control that is none of those three keeps the flex default `order:0` and is
//             therefore painted BEFORE its own label. Checkboxes, button groups and colour
//             inputs all hit this, so rows read "Match pick Swatch Custom | Target".
//
//   OVERLAP   two visible siblings whose rects intersect.
//
// Plus two legibility floors (tap target, font size) and a WCAG contrast check computed
// directly — no axe-core dependency, so this harness stays as offline as the app it tests.
//
// The browser/serve boilerplate deliberately mirrors export_harness.mjs.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// Baselines live in test/baselines/, NOT test/output/ — the latter is gitignored, so a baseline
// stored there would silently vanish on a fresh checkout and every run would report "no baseline".
const OUT_DIR = path.join(__dirname, 'baselines');
const BASELINE = path.join(OUT_DIR, 'ui_audit_baseline.json');
const WRITE_BASELINE = process.argv.includes('--baseline');
const DUMP_JSON = process.argv.includes('--json');

// Every rail section key in FX_SECTIONS, plus the deskx group keys those collapse into.
// ⚠️ Keep in sync with FX_SECTIONS/FX_GROUPS. A section missing here is simply never opened, so
// it is never measured — which is how `retouch` went unaudited for as long as it went unreachable.
const SECTIONS = ['image', 'looks', 'adjust', 'color', 'detail', 'retouch', 'film', 'frame',
  'local', 'crop', 'export', 'info'];

// Source files the token check reads. Anything that writes CSS the app renders belongs here.
const TOKEN_SOURCES = ['chromasmith-22.html', 'desktop/library-ui.js', 'desktop/desktop-native.js'];
const VIEWPORTS = [
  { w: 1440, h: 820, label: '1440x820' },   // 13" MacBook, the tightest realistic desktop
  { w: 1600, h: 1000, label: '1600x1000' },
  { w: 1280, h: 720, label: '1280x720' },   // smallest window worth supporting
];

const MIN_TAP = 28;   // px — below this a pointer target is uncomfortable
// Small inline affordances are held to a lower floor ON PURPOSE. A checkbox or a colour swatch
// sitting inside a labelled row is not a button: every desktop photo tool draws them at 16-22px,
// and inflating them to 28px would make dense panels worse, not better. They still have to clear
// 18px — the point of the exemption is to name the two shapes it covers, not to stop measuring.
const MIN_TAP_INLINE = 18;
const INLINE_TARGET_SEL = 'input[type=checkbox], input[type=color], input[type=radio], .pc-chip';
// Edge drag handles (the tool-panel and tool-rail resizers) are deliberately thin on ONE axis and
// full-height on the other: 7x776 is a larger pointer target than any button in the app, and the
// platform convention for a col-resize edge is 5-8px. Widening one to 28px would put an invisible
// grab strip over 28px of the panel's own controls. They are still measured — on their long axis,
// against the ordinary floor — so a handle that collapses to nothing still fails.
const EDGE_TARGET_SEL = '.fx-edge';
const MIN_FONT = 11;  // px — below this UI text stops being comfortably legible
const MIN_CONTRAST = 4.5;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.png': 'image/png', '.json': 'application/json',
  '.css': 'text/css', '.cube': 'text/plain' };

function startServer(root) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        const filePath = path.join(root, urlPath === '/' ? '/index.html' : urlPath);
        if (!filePath.startsWith(root)) { res.writeHead(403); res.end(); return; }
        const data = await readFile(filePath);
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      } catch { res.writeHead(404); res.end('not found'); }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// ── 0. TOKEN — a source check, not a render one. ─────────────────────────────────────────────
// Every `var(--x)` must resolve to something the design system actually defines. It is worth a
// gate because the failure is SILENT and cosmetic-looking: an undefined token with a fallback
// quietly paints an off-palette literal that no theme can reach, and one WITHOUT a fallback
// resolves to nothing at all. Both shipped here. The set found when this check was written:
//   --accent,#4a9eff  the denoise progress bar rendered blue; every other bar in the app is amber
//   --bg3,#2a2a2a     its track, off-palette
//   --sur1            no fallback -> a default white system <select> on a dark panel
//   --sur3 x7         popover/menu hover, frozen at rgba(255,255,255,.08)
//   --rad-1,6px x3    a second radius scale competing with --r
//   --fg,#eee         dialog text, missing the real --txt and the light theme with it
// Each was a later feature written against a GUESSED token vocabulary instead of the one in
// :root — so the check reports the name and every site, and says which vocabulary is real.
/// Blanks comments (and, inside JS only, string literals), preserving every newline and the
/// original length so line numbers computed against the result stay true to the source.
///
/// ⚠️ The region matters, and getting it wrong is how this check spent a long time with a blind
/// spot. Two real cases from this repo, both found by measuring rather than reasoning:
///
///   · `'video/*,.mp4,.mov,.m4v'` — a `/*` inside a JS STRING. Treated as code, it opens a block
///     comment that the scanner closes at the next `*/` **3,940 lines later** (7644-11584), so
///     every var() and setProperty in between is invisible. That is what made `--app-h` report as
///     "never setProperty'd" when its setProperty call sits at line 8958, inside the hole.
///   · A prose apostrophe in CSS or markup — `don't`. Treated as a string delimiter, it blanks
///     everything up to the next apostrophe, which swallowed the whole `:root` block and reported
///     all 25 real design tokens (`--acc`, 72 uses) as undefined.
///
/// So strings are blanked inside <script> and .js only; CSS and markup get comments stripped but
/// their quotes left alone.
function stripRegion(src, isJs) {
  const out = Array.from(src);
  const blank = (i) => { if (out[i] !== '\n') out[i] = ' '; };
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      for (let k = i; k < stop; k++) blank(k);
      i = stop; continue;
    }
    // `//` is a comment in JS only, and only when not preceded by `:` (else every https:// URL
    // swallows its line). CSS has no line comments.
    if (isJs && c === '/' && d === '/' && src[i - 1] !== ':') {
      let k = i;
      while (k < n && src[k] !== '\n') blank(k++);
      i = k; continue;
    }
    if (isJs && (c === '"' || c === "'" || c === '`')) {
      let k = i + 1;
      while (k < n) {
        if (src[k] === '\\') { k += 2; continue; }
        if (src[k] === c) { k++; break; }
        k++;
      }
      for (let j = i; j < Math.min(k, n); j++) blank(j);
      i = k; continue;
    }
    i++;
  }
  return out.join('');
}

/// Splits an HTML file into <script> (JS rules) and everything else (CSS/markup rules), so each
/// region is stripped by the language it actually is.
function stripComments(src, file) {
  if (!/\.html?$/i.test(file)) return stripRegion(src, true);   // a .js file is all JS
  let out = '';
  let i = 0;
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(src))) {
    const bodyStart = m.index + m[0].indexOf('>') + 1;
    out += stripRegion(src.slice(i, bodyStart), false);
    out += stripRegion(src.slice(bodyStart, bodyStart + m[1].length), true);
    i = bodyStart + m[1].length;
  }
  out += stripRegion(src.slice(i), false);
  return out;
}

function auditTokens(sources) {
  const defined = new Set(), runtime = new Set(), used = new Map();
  for (const { file, text: raw } of sources) {
    // Blank out comments before scanning, preserving newlines so reported line numbers stay
    // true. Without this the check reports its own prose: a comment explaining that
    // `var(--pan,…)` used to be a phantom reads to the regex as a live use of --pan.
    //
    // ⚠️ This is a single left-to-right scan, NOT two regex passes, and the difference is not
    // cosmetic. The previous version stripped /* */ first and // second, so a `//` comment that
    // merely CONTAINED the characters `/*` opened a block comment the regex then closed at the
    // next `*/` thousands of lines later. Measured on chromasmith-22.html: one such line opened a
    // phantom comment spanning lines 7042-11584 — **4,542 lines the token check silently never
    // scanned**, which is both a false negative for every var() in that range and the false
    // POSITIVE that surfaced it (--app-h, whose setProperty call sits at line 8958, inside the
    // blanked region). Swapping the order just moves the bug; only a real scan fixes it.
    const text = stripComments(raw, file);
    // Any `--name:` declaration counts, wherever it lives (:root, body.light, a media query).
    for (const m of text.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(m[1]);
    // ⚠️ Read from the RAW source, not the stripped one: the token name lives INSIDE a string
    // literal (`setProperty('--app-h', …)`), and JS string-blanking necessarily destroys it. A
    // setProperty that only appears in a comment would at worst whitelist a token that is never
    // written, which under-reports by one rather than fabricating a failure — the safe direction.
    for (const m of raw.matchAll(/setProperty\(\s*['"`](--[a-zA-Z0-9-]+)/g)) runtime.add(m[1]);
    for (const m of text.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*(,)?/g)) {
      const line = text.slice(0, m.index).split('\n').length;
      if (!used.has(m[1])) used.set(m[1], []);
      used.get(m[1]).push({ file, line, hasFallback: !!m[2] });
    }
  }
  const findings = [];
  for (const [tok, sites] of [...used].sort()) {
    if (defined.has(tok) || runtime.has(tok)) continue;
    const where = sites.map(s => `${s.file}:${s.line}`).join(', ');
    findings.push({
      kind: 'TOKEN', section: 'source', viewport: '-', el: tok,
      detail: `used ${sites.length}x but never defined and never setProperty'd`
        + `${sites.every(s => s.hasFallback) ? '' : ' (and NO fallback — resolves to nothing)'} — ${where}`,
    });
  }
  return findings;
}

// ── the in-page audit. Runs once per (section, viewport). ───────────────────────────────────
function auditInPage({ minTap, minTapInline, inlineSel, edgeSel, minFont, minContrast }) {
  const out = [];
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity || '1') > 0.05;
  };
  const desc = (el) => {
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 34);
    const id = el.id ? '#' + el.id : '';
    const cl = (el.className || '').toString().split(' ').filter(Boolean)[0];
    return `${el.tagName.toLowerCase()}${id}${cl ? '.' + cl : ''}${t ? ` "${t}"` : ''}`;
  };

  // ── 1. FRAGMENT — the multicol trap. Also flags any panel that cannot scroll to its content.
  const panel = document.querySelector('.fx-panel');
  if (panel) {
    if (panel.scrollWidth > panel.clientWidth + 2) {
      out.push({ kind: 'FRAGMENT', el: '.fx-panel',
        detail: `scrollWidth ${panel.scrollWidth} > clientWidth ${panel.clientWidth}`
          + ` (~${Math.round(panel.scrollWidth / Math.max(1, panel.clientWidth))} columns)` });
    }
    // Content taller than the panel MUST be reachable by vertical scrolling.
    const card = document.querySelector('.fx-ctrl.sec-active');
    if (card && card.scrollHeight > panel.clientHeight + 2 && panel.scrollHeight <= panel.clientHeight + 2) {
      out.push({ kind: 'FRAGMENT', el: '.fx-panel',
        detail: `content ${card.scrollHeight}px in a ${panel.clientHeight}px panel but scrollHeight `
          + `${panel.scrollHeight} — vertical scroll cannot reach it` });
    }
  }

  // ── 2. ORDER — a non-.fx-val control painted to the left of its own label on the same line.
  document.querySelectorAll('.fx-row').forEach((row) => {
    if (!vis(row)) return;
    const label = row.querySelector(':scope > .fx-label');
    if (!label || !vis(label)) return;
    const lb = label.getBoundingClientRect();
    [...row.children].forEach((c) => {
      if (c === label || !vis(c)) return;
      if (c.classList.contains('fx-val')) return;          // the value readout is meant to sit right of the label
      const cb = c.getBoundingClientRect();
      const sameLine = cb.top < lb.bottom - 2 && cb.bottom > lb.top + 2;
      if (sameLine && cb.left < lb.left) {
        out.push({ kind: 'ORDER', el: desc(row), detail: `${desc(c)} paints before its label "${label.textContent.trim().slice(0, 26)}"` });
      }
    });
  });

  // ── 3. TAP / FONT — legibility floors, restricted to what is actually on screen.
  const seen = new Set();
  document.querySelectorAll('button, .fx-rail-btn, .fx-sec-btn, .fx-db, select, input[type=checkbox], input[type=color]')
    .forEach((el) => {
      if (!vis(el)) return;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return;
      const k = desc(el) + Math.round(r.top);
      if (seen.has(k)) return; seen.add(k);
      if (el.matches(edgeSel)) {
        const long = Math.max(r.width, r.height), short = Math.min(r.width, r.height);
        if (long < minTap || short < 5) {
          out.push({ kind: 'TAP', el: desc(el), detail: `edge handle ${Math.round(r.width)}x${Math.round(r.height)}` });
        }
        return;
      }
      const floor = el.matches(inlineSel) ? minTapInline : minTap;
      if (r.height < floor || r.width < floor) {
        out.push({ kind: 'TAP', el: desc(el), detail: `${Math.round(r.width)}x${Math.round(r.height)} < ${floor}` });
      }
    });
  document.querySelectorAll('.fx-label, .fx-val, .fx-rail-lb, .fx-sec-lb, .fx-ctrl-title, .fx-sub, button, .fx-select')
    .forEach((el) => {
      if (!vis(el)) return;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      if (!(el.textContent || '').trim()) return;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs > 0 && fs < minFont) {
        const k = 'F' + desc(el) + Math.round(r.top);
        if (seen.has(k)) return; seen.add(k);
        out.push({ kind: 'FONT', el: desc(el), detail: `${fs}px < ${minFont}px` });
      }
    });

  // ── 3b. SPILL — content wider than its own box, with overflow:visible so it paints outside it.
  // The rect-vs-rect OVERLAP check below cannot see this: the deskbar's centre title had a 25px
  // box (so it "didn't overlap" anything) while the filename text inside it spilled ~75px and
  // painted straight over the tool cluster. Flex children with min-width:0 shrink their BOX to
  // nothing and let text escape, which is exactly the case worth catching.
  document.querySelectorAll('#fx-deskbar *, .fx-panel .fx-row > *, #fx-toolrail *').forEach((el) => {
    if (!vis(el) || el.children.length) return;                 // leaf text nodes only
    if (!(el.textContent || '').trim()) return;
    const cs = getComputedStyle(el);
    if (cs.overflow !== 'visible') return;                      // clipping is the fix, not the bug
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      out.push({ kind: 'SPILL', el: desc(el),
        detail: `content ${el.scrollWidth}px spills a ${el.clientWidth}px box (overflow:visible)` });
    }
  });

  // ── 4. OVERLAP — two visible siblings whose boxes intersect by more than a hairline.
  // Generic on purpose: instead of a hand-maintained list of bar/panel selectors (which silently
  // stops covering a NEW bar the day it's added — exactly how the Library topbar redesign shipped
  // with no automated overlap check at all), this walks every element in the document and treats
  // ANY flex/grid container as a "control row" worth checking. Every overlap bug this file has on
  // record (§10.8/§10.9 in CLAUDE.md, the deskbar title spill, the Library topbar's own left/
  // right clusters) was a flex or grid layout mistake, so keying off `display` instead of a
  // selector list covers the whole app — current bars AND any future one — for free.
  const OVERLAP_TOL = 2;
  document.querySelectorAll('body *').forEach((parent) => {
    if (!vis(parent)) return;
    const d = getComputedStyle(parent).display;
    if (d !== 'flex' && d !== 'inline-flex' && d !== 'grid' && d !== 'inline-grid') return;
    const kids = [...parent.children].filter(vis);
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
        // Absolutely/fixed-positioned overlays are legitimately stacked — skip them.
        if (getComputedStyle(kids[i]).position !== 'static' || getComputedStyle(kids[j]).position !== 'static') continue;
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > OVERLAP_TOL && oy > OVERLAP_TOL) {
          out.push({ kind: 'OVERLAP', el: desc(kids[i]), detail: `overlaps ${desc(kids[j])} by ${Math.round(ox)}x${Math.round(oy)}px in ${desc(parent)}` });
        }
      }
    }
  });

  // ── 4b. MENU — every dropdown/popover must (a) stay fully on-screen and (b) open directly under
  // the button that triggered it, not float off in some unrelated corner. Written after shipping
  // the Library topbar redesign with a sort-menu that anchored `right:0` off a wrapper which had
  // moved to the LEFT of the bar — the popover rendered 230px off the left edge of the window, and
  // nothing in the test suite would have caught it short of a human clicking it.
  //
  // Generic by naming convention, not a hardcoded id list: every dropdown/popover in this codebase
  // already has "menu" in its class or id (.lib-menu, #fx-settings-menu, .msk-more-menu, …) and
  // sits as a sibling of its trigger <button> inside a shared `position:relative` wrapper — that
  // structural pattern, not a specific selector, is what this walks. A future menu only needs to
  // follow the same two conventions (name contains "menu", lives next to its trigger button) to be
  // covered automatically.
  document.querySelectorAll('[class*="menu" i], [id*="menu" i]').forEach((menu) => {
    if (vis(menu)) return; // only interested in menus that start closed, so opening them is a real state change
    const wrap = menu.parentElement;
    if (!wrap) return;
    const trigger = wrap.querySelector(':scope > button') || wrap.previousElementSibling;
    if (!trigger || trigger.tagName !== 'BUTTON' || !vis(trigger)) return;
    trigger.click();
    const opened = vis(menu);
    if (opened) {
      const m = menu.getBoundingClientRect(), t = trigger.getBoundingClientRect();
      if (m.left < -OVERLAP_TOL || m.top < -OVERLAP_TOL || m.right > innerWidth + OVERLAP_TOL || m.bottom > innerHeight + OVERLAP_TOL) {
        out.push({ kind: 'MENU', el: desc(menu), detail: `off-screen: ${Math.round(m.left)},${Math.round(m.top)} to ${Math.round(m.right)},${Math.round(m.bottom)} in a ${innerWidth}x${innerHeight} viewport` });
      }
      const belowGap = m.top - t.bottom;
      const hOverlap = Math.min(m.right, t.right) - Math.max(m.left, t.left);
      if (belowGap < -2 || belowGap > 12 || hOverlap < -2) {
        out.push({ kind: 'MENU', el: desc(menu), detail: `not anchored under ${desc(trigger)} — gap ${Math.round(belowGap)}px, h-overlap ${Math.round(hOverlap)}px` });
      }
    }
    trigger.click(); // close again — leave state clean for every check that runs after this one
    if (vis(menu)) menu.classList.remove('open', 'on'); // belt-and-suspenders if the second click didn't toggle it closed
  });

  // ── 5. CONTRAST — WCAG 2.1 relative luminance against the nearest opaque painted ancestor.
  const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  const parse = (s) => { const m = (s || '').match(/[\d.]+/g); return m ? m.slice(0, 4).map(Number) : null; };
  // Walks up to the nearest ancestor that actually paints an opaque background. Returns null if
  // it hits a gradient/image first: `background-image` does not surface as a computed colour, so
  // guessing would produce a false failure — the primary Export button is black-on-amber via
  // `linear-gradient`, which naively measured as 1.28:1 against the dark panel behind it.
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = parse(cs.backgroundColor);
      if (c && (c[3] === undefined || c[3] > 0.85)) return c;
      n = n.parentElement;
    }
    return [23, 23, 27];
  };
  document.querySelectorAll('.fx-label, .fx-val, .fx-rail-lb, .fx-ctrl-title, .fx-sub, button, .fx-select')
    .forEach((el) => {
      if (!vis(el) || !(el.textContent || '').trim()) return;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      const fg = parse(getComputedStyle(el).color); if (!fg) return;
      if (fg[3] !== undefined && fg[3] < 0.6) return;    // deliberately faded (disabled/dimmed) text
      const bg = bgOf(el); if (!bg) return;              // gradient-backed — not measurable here
      const l1 = lum(fg), l2 = lum(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      if (ratio < minContrast) {
        const k = 'C' + desc(el) + Math.round(r.top);
        if (seen.has(k)) return; seen.add(k);
        out.push({ kind: 'CONTRAST', el: desc(el), detail: `${ratio.toFixed(2)}:1 < ${minContrast}:1` });
      }
    });

  // ── 6. FOCUS — every clickable custom element must be keyboard-reachable.
  // Native <button>/<select>/<a href> are focusable for free; a plain `<div onclick>` is not,
  // so a mouse-only click handler on one is invisible to Tab-key and screen-reader use. This is
  // exactly the class of thing a11yEnhanceToggles/a11yEnhanceTabs (chromasmith-22.html) exist to
  // fix — this check is what stops the NEXT one from shipping unnoticed the same way `retouch`
  // shipped unreachable in the desktop shell (§ FRAGMENT's own history).
  const NATIVE_FOCUSABLE = new Set(['BUTTON', 'A', 'SELECT', 'INPUT', 'TEXTAREA']);
  // #fx-canvas's onclick (fxCanvasClick) is a pick-a-pixel gesture — the WB eyedropper, point
  // color, click-to-add a mask sample. Same category as every professional app's own eyedropper:
  // inherently pointer-driven, with no meaningful keyboard equivalent for "click at THIS spot in
  // the photo". Giving it a tabindex would claim a keyboard affordance it doesn't actually have.
  const POINTER_ONLY = new Set(['fx-canvas']);
  document.querySelectorAll('[onclick]').forEach((el) => {
    if (!vis(el)) return;                                   // hidden/off-screen controls aren't reachable by definition, but aren't a bug either
    if (NATIVE_FOCUSABLE.has(el.tagName)) return;
    if (POINTER_ONLY.has(el.id)) return;
    const tabindex = el.getAttribute('tabindex');
    if (tabindex !== null && Number(tabindex) >= 0) return;  // explicitly focusable
    if (el.getAttribute('role') === 'presentation') return;
    out.push({ kind: 'FOCUS', el: desc(el),
      detail: `<${el.tagName.toLowerCase()} onclick> has no tabindex — unreachable by keyboard/screen reader` });
  });

  return out;
}

// Shared page setup for both the desktop and phone passes: dismiss the first-run overlay, then
// put the Masks panel in its WORST case — a mask with the skin-tone block expanded, the
// configuration that fragmented. Auditing masks without it would miss the whole bug.
function seedFn() {
  const b = [...document.querySelectorAll('button')].find(x => /got it/i.test(x.textContent || ''));
  if (b) b.click();
  if (typeof mskAdd !== 'function') return;
  mskAdd('radial');
  const m = fxState.masks[0];
  if (m) {
    m.crOn = true;
    m.crSamples = [{ h: 0.05, s: 0.30, v: 0.70, rgb: [200, 150, 120] },
                   { h: 0.02, s: 0.25, v: 0.50, rgb: [160, 110, 90] }];
  }
  if (typeof mskRebuild === 'function') mskRebuild();
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // Source-level, so it runs before a browser is even launched.
  const tokenFindings = auditTokens(await Promise.all(TOKEN_SOURCES.map(async (f) => ({
    file: f, text: await readFile(path.join(ROOT, f), 'utf8'),
  }))));

  const server = await startServer(ROOT);
  const { port } = server.address();
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox',
      '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
  });

  const findings = [...tokenFindings];
  try {
    const page = await browser.newPage({ viewport: { width: VIEWPORTS[0].w, height: VIEWPORTS[0].h } });
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.error('  [console.error]', m.text()); });

    await page.goto(`http://127.0.0.1:${port}/chromasmith-22.html?deskx=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.loadFXImages === 'function'
      && typeof window.fxSection === 'function', null, { timeout: 30000 });

    // Load a real photo — most sections render nothing without one.
    const fixture = (await readFile(path.join(__dirname, 'fixtures', 'portrait.png'))).toString('base64');
    await page.evaluate(async (b64) => {
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      await window.loadFXImages([new File([arr], 'portrait.png', { type: 'image/png' })]);
    }, fixture);
    await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages.length > 0, null, { timeout: 15000 });

    await page.evaluate(seedFn);

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.waitForTimeout(120);
      for (const sec of SECTIONS) {
        const ok = await page.evaluate((s) => {
          if (typeof fxSection !== 'function') return false;
          try { fxSection(s, true); } catch { return false; }
          const p = document.querySelector('.fx-panel'); if (p) { p.scrollTop = 0; p.scrollLeft = 0; }
          return !!document.querySelector('.fx-ctrl.sec-active');
        }, sec);
        if (!ok) continue;
        await page.waitForTimeout(60);
        const res = await page.evaluate(auditInPage,
          { minTap: MIN_TAP, minTapInline: MIN_TAP_INLINE, inlineSel: INLINE_TARGET_SEL, edgeSel: EDGE_TARGET_SEL,
            minFont: MIN_FONT, minContrast: MIN_CONTRAST });
        res.forEach(f => findings.push({ ...f, section: sec, viewport: vp.label }));
      }
    }

    // ── TOPBAR NARROW PASS ───────────────────────────────────────────────────────────────
    // The Library topbar redesign (2026-09-10) shipped a real overlap bug — the search box
    // collided with the side clusters under ~820px — that nothing in this file's own VIEWPORTS
    // sweep above could have caught: every entry there is a full desktop window width (1280+),
    // chosen for auditing PANEL content, not for stress-testing a bar's own responsive fold.
    // The bar itself can go narrower than any panel needs to, since a real user can resize the
    // window down without ever opening a tool panel. This runs OVERLAP/MENU (and everything
    // else auditInPage checks) against #fx-deskbar AND #lib-top at three widths spanning both
    // documented fold thresholds (900px/820px — see body.fx-deskbar-tight1/2, chromasmith-22.html,
    // and #lib-top-tight1/2, desktop/library-ui.js) plus one stress width below both.
    const NARROW_WIDTHS = [900, 820, 700];
    for (const w of NARROW_WIDTHS) {
      await page.setViewportSize({ width: w, height: 820 });
      await page.waitForTimeout(150); // let the ResizeObserver-driven tight1/tight2 classes settle
      const res = await page.evaluate(auditInPage,
        { minTap: MIN_TAP, minTapInline: MIN_TAP_INLINE, inlineSel: INLINE_TARGET_SEL, edgeSel: EDGE_TARGET_SEL,
          minFont: MIN_FONT, minContrast: MIN_CONTRAST });
      res.forEach(f => findings.push({ ...f, section: 'editor-topbar', viewport: `${w}x820 (narrow)` }));
    }

    // Library gets its own page — chromasmith-22.html alone doesn't include desktop/library-ui.js,
    // that's only staged into desktop/dist/index.html by build-desktop.sh (run that first if this
    // 404s or the Library never appears). #lib-top only renders in FULL mode (.lib-fullview-only),
    // and whether boot lands there on its own is a genuine timing race (chromasmithForceLibraryReady,
    // desktop/library-ui.js) — confirmed live: an early version of this pass pressed Escape (copied
    // from the EDITOR fixture's boot sequence, which needs the opposite — Escape OUT of full-view
    // back to the editor) and audited a docked #lib-top at 0x0 the entire time, finding nothing to
    // check and reporting a clean pass with zero real coverage. test/wireframe_inventory.mjs's own
    // Library-only setup does this correctly: force `.full` directly rather than racing the boot
    // sequence or relying on Escape doing the right thing from an unknown starting state.
    const libPage = await browser.newPage({ viewport: { width: NARROW_WIDTHS[0], height: 820 } });
    try {
      libPage.on('pageerror', (e) => console.error('  [pageerror]', e.message));
      await libPage.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&deskx=1&libn=8`, { waitUntil: 'domcontentloaded' });
      await libPage.waitForTimeout(1200);
      await libPage.evaluate(() => {
        document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); });
        document.getElementById('lib-overlay')?.classList.add('full');
      });
      await libPage.waitForFunction(() => {
        const el = document.getElementById('lib-top');
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }, null, { timeout: 10000 }).catch(() => {});
      // The app's fonts (Inter/Instrument Serif) are base64 @font-face, loaded async — measuring
      // text/button widths before they finish swapping in gave a real flake: the same MENU check
      // read the gear popover 5-18px past the viewport edge on some runs and cleanly inside it on
      // others, purely from fallback-vs-real font metrics shifting a button's width by a few px
      // right at a hard boundary. document.fonts.ready removes the race instead of papering over
      // it with a longer timeout.
      await libPage.evaluate(() => document.fonts.ready).catch(() => {});
      await libPage.waitForTimeout(150);
      for (const w of NARROW_WIDTHS) {
        await libPage.setViewportSize({ width: w, height: 820 });
        await libPage.waitForTimeout(150);
        const res = await libPage.evaluate(auditInPage,
          { minTap: MIN_TAP, minTapInline: MIN_TAP_INLINE, inlineSel: INLINE_TARGET_SEL, edgeSel: EDGE_TARGET_SEL,
            minFont: MIN_FONT, minContrast: MIN_CONTRAST });
        res.forEach(f => findings.push({ ...f, section: 'library-topbar', viewport: `${w}x820 (narrow)` }));
      }

      // ── TOPBAR RIGHT-SIDE PARITY ───────────────────────────────────────────────────────
      // 2026-09-11: the user reported the Editor (#fx-deskbar) and Library (#lib-top) right-
      // hand clusters (zoom → flags → All FX → Export → gear) LOOK misaligned at ordinary
      // window widths, despite prior wireframe/testing passes claiming they matched — those
      // passes checked structure (grid columns, element order, overlap) but never compared the
      // two bars' actual pixel gaps/icon sizes against each other. This asserts the specific
      // numbers a human eye catches that OVERLAP/FRAGMENT/etc. cannot: the gear↔Export gap, the
      // flag-icon size/shape, and the flag↔zoom gap, each read from BOTH pages at one ordinary
      // (non-narrow, non-folded) width and diffed with a small tolerance for antialiasing.
      // Only the RIGHT-hand cluster is compared — the left cluster legitimately differs between
      // the two views (Date taken/Filters/grid-list vs. undo/redo/eye/monitor) per Tareq's own
      // call on this, so this check must never grow to touch left-side selectors.
      await page.setViewportSize({ width: 1400, height: 900 });
      await page.waitForTimeout(150);
      await libPage.setViewportSize({ width: 1400, height: 900 });
      await libPage.waitForTimeout(150);
      const PARITY_TOL = 1.5; // px — antialiasing/font-metric slop, not a real mismatch
      const [edParity, libParity] = await Promise.all([
        page.evaluate(() => {
          // The flag buttons are hidden by default outside the desktop shell — fxUpdateFlagBtns()
          // only un-hides them when window.chromasmithOpenedFlag exists (desktop-native.js), which
          // this plain-browser harness never loads. Force them visible for measurement only; this
          // is a throwaway page so mutating its DOM has no effect beyond this one evaluate() call.
          const rb = document.getElementById('btn-flag-red');
          const gb = document.getElementById('btn-flag-green');
          const fb = document.getElementById('btn-favorite');
          [rb, gb, fb].forEach((b) => { if (b) b.style.display = ''; });
          const r = (sel) => document.querySelector(sel)?.getBoundingClientRect() || null;
          const flagEl = document.getElementById('btn-flag-red');
          const flagBtn = r('#btn-flag-red');
          const flagSvg = document.querySelector('#btn-flag-red svg path');
          // Reads the CSS gap/margin AT the flag cluster's own boundary directly via
          // getComputedStyle, rather than a sibling's bounding rect: the Editor's cluster
          // (#fx-zoom-ctrl) has several buttons between the slider and the flags (zoom in/out,
          // %, 1:1, full-res) that only render once relocatePreviewTools() has moved the whole
          // cluster into the deskbar — a step this plain-browser harness doesn't reliably trigger,
          // which made a sibling-rect measurement read a stray, still-hidden element's rect (0,0)
          // and report a 1000+px "gap" that was actually a broken selector, not a real mismatch.
          // The cluster's own gap (1px) plus the flag's own margin-left (4px) — both literal
          // values copied 1:1 into desktop/library-ui.js's #lib-zoomflag-cluster — is the number
          // item 3 is actually about, and getComputedStyle reads it whether or not the cluster
          // has been relocated/resized by other JS this harness didn't run.
          const clusterGap = parseFloat(getComputedStyle(document.getElementById('fx-zoom-ctrl') || document.body).gap) || 0;
          const flagMargin = flagEl ? parseFloat(getComputedStyle(flagEl).marginLeft) || 0 : NaN;
          return {
            gearExportGap: (r('#fx-settings')?.left ?? NaN) - (r('#btn-export-db')?.right ?? NaN),
            flagZoomGap: clusterGap + flagMargin,
            flagW: flagBtn?.width ?? NaN, flagH: flagBtn?.height ?? NaN,
            flagPathD: flagSvg?.getAttribute('d') || null,
            titleCenter: (() => { const t = r('#fx-deskbar-title'); return t ? t.left + t.width / 2 : NaN; })(),
            imgAreaCenter: (() => { const w = r('#fx-zoom-wrap'); return w ? w.left + w.width / 2 : NaN; })(),
          };
        }),
        libPage.evaluate(() => {
          const r = (sel) => document.querySelector(sel)?.getBoundingClientRect() || null;
          const flagBtn = r('#lib-flag-reject');
          const flagEl = document.getElementById('lib-flag-reject');
          const flagSvg = document.querySelector('#lib-flag-reject svg path');
          // Same getComputedStyle approach as the Editor side — see its comment for why a
          // sibling-rect measurement isn't reliable here.
          const clusterGap = parseFloat(getComputedStyle(document.getElementById('lib-zoomflag-cluster') || document.body).gap) || 0;
          const flagMargin = flagEl ? parseFloat(getComputedStyle(flagEl).marginLeft) || 0 : NaN;
          return {
            gearExportGap: (r('#lib-settings')?.left ?? NaN) - (r('#lib-export-btn')?.right ?? NaN),
            flagZoomGap: clusterGap + flagMargin,
            flagW: flagBtn?.width ?? NaN, flagH: flagBtn?.height ?? NaN,
            flagPathD: flagSvg?.getAttribute('d') || null,
          };
        }),
      ]);
      const parityChecks = [
        ['gearExportGap', edParity.gearExportGap, libParity.gearExportGap, 'px gap between the gear icon and the Export button'],
        ['flagZoomGap', edParity.flagZoomGap, libParity.flagZoomGap, 'px gap between the flags and the zoom control'],
        ['flagW', edParity.flagW, libParity.flagW, 'px flag-button width'],
        ['flagH', edParity.flagH, libParity.flagH, 'px flag-button height'],
      ];
      for (const [key, edVal, libVal, desc] of parityChecks) {
        if (Number.isNaN(edVal) || Number.isNaN(libVal)) {
          findings.push({ kind: 'PARITY-MISSING', el: key, section: 'topbar-parity', viewport: '1400x900',
            detail: `could not measure one or both bars (selector missing) — ${desc}` });
          continue;
        }
        if (Math.abs(edVal - libVal) > PARITY_TOL) {
          findings.push({ kind: 'PARITY', el: key, section: 'topbar-parity', viewport: '1400x900',
            detail: `${desc}: Editor=${edVal.toFixed(1)}px vs Library=${libVal.toFixed(1)}px (diff ${(edVal - libVal).toFixed(1)}px, tol ${PARITY_TOL}px)` });
        }
      }
      if (edParity.flagPathD && libParity.flagPathD && edParity.flagPathD !== libParity.flagPathD) {
        findings.push({ kind: 'PARITY', el: 'flagPathD', section: 'topbar-parity', viewport: '1400x900',
          detail: `reject-flag icon path differs between bars — Editor and Library must use the same icon key ('flagRed')` });
      } else if (!edParity.flagPathD || !libParity.flagPathD) {
        findings.push({ kind: 'PARITY-MISSING', el: 'flagPathD', section: 'topbar-parity', viewport: '1400x900',
          detail: `reject-flag <svg><path> not found on one or both bars` });
      }
      // Title (item 4): must center over the actual image viewport (#fx-zoom-wrap), not over
      // "whole bar minus the traffic-light gutter" — a wider tolerance here (8px) since this is
      // font-driven text centering, not a fixed control gap.
      if (!Number.isNaN(edParity.titleCenter) && !Number.isNaN(edParity.imgAreaCenter) &&
          Math.abs(edParity.titleCenter - edParity.imgAreaCenter) > 8) {
        findings.push({ kind: 'PARITY', el: 'titleCenter', section: 'topbar-parity', viewport: '1400x900',
          detail: `Editor title center (${edParity.titleCenter.toFixed(1)}px) does not align with the image viewport center (${edParity.imgAreaCenter.toFixed(1)}px)` });
      }
    } finally { await libPage.close(); }

    // ── MOBILE PASS ──────────────────────────────────────────────────────────────────────
    // Deliberately a SEPARATE page without ?deskx=1: under 700px the app is a different shell
    // (photo fills the screen, tools live in a bottom sheet — CLAUDE.md §4), and deskx pins the
    // desktop layout, so adding 375px to VIEWPORTS above would have audited a layout no phone
    // ever shows. Sections are opened the same way a tap does, then the SHEET is audited.
    if (!process.env.CS_UI_NO_MOBILE) {
      const mp = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      try {
        await mp.goto(`http://127.0.0.1:${port}/chromasmith-22.html`, { waitUntil: 'load' });
        await mp.waitForFunction(() => typeof fxSection === 'function', null, { timeout: 20000 });
        await mp.evaluate(seedFn);
        for (const sec of SECTIONS) {
          const ok = await mp.evaluate((s) => {
            try { fxSection(s, true); } catch { return false; }
            return document.body.classList.contains('sheet-open') || !!document.querySelector('.fx-ctrl.sec-active');
          }, sec);
          if (!ok) continue;
          await mp.waitForTimeout(80);
          const res = await mp.evaluate(auditInPage,
            { minTap: MIN_TAP, minTapInline: MIN_TAP_INLINE, inlineSel: INLINE_TARGET_SEL, edgeSel: EDGE_TARGET_SEL,
              minFont: MIN_FONT, minContrast: MIN_CONTRAST });
          res.forEach(f => findings.push({ ...f, section: sec, viewport: '375x812 (phone)' }));
        }
      } finally { await mp.close(); }
    }
  } finally {
    await browser.close();
    server.close();
  }

  // ── report ──
  const byKind = {};
  findings.forEach(f => { (byKind[f.kind] ||= []).push(f); });
  const KINDS = ['TOKEN', 'FRAGMENT', 'ORDER', 'SPILL', 'OVERLAP', 'MENU', 'TAP', 'FONT', 'CONTRAST', 'FOCUS',
    'PARITY', 'PARITY-MISSING'];
  // The same defect is re-reported once per (section, viewport) it is visible in, so every count
  // — table, baseline and comparison alike — is over DISTINCT defects. Mixing raw and deduped
  // counts would make the "vs baseline" delta meaningless.
  const distinct = (k) => [...new Map((byKind[k] || []).map(f => [f.el + '|' + f.detail, f])).values()];

  if (WRITE_BASELINE) {
    // Counts only. The full finding list is ~10k lines, fully regenerable from a run, and would
    // churn on every unrelated edit — the committed baseline exists to answer "did this get
    // better or worse", nothing more. Use --json for the detail.
    const counts = Object.fromEntries(KINDS.map(k => [k, distinct(k).length]));
    const examples = Object.fromEntries(KINDS.map(k => [k, distinct(k).slice(0, 3).map(f => `${f.el} — ${f.detail}`)]));
    await writeFile(BASELINE, JSON.stringify({ capturedAt: new Date().toISOString().slice(0, 10), counts, examples }, null, 2));
    console.log(`Baseline written to ${path.relative(ROOT, BASELINE)}`);
    console.log(KINDS.map(k => `${k} ${counts[k]}`).join('  '));
    return 0;
  }

  console.log('\nkind        count  status  examples');
  console.log('--------------------------------------------------------------------------');
  let fail = false;
  for (const k of KINDS) {
    const uniq = distinct(k);
    const status = uniq.length === 0 ? 'PASS' : 'FAIL';
    if (uniq.length) fail = true;
    const ex = uniq.slice(0, 2).map(f => `${f.section}@${f.viewport}: ${f.el} — ${f.detail}`).join('\n' + ' '.repeat(28));
    console.log(`${k.padEnd(11)} ${String(uniq.length).padStart(5)}  ${status.padEnd(6)}  ${ex}`);
  }
  console.log('--------------------------------------------------------------------------');

  if (existsSync(BASELINE)) {
    const base = JSON.parse(await readFile(BASELINE, 'utf8'));
    console.log('\nvs baseline:');
    for (const k of KINDS) {
      const now = distinct(k).length;
      const was = base.counts?.[k] ?? 0;
      const d = now - was;
      console.log(`  ${k.padEnd(11)} ${String(was).padStart(4)} -> ${String(now).padStart(4)}  ${d === 0 ? '=' : d < 0 ? `${d} better` : `+${d} WORSE`}`);
    }
  }

  if (DUMP_JSON) console.log('\n' + JSON.stringify(findings, null, 2));
  console.log(`\nRESULT: ${fail ? 'FAIL' : 'PASS'}`);
  return fail ? 1 : 0;
}

main().then(c => process.exit(c)).catch((e) => { console.error('FATAL:', e); process.exit(1); });
