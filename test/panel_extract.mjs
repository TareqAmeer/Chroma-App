// Stage 1 of the Editor panel redesign (docs/editor-redesign-plan.md, section "Extraction
// tool"). Reads the LIVE app — not the source file — and emits, per `data-fxsec` section, every
// control it actually renders: label, kind, range/step/default, element id, group heading, and
// whether it's visible by default.
//
// WHY LIVE, NOT A SOURCE REGEX: a source scan gets this wrong in ways that are easy to miss.
// `info` is the LAST `.fx-ctrl` card in the file, so a naive "read until the next .fx-ctrl"
// split absorbs everything after it — the main preview canvases, the loupe, the split-view
// controls — and reports wildly inflated counts. `diag` is built entirely by JS at runtime and
// has no static markup at all, so a source scan finds no card for it. The live DOM has neither
// problem, and it also knows what's hidden by default (an `ff-off` class, a `display:none`
// panel) — exactly the information Stage 2's comparison pages need and a source scan cannot
// give reliably (inline styles set by JS after load aren't in the static HTML).
//
// Usage:
//   node test/panel_extract.mjs                 # summary table, writes test/output/panel_inventory.json
//   node test/panel_extract.mjs --json           # dump the full inventory to stdout instead
//   node test/panel_extract.mjs --section=curves # only this section (debugging one card)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS, settleForCapture } from './wireframe_diff_lib.mjs';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const DUMP_JSON = argv.includes('--json');
const ONLY_SECTION = (argv.find((a) => a.startsWith('--section=')) || '').split('=')[1] || null;

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
const page = await b.newPage({ ...DETERMINISTIC_CONTEXT_OPTIONS });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  document.querySelectorAll('button').forEach((btn) => { if (btn.textContent.trim() === 'Got it') btn.click(); });
  if (typeof applyFxLayout === 'function') applyFxLayout();
});
await page.keyboard.press('Escape'); // exit the boot-watchdog Library full-view race — see editor_wireframe_diff.mjs's comment
await page.waitForTimeout(150);

// Load a real photo so photo-gated sections/controls actually exist in the DOM — the same gap
// HANDOVER_EDITOR.md flagged for the wireframe-diff PAIRS tool applies here too.
const fixtureB64 = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
await page.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const file = new File([bytes], 'portrait.png', { type: 'image/png' });
  if (typeof window.loadFXImages === 'function') await window.loadFXImages([file]);
}, fixtureB64);
await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages && fxImages.length > 0, { timeout: 10000 }).catch(() => {});
await settleForCapture(page);

// Force every tool section open in turn so its controls actually mount — the app builds/reveals
// some section content lazily (masks list, dcp profile <select>, curve canvases) only once the
// section becomes active, matching how a real user would encounter it.
const sectionKeys = await page.evaluate(() =>
  [...document.querySelectorAll('.fx-ctrl[data-fxsec]')].map((el) => el.dataset.fxsec).filter((k) => k && k !== '${cardOrName}'));

