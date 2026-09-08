// FULL-INVENTORY wireframe check — the thing test/wireframe_diff.mjs deliberately was not.
//
// wireframe_diff.mjs opens with the comment "This is a CHECK, not a search": it takes a
// hand-written map of 13 element pairs and verifies their colours/fonts. That design can only
// ever confirm assumptions already baked into the map. It structurally CANNOT see:
//   - an element the app has that the wireframe doesn't (a second search icon in the pill)
//   - an element the wireframe has that the app doesn't (the .logo-gap spacer)
//   - a control count mismatch (3 view-toggle buttons vs 2)
//   - a row rendered under the wrong section
//   - a wrong font size on a row type nobody listed
// Every one of those shipped while that tool reported a shrinking, reassuring number.
//
// This walks BOTH trees under a container pair and compares an inventory of "visible atoms"
// (interactive controls, text nodes, icons) by SHAPE, TEXT and GEOMETRY — never by class name,
// since the two codebases use different naming schemes and that mismatch is exactly what made
// the first attempt at this too noisy to keep. Extras and missing atoms are both failures.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS, settleForCapture,
  writeReport, recheck, printRecheck } from './wireframe_diff_lib.mjs';

const REPORT_PATH = path.join(process.cwd(), 'test/output/wireframe_inventory_report.json');

const ACCEPTED_PATH = path.join(process.cwd(), 'test/wireframe_accepted.json');
let ACCEPTED = [];
try { ACCEPTED = JSON.parse(await readFile(ACCEPTED_PATH, 'utf8')); } catch { /* none yet */ }
function isAccepted(finding) {
  return ACCEPTED.some((a) => finding.includes(a.match));
}

// Dynamic/mock data (photo counts, folder/person/album names, byte totals) differs between the
// wireframe's hand-authored numbers and the harness's synthetic library by design — it is not a
// fidelity bug. A "text" atom whose own text is pure digits/commas/currency-like, OR whose text
// matches a known dynamic-content label pattern, is data noise: skip it in the atom tally, but
// still count it (by kind+row position) so a whole ROW disappearing is still caught.
const NUMERIC_RE = /^[\d.,%$]+$/;
const DYNAMIC_LABEL_RE = /photos?$|of \d|·|GB|MB\b/i;
// Sample PEOPLE/ALBUM/DEVICE names are also dynamic mock data — the wireframe hardcodes its own
// arbitrary examples (Sarah, Portfolio, iPhone, ...) and the app's ?libtest mock uses a different
// arbitrary set (Dogs 2026, Archive T7, ...). Comparing them by exact text will never match on
// either side; what matters is that a person/album/device ROW renders at all (caught by the
// dynamic-data row-count check below), not which name it happens to carry.
const NOISE_LABELS = new Set([
  'Sarah', 'Buddy (Dog)', 'Summer Trip', 'Portfolio', 'External SSD', 'iPhone', 'Client Work',
  'Archive T7', 'Old LaCie', 'This Mac', 'Dogs 2026', 'Travel', 'Film scans',
]);
// The date-tree's month/day labels are also mock sample data — the wireframe's static "March" and
// the app's mock catalog_date_counts (August/July/December, whatever the mock happens to cover)
// are two independent arbitrary samples that will never name the same month. Same reasoning as
// NOISE_LABELS above: what matters is a month ROW renders (row-count check), not which month.
const MONTH_RE = /^(January|February|March|April|May|June|July|August|September|October|November|December)$/;
function isDataNoise(atom) {
  if (atom.kind !== 'text') return false;
  return NUMERIC_RE.test(atom.text) || DYNAMIC_LABEL_RE.test(atom.text) || NOISE_LABELS.has(atom.text) || MONTH_RE.test(atom.text);
}

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

// Container pairs to inventory. Only the CONTAINER is hand-mapped; everything inside is
// discovered, not asserted — that is the whole point.
const ZONES = [
  { label: 'topbar',  wf: '.topbar',  app: '#lib-top' },
  { label: 'sidebar', wf: '.sidebar', app: '#lib-side' },
  { label: 'statusbar', wf: '.statusbar', app: '#lib-bottom' },
];

