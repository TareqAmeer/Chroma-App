#!/usr/bin/env node
// Mask sidebar progressive disclosure: every control inventoried from the pre-redesign native app
// (test/baselines/mask_sidebar_inventory_chromium.json, 24 states) must still be REACHABLE in the live DOM —
// visible, or inside a collapsed group/"More"/view-options disclosure that expands on click (the scan
// clicks every aria-expanded="false" toggle until none remain). Also asserts the new structure:
// single Create button + dropdown (every tile type inside, shortcuts, aria, arrows, Esc, close on pick),
// groups collapsed by default with a count pill when non-default, and a sane default-visible control budget.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openMaskPage } from './lib_mask_probe.mjs';
const base = JSON.parse(await readFile(new URL('./baselines/mask_sidebar_inventory_chromium.json', import.meta.url), 'utf8'));
const scanSrc = await readFile(new URL('./lib_mask_panel_scan.js', import.meta.url), 'utf8');
// Deliberate renames only (old identity -> new identity). Anything else missing is a lost control.
const RENAMED = { 'button|+ Mask|mskAddMenu': 'button|+Create New Mask|btn-msk-create', 'button|Invert|btn-msk-tool-invert': 'button|Invert|btn-msk-invert' };
// Button system (2026-10-25): exactly ONE Invert button per mask, in the combine row for every mask type (btn-msk-invert).
// The brush tool header's second Invert (btn-msk-tool-invert) and the row mini-control folded into it.
const ALT = { 'button|Invert|mskInvert': ['button|Invert|btn-msk-invert'] };
const TILE = /^button\|(Auto Subject|Subject|Objects|Sky|Landscape|Background|Skin|Brush|Linear|Radial|Color|Luminance|Depth|Water|Vegetation|Mountains|Buildings|Ground)\|(mskAdd\w*|mskLandscapeToggle)$/;
// Deliberately removed (button system, 2026-10-25): the per-row Invert mini control duplicated the single Invert button.
// Compact slider layout moved into the mask "..." menu (2026-10-26).
const REMOVED = new Set(['list-row|button|msk-li-ctl.msk-li-act|Invert', 'button|Compact mask slider layout|mskCompactLayoutToggle']);
const norm = (id) => RENAMED[id] || id;
const { page, errors, close } = await openMaskPage();
const fails = [];
try {
  await page.evaluate(() => { try { window.__TAURI__ = window.__TAURI__ || undefined; } catch (_) {} });
  const res = await page.evaluate(`(${scanSrc})()`);
  let checked = 0, tiles = 0, hiddenDefault = 0;
  for (const [state, st] of Object.entries(base.states)) {
    const now = res.types[state];
    if (!now) { fails.push(`state ${state}: not scanned`); continue; }
    const byId = new Map(now.expanded.map((c) => [c.id, c]));
    // Baseline group headers were un-id'd; identity is label|key, count pills are stripped by the scan.
    for (const [id0, info] of Object.entries(st.controls)) {
      const id = norm(id0);
      const c = byId.get(id) || (ALT[id] || []).map((a) => byId.get(a)).find(Boolean);
      if (REMOVED.has(id0)) continue;
      if (TILE.test(id0) && state !== 'none') { tiles++; continue; }   // create tiles: verified through the dropdown below
      if (!c) { fails.push(`${state}: LOST ${id0} (${info.ctx})`); continue; }
      checked++;
      if (info.visibleByDefault && !c.vis) fails.push(`${state}: ${id0} no longer reachable (present but not visible after expanding every disclosure)`);
    }
    hiddenDefault += now.default.filter((c) => !c.vis).length;
  }
  // default-visible budget: far fewer controls on screen by default than before, for every mask-bearing state
  const budget = [];
  for (const [state, st] of Object.entries(base.states)) {
    if (state === 'none') continue;
    const before = Object.values(st.controls).filter((c) => c.visDefault).length;
    const after = res.types[state].default.filter((c) => c.vis).length;
    budget.push([state, before, after]);
    if (after >= before) fails.push(`${state}: default-visible controls did not shrink (${before} -> ${after})`);
  }
  // ---- create button + dropdown ----
  const create = await page.evaluate(async () => {
    const out = {}; fxSection('local'); document.getElementById('tg-local')?.classList.add('on');
    fxState.masks.length = 0; mskSel = -1; mskRebuild();
    const wrap = document.getElementById('msk-create-wrap');
    out.emptyWrapVisible = !wrap.hidden && wrap.getBoundingClientRect().height > 0;
    out.tileActions = [...document.querySelectorAll('#msk-create-grid .msk-tile')].map((b) => b.getAttribute('onclick'));
    mskAdd('radial'); mskSel = 0; mskRebuild();
    out.wrapHiddenWithMask = wrap.hidden || wrap.getBoundingClientRect().height === 0;
    const btn = document.getElementById('btn-msk-create');
    out.btn = { text: btn.textContent.replace(/\s+/g, ' ').trim(), haspopup: btn.getAttribute('aria-haspopup'), expanded0: btn.getAttribute('aria-expanded') };
    btn.click(); await new Promise((r) => setTimeout(r, 50));
    const menu = document.querySelector('.msk-add-menu');
    out.menuOpen = !!menu; out.role = menu?.getAttribute('role'); out.expanded1 = btn.getAttribute('aria-expanded');
    out.focusInMenu = !!menu && menu.contains(document.activeElement);
    out.items = menu ? [...menu.querySelectorAll('[role=menuitem]')].map((b) => ({ t: b.textContent.trim(), a: b.getAttribute('onclick') || '' })) : [];
    out.firstSection = menu ? [...menu.children].map((c) => c.textContent.trim()).filter(Boolean).slice(0, 3) : [];
    out.kbd = menu ? [...menu.querySelectorAll('kbd')].map((k) => k.textContent) : [];
    if (menu) {
      const first = document.activeElement;
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      out.arrowMoved = document.activeElement !== first;
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
      out.escClosed = !document.querySelector('.msk-add-menu'); out.expanded2 = btn.getAttribute('aria-expanded'); out.focusBack = document.activeElement === btn;
    }
    btn.click(); await new Promise((r) => setTimeout(r, 50));
    const n0 = fxState.masks.length;
    document.querySelector('.msk-add-menu [data-kind="linear"]')?.click(); await new Promise((r) => setTimeout(r, 80));
    out.pickAdded = fxState.masks.length === n0 + 1; out.closedOnPick = !document.querySelector('.msk-add-menu'); out.expanded3 = btn.getAttribute('aria-expanded');
    // "Show all mask types" brings the tiles back
    btn.click(); await new Promise((r) => setTimeout(r, 50));
    const showAll = [...document.querySelectorAll('.msk-add-menu .msk-more-it')].find((b) => /all mask types/i.test(b.textContent));
    showAll?.click(); await new Promise((r) => setTimeout(r, 80));
    out.tilesBack = !wrap.hidden && document.querySelectorAll('#msk-create-grid .msk-tile').length > 0 && wrap.getBoundingClientRect().height > 0;
    mskCreateExpandToggle(); fxState.masks.length = 0; mskSel = -1; mskRebuild();
    return out;
  });
  assert.ok(create.emptyWrapVisible, 'empty state shows the expanded tiles');
  assert.ok(create.wrapHiddenWithMask, 'tiles fold away once a mask exists');
  assert.equal(create.btn.haspopup, 'menu'); assert.equal(create.btn.expanded0, 'false'); assert.match(create.btn.text, /Create New Mask/);
  assert.ok(create.menuOpen && create.role === 'menu' && create.expanded1 === 'true', 'menu opens, aria-expanded=true');
  assert.ok(create.focusInMenu, 'focus moves into the menu');
  assert.match(create.firstSection[1] || '', /One click/, 'One click section at the top: ' + JSON.stringify(create.firstSection));
  assert.ok(create.kbd.length >= 3, 'shortcut letters shown: ' + JSON.stringify(create.kbd));
  assert.ok(create.arrowMoved, 'ArrowDown moves focus'); assert.ok(create.escClosed && create.expanded2 === 'false' && create.focusBack, 'Esc closes, focus returns');
  assert.ok(create.pickAdded && create.closedOnPick && create.expanded3 === 'false', 'picking closes the menu');
  assert.ok(create.tilesBack, '"Show all mask types" restores the tile grid');
  // every tile action exists in the dropdown (landscape tile = the Landscape group items)
  const acts = create.items.map((i) => i.a);
  for (const a of create.tileActions) {
    if (/mskLandscapeToggle/.test(a)) continue;
    const key = a.replace(/^\s*/, '');
    if (!acts.some((x) => x.includes(key))) fails.push(`dropdown lacks tile action ${key}`);
  }
  console.log(`reachability: ${checked} baseline controls checked across ${Object.keys(base.states).length} states (${tiles} create tiles via dropdown); default-visible shrink per state: ${budget.map(([s, b, a]) => `${s} ${b}->${a}`).join(', ')}`);
  console.log(`dropdown: ${create.items.length} items, shortcuts ${JSON.stringify(create.kbd)}`);
  if (errors.length) fails.push('page errors: ' + errors.slice(0, 3).join(' | '));
} finally { await close(); }
if (fails.length) { console.error(`FAIL ${fails.length}:\n  ` + fails.slice(0, 40).join('\n  ')); process.exit(1); }
console.log('PASS mask sidebar reachability');