const EXTRACT_FN = `(key) => {
  const card = document.querySelector('.fx-ctrl[data-fxsec="' + key + '"]');
  if (!card) return null;

  const title = card.querySelector('.fx-ctrl-title');
  const titleText = title ? [...title.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim() : null;
  const fieldsEl = card.querySelector('.fx-fields');
  const defaultOn = fieldsEl ? !fieldsEl.classList.contains('ff-off') : true;

  // A control's label is whatever a human would actually read first: its .fx-label sibling,
  // else its own title/aria-label/placeholder, else nearby text. Anything that resolves to
  // none of these is flagged unlabeled rather than silently dropped — Stage 2 must not draft
  // a blank row into the proposal.
  function labelFor(el) {
    const row = el.closest('.fx-row');
    const lbl = row && row.querySelector('.fx-label');
    if (lbl && lbl.textContent.trim()) return lbl.textContent.trim();
    if (el.title) return el.title.trim();
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
    if (el.placeholder) return el.placeholder.trim();
    if (el.tagName === 'BUTTON' && el.textContent.trim()) return el.textContent.trim().slice(0, 60);
    // Fallback for markup that labels a control with a plain preceding sibling rather than a
    // .fx-row/.fx-label pair (several sel-* dropdowns in Looks, the colour-wheel sliders, which
    // sit under a canvas that itself sits under a bare labelling div). Walk up to 3 previous
    // siblings within the same parent looking for one with short, human-looking text — not the
    // control's own tag, and not another form control (which would be a peer value, not a label).
    let node = el, hops = 0;
    while (node && hops < 3) {
      let sib = node.previousElementSibling;
      while (sib) {
        const isControl = /^(INPUT|SELECT|BUTTON|CANVAS)$/.test(sib.tagName);
        // A real label is plain text — an axis-tick strip ("0% 25% 50% 75% 100%") or a chip
        // row (RGB/R/G/B buttons) is several child elements whose text concatenates into one
        // run-on string with no separating whitespace. >=2 element children is the tell; skip
        // and keep looking further back rather than mislabeling the control with it.
        const isMultiPart = sib.children.length >= 2;
        const txt = sib.textContent.trim().replace(/\s+/g, ' ');
        if (!isControl && !isMultiPart && txt && txt.length < 60) return txt;
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
      hops++;
    }
    return null;
  }
  function visible(el) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  const controls = [];
  const seen = new Set();
  const record = (el, kind, extra) => {
    if (seen.has(el)) return;
    seen.add(el);
    const label = labelFor(el);
    controls.push({
      kind, label, unlabeled: !label,
      id: el.id || null,
      visible: visible(el),
      groupHeading: (() => {
        const grp = el.closest('.msk-group, [data-group]');
        const hd = grp && grp.querySelector('.msk-group-hd, .grp-label');
        return hd ? hd.textContent.trim().replace(/\\s+/g, ' ').slice(0, 60) : null;
      })(),
      ...extra,
    });
  };

  card.querySelectorAll('input[type=range]').forEach(el => record(el, 'slider', {
    min: el.min, max: el.max, step: el.step || null, default: el.value,
  }));
  card.querySelectorAll('select').forEach(el => record(el, 'select', {
    options: [...el.options].map(o => o.textContent.trim()).slice(0, 12),
    optionCount: el.options.length,
  }));
  card.querySelectorAll('input[type=checkbox]').forEach(el => record(el, 'checkbox', { default: el.checked }));
  card.querySelectorAll('input[type=color]').forEach(el => record(el, 'color', { default: el.value }));
  card.querySelectorAll('input[type=text],input[type=number]:not([type=range])').forEach(el => record(el, 'text', { default: el.value || null }));
  card.querySelectorAll('canvas[id]').forEach(el => record(el, 'canvas', { width: el.width, height: el.height }));
  card.querySelectorAll('button').forEach(el => {
    // Skip a button whose only job is toggling another control we already record (the section
    // switch itself) so it isn't double-counted as a bare, unlabeled button.
    if (el.classList.contains('fx-toggle')) return;
    record(el, 'button', {});
  });

  return {
    key, title: titleText, defaultOn,
    hasToggle: !!card.querySelector('.fx-toggle'),
    controlCount: controls.length,
    controls,
  };
}`;

const inventory = {};
const targets = ONLY_SECTION ? [ONLY_SECTION] : sectionKeys;
for (const key of targets) {
  // Actually open the section so lazily-mounted content (masks list, dcp <select>, curve
  // canvas draw) is present — clicking the rail button is closer to a real user path than
  // calling the internal fxSection() function directly.
  await page.evaluate((k) => { if (typeof fxSection === 'function') fxSection(k, true); }, key);
  await page.waitForTimeout(120);
  const result = await page.evaluate(`(${EXTRACT_FN})(${JSON.stringify(key)})`);
  if (result) inventory[key] = result;
}

await page.close();
await b.close();
server.close();

await mkdir(path.join(ROOT, 'test/output'), { recursive: true });
const outPath = path.join(ROOT, 'test/output/panel_inventory.json');
await writeFile(outPath, JSON.stringify(inventory, null, 2));

if (DUMP_JSON) {
  console.log(JSON.stringify(inventory, null, 2));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\nPANEL EXTRACTION — live app inventory\n' + '='.repeat(78));
  console.log(pad('section', 12) + pad('title', 22) + pad('on?', 5) + pad('toggle', 8) + pad('controls', 9) + 'unlabeled');
  console.log('-'.repeat(78));
  let totalControls = 0, totalUnlabeled = 0;
  for (const key of Object.keys(inventory).sort()) {
    const s = inventory[key];
    const unlabeled = s.controls.filter((c) => c.unlabeled);
    totalControls += s.controls.length;
    totalUnlabeled += unlabeled.length;
    console.log(pad(key, 12) + pad(s.title || '(no title)', 22) + pad(s.defaultOn ? 'yes' : 'no', 5)
      + pad(s.hasToggle ? 'yes' : 'no', 8) + pad(s.controlCount, 9) + (unlabeled.length ? `⚠ ${unlabeled.length}` : '-'));
  }
  console.log('-'.repeat(78));
  console.log(`${Object.keys(inventory).length} sections, ${totalControls} controls total, ${totalUnlabeled} unlabeled`);
  if (totalUnlabeled) {
    console.log('\n⚠ UNLABELED CONTROLS (Stage 2 must not draft these as blank rows — label them by hand):');
    for (const key of Object.keys(inventory)) {
      const bad = inventory[key].controls.filter((c) => c.unlabeled);
      for (const c of bad) console.log(`  [${key}] ${c.kind}${c.id ? ' #' + c.id : ''}`);
    }
  }
  console.log(`\nWrote ${path.relative(ROOT, outPath)}`);
}
