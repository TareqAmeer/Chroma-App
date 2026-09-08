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
// Grid-card badges are per-photo mock data, same reasoning as NOISE_LABELS/MONTH_RE below: a
// format badge ("R" for RAW, "HEIC", "MP4") or a video duration ("0:13") is real content that
// will never textually match between the wireframe's own hand-picked sample photos and the
// app's synthetic ?libn mock — what matters is that badges/durations render at all (still
// counted via the dynamic-data row-count check), not their exact letters/numbers.
const BADGE_RE = /^[A-Z]{1,4}$/;           // R, HEIC, RAW, MP4, PNG, ...
const DURATION_RE = /^\d{1,2}:\d{2}$/;      // 0:13, 12:04, ...
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
  return NUMERIC_RE.test(atom.text) || DYNAMIC_LABEL_RE.test(atom.text) || NOISE_LABELS.has(atom.text) ||
    MONTH_RE.test(atom.text) || BADGE_RE.test(atom.text) || DURATION_RE.test(atom.text);
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
//
// ── Coverage history ────────────────────────────────────────────────────────────────────────
// Originally 3 static zones (topbar/sidebar/statusbar). A 2026-09-08 review found 16 real
// fidelity/behaviour defects NONE of these zones — or any other tool — could see, because they
// lived in places this file never looked: the photo grid (never a zone at all), any menu's
// CONTENTS (menus aren't in the DOM until clicked, and nothing clicked them open before
// inventorying), and interaction STATES (hover/selected colors — this tool only ever compared
// the default/rest state). `grid` and the two OPEN_MENUS entries below close those three gaps.
const ZONES = [
  { label: 'topbar',  wf: '.topbar',  app: '#lib-top' },
  { label: 'sidebar', wf: '.sidebar', app: '#lib-side' },
  { label: 'statusbar', wf: '.statusbar', app: '#lib-bottom' },
  { label: 'grid', wf: '.grid', app: '#lib-grid' },
];