// Serialized in the page: returns a flat, ordered inventory of visible atoms.
const INVENTORY_FN = `(sel) => {
  const root = document.querySelector(sel);
  if (!root) return null;
  const rootBox = root.getBoundingClientRect();
  const out = [];
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0;
  };
  const walk = (el) => {
    for (const child of el.children) {
      if (!visible(child)) continue;
      const tag = child.tagName.toLowerCase();
      const b = child.getBoundingClientRect();
      const cs = getComputedStyle(child);
      // An "atom" is a leaf-ish thing a user actually perceives: a control, an icon, or a
      // text-bearing node with no element children carrying their own text.
      const ownText = Array.from(child.childNodes)
        .filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
      const isControl = ['button', 'input', 'select', 'textarea', 'a'].includes(tag);
      const isIcon = tag === 'svg' || tag === 'img';
      // ICON SHAPE SIGNATURE — the gap that let the view-toggle ship a crop-tool glyph and a
      // log glyph where the wireframe has a 2x2 grid and three lines, across several sessions,
      // while this tool reported PASS. Counting icons can never catch a WRONG icon; comparing
      // their geometry can. Normalised so equivalent geometry expressed differently (a "line"
      // vs a two-point "path") still lands on the same signature where it genuinely is the
      // same shape, and whitespace/attribute order never matters.
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
        });
      }
      // Recurse regardless: a control can contain an icon + label, and we want both.
      walk(child);
    }
  };
  walk(root);
  return { atoms: out, box: { w: Math.round(rootBox.width), h: Math.round(rootBox.height) } };
}`;

function summarize(atoms) {
  // Class-name-free signature: what kind of thing, and what it says.
  return atoms.map((a) => `${a.kind}${a.text ? `:"${a.text}"` : ''}`);
}

// Count-based diff of atom kinds/labels — order-insensitive so a reordering doesn't cascade
// into every following row reading as both missing and extra.
function tally(list) {
  const m = new Map();
  list.forEach((k) => m.set(k, (m.get(k) || 0) + 1));
  return m;
}

// ── Icon-shape regression baseline ──────────────────────────────────────────────────────────
// ⚠️ This deliberately does NOT compare the app's icon geometry against the WIREFRAME's. The
// two use different icon sets on purpose — design.md records that no icon assets were supplied
// and Lucide was substituted in the wireframe, while the app draws its own set in chromasmith-
// 22.html's ICONS. Diffing those geometries would emit a mismatch for every icon on the page:
// pure noise, which is exactly how the last attempt at a structural diff died.
//
// What IS checkable is the app against ITSELF over time. A committed signature baseline turns
// "someone swapped the grid glyph for the crop-tool glyph" — which shipped for several sessions
// under a green PASS, because counting icons cannot see a wrong icon — into a loud diff.
// Convention follows test/baselines/*.json (committed, survives a fresh checkout), not
// test/output/ (gitignored).
const ICON_BASELINE = path.join(ROOT, 'test/baselines/wireframe_icons.json');

function iconSignatures(zoneLabel, atoms) {
  // Positional key: icons have no text to identify them, so the nth icon in a zone is the
  // identity. A reorder therefore reads as a change — correct, since moving an icon to a
  // different control is exactly the class of bug this exists to catch.
  return atoms.filter((a) => a.kind === 'icon')
    .map((a, i) => [`${zoneLabel}#${i}`, a.iconSig || '(empty)']);
}

const b = await chromium.launch({ args: DETERMINISTIC_LAUNCH_ARGS });
const findings = [];

const wf = await b.newPage({ viewport: VIEWPORT, ...DETERMINISTIC_CONTEXT_OPTIONS });
await wf.goto(`http://127.0.0.1:${port}/chromasmith-design/project/Library%20View.html`, { waitUntil: 'load' });
await wf.evaluate(() => document.getElementById('app').classList.add('dark'));
await settleForCapture(wf);

