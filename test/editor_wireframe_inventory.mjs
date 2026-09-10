// FULL-INVENTORY wireframe check for the EDITOR — mirrors test/wireframe_inventory.mjs's answer
// to the same problem test/wireframe_diff.mjs (and editor_wireframe_diff.mjs) structurally
// cannot solve on their own: a hand-written pair map can only confirm assumptions already baked
// into it. It cannot see an extra/missing control, a wrong count, or a row under the wrong
// section. This walks both trees under a container pair and compares "visible atoms" (controls,
// icons, text) by SHAPE/TEXT/GEOMETRY, never by class name — the two codebases share none.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS, settleForCapture,
  writeReport, recheck, printRecheck } from './wireframe_diff_lib.mjs';
import { loadAllowlist, isAccepted, hardGate } from './wireframe_checks_lib.mjs';

const REPORT_PATH = 'test/output/editor_wireframe_inventory_report.json';
const ACCEPTED_PATH = 'test/editor_wireframe_inventory_accepted.json';
let ACCEPTED = [];
try { ACCEPTED = loadAllowlist(JSON.parse(await readFile(ACCEPTED_PATH, 'utf8'))); } catch { /* none yet */ }

const ROOT = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const d = await readFile(path.join(ROOT, u.slice(1)));
    const ext = path.extname(u);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.otf': 'font/otf' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const port = server.address().port;
const VIEWPORT = { width: 1440, height: 900 };

// Container pairs. Only the CONTAINER is hand-mapped; everything inside is discovered.
//   - `panel` is deliberately scoped to the LOOKS tp-panel only, both sides: the wireframe's
//     other 9 tp-panels are placeholder `<p>Foo tools live here.</p>` mocks (Editor (Developer)
//     View.dc.html:374-382) — inventorying the whole .toolpanel container would report every
//     real Curves/HSL/Masks control in the app as an "extra", which is noise, not a finding.
const ZONES = [
  { label: 'topbar', wf: '.topbar', app: '#fx-deskbar' },
  { label: 'rail', wf: '.rail', app: '#fx-toolrail' },
  { label: 'panel', wf: '.tp-panel[data-panel="looks"]', app: '[data-fxsec="looks"]' },
  { label: 'statusbar', wf: '.statusbar', app: '#fx-statusbar' }, // real "missing" until Phase F builds it
];
// Menus whose CONTENTS are invisible until opened — same principle as Library's OPEN_MENUS.
// 2026-09-10: Tools + View + ⋯ merged into ONE settings menu (#fx-settings/#fx-settings-menu),
// a two-column drill-down — one gear trigger, a category rail (#fx-settings-cats), and one
// content pane visible at a time (settingsShowCat()). Both rows below share the same
// appTrigger/appContainer-open (the gear) but click a different category (appCatClick) before
// inventorying, since each wireframe menu maps to one settings PANE now, not a standalone popover.
const OPEN_MENUS = [
  { label: 'toolsmenu', wfTrigger: '#btn-tools', wfContainer: '#tools-menu', appTrigger: '#fx-settings .fx-db', appCatClick: '.fx-settings-cat[data-cat="tools"]', appContainer: '#fx-tools-menu' },
  // 2026-09-09: the app now has a real View menu (gamut warning + Appearance, split out of both
  // Tools and the ⋯ overflow menu per item 3.1.6); 2026-09-10: it became the "view" category pane
  // inside the merged settings menu rather than its own standalone trigger.
  { label: 'viewmenu', wfTrigger: '#btn-view-menu', wfContainer: '#view-menu', appTrigger: '#fx-settings .fx-db', appCatClick: '.fx-settings-cat[data-cat="view"]', appContainer: '#fx-view-menu' },
];

