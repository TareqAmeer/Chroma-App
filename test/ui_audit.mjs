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
function auditInPage({ minTap, minTapInline, inlineSel, minFont, minContrast }) {
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
  const OVERLAP_TOL = 2;
  document.querySelectorAll('.fx-panel, #fx-deskbar, #fx-toolrail, .fx-ctrl.sec-active').forEach((parent) => {
    const kids = [...parent.children].filter(vis);
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
        // Absolutely-positioned overlays are legitimately stacked — skip them.
        if (getComputedStyle(kids[i]).position !== 'static' || getComputedStyle(kids[j]).position !== 'static') continue;
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > OVERLAP_TOL && oy > OVERLAP_TOL) {
          out.push({ kind: 'OVERLAP', el: desc(kids[i]), detail: `overlaps ${desc(kids[j])} by ${Math.round(ox)}x${Math.round(oy)}px` });
        }
      }
    }
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
          { minTap: MIN_TAP, minTapInline: MIN_TAP_INLINE, inlineSel: INLINE_TARGET_SEL,
            minFont: MIN_FONT, minContrast: MIN_CONTRAST });
        res.forEach(f => findings.push({ ...f, section: sec, viewport: vp.label }));
      }
    }
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
            { minTap: MIN_TAP, minTapInline: MIN_TAP_INLINE, inlineSel: INLINE_TARGET_SEL,
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
  const KINDS = ['TOKEN', 'FRAGMENT', 'ORDER', 'SPILL', 'OVERLAP', 'TAP', 'FONT', 'CONTRAST', 'FOCUS'];
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
