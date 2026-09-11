// T2 (editor_ux_spec.json) — cross-checks chromasmith-22.html's hand-maintained _FX_SNAP_SLIDERS/
// _FX_SNAP_COLORS/_FX_SNAP_TOGGLES lists against the DOM's actual sl-/cl-/tg- ids inside every
// .fx-ctrl[data-fxsec] card. Nothing did this before: deconv-amt/deconv-rad sat unregistered in
// _FX_SNAP_SLIDERS for a long time (broke undo, session persistence, and the header Reset
// button's changed-state signal — see spec DT1's note) with zero test failure anywhere, because
// the only thing that would ever have caught it is exactly this kind of list-vs-DOM diff.
//
// Not everything found here is a bug — a few controls are deliberately excluded (nr-high-strength
// only takes effect via a separate desktop-native path; -pv/-ph/-scale/-defr lens sliders have
// their own reasons; canvas-z/heal-*/straighten are per-photo geometry or brush settings, not
// graded state). Real exclusions live in KNOWN_EXCLUSIONS below with a one-line reason each — an
// id that isn't there and isn't tracked is a genuine finding.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const d = await readFile(path.join(ROOT, u.slice(1)));
    const ext = path.extname(u);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const port = server.address().port;

// id (WITHOUT its sl-/cl-/tg- prefix, matching how the real lists store sliders/toggles — see
// chromasmith-22.html's own comment on _FX_SNAP_COLORS being the one exception that keeps its
// prefix) -> reason it is deliberately not snapshot-tracked.
// T17 (editor_ux_spec.json): this object is itself hand-maintained with no automated check that
// its entries stay current — same class of risk this whole script exists to catch elsewhere. The
// realistic mitigation is process, not another check-on-a-check: a PR that removes the mechanism
// an exclusion's reason describes (e.g. deletes healSyncUI's separate brush-settings path) must
// also remove that entry here, not leave it as dead justification for an id that may have started
// mattering again.
const KNOWN_EXCLUSIONS = {
  sliders: {
    'nr-high-strength': 'desktop-native High-tier NR job parameter, not a graded/undoable value — travels via window.chromasmithRawNrHighStrength + localStorage instead',
    'straighten': 'geometry (crop/rotate/flip/straighten) has its own per-photo it.geom snapshot path, not the graded-effects snapshot',
    'canvas-z': 'canvas zoom is UI framing, not a graded value — intentionally not part of the undo/redo history',
    'heal-size': 'Retouch brush-tool setting, not persisted photo state — see healSyncUI\'s own comment on why brush settings are tracked separately from spots',
    'heal-feather': 'see heal-size',
    'heal-opacity': 'see heal-size',
    'crop-custom-w': 'crop aspect-ratio custom input, not a range slider (type=number) and not part of the graded-effects snapshot',
    'crop-custom-h': 'see crop-custom-w',
    'lens-manual-focal': 'manual-lens metadata (type=number), not a graded slider',
    // Structured state (an object/array, not a single number) carried by its own getUISnapshot()
    // field instead of the flat sliders map — the live DOM slider is just today's EDITING widget
    // for whichever band/point/curve-point is currently selected, not the value of record.
    'crv-s': 'tracked via s.curveParam (fxState.curveParam), not the flat sliders map',
    'crv-d': 'see crv-s', 'crv-l': 'see crv-s', 'crv-h': 'see crv-s',
    'hsl-h': 'tracked via s.hsl (fxState.hsl, per-band object) — the slider reflects whichever band is currently selected',
    'hsl-s': 'see hsl-h', 'hsl-l': 'see hsl-h',
    'wheel-lift-l': 'tracked via s.wheels (fxState.wheels)', 'wheel-gamma-l': 'see wheel-lift-l', 'wheel-gain-l': 'see wheel-lift-l',
    'pc-h': 'tracked via s.pointColors (fxState.pointColors array, one entry per picked point)',
    'pc-s': 'see pc-h', 'pc-l': 'see pc-h', 'pc-r': 'see pc-h',
    'msk-selview-opacity': 'a mask-selection VIEW aid (how bright the selection overlay renders), not graded photo state',
    // VIDEO-ONLY rows (chromasmith-22.html: fxSyncVideoUI shows/hides them) — docs/video-grading.md
    // owns their persistence path, not the still-photo effects snapshot.
    'grain-motion': 'video-only grain-continuity control, see docs/video-grading.md',
    'gate-weave': 'video-only, see grain-motion', 'film-breath': 'video-only, see grain-motion',
    // Export-tab settings are app/export preferences, not per-photo graded state — they have
    // their own persistence (see chromasmith-22.html around line 15665's export-settings snapshot).
    'exp-q': 'Export-tab setting (JPEG quality), not per-photo graded state', 'exp-wm-op': 'Export-tab watermark opacity, same as exp-q',
  },
  colors: {
    'cl-canvas-bg': 'tracked via s.canvas (fxState.canvas object: ar/bg/blur), not the flat colors map',
  },
  toggles: {
    'lens-auto': 'a sub-toggle inside the always-on Lens section, not a section on/off switch — no ff-<name> fields block to gate',
    'demosaic-ahd': 'a sub-toggle inside the always-on Noise Reduction section, same shape as lens-auto',
    'hal-white': 'a sub-toggle inside the always-on-when-hal-is-on Halation fields, not its own section toggle',
    'hal-noremjet': 'see hal-white',
    'hal-extreme': 'see hal-white',
    'retouch': 'Retouch has no off state to speak of — its "edited" signal is spot count (fx-has-heal), not a graded on/off; see healSyncUI\'s own comment',
    'exp-hdr': 'Export-tab setting, not per-photo graded state', 'exp-wm': 'see exp-hdr', 'gp-save': 'app-level Google Photos preference, not per-photo state',
  },
};

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&deskx=1`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const result = await page.evaluate(() => {
  const domIds = (prefix, selector) =>
    Array.from(document.querySelectorAll(`.fx-ctrl[data-fxsec] ${selector}`))
      .map((el) => el.id)
      .filter((id) => id.startsWith(prefix))
      .map((id) => id.slice(prefix.length));
  return {
    domSliders: domIds('sl-', 'input[type=range][id^="sl-"]'),
    domColors: domIds('', 'input[type=color][id^="cl-"]'), // _FX_SNAP_COLORS keeps the full "cl-" prefix
    domToggles: domIds('tg-', '[id^="tg-"]'),
    snapSliders: typeof _FX_SNAP_SLIDERS !== 'undefined' ? _FX_SNAP_SLIDERS : null,
    snapColors: typeof _FX_SNAP_COLORS !== 'undefined' ? _FX_SNAP_COLORS : null,
    snapToggles: typeof _FX_SNAP_TOGGLES !== 'undefined' ? _FX_SNAP_TOGGLES : null,
  };
});
await browser.close();
server.close();

if (!result.snapSliders) {
  console.error('Could not read _FX_SNAP_SLIDERS/_FX_SNAP_COLORS/_FX_SNAP_TOGGLES from the page — check chromasmith-22.html still defines them as bare top-level consts.');
  process.exit(2);
}

const findings = [];
function checkGroup(label, domIds, snapList, exclusions) {
  const snapSet = new Set(snapList);
  for (const id of new Set(domIds)) {
    if (exclusions[id]) continue;
    if (!snapSet.has(id)) findings.push(`[${label}] DOM has "${id}" but it is not in the snapshot list and not in KNOWN_EXCLUSIONS — reset/undo/session persistence silently skip it`);
  }
  // The other direction matters too: a snapshot entry naming an id that no longer exists in the
  // DOM is dead weight at best and a sign a control was removed without updating this list.
  for (const id of snapList) {
    if (!domIds.includes(id)) findings.push(`[${label}] snapshot list has "${id}" but no matching element exists in the DOM`);
  }
}
checkGroup('sliders', result.domSliders, result.snapSliders, KNOWN_EXCLUSIONS.sliders);
checkGroup('colors', result.domColors, result.snapColors, KNOWN_EXCLUSIONS.colors);
checkGroup('toggles', result.domToggles, result.snapToggles, KNOWN_EXCLUSIONS.toggles);

console.log('EDITOR SNAP-LIST CROSS-CHECK (_FX_SNAP_SLIDERS/_FX_SNAP_COLORS/_FX_SNAP_TOGGLES vs DOM)');
console.log('='.repeat(78));
if (findings.length) {
  findings.forEach((f) => console.log('  ' + f));
  console.log(`\n${findings.length} finding(s).`);
  console.log('RESULT: FAIL');
  process.exit(1);
} else {
  console.log('No drift between the snapshot lists and the DOM.');
  console.log('RESULT: PASS');
}