// Wireframe sample-data noise: the preset grid renders arbitrary hand-picked LUT names the app's
// real preset library will never textually match — same reasoning as Library's NOISE_LABELS,
// scaled down since the Editor's only noisy zone is the preset grid (photo count, filenames).
const NUMERIC_RE = /^[\d.,%$]+$/;
const DYNAMIC_LABEL_RE = /of \d|\d+ of|·/i;
function isDataNoise(atom) {
  if (atom.kind === 'noisy-grid') return true; // preset-grid/#fx-looks stand-in atom — see INVENTORY_FN
  if (atom.kind !== 'text') return false;
  return NUMERIC_RE.test(atom.text) || DYNAMIC_LABEL_RE.test(atom.text);
}

// Same INVENTORY_FN as Library's — copied verbatim (not re-derived) since it's the actual
// mechanism that makes a class-name-free comparison possible: icon shape signature, icon
// centering, kind/text/geometry per visible atom.
const INVENTORY_FN = `(sel) => {
  // Force a layout/style flush before reading anything — editor_wireframe_diff.mjs found
  // (2026-09-08) that a getComputedStyle read right after a theme toggle + photo load can return
  // a genuinely STALE value even though the underlying custom property already resolved
  // correctly; a synchronous reflow immediately before reading fixed it 10/10 in that harness.
  void document.body.offsetHeight;
  const root = document.querySelector(sel);
  if (!root) return null;
  const rootBox = root.getBoundingClientRect();
  const out = [];
  // Same reasoning as Library's grid exclusion: the wireframe's preset grid (#preset-grid) is a
  // small hand-picked mock (~6 tiles); the app's Looks gallery (#fx-looks) renders the real
  // 113-entry preset library. Comparing their atom counts/tallies is comparing two unrelated
  // dynamic content sets, not a fidelity question — it produced 146 vs 32 atoms and a wall of
  // "EXTRA 1x text:<film stock name>" noise on the first run. Descend no further than these
  // containers: their PRESENCE (and that at least one tile renders) is what's checked, not their
  // contents — same as the grid zone being entirely excluded from Library's count-based checks.
  // #db-title-name/.fn: the open photo's filename/title — dynamic per-photo content, same
  // reasoning as the preset-grid/#fx-looks exclusion above. The wireframe hardcodes its own
  // sample filename (IMG_0427.RAF); the harness loads a different fixture and displays it
  // without an extension (portrait) — neither should ever be expected to textually match.
  const NOISY_CONTAINERS = ['#preset-grid', '#fx-looks', '#db-title-name', '.tb-title .fn'];
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0;
  };
  const walk = (el) => {
    for (const child of el.children) {
      if (!visible(child)) continue;
      if (NOISY_CONTAINERS.some((s) => child.matches && child.matches(s))) {
        const tileCount = child.children.length;
        out.push({ iconSig: '', kind: 'noisy-grid', text: \`\${tileCount} tile(s)\`, x: Math.round(child.getBoundingClientRect().left - rootBox.left), y: Math.round(child.getBoundingClientRect().top - rootBox.top), w: 0, h: 0, fs: '', ff: '', centerOffset: null });
        continue; // do not recurse into it
      }
      const tag = child.tagName.toLowerCase();
      const b = child.getBoundingClientRect();
      const cs = getComputedStyle(child);
      const ownText = Array.from(child.childNodes)
        .filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
      const isControl = ['button', 'input', 'select', 'textarea', 'a'].includes(tag);
      const isIcon = tag === 'svg' || tag === 'img';
      const iconSig = isIcon ? (() => {
        const parts = [];
        for (const g of child.querySelectorAll('path,rect,line,circle,polyline,polygon,ellipse')) {
          const n = g.tagName.toLowerCase();
          const d = (g.getAttribute('d') || g.getAttribute('points') || '').replace(/\\s+/g, ' ').trim();
          const box = ['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2']
            .map((a) => g.getAttribute(a)).filter(Boolean).join(',');
          parts.push(n + ':' + (d || box));
        }
        return parts.sort().join('|') || (child.getAttribute('src') || '').slice(-40);
      })() : '';
      const centerOffset = isIcon ? (() => {
        let host = child.parentElement;
        for (let i = 0; i < 3 && host && host !== root; i++) {
          const hcs = getComputedStyle(host);
          const hb = host.getBoundingClientRect();
          const isSquareish = hb.width > 0 && Math.abs(hb.width - hb.height) < Math.max(4, hb.width * 0.15);
          const looksLikeHitShape = isSquareish &&
            (['BUTTON', 'A'].includes(host.tagName) || parseFloat(hcs.borderRadius) > 0);
          if (looksLikeHitShape) {
            const iconCx = b.left + b.width / 2, iconCy = b.top + b.height / 2;
            const hostCx = hb.left + hb.width / 2, hostCy = hb.top + hb.height / 2;
            return Math.round(Math.hypot(iconCx - hostCx, iconCy - hostCy) * 10) / 10;
          }
          host = host.parentElement;
        }
        return null;
      })() : null;
      if (isControl || isIcon || ownText) {
        out.push({
          iconSig,
          kind: isIcon ? 'icon' : (isControl ? tag : 'text'),
          text: (ownText || child.getAttribute('placeholder') || '').replace(/\\s+/g, ' ').slice(0, 40),
          x: Math.round(b.left - rootBox.left),
          y: Math.round(b.top - rootBox.top),
          w: Math.round(b.width),
          h: Math.round(b.height),
          fs: cs.fontSize,
          ff: cs.fontFamily.split(',')[0].replace(/['"]/g, ''),
          centerOffset,
        });
      }
      walk(child);
    }
  };
  walk(root);
  return { atoms: out, box: { w: Math.round(rootBox.width), h: Math.round(rootBox.height) } };
}`;

