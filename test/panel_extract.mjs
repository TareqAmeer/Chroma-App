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

const EXTRACT_FN = `(key, stateContext) => {
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
    // .vrow/.vlb is a second labelled-row idiom the app uses alongside .fx-row/.fx-label
    // (Export's Filename field, Match/Colour Copy's name fields). Checking only .fx-row made
    // those fall through to the title attribute, which is help text, not a label — Export's
    // came out as the full "Batch tokens: {name} source name..." sentence.
    const row = el.closest('.fx-row, .vrow');
    const lbl = row && row.querySelector('.fx-label, .vlb');
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
    const groupHeading = (() => {
      const grp = el.closest('.msk-group, [data-group]');
      const hd = grp && grp.querySelector('.msk-group-hd, .grp-label');
      return hd ? hd.textContent.trim().replace(/\\s+/g, ' ').slice(0, 60) : null;
    })();
    const stablePart = el.id ? '#' + el.id
      : el.dataset && el.dataset.k ? '[data-k="' + el.dataset.k + '"]'
      : el.getAttribute('onclick') ? 'onclick:' + el.getAttribute('onclick').replace(/\\s+/g, ' ').slice(0, 100)
      : null;
    const identity = stablePart || [key, groupHeading || 'ungrouped', kind, label || 'unlabelled'].join('::');
    controls.push({
      kind, label, unlabeled: !label,
      id: el.id || null,
      selector: el.id ? '#' + CSS.escape(el.id) : (el.dataset && el.dataset.k ? '.fx-ctrl[data-fxsec="' + key + '"] [data-k="' + CSS.escape(el.dataset.k) + '"]' : null),
      identity,
      unresolvedIdentity: !identity,
      visible: visible(el),
      groupHeading,
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
  // ⚠️ "input[type=text]" does NOT match an <input> with no type attribute at all, and the
  // app has five of those — including #fx-fname, the Export filename field, and #exp-wm-text,
  // the watermark text. Reported as missing from the Export draft by the user, 2026-09-09. An
  // attribute selector matches the ATTRIBUTE, not the effective type, so ":not([type])" has to
  // be spelled out separately; el.type still reads "text" for them at runtime.
  // ⚠️ NO BACKTICKS IN THIS COMMENT — it lives inside the EXTRACT_FN template literal, so a
  // stray backtick truncates the whole function source. Same bug class as CLAUDE.md §3's GLSL
  // rule, and it bit here first time out.
  card.querySelectorAll('input[type=text],input[type=number],input:not([type])').forEach(el => record(el, 'text', { default: el.value || null, placeholder: el.placeholder || null }));
  card.querySelectorAll('canvas[id]').forEach(el => record(el, 'canvas', { width: el.width, height: el.height }));
  card.querySelectorAll('button').forEach(el => {
    // Skip a button whose only job is toggling another control we already record (the section
    // switch itself) so it isn't double-counted as a bare, unlabeled button.
    if (el.classList.contains('fx-toggle')) return;
    record(el, 'button', {});
  });

  return {
    key, title: titleText, defaultOn, stateContext: stateContext || null,
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
  const result = await page.evaluate(`(${EXTRACT_FN})(${JSON.stringify(key)}, null)`);
  if (result) inventory[key] = result;
}

// Masks are rebuilt conditionally from the selected mask. Discover the real creation choices
// from the live + Mask menu, then enter every type through that menu. A no-mask snapshot alone
// is not an inventory of this panel.
if ((!ONLY_SECTION || ONLY_SECTION === 'local') && inventory.local) {
  // Keep the inventory deterministic and offline while still exercising the application's real
  // failure/unavailable branches: model invocations fail promptly instead of loading native
  // inference work that this Chromium harness cannot complete.
  await page.evaluate(() => {
    const core = window.__TAURI__ && window.__TAURI__.core;
    if (!core || core.__panelExtractWrapped) return;
    const realInvoke = core.invoke.bind(core);
    core.invoke = (cmd, args) => /^(sam_|sam2_|depth_|faceparse_)/.test(cmd)
      ? Promise.reject(new Error('model unavailable in offline inventory harness'))
      : realInvoke(cmd, args);
    core.__panelExtractWrapped = true;
    // Rendering the same photo after every inventory-only mask creation adds no DOM evidence.
    // mskAdd still creates the real state and calls mskRebuild; only the pixel render is skipped.
    window.__panelExtractFxUpdate = window.fxUpdate;
    window.fxUpdate = () => {};
  });
  const addButton = page.getByRole('button', { name: '+ Mask', exact: true });
  await addButton.click();
  const maskTypes = await page.locator('.msk-more-menu .msk-more-it').evaluateAll((buttons) => buttons.map((b) => ({
    label: b.textContent.trim().replace(/\s+/g, ' '),
    type: (b.getAttribute('onclick') || '').match(/mskAdd\('([^']+)'\)/)?.[1] || null,
  })).filter((x) => x.type));
  await page.keyboard.press('Escape');
  if (!DUMP_JSON) console.log(`[masks] discovered ${maskTypes.map((x) => x.type).join(', ')}`);
  const states = [];
  const extractLocal = async (context) => {
    await page.waitForTimeout(20);
    const snap = await page.evaluate(`(${EXTRACT_FN})('local', ${JSON.stringify(context)})`);
    if (snap) states.push(snap);
  };
  await page.evaluate(() => { fxState.masks = []; mskSel = 0; mskRebuild(); });
  await extractLocal({ name: 'no-mask', maskTypes: [] });
  for (const mt of maskTypes) {
    if (!DUMP_JSON) console.log(`[masks] extracting ${mt.type}`);
    await page.evaluate(() => { fxState.masks = []; mskSel = 0; mskRebuild(); });
    // mskAdd is the same real application function invoked by the discovered menu item. Calling
    // it directly avoids Playwright waiting on transient menus while background model work starts.
    await page.evaluate((type) => {
      if (type === 'depth' && typeof curItem === 'function' && curItem()?.img) curItem().img._depthMapAttempted = true;
      mskAdd(type);
    }, mt.type);
    await page.waitForTimeout(30);
    await extractLocal({ name: `selected-${mt.type}`, maskTypes: [mt.type], selected: mt.type });
  }
  // Multi-mask management changes the available actions. Muting and inversion use the real app
  // commands, then rebuild exactly as the UI buttons do.
  await page.evaluate(() => { fxState.masks = []; mskSel = 0; mskRebuild(); });
  for (const type of ['radial', 'linear']) {
    await page.evaluate((maskType) => mskAdd(maskType), type);
  }
  await page.locator('#local-ctl .msk-more').click();
  const managementNormal = await page.locator('.msk-more-menu .msk-more-it').evaluateAll((buttons) => buttons.map((el) => ({
    kind: 'button', label: el.textContent.trim().replace(/\s+/g, ' '), unlabeled: false,
    id: el.id || null, selector: null,
    identity: 'local::management::button::' + el.textContent.trim().replace(/\s+/g, ' '),
    unresolvedIdentity: false, visible: el.getBoundingClientRect().width > 0, groupHeading: 'Mask management',
  })));
  await page.keyboard.press('Escape');
  await extractLocal({ name: 'multiple-selected', maskTypes: ['radial', 'linear'], selected: 'linear' });
  states.at(-1).controls.push(...managementNormal);
  states.at(-1).controlCount = states.at(-1).controls.length;
  await page.evaluate(() => mskToggleMute());
  await page.evaluate(() => mskInvert());
  await extractLocal({ name: 'multiple-muted-inverted', maskTypes: ['radial', 'linear'], selected: 'linear', muted: true, inverted: true });
  await page.locator('#local-ctl .msk-more').click();
  const management = await page.locator('.msk-more-menu .msk-more-it').evaluateAll((buttons) => buttons.map((el) => ({
    kind: 'button', label: el.textContent.trim().replace(/\s+/g, ' '), unlabeled: false,
    id: el.id || null, selector: null,
    identity: 'local::management::button::' + el.textContent.trim().replace(/\s+/g, ' '),
    unresolvedIdentity: false, visible: el.getBoundingClientRect().width > 0,
    groupHeading: 'Mask management',
  })));
  states.at(-1).controls.push(...management);
  states.at(-1).controlCount = states.at(-1).controls.length;
  await page.keyboard.press('Escape');

  const merged = new Map();
  for (const state of states) for (const control of state.controls) {
    const id = control.identity;
    if (!id) continue;
    if (!merged.has(id)) merged.set(id, { ...control, contexts: [] });
    const entry = merged.get(id);
    const context = { ...state.stateContext, visible: control.visible };
    if (!entry.contexts.some((x) => JSON.stringify(x) === JSON.stringify(context))) entry.contexts.push(context);
  }
  inventory.local = {
    ...inventory.local,
    discoveredMaskTypes: maskTypes,
    states: states.map((s) => ({ context: s.stateContext, controlCount: s.controlCount })),
    controls: [...merged.values()],
  };
  inventory.local.controlCount = inventory.local.controls.length;
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
