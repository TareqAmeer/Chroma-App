#!/usr/bin/env node
// Compare a scan taken in the REAL desktop app (tools/diagnostics/app_control.py run --code "(<test/lib_mask_panel_scan.js>)().then(r=>JSON.stringify(r))")
// against the pre-redesign native baseline (test/baselines/mask_sidebar_inventory.json).
// usage: node test/mask_sidebar_compare.mjs <app_control_output.json>
import { readFile } from 'node:fs/promises';
const raw = JSON.parse(await readFile(process.argv[2], 'utf8'));
const scan = JSON.parse(raw.result ?? JSON.stringify(raw));
const base = JSON.parse(await readFile(new URL('./baselines/mask_sidebar_inventory.json', import.meta.url), 'utf8'));
const RENAMED = { 'button|+ Mask|mskAddMenu': 'button|+Create New Mask|btn-msk-create' };
const TILE = /^button\|(Auto Subject|Subject|Objects|Sky|Landscape|Background|Skin|Brush|Linear|Radial|Color|Luminance|Depth|Water|Vegetation|Mountains|Buildings|Ground)\|(mskAdd\w*|mskLandscapeToggle)$/;
// Transient-state artefacts of the baseline run, not controls: the AI busy overlay's Cancel (exists only while a model runs)
// and the Pick button's label while the eyedropper was left armed ("Picking - shift-click to add" is the armed form of "Pick manually").
const TRANSIENT = [/\|mskAiBusyCancel$/];
const ARMED = { 'button|Picking — shift-click to add|btn-msk-cr-eye': 'button|Pick manually|btn-msk-cr-eye' };
const fails = []; let checked = 0, tiles = 0; const ids = new Set();
for (const [state, st] of Object.entries(base.states)) {
  const now = scan.types[state]; if (!now) { fails.push(`state ${state} not scanned`); continue; }
  const by = new Map(now.expanded.map((c) => [c.id, c]));
  for (const [id0, info] of Object.entries(st.controls)) {
    ids.add(id0);
    if (TRANSIENT.some((r) => r.test(id0))) continue;
    if (TILE.test(id0) && state !== 'none') { tiles++; continue; }
    const c = by.get(RENAMED[id0] || id0) || by.get(ARMED[id0] || '') || by.get(id0.replace('Pick manually', 'Picking — shift-click to add')) || (id0 === 'button|Invert|mskInvert' ? by.get('button|Invert|btn-msk-tool-invert') : null);
    if (!c) { fails.push(`${state}: LOST ${id0}`); continue; }
    checked++;
    if (info.visibleByDefault && !c.vis) fails.push(`${state}: ${id0} present but not visible after expanding every disclosure`);
  }
}
const shrink = Object.entries(base.states).filter(([s]) => s !== 'none').map(([s, st]) => [s, Object.values(st.controls).filter((c) => c.visibleByDefault).length, scan.types[s].default.filter((c) => c.vis).length]);
console.log(`native: ${ids.size} unique inventoried controls, ${Object.keys(base.states).length} states, ${checked} control-state checks, ${tiles} create-tile checks (via dropdown)`);
console.log('visible-after-all-open (old) -> visible by default (new): ' + shrink.map(([s, a, b]) => `${s} ${a}->${b}`).join(', '));
if (fails.length) { console.error('FAIL ' + fails.length + '\n  ' + fails.slice(0, 40).join('\n  ')); process.exit(1); }
console.log('PASS native reachability');