function summarize(atoms) { return atoms.map((a) => `${a.kind}${a.text ? `:"${a.text}"` : ''}`); }
function tally(list) { const m = new Map(); list.forEach((k) => m.set(k, (m.get(k) || 0) + 1)); return m; }

// Icon-shape regression baseline — same reasoning as Library's: comparing the app's icon
// geometry against the wireframe's is pure noise (different icon SETS by design), but a
// committed baseline of the APP's OWN icon shapes over time catches a wrong glyph swapped in
// silently, which a mere icon COUNT can never see.
const ICON_BASELINE = path.join(ROOT, 'test/baselines/editor_wireframe_icons.json');
function iconSignatures(zoneLabel, atoms) {
  return atoms.filter((a) => a.kind === 'icon').map((a, i) => [`${zoneLabel}#${i}`, a.iconSig || '(empty)']);
}

const b = await chromium.launch({ args: DETERMINISTIC_LAUNCH_ARGS });
const findings = [];
const iconsNow = {};

const wf = await b.newPage({ viewport: VIEWPORT, ...DETERMINISTIC_CONTEXT_OPTIONS });
await wf.goto(`http://127.0.0.1:${port}/chromasmith-design/project/Editor%20(Developer)%20View.dc.html`, { waitUntil: 'load' });
await settleForCapture(wf);