// Menus whose CONTENTS were previously invisible to this tool (closed until clicked). Each is
// opened via its own trigger, on both pages, immediately before inventorying — same principle
// as the existing date-tree-chevron clicks below, generalised to every closed popover.
const OPEN_MENUS = [
  { label: 'sortmenu', wfTrigger: '#btn-sort', wfContainer: '#sort-menu', appTrigger: '#lib-sort-btn', appContainer: '#lib-sort-menu' },
  { label: 'gearmenu', wfTrigger: '#btn-view-menu', wfContainer: '#view-menu', appTrigger: '#lib-view-menu-btn', appContainer: '#lib-view-menu' },
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
      // ICON CENTERING — an icon inside a round/square ICON-ONLY hit-shape (a circular toolbar
      // button, a chip) that isn't optically centered in it. Deliberately requires near-SQUARE
      // dimensions regardless of tag — a <button> is not exempt: a wide menu row (icon on the
      // left, a text label filling the rest) is an icon+text LOCKUP, not a centering question,
      // and comparing the icon to that button's full-width center produced a false "off-center
      // by 90+px" on every such row before this guard existed. Compares the icon's own bbox
      // center against its immediate CONTROL ancestor's, not the icon's direct parent, since
      // icons are often wrapped in a plain span first.
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
await settleForCapture(wf);
await settleForCapture(app);

// ── Grid card state: flag + reject one card deterministically on both sides (rather than
// relying on the wireframe's own random every-7th-card seed, which the app's mock doesn't
// mirror) — HANDOVER 2026-09-08 items #9/#12: only the SET flag should remain visible once one
// is chosen, and a rejected card's thumbnail should dim. Neither is an atom-tally question (the
// flag icons are present either way — it's their VISIBILITY and the thumbnail's FILTER that
// differ), so this is asserted directly rather than folded into the zone loop below.
try {
  // Both the wireframe's ratebar and the app's flag row are opacity:0 until the card is
  // hovered (Library View.html:175-176; library-ui.js:1290-1291) — a real Playwright hover
  // over a headless page doesn't reliably keep that CSS :hover state held through the
  // subsequent click. Since it's the RESULTING classes/CSS this check actually cares about
  // (not proving the hover+click gesture itself, which wireframe_behaviour.mjs's own
  // `.lib-flag` tests already exercise), invoke each side's own click handler directly instead
  // of simulating the pointer path.
  await wf.evaluate(() => {
    const card = document.querySelector('.grid .card[data-i="1"]');
    card.querySelector('.ratebar .reject').click();
  });
  const wCard = await wf.evaluate(() => {
    const card = document.querySelector('.grid .card[data-i="1"]');
    const bar = card.querySelector('.ratebar');
    const visibleBtns = Array.from(bar.querySelectorAll('button')).filter((b) => getComputedStyle(b).display !== 'none');
    return {
      rejectedClass: card.classList.contains('rejected'),
      phFilter: getComputedStyle(card.querySelector('.ph')).filter,
      visibleFlagCount: visibleBtns.length,
    };
  });
  await app.evaluate(() => {
    const card = document.querySelector('#lib-grid .lib-card:first-child');
    card.querySelector('.lib-flag[data-flag="Red"]').click();
  });
  await app.waitForTimeout(150);
  const aCard = await app.evaluate(() => {
    const card = document.querySelector('#lib-grid .lib-card:first-child');
    const thumb = card.querySelector('.lib-thumb-wrap, img');
    // display:none is the wireframe's actual rule (.ratebar.has-set button:not(.set){display:
    // none}) — an unset flag rendered at reduced opacity instead of removed entirely is exactly
    // the bug, so opacity must NOT be part of this filter (an earlier version used opacity>0.9
    // here, which excluded the dimmed-but-still-drawn flags from the count and silently hid
    // this exact finding).
    const visibleFlags = Array.from(card.querySelectorAll('.lib-flag')).filter((f) => getComputedStyle(f).display !== 'none');
    return {
      rejectedClass: card.classList.contains('rejected'),
      thumbFilter: thumb ? getComputedStyle(thumb).filter : '(no thumb element)',
      visibleFlagCount: visibleFlags.length,
    };
  });
  if (wCard.visibleFlagCount !== 1) findings.push(`[grid] wireframe sanity check failed: expected 1 visible flag after reject, wireframe itself shows ${wCard.visibleFlagCount} — the reference mock changed, re-check this assertion`);
  if (aCard.visibleFlagCount !== 1) {
    findings.push(`[grid] card flags: after rejecting, wireframe shows exactly 1 flag icon (others display:none via .ratebar.has-set button:not(.set)); app shows ${aCard.visibleFlagCount} fully-visible flag(s) — unset flags should be HIDDEN, not merely dimmed`);
  }
  if (wCard.rejectedClass && (aCard.thumbFilter === 'none' || aCard.thumbFilter === '')) {
    findings.push(`[grid] reject dimming: wireframe applies .card.rejected .ph{filter:brightness(.45) saturate(.7)} to the thumbnail; app's thumbnail has no filter applied at all after reject`);
  }
} catch (e) { findings.push(`[grid] card-state check errored: ${e.message}`); }

// ── Hover/selected colour states — every prior version of this tool only ever compared the
// REST state. HANDOVER 2026-09-08 item #16 and #10/#11: the folder/date/keyword tree's selected
// row used `--bdr` (a light grey overlay) instead of the blue every other selected row in the
// app and the wireframe both use. Reads the wireframe's OWN computed colours rather than a
// hardcoded hex, so this stays correct if the wireframe's palette ever changes.
async function bgOf(page, sel, { hover = false } = {}) {
  const loc = page.locator(sel).first();
  if (await loc.count() === 0) return null;
  if (hover) { await loc.hover().catch(() => {}); await page.waitForTimeout(80); }
  return loc.evaluate((el) => getComputedStyle(el).backgroundColor);
}
// Nothing carries `.on`/`.sel` in the default mock state — no row is pre-selected — so the
// selected-state pairs below would silently no-op (bgOf returns null, skipped) without this: the
// tree's date-scope row is already expanded (see the chevron clicks above), so its body is a
// real, stable click target on both pages.
await wf.click('.sidebar .row.sub', { timeout: 2000 }).catch(() => {});
await app.click('.lib-tree-row[data-date-scope]', { timeout: 2000 }).catch(() => {});
await wf.waitForTimeout(80);
await app.waitForTimeout(80);
const COLOR_STATE_PAIRS = [
  { label: 'sidebar collection row (selected)', wf: '.sidebar .row.sel', app: '.lib-coll-row.on' },
  { label: 'sidebar tree row (selected)', wf: '.sidebar .row.sel', app: '.lib-tree-row.on' },
  { label: 'sidebar row (hover)', wf: '.sidebar .row', app: '.lib-coll-row' },
];
for (const pair of COLOR_STATE_PAIRS) {
  const isHover = pair.label.includes('hover');
  const wBg = await bgOf(wf, pair.wf, { hover: isHover });
  const aBg = await bgOf(app, pair.app, { hover: isHover });
  if (wBg === null || aBg === null) continue; // element not present in this mock state — not a finding here, the zone loop above already covers presence
  // Selected rows must be BLUE-family (the wireframe's --blue-mist-soft / rgba(97,160,175,*)),
  // never a neutral grey — that distinction is exactly what shipped wrong in .lib-tree-row.on.
  if (pair.label.includes('selected')) {
    const aIsBlueish = /rgba?\(\s*(6[0-9]|7[0-9]|8[0-9]|9[0-9])\s*,\s*1[5-9][0-9]\s*,/.test(aBg) || aBg === wBg;
    if (!aIsBlueish) {
      findings.push(`[colors] ${pair.label}: wireframe background ${wBg} (blue-family selected state) vs app ${aBg} — app's selected row is not blue`);
    }
  }
}

// ── Overflow: no visible content should sit under a scrollbar gutter it doesn't know about.
// HANDOVER 2026-09-08 item #3: the sidebar's own vertical scrollbar was rendered wide enough to
// cover the trailing count numbers, because those counts are laid out against the FULL row
// width rather than the scroll container's actual content-box width (offsetWidth minus the
// scrollbar's own rendered width).
const scrollbarFindings = await app.evaluate(() => {
  const out = [];
  const side = document.getElementById('lib-side');
  if (!side) return out;
  const scrollbarW = side.offsetWidth - side.clientWidth;
  if (scrollbarW <= 0) return out; // no visible scrollbar right now (content fits) — nothing to check
  const rightEdge = side.getBoundingClientRect().right;
  for (const el of side.querySelectorAll('.lib-coll-count, .coll-count')) {
    const b = el.getBoundingClientRect();
    if (b.width === 0) continue;
    if (b.right > rightEdge - scrollbarW) {
      out.push(`count element "${el.textContent.trim()}" right edge ${Math.round(b.right)} overlaps the ${scrollbarW}px scrollbar gutter (sidebar right edge ${Math.round(rightEdge)})`);
    }
  }
  return out;
});
scrollbarFindings.forEach((f) => findings.push(`[sidebar] scrollbar overlap: ${f}`));

const iconsNow = {};

async function diffZone(zone) {
  const w = await wf.evaluate(`(${INVENTORY_FN})(${JSON.stringify(zone.wf)})`);
  const a = await app.evaluate(`(${INVENTORY_FN})(${JSON.stringify(zone.app)})`);
  if (!w) { findings.push(`[${zone.label}] wireframe container ${zone.wf} not found`); return; }
  if (!a) { findings.push(`[${zone.label}] app container ${zone.app} NOT FOUND`); return; }

  // The icon-shape baseline exists to catch a wrong NAVIGATIONAL glyph — the grid's <img> atoms
  // are photo thumbnails (blob: URLs regenerated fresh every run), not stable icons, so their
  // "shape signature" is just churn and would fail this check on every single run regardless of
  // any real change.
  if (zone.label !== 'grid') {
    for (const [k, sig] of iconSignatures(zone.label, a.atoms)) iconsNow[k] = sig;
  }

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

  // Font-FAMILY inventory, same shape as font-size above — HANDOVER 2026-09-08 item #15: the
  // wireframe/design.md commit the Library to the same SF Pro Display/Text pairing as every
  // other DS surface (library-ui.js's own DS_FONTS block declares this), so a row rendering in
  // whatever the browser's default UI font happens to be is a real, silent drift no prior check
  // could see (only font-SIZE was ever tallied).
  const ffOf = (atoms) => tally(atoms.filter((x) => x.text).map((x) => x.ff));
  const wFf = ffOf(wClean), aFf = ffOf(aClean);
  const allFf = new Set([...wFf.keys(), ...aFf.keys()]);
  for (const fam of allFf) {
    const wn = wFf.get(fam) || 0, an = aFf.get(fam) || 0;
    if (wn !== an) findings.push(`[${zone.label}] font-family "${fam}": wireframe uses it on ${wn} text atom(s), app on ${an}`);
  }

  // Icon centering — HANDOVER 2026-09-08 item #6 (topbar icons not centered in their shapes).
  const ICON_CENTER_TOLERANCE = 1.5; // px — sub-pixel rounding noise, not a real miscentering
  for (const icon of aClean.filter((x) => x.kind === 'icon' && x.centerOffset != null)) {
    if (icon.centerOffset > ICON_CENTER_TOLERANCE) {
      findings.push(`[${zone.label}] icon off-center by ${icon.centerOffset}px within its hit-shape (icon#${aClean.indexOf(icon)})`);
    }
  }

  // Geometry of the first few atoms — catches "search jammed against the logo" (an x-offset
  // difference), which no per-element computed-style check can express.
  for (let i = 0; i < Math.min(6, wSig.length, aSig.length); i++) {
    if (wSig[i] !== aSig[i]) { findings.push(`[${zone.label}] order@${i}: wireframe ${wSig[i]} vs app ${aSig[i]}`); break; }
    const dx = Math.abs(wClean[i].x - aClean[i].x);
    if (dx > 12) findings.push(`[${zone.label}] x-offset of ${wSig[i]}: wireframe ${wClean[i].x}px vs app ${aClean[i].x}px (Δ${dx})`);
  }
}

for (const zone of ZONES) await diffZone(zone);

// Menus are diffed ONE AT A TIME, opening each fresh right before its own inventory: several of
// the app's own trigger handlers close a SIBLING menu when opening theirs (sortBtn.onclick
// removes viewMenu's .open and vice versa, matching the wireframe's own single-menu-open
// convention) — batching every open() before any inventory() silently closed the first menu
// before it was ever read, which is exactly the kind of bug this whole file exists to catch.
for (const m of OPEN_MENUS) {
  try { await wf.click(m.wfTrigger, { timeout: 2000 }); } catch { findings.push(`[${m.label}] wireframe trigger ${m.wfTrigger} not clickable`); continue; }
  try { await app.click(m.appTrigger, { timeout: 2000 }); } catch { findings.push(`[${m.label}] app trigger ${m.appTrigger} not clickable`); continue; }
  await wf.waitForTimeout(120);
  await app.waitForTimeout(120);
  await diffZone({ label: m.label, wf: m.wfContainer, app: m.appContainer });
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