const app = await b.newPage({ viewport: VIEWPORT, ...DETERMINISTIC_CONTEXT_OPTIONS });
app.on('pageerror', (e) => console.log('[pageerror]', e.message));
// `libcat=1` turns on the catalog-feature mocks (date tree, Needs Review / Not-Face-Scanned
// counts, People/Albums/Devices names, Drives) — without it those sections render structurally
// empty and every one of their rows reads as a false "MISSING" finding here.
await app.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libcat=1&libn=60`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await app.waitForTimeout(2500);
await app.evaluate(() => {
  document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); });
});
await app.evaluate(() => { document.getElementById('lib-overlay')?.classList.add('full'); });
// The date tree starts with only its root open (dateExpanded = {'__root__'}) — years/months
// collapse by default, same as the real product. The wireframe's static mock instead shows a
// year AND its first month pre-expanded (Library View.html:301-304, "2026" -> "March"), so
// comparing against the app's default-collapsed state produces a false "March MISSING" finding
// that has nothing to do with real fidelity. Click the same two chevrons a user would, so both
// sides are compared in the same expanded state.
await app.evaluate(() => {
  const chevs = document.querySelectorAll('.lib-tree-row[data-date-scope] [data-chev-toggle]');
  if (chevs[0]) chevs[0].click();          // expand the newest year
});
await app.waitForTimeout(50);
await app.evaluate(() => {
  const chevs = document.querySelectorAll('.lib-tree-row[data-date-scope] [data-chev-toggle]');
  if (chevs[1]) chevs[1].click();          // expand its first (newest) month
});
await app.waitForTimeout(400);
await settleForCapture(app);

const iconsNow = {};

for (const zone of ZONES) {
  const w = await wf.evaluate(`(${INVENTORY_FN})(${JSON.stringify(zone.wf)})`);
  const a = await app.evaluate(`(${INVENTORY_FN})(${JSON.stringify(zone.app)})`);
  if (!w) { findings.push(`[${zone.label}] wireframe container ${zone.wf} not found`); continue; }
  if (!a) { findings.push(`[${zone.label}] app container ${zone.app} NOT FOUND`); continue; }

  for (const [k, sig] of iconSignatures(zone.label, a.atoms)) iconsNow[k] = sig;

  // Row-count parity for noisy rows: same number of dynamic-data atoms, even though their exact
  // text will never match (mock counts vs the wireframe's hand-picked numbers).
  const wNoise = w.atoms.filter(isDataNoise).length, aNoise = a.atoms.filter(isDataNoise).length;
  if (wNoise !== aNoise) {
    findings.push(`[${zone.label}] dynamic-data row count: wireframe ${wNoise} vs app ${aNoise}`);
  }
  const wClean = w.atoms.filter((x) => !isDataNoise(x));
  const aClean = a.atoms.filter((x) => !isDataNoise(x));

  const wSig = summarize(wClean), aSig = summarize(aClean);
  const wT = tally(wSig), aT = tally(aSig);

  for (const [k, n] of wT) {
    const have = aT.get(k) || 0;
    if (have < n) findings.push(`[${zone.label}] MISSING ${n - have}x  ${k}   (wireframe has ${n}, app has ${have})`);
  }
  for (const [k, n] of aT) {
    const want = wT.get(k) || 0;
    if (n > want) findings.push(`[${zone.label}] EXTRA   ${n - want}x  ${k}   (app has ${n}, wireframe has ${want})`);
  }
  if (wSig.length !== aSig.length) {
    findings.push(`[${zone.label}] atom count: wireframe ${wSig.length} vs app ${aSig.length}`);
  }

  // Font-size inventory per zone: catches a whole row type rendering at the wrong size even
  // when nobody hand-listed that row type as a pair.
  const fsOf = (atoms) => tally(atoms.filter((x) => x.text).map((x) => x.fs));
  const wFs = fsOf(wClean), aFs = fsOf(aClean);
  const allFs = new Set([...wFs.keys(), ...aFs.keys()]);
  for (const size of allFs) {
    const wn = wFs.get(size) || 0, an = aFs.get(size) || 0;
    if (wn !== an) findings.push(`[${zone.label}] font-size ${size}: wireframe uses it on ${wn} text atom(s), app on ${an}`);
  }

  // Geometry of the first few atoms — catches "search jammed against the logo" (an x-offset
  // difference), which no per-element computed-style check can express.
  for (let i = 0; i < Math.min(6, wSig.length, aSig.length); i++) {
    if (wSig[i] !== aSig[i]) { findings.push(`[${zone.label}] order@${i}: wireframe ${wSig[i]} vs app ${aSig[i]}`); break; }
    const dx = Math.abs(wClean[i].x - aClean[i].x);
    if (dx > 12) findings.push(`[${zone.label}] x-offset of ${wSig[i]}: wireframe ${wClean[i].x}px vs app ${aClean[i].x}px (Δ${dx})`);
  }
}

await wf.close(); await app.close();
await b.close();
server.close();

// ── icon-shape regression check ─────────────────────────────────────────────────────────────
// `--icons-baseline` records the current glyphs as correct; every other run compares against
// that file and reports any icon whose geometry changed. Findings use the same em-dash record
// format the rest of this file emits so they flow through the allowlist and recheck machinery
// unchanged.
if (process.argv.includes('--icons-baseline')) {
  await mkdir(path.dirname(ICON_BASELINE), { recursive: true });
  await writeFile(ICON_BASELINE, JSON.stringify({ capturedAt: new Date().toISOString().slice(0, 10), icons: iconsNow }, null, 2));
  console.log(`icon baseline written: ${Object.keys(iconsNow).length} glyphs -> ${path.relative(ROOT, ICON_BASELINE)}`);
  process.exit(0);
}
let iconBase = null;
try { iconBase = JSON.parse(await readFile(ICON_BASELINE, 'utf8')).icons; } catch { /* no baseline yet */ }
if (iconBase) {
  for (const [k, sig] of Object.entries(iconsNow)) {
    const was = iconBase[k];
    if (was === undefined) findings.push(`[icons] ${k}: added — no baseline entry for this position`);
    else if (was !== sig) findings.push(`[icons] ${k}: shape — baseline "${was.slice(0, 60)}" vs now "${sig.slice(0, 60)}"`);
  }
  for (const k of Object.keys(iconBase)) {
    if (!(k in iconsNow)) findings.push(`[icons] ${k}: removed — present in baseline, absent now`);
  }
} else {
  console.log('(no icon baseline yet — run with --icons-baseline to record one)');
}

const raw = findings.length;
const unaccepted = findings.filter((f) => !isAccepted(f));
const acceptedHit = raw - unaccepted.length;

console.log(`wireframe_inventory: ${raw} structural findings (${acceptedHit} allowlisted in test/wireframe_accepted.json)\n`);
unaccepted.forEach((f) => console.log('  ' + f));
if (acceptedHit) console.log(`\n  (+${acceptedHit} allowlisted findings suppressed)`);
console.log(unaccepted.length ? '\nRESULT: FAIL' : '\nRESULT: PASS');

// Gate on REGRESSIONS, not the pre-existing backlog above — a hard block on all 38 current
// findings would brick every future library-ui.js commit until they're all cleared or
// allowlisted. `rc` is null on the first run (nothing to compare against): record the baseline,
// don't fail. Any newly-appearing unaccepted finding after that DOES fail the commit.
const records = { mismatches: unaccepted.map((raw) => ({ raw })), missing: [] };
const rc = await recheck(REPORT_PATH, records);
printRecheck(rc);
await writeReport(REPORT_PATH, records);
const regressed = rc && rc.new.length > 0;
process.exit(regressed ? 1 : 0);