const app = await b.newPage({ viewport: VIEWPORT, ...DETERMINISTIC_CONTEXT_OPTIONS });
app.on('pageerror', (e) => console.log('[pageerror]', e.message));
await app.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await app.waitForTimeout(1500);
await app.evaluate(() => {
  document.querySelectorAll('button').forEach((btn) => { if (btn.textContent.trim() === 'Got it') btn.click(); });
  if (typeof applyFxLayout === 'function') applyFxLayout(); // see editor_wireframe_diff.mjs's note on __TAURI__ timing
});
// ⚠️ chromasmithForceLibraryReady() (library-ui.js:5655) forces the Library into its FULL
// window takeover (body.lib-full) as a splash-hiding fallback if a boot watchdog
// (bumpBootSplashWatchdog, chromasmith-22.html:1265) fires before boot settles — a TIMING race,
// not a deterministic state. When it wins, every editor zone (topbar/rail/panel) renders at
// 0x0 because body.lib-full hides #fx-deskbar entirely, and every finding downstream is that
// artifact, not a real defect (confirmed live: #fx-tools computed display was inline-flex but
// its rect was 0x0 solely because of this). Escape reliably exits full-view
// (library-ui.js:5924 `state.expanded_view` branch) regardless of which side of the race fired,
// so press it unconditionally rather than trying to win a timing race.
await app.keyboard.press('Escape');
await app.waitForTimeout(150);
// Load a real photo so #fx-zoom-ctrl/#fx-tools (display:none until then) are inventoried, and
// switch the rail to Looks so the panel zone measures real content, not whatever section was
// last active (the wireframe defaults to Looks — Editor (Developer) View.dc.html:290).
// ⚠️ An in-page fetch('test/fixtures/portrait.png') resolves relative to the APP's own origin
// (…/desktop/dist/index.html), not the repo root — it 404s, the photo never loads, #fx-tools
// stays invisible, and every menu-content finding downstream reads as "MISSING everything"
// purely from that, not a real defect (confirmed live: the button was `visible: false`).
// Read the fixture from disk and hand it in as base64, same as editor_wireframe_diff.mjs.
const fixtureB64 = (await readFile('test/fixtures/portrait.png')).toString('base64');
await app.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const file = new File([bytes], 'portrait.png', { type: 'image/png' });
  if (typeof window.loadFXImages === 'function') await window.loadFXImages([file]);
}, fixtureB64);
await app.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages && fxImages.length > 0, { timeout: 10000 }).catch(() => {});
await app.evaluate(() => { if (typeof fxSection === 'function') fxSection('looks', true); });
await app.waitForTimeout(300);
await settleForCapture(app);

async function diffZone(zone) {
  const w = await wf.evaluate(`(${INVENTORY_FN})(${JSON.stringify(zone.wf)})`);
  const a = await app.evaluate(`(${INVENTORY_FN})(${JSON.stringify(zone.app)})`);
  if (!w) { findings.push(`[${zone.label}] wireframe container ${zone.wf} not found`); return; }
  if (!a) { findings.push(`[${zone.label}] app container ${zone.app} NOT FOUND`); return; }

  for (const [k, sig] of iconSignatures(zone.label, a.atoms)) iconsNow[k] = sig;

  const wClean = w.atoms.filter((x) => !isDataNoise(x));
  const aClean = a.atoms.filter((x) => !isDataNoise(x));
  const wSig = summarize(wClean), aSig = summarize(aClean);

  const wNoise = w.atoms.filter(isDataNoise).length, aNoise = a.atoms.filter(isDataNoise).length;
  if (wNoise !== aNoise) findings.push(`[${zone.label}] dynamic-data row count: wireframe ${wNoise} vs app ${aNoise}`);

  const wT = tally(wSig), aT = tally(aSig);
  for (const [k, n] of wT) { const have = aT.get(k) || 0; if (have < n) findings.push(`[${zone.label}] MISSING ${n - have}x  ${k}   (wireframe has ${n}, app has ${have})`); }
  for (const [k, n] of aT) { const want = wT.get(k) || 0; if (n > want) findings.push(`[${zone.label}] EXTRA   ${n - want}x  ${k}   (app has ${n}, wireframe has ${want})`); }
  if (wSig.length !== aSig.length) findings.push(`[${zone.label}] atom count: wireframe ${wSig.length} vs app ${aSig.length}`);

  const fsOf = (atoms) => tally(atoms.filter((x) => x.text).map((x) => x.fs));
  const wFs = fsOf(wClean), aFs = fsOf(aClean);
  for (const size of new Set([...wFs.keys(), ...aFs.keys()])) {
    const wn = wFs.get(size) || 0, an = aFs.get(size) || 0;
    if (wn !== an) findings.push(`[${zone.label}] font-size ${size}: wireframe uses it on ${wn} text atom(s), app on ${an}`);
  }

  for (let i = 0; i < Math.min(6, wSig.length, aSig.length); i++) {
    if (wSig[i] !== aSig[i]) { findings.push(`[${zone.label}] order@${i}: wireframe ${wSig[i]} vs app ${aSig[i]}`); break; }
    const dx = Math.abs(wClean[i].x - aClean[i].x);
    if (dx > 12) findings.push(`[${zone.label}] x-offset of ${wSig[i]}: wireframe ${wClean[i].x}px vs app ${aClean[i].x}px (Δ${dx})`);
  }

  const ICON_CENTER_TOLERANCE = 1.5;
  for (const icon of aClean.filter((x) => x.kind === 'icon' && x.centerOffset != null)) {
    if (icon.centerOffset > ICON_CENTER_TOLERANCE) findings.push(`[${zone.label}] icon off-center by ${icon.centerOffset}px within its hit-shape (icon#${aClean.indexOf(icon)})`);
  }
}
for (const zone of ZONES) await diffZone(zone);

for (const m of OPEN_MENUS) {
  await wf.click(m.wfTrigger).catch(() => {});
  await wf.waitForTimeout(150);
  const w = await wf.evaluate(`(${INVENTORY_FN})(${JSON.stringify(m.wfContainer)})`);
  await wf.click(m.wfTrigger).catch(() => {});

  await app.click(m.appTrigger).catch(() => {});
  if (m.appCatClick) { await app.click(m.appCatClick).catch(() => {}); await app.waitForTimeout(100); }
  await app.waitForTimeout(150);
  const a = await app.evaluate(`(${INVENTORY_FN})(${JSON.stringify(m.appContainer)})`);
  await app.click(m.appTrigger).catch(() => {});

  if (!w) { findings.push(`[${m.label}] wireframe menu ${m.wfContainer} did not open via ${m.wfTrigger}`); continue; }
  if (!a) { findings.push(`[${m.label}] app menu ${m.appContainer} did not open via ${m.appTrigger}`); continue; }
  const wSig = summarize(w.atoms.filter((x) => !isDataNoise(x)));
  const aSig = summarize(a.atoms.filter((x) => !isDataNoise(x)));
  const wT = tally(wSig), aT = tally(aSig);
  for (const [k, n] of wT) { const have = aT.get(k) || 0; if (have < n) findings.push(`[${m.label}] MISSING ${n - have}x  ${k}`); }
  for (const [k, n] of aT) { const want = wT.get(k) || 0; if (n > want) findings.push(`[${m.label}] EXTRA   ${n - want}x  ${k}`); }
}

await wf.close();
await app.close();
await b.close();
server.close();

// Icon-shape baseline diff — see comment above ICON_BASELINE.
let iconsBefore = {};
try { iconsBefore = JSON.parse(await readFile(ICON_BASELINE, 'utf8')); } catch { /* first run */ }
const iconKeys = new Set([...Object.keys(iconsBefore), ...Object.keys(iconsNow)]);
for (const k of iconKeys) {
  if (iconsBefore[k] && iconsNow[k] && iconsBefore[k] !== iconsNow[k]) {
    findings.push(`[iconshape] ${k}: icon shape changed since the last committed baseline — verify this is intentional, not a swapped glyph`);
  }
}
if (process.argv.includes('--icons-baseline')) {
  await mkdir(path.dirname(ICON_BASELINE), { recursive: true });
  await writeFile(ICON_BASELINE, JSON.stringify(iconsNow, null, 2));
  console.log(`Wrote ${Object.keys(iconsNow).length} icon signatures to ${ICON_BASELINE}`);
}

const records = { mismatches: findings.map((raw) => ({ raw })), missing: [] };
const rc = await recheck(REPORT_PATH, records);
printRecheck(rc);
await writeReport(REPORT_PATH, records);

const ok = await hardGate(findings, ACCEPTED, null, {});
process.exit(ok ? 0 : 1);
