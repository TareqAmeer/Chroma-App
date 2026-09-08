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
// ⚠️ Matching is ZONE-QUALIFIED. A bare substring test (what this used to be) let an entry
// reasoned about ONE zone silence the identical string everywhere: `order@3`, accepted as a
// walker artifact in the sidebar, was also suppressing it in the topbar, grid, sortmenu and
// gearmenu. Every finding is emitted as `[zone] ...`; an entry may name the zone it applies to
// either inside `match` (e.g. "[sidebar] atom count") or in an explicit `zone` field. An entry
// that does neither is rejected at load time rather than silently going global.
const ZONE_RE = /^\[([a-z]+)\]/;
for (const a of ACCEPTED) {
  const inMatch = ZONE_RE.exec(a.match);
  if (!a.zone && !inMatch) {
    console.log(`[allowlist] REJECTED unscoped entry ${JSON.stringify(a.match)} — add a "zone" field`);
  }
  a._zone = a.zone || (inMatch ? inMatch[1] : null);
}
function isAccepted(finding) {
  const fz = ZONE_RE.exec(finding);
  return ACCEPTED.some((a) => a._zone && finding.includes(a.match) && fz && fz[1] === a._zone);
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
  // Added once the keyword/folder trees started being expanded (tree-indentation/Folders-vs-tree
  // checks): 'Portrait'/'Iceland' are the ?libcat=1 mock's own sample keyword leaves
  // (library-ui.js:313-318), 'sub' is the mock list_dir's single synthetic subfolder name.
  'Portrait', 'Iceland', 'sub',
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
// Expand the folder tree's root (one level of children) and the Keyword tree down to its own
// nested node ("Travel" > "Iceland", seeded by the ?libcat=1 mock at library-ui.js:313-318) —
// needed for the tree-indentation-consistency check below, which needs at least depth 0/1/2 to
// find anything to compare. Neither tree is expanded by default.
await app.evaluate(() => {
  const folderChev = document.querySelector('#lib-tree [data-chev-toggle]');
  if (folderChev) folderChev.click();
});
await app.waitForTimeout(150);
// A raw document.querySelector (as used above for the folder tree, which is always present
// synchronously) races catalog_keywords — the Keywords tree renders empty until that async
// invoke() resolves, so an immediate querySelector silently finds nothing and the click is
// skipped. Playwright's own `.click()` auto-waits/retries for the element to exist, which the
// folder tree doesn't need but this genuinely does.
await app.click('[data-kw-tree-toggle]', { timeout: 3000 }).catch(() => {});
await app.click('.lib-tree-row[data-kw-scope] [data-chev-toggle]', { timeout: 3000 }).catch(() => {});
await app.waitForTimeout(150);
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
    const thumbWrap = card.querySelector('.lib-thumb-wrap');
    // display:none is the wireframe's actual rule (.ratebar.has-set button:not(.set){display:
    // none}) — an unset flag rendered at reduced opacity instead of removed entirely is exactly
    // the bug, so opacity must NOT be part of this filter (an earlier version used opacity>0.9
    // here, which excluded the dimmed-but-still-drawn flags from the count and silently hid
    // this exact finding).
    const visibleFlags = Array.from(card.querySelectorAll('.lib-flag')).filter((f) => getComputedStyle(f).display !== 'none');
    // Dimming: the app deliberately uses a black overlay at reduced opacity, NOT a CSS filter —
    // UI_SPEC.md's own explicit call (library-ui.js:1175-1177, "not a CSS filter/hue change"),
    // via .lbl-red .lib-thumb-wrap::after{background:var(--surface-black);opacity:.55}. Checked
    // for the MECHANISM the app actually committed to, not literally the wireframe's filter —
    // same "intentional superset/different approach" reasoning as the sort/gear menus (§8
    // items #10/#11), not force-fit to match the wireframe pixel-for-pixel.
    const after = thumbWrap ? getComputedStyle(thumbWrap, '::after') : null;
    const dimmed = !!(thumbWrap && card.classList.contains('lbl-red') && after && parseFloat(after.opacity) > 0);
    return {
      rejectedClass: card.classList.contains('rejected'),
      dimmed,
      visibleFlagCount: visibleFlags.length,
    };
  });
  if (wCard.visibleFlagCount !== 1) findings.push(`[grid] wireframe sanity check failed: expected 1 visible flag after reject, wireframe itself shows ${wCard.visibleFlagCount} — the reference mock changed, re-check this assertion`);
  if (aCard.visibleFlagCount !== 1) {
    findings.push(`[grid] card flags: after rejecting, wireframe shows exactly 1 flag icon (others display:none via .ratebar.has-set button:not(.set)); app shows ${aCard.visibleFlagCount} fully-visible flag(s) — unset flags should be HIDDEN, not merely dimmed`);
  }
  if (wCard.rejectedClass && !aCard.dimmed) {
    findings.push('[grid] reject dimming: wireframe dims a rejected thumbnail; app\'s card has no .lbl-red class or its ::after overlay isn\'t visible after reject — see the app\'s own deliberate overlay mechanism at library-ui.js:1179-1183 (UI_SPEC.md), not the wireframe\'s filter approach');
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
// ⚠️ Every state below asserts something for EVERY pair. The previous version fetched the
// hover pair's two colours and then discarded them — the only assertion body was gated on
// `label.includes('selected')`, so the hover check could never fail and reported as covered.
// A hover state is not "different by any amount": #6 in the 2026-09-08 report was a hover that
// DID change (rgba(0,0,0,0) -> rgb(42,42,44)) but only by 3/255 per channel against a
// rgb(39,39,41) ground, because --sur and --sur2 are both aliased to --surface-tile-2 while the
// row sits on --surface-tile-1. So the assertion is a MEASURED perceptual delta, benchmarked
// against the wireframe's own (rgba(255,255,255,.08), ~17/255) — not mere inequality.
function parseRgb(c) {
  const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null;
  const p = m[1].split(',').map((x) => parseFloat(x));
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
// Flatten a possibly-transparent colour onto a known ground so two states are comparable.
function over(fg, ground) {
  if (!fg) return ground;
  const a = fg.a;
  return { r: fg.r * a + ground.r * (1 - a), g: fg.g * a + ground.g * (1 - a), b: fg.b * a + ground.b * (1 - a), a: 1 };
}
function chanDelta(a, b) {
  if (!a || !b) return null;
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}
async function stateOf(page, sel, { hover = false } = {}) {
  const loc = page.locator(sel).first();
  if (await loc.count() === 0) return null;
  if (hover) { await loc.hover().catch(() => {}); await page.waitForTimeout(120); }
  const v = await loc.evaluate((el) => {
    const cs = getComputedStyle(el);
    // The row's own ground: nearest ancestor with a non-transparent background.
    let g = el.parentElement, gbg = 'rgb(0, 0, 0)';
    while (g) { const b = getComputedStyle(g).backgroundColor;
      if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) { gbg = b; break; } g = g.parentElement; }
    return { bg: cs.backgroundColor, ground: gbg, color: cs.color, weight: cs.fontWeight, shadow: cs.boxShadow };
  });
  if (hover) { await page.mouse.move(2, 2); await page.waitForTimeout(60); }
  return v;
}

// Nothing carries `.on`/`.sel` in the default mock state — no row is pre-selected — so the
// selected-state pairs below would silently no-op without this: the tree's date-scope row is
// already expanded (see the chevron clicks above), so its body is a real click target on both.
// ⚠️ Clicking the tree row also CLEARS `.on` from the collection row, so the collection-row
// pair is captured BEFORE that click, not after — the previous version clicked first and then
// hit `bgOf() === null` on `.lib-coll-row.on`, silently skipping the pair entirely.
await wf.click('#row-allphotos', { timeout: 2000 }).catch(() => {});
await app.click('.lib-coll-row', { timeout: 2000 }).catch(() => {});
await wf.waitForTimeout(80); await app.waitForTimeout(80);
const collSelWf = await stateOf(wf, '.sidebar .row.sel');
const collSelApp = await stateOf(app, '.lib-coll-row.on');
await wf.click('.sidebar .row.sub', { timeout: 2000 }).catch(() => {});
await app.click('.lib-tree-row[data-date-scope]', { timeout: 2000 }).catch(() => {});
await wf.waitForTimeout(80); await app.waitForTimeout(80);
const treeSelWf = await stateOf(wf, '.sidebar .row.sel');
const treeSelApp = await stateOf(app, '.lib-tree-row.on');

const SELECTED_PAIRS = [
  { label: 'sidebar collection row (selected)', wf: collSelWf, app: collSelApp, appSel: '.lib-coll-row.on' },
  { label: 'sidebar tree row (selected)', wf: treeSelWf, app: treeSelApp, appSel: '.lib-tree-row.on' },
];
for (const pair of SELECTED_PAIRS) {
  if (!pair.wf || !pair.app) {
    // A missing selected state is itself the finding — never a silent skip.
    findings.push(`[colors] ${pair.label}: could not capture a selected row (${pair.wf ? 'app' : 'wireframe'} side had none) — the selected state may not be reachable`);
    continue;
  }
  const aBg = pair.app.bg, wBg = pair.wf.bg;
  const aIsBlueish = /rgba?\(\s*(6[0-9]|7[0-9]|8[0-9]|9[0-9])\s*,\s*1[5-9][0-9]\s*,/.test(aBg) || aBg === wBg;
  if (!aIsBlueish) findings.push(`[colors] ${pair.label}: wireframe background ${wBg} (blue-family selected state) vs app ${aBg} — app's selected row is not blue`);
  // The wireframe's selected row is not just a background — it also carries an inset left
  // marker and a distinct ink colour. Neither was ever compared.
  const wHasMarker = /inset/.test(pair.wf.shadow || '');
  const aHasMarker = /inset/.test(pair.app.shadow || '');
  if (wHasMarker && !aHasMarker) findings.push(`[colors] ${pair.label}: wireframe draws an inset selection marker (box-shadow ${pair.wf.shadow}) — app has none`);
  const wInkShift = pair.wf.color !== (collSelWf && collSelWf.color) ? null : null; // placeholder, ink compared below
  if (pair.app.color === pair.app.ground) findings.push(`[colors] ${pair.label}: selected-row text colour equals its own background`);
}

// ── Hover, asserted as a MEASURED delta on every interactive row family ──────
const HOVER_TARGETS = [
  { label: 'sidebar collection row', wf: '.sidebar .row:not(.sel)', app: '.lib-coll-row:not(.on)' },
  { label: 'sidebar tree row', wf: '.sidebar .row.sub:not(.sel)', app: '.lib-tree-row:not(.on)' },
  { label: 'sidebar section header', wf: '.sidebar .sec-h', app: '#lib-side .lib-sec-h' },
  { label: 'topbar pill button', wf: '.topbar .pillbtn', app: '#lib-top .lib-pill' },
  { label: 'topbar icon button', wf: '.topbar .iconbtn', app: '#lib-top .lib-btn-icon' },
];
// Anything below this is a hover a user cannot see. Derived from the two real cases: the app's
// broken 3/255 lift, and the wireframe's own rgba(255,255,255,.08) which lands at ~17/255.
const HOVER_MIN_DELTA = 8;
for (const t of HOVER_TARGETS) {
  const aRest = await stateOf(app, t.app);
  const aHov = await stateOf(app, t.app, { hover: true });
  const wRest = await stateOf(wf, t.wf);
  const wHov = await stateOf(wf, t.wf, { hover: true });
  if (!aRest || !aHov) { findings.push(`[colors] ${t.label} (hover): app selector ${t.app} matched nothing — hover state unverifiable`); continue; }
  const ground = parseRgb(aRest.ground);
  const dApp = chanDelta(over(parseRgb(aRest.bg), ground), over(parseRgb(aHov.bg), ground));
  const wGround = wRest ? parseRgb(wRest.ground) : null;
  const dWf = wRest && wHov ? chanDelta(over(parseRgb(wRest.bg), wGround), over(parseRgb(wHov.bg), wGround)) : null;
  const ref = dWf == null ? '(wireframe reference unavailable)' : `wireframe lifts by ${dWf.toFixed(1)}/255`;
  if (dApp == null) { findings.push(`[colors] ${t.label} (hover): could not measure app hover colour`); continue; }
  if (dApp < HOVER_MIN_DELTA) {
    findings.push(`[colors] ${t.label} (hover): app background lifts by only ${dApp.toFixed(1)}/255 on hover `
      + `(${aRest.bg} -> ${aHov.bg} over ${aRest.ground}) — below the ${HOVER_MIN_DELTA}/255 visibility floor; ${ref}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SELF-CONSISTENCY CHECKS — these compare the app against ITSELF, not against
// the wireframe.
//
// Why they exist: every check above needs a wireframe counterpart to compare to, so anything
// the wireframe's static mock never modelled (Keywords section, Raw/Videos rows, the gear
// menu's checkbox rows, real-aspect-ratio) is structurally invisible to it — which is exactly
// where the 2026-09-08 reported defects live. A UI can be internally inconsistent without the
// wireframe having an opinion, and that inconsistency is itself the bug: one section built
// differently from its five siblings, one row family missing the count all its siblings carry,
// two "this is on" idioms in one menu, one menu row carrying an icon none of its siblings has.
// These are written as "N of M siblings do X, the rest don't" so they fire on any FUTURE
// divergence too, not just the ones already reported.

const selfFindings = await app.evaluate(() => {
  const out = [];
  const cs = (el) => getComputedStyle(el);
  const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

  // ── 1. Sidebar section chrome: every collapsible section must be built the same way.
  // Catches a section that renders its own ad-hoc header instead of going through the shared
  // section builder (no shared collapse chrome, no persisted open state, no shared heading style).
  const heads = [...document.querySelectorAll('#lib-side .lib-sec-h, #lib-side [data-kw-tree-toggle], #lib-side [data-date-tree-toggle]')];
  const shaped = heads.map((h) => ({
    label: txt(h).slice(0, 24),
    isSecH: h.classList.contains('lib-sec-h'),
    hasSecToggle: h.hasAttribute('data-sec-toggle'),
    role: h.getAttribute('role'), aria: h.hasAttribute('aria-expanded'),
    fs: cs(h).fontSize, tt: cs(h).textTransform, pad: cs(h).padding,
  }));
  const secHCount = shaped.filter((h) => h.isSecH).length;
  for (const h of shaped) {
    if (!h.isSecH && secHCount >= 2)
      out.push(`[selfconsist] sidebar section "${h.label}" is not built with the shared section header (.lib-sec-h) that ${secHCount} sibling sections use — it has its own collapse chrome, heading style and open-state handling`);
    else if (h.isSecH && !h.hasSecToggle && secHCount >= 2)
      out.push(`[selfconsist] sidebar section "${h.label}" uses .lib-sec-h but has no data-sec-toggle — its open/closed state is not persisted like its siblings'`);
    else if (h.isSecH && (!h.role || !h.aria))
      out.push(`[selfconsist] sidebar section "${h.label}" is missing role/aria-expanded that its sibling section headers carry`);
  }
  // Heading typography must be uniform across sections.
  const fsTally = {};
  shaped.forEach((h) => { fsTally[h.fs] = (fsTally[h.fs] || 0) + 1; });
  const fsKeys = Object.keys(fsTally);
  if (fsKeys.length > 1) {
    const majority = fsKeys.sort((a, b) => fsTally[b] - fsTally[a])[0];
    for (const k of fsKeys) if (k !== majority)
      out.push(`[selfconsist] sidebar section headings disagree on font-size: ${fsTally[majority]} use ${majority}, ${fsTally[k]} use ${k} (${shaped.filter((h) => h.fs === k).map((h) => `"${h.label}"`).join(', ')})`);
  }

  // ── 2. Count badges: a row family where most siblings carry a count, but some don't — or
  // carry an EMPTY one. An empty <span class="lib-coll-count"></span> reserves layout and reads
  // as "zero photos" while meaning "nobody wired a number to this row".
  // Only rows that SCOPE the grid to a set of photos belong to this family. Action rows
  // ("Free up space…", "Verify library…") and the storage-summary line share the .lib-coll-row
  // class for layout but scope nothing, so a missing count on them is correct, not a defect.
  const collRows = [...document.querySelectorAll('#lib-collections .lib-coll-row')]
    .filter((r) => r.hasAttribute('data-coll') || r.hasAttribute('data-type-shortcut')
      || r.hasAttribute('data-catalog-scope') || r.hasAttribute('data-faces-filter')
      || r.id === 'lib-row-allphotos' || r.querySelector('.lib-coll-count'));
  const withCount = collRows.filter((r) => r.querySelector('.lib-coll-count'));
  const nonEmpty = withCount.filter((r) => txt(r.querySelector('.lib-coll-count')).length > 0);
  if (collRows.length >= 4 && nonEmpty.length >= collRows.length / 2) {
    for (const r of collRows) {
      const c = r.querySelector('.lib-coll-count');
      const label = txt(r).split('\n')[0].slice(0, 24);
      if (!c) out.push(`[selfconsist] sidebar row "${label}" renders no count element, while ${nonEmpty.length} of ${collRows.length} sibling rows show a count`);
      else if (!txt(c)) out.push(`[selfconsist] sidebar row "${label}" renders an EMPTY count element — it reserves the layout slot but shows no number`);
    }
  }

  // ── 3. Menu "is-on" idiom: one menu must express selection one way. Mixing a native
  // <input type=checkbox> with a custom checkmark glyph in the same menu is two visual
  // languages for the same state.
  for (const menu of document.querySelectorAll('.lib-menu')) {
    // ⚠️ `.opt` alone misses the menu's toggle-style rows, which carry `opt-action opt-toggle`
    // and no `.opt` — including the two rows whose idiom actually diverges.
    const opts = [...menu.querySelectorAll('.opt, .opt-toggle')];
    if (opts.length < 3) continue;
    const idiom = (o) => o.querySelector('input[type=checkbox]') ? 'native-checkbox'
      : (o.querySelector('svg') ? 'checkmark-glyph' : 'none');
    const tally = {};
    opts.forEach((o) => { const i = idiom(o); (tally[i] = tally[i] || []).push(txt(o).slice(0, 26)); });
    const kinds = Object.keys(tally);
    if (kinds.length > 1) {
      const major = kinds.sort((a, b) => tally[b].length - tally[a].length)[0];
      for (const k of kinds) if (k !== major)
        out.push(`[selfconsist] #${menu.id}: ${tally[major].length} option rows show their on-state as "${major}" but ${tally[k].length} use "${k}" (${tally[k].map((t) => `"${t}"`).join(', ')}) — two idioms for the same state in one menu`);
    }
    // ── 4. A menu row carrying a leading icon none of its siblings has.
    const leading = opts.map((o) => {
      const svgs = [...o.querySelectorAll('svg')];
      // The trailing checkmark glyph is the last svg; anything before it is a leading icon.
      return { t: txt(o).slice(0, 26), lead: Math.max(0, svgs.length - (idiom(o) === 'checkmark-glyph' ? 1 : 0)) };
    });
    const withLead = leading.filter((l) => l.lead > 0);
    if (withLead.length && withLead.length <= leading.length / 3)
      out.push(`[selfconsist] #${menu.id}: ${withLead.map((l) => `"${l.t}"`).join(', ')} carry a leading icon that ${leading.length - withLead.length} of ${leading.length} sibling option rows do not`);
  }

  // ── 5. Icon-only buttons: centering, WITH the CSS that causes it. The pre-existing
  // icon-centering check reports an offset and nothing else, which is not actionable; the
  // real cause in this app is a `display:block` + asymmetric padding on a fixed-size box,
  // which no amount of re-measuring the offset would have revealed.
  for (const btn of document.querySelectorAll('#lib-top button, #lib-side button, .lib-menu button')) {
    const svg = btn.querySelector('svg');
    if (!svg || txt(btn)) continue;                      // icon-only buttons only
    const bb = btn.getBoundingClientRect(), sb = svg.getBoundingClientRect();
    if (!bb.width || !sb.width) continue;
    const dx = (sb.x + sb.width / 2) - (bb.x + bb.width / 2);
    const dy = (sb.y + sb.height / 2) - (bb.y + bb.height / 2);
    if (Math.abs(dx) <= 0.75 && Math.abs(dy) <= 0.75) continue;
    const c = cs(btn);
    const why = [];
    if (!/flex|grid/.test(c.display)) why.push(`display:${c.display} (the shared .lib-btn flex centering is being overridden)`);
    if (/flex|grid/.test(c.display) && c.alignItems !== 'center') why.push(`align-items:${c.alignItems}`);
    if (/flex|grid/.test(c.display) && c.justifyContent !== 'center') why.push(`justify-content:${c.justifyContent}`);
    const [pt, pr, pb, pl] = [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft];
    if (pt !== pb || pr !== pl) why.push(`asymmetric padding ${pt} ${pr} ${pb} ${pl} inside a fixed ${Math.round(bb.width)}x${Math.round(bb.height)} box`);
    const name = btn.id ? '#' + btn.id : (btn.getAttribute('title') || btn.getAttribute('aria-label')
      || `${btn.closest('[id]') ? '#' + btn.closest('[id]').id + ' ' : ''}.${(btn.className || 'button').trim().split(/\s+/).join('.')}`);
    out.push(`[selfconsist] icon-only button ${name} draws its icon ${dx.toFixed(1)}px right / ${dy.toFixed(1)}px down of centre — ${why.length ? why.join('; ') : 'cause not in display/align/padding, inspect the svg box'}`);
  }

  // ── 6. Icon SIZE consistency per role. A 14px icon rendering at 20px next to its siblings
  // is invisible to an atom tally and to a centering check.
  const roles = [['#lib-top', 'topbar'], ['#lib-side', 'sidebar'], ['.lib-menu', 'menu']];
  for (const [sel, name] of roles) {
    const svgs = [...document.querySelectorAll(`${sel} svg`)].filter((v) => v.getBoundingClientRect().width > 0);
    const tally = {};
    svgs.forEach((v) => { const b = v.getBoundingClientRect(); const k = `${Math.round(b.width)}x${Math.round(b.height)}`; tally[k] = (tally[k] || 0) + 1; });
    const keys = Object.keys(tally).sort((a, b) => tally[b] - tally[a]);
    // Report only true outliers: a size used by a single element while a clear majority shares another.
    if (keys.length > 2 && tally[keys[0]] >= 4) {
      for (const k of keys.slice(1)) if (tally[k] === 1)
        out.push(`[selfconsist] ${name}: one icon renders at ${k} while ${tally[keys[0]]} siblings render at ${keys[0]} — a one-off icon size`);
    }
  }

  // ── 7. Text truncation, measured by LINE COUNT, not scrollWidth. The previous attempt
  // (library_responsive_qa NO_ELLIPSIS) keyed on `scrollWidth > clientWidth`, which can only
  // ever be true for an element that ALREADY has the overflow:hidden + nowrap it was checking
  // for the absence of — so a label that simply wraps was invisible to it.
  for (const el of document.querySelectorAll('#lib-side .lib-coll-lb, #lib-side .lib-tree-lb')) {
    const c = cs(el);
    if (c.whiteSpace.startsWith('nowrap') || c.whiteSpace === 'pre') continue;
    if (c.textOverflow === 'ellipsis' && c.overflow !== 'visible') continue;
    out.push(`[selfconsist] sidebar label "${txt(el).slice(0, 20)}" (${el.className}) can WRAP: white-space:${c.whiteSpace}, overflow:${c.overflow}, text-overflow:${c.textOverflow} — a long folder/collection/keyword name will grow the row instead of truncating`);
    break;                                              // one representative finding per class, not one per row
  }

  return out;
});
findings.push(...selfFindings);

// ── 8. Truncation, actually exercised: rename a real sidebar row to a 60-character label and
// measure whether the row grows. A CSS read alone can be argued with; a measured row-height
// change cannot. Restores the original text afterwards so no later check sees the mutation.
const wrapProof = await app.evaluate(() => {
  const el = document.querySelector('#lib-side .lib-coll-lb');
  if (!el) return null;
  const row = el.closest('.lib-coll-row') || el.parentElement;
  const before = row.getBoundingClientRect().height;
  const orig = el.textContent;
  el.textContent = 'A deliberately long folder name for truncation testing purposes';
  const after = row.getBoundingClientRect().height;
  el.textContent = orig;
  return { before, after, label: 'sidebar collection row' };
});
if (wrapProof && wrapProof.after > wrapProof.before + 2) {
  findings.push(`[selfconsist] ${wrapProof.label} GROWS from ${Math.round(wrapProof.before)}px to ${Math.round(wrapProof.after)}px tall when given a 60-character label — measured, not inferred: long names wrap instead of truncating`);
}

// ── Overflow: no visible content should sit under a scrollbar an overlay scrollbar can paint
// over. HANDOVER 2026-09-08 item #3: the sidebar's own vertical scrollbar covers the trailing
// count numbers.
//
// ⚠️ #lib-side has no `::-webkit-scrollbar`/`scrollbar-width`/`scrollbar-gutter` rule anywhere
// in library-ui.js — confirmed by grep — so it renders the platform's DEFAULT scrollbar, which
// on macOS (the real app, via WKWebView) is an OVERLAY style: it reserves ~0 box-model width at
// rest and PAINTS OVER content when the thumb expands on hover/scroll, rather than shrinking the
// content box the way a classic scrollbar does. A box-model check (offsetWidth - clientWidth,
// which is how a classic scrollbar would show up) measured ~1px here in Playwright's Chromium —
// confirming this really is overlay-style rendering, not a reserved gutter — so it can NEVER
// detect this bug: there is no "gutter" to measure, only paint that happens on top. The correct
// check is structural instead: does the trailing count element keep a fixed safety margin from
// the row's own right edge, sized to a typical overlay scrollbar's hover-expanded width
// (~14-16px on macOS), regardless of whether a scrollbar happens to be actively rendering RIGHT
// NOW in this particular headless run.
const OVERLAY_SCROLLBAR_SAFETY_MARGIN = 14; // px
const scrollbarFindings = await app.evaluate((margin) => {
  const out = [];
  const side = document.getElementById('lib-side');
  if (!side) return out;
  const sideRight = side.getBoundingClientRect().right;
  for (const el of side.querySelectorAll('.lib-coll-count, .coll-count')) {
    const b = el.getBoundingClientRect();
    if (b.width === 0) continue;
    const insetFromEdge = sideRight - b.right;
    if (insetFromEdge < margin) {
      out.push(`count element "${el.textContent.trim()}" sits only ${Math.round(insetFromEdge)}px from the sidebar's right edge (want >= ${margin}px to clear an overlay scrollbar's hover-expanded width)`);
    }
  }
  return out;
}, OVERLAY_SCROLLBAR_SAFETY_MARGIN);
scrollbarFindings.forEach((f) => findings.push(`[sidebar] scrollbar safety margin: ${f}`));

// ── "Folders" section vs. its own tree — HANDOVER 2026-09-08 item #5, confirmed by a user
// screenshot: the folder tree (root row labelled "Photos" in this mock) renders visually AFTER
// the Cloud section, disconnected from the "Folders" header above it, instead of appearing
// directly under it. Root cause: `#lib-tree` (renderTree()'s target) is a DOM SIBLING of
// `#lib-collections` in the static template (`<div id="lib-collections"></div><div id="lib-
// tree"></div>`), and #lib-collections's own innerHTML places the "Folders" header just before
// Cloud — so #lib-tree, always rendered last regardless of where "Folders" sits in that
// sequence, ends up after EVERYTHING, including Cloud. Checked two ways: position (the tree
// must appear before Cloud's own rows, not after) and indentation (the tree's root row should
// sit further right than the "Folders" header's own chevron, to read as its child rather than a
// second unrelated top-level row).
{
  const folderTreeFindings = await app.evaluate(() => {
    const out = [];
    const tree = document.getElementById('lib-tree');
    const foldersHeader = document.querySelector('[data-sec-toggle="folders"]');
    // ⚠️ These used to be silent early-returns, which is how the defect below shipped: with
    // #lib-tree absent the whole check no-opped and reported clean. An absent container is not
    // "nothing to check" — it means the Folders section renders no body at all.
    if (!foldersHeader) { out.push('the sidebar has no "Folders" section header at all'); return out; }
    if (!tree) { out.push('#lib-tree does not exist in the DOM — the "Folders" section renders an empty body and no folder tree is reachable'); return out; }
    if (tree.parentElement && tree.parentElement.id === 'lib-collections') {
      // renderCollections() rewrites #lib-collections.innerHTML on EVERY render. A #lib-tree
      // living inside it survives exactly one render and is destroyed by the next.
      out.push('#lib-tree has been moved INSIDE #lib-collections, whose innerHTML renderCollections() rewrites on every render — the folder tree is destroyed on the next sidebar re-render');
    }
    const treeRow = tree.querySelector('.lib-tree-row');
    if (!treeRow) { out.push('#lib-tree exists but contains no tree row — the folder tree rendered nothing'); return out; }
    if (treeRow.getBoundingClientRect().width === 0) { out.push('#lib-tree\'s root row has zero width — the folder tree is present but not visible'); return out; }
    const cloudHeader = document.querySelector('[data-sec-toggle="cloud"]');
    if (cloudHeader) {
      const treeTop = treeRow.getBoundingClientRect().top;
      const cloudTop = cloudHeader.getBoundingClientRect().top;
      if (treeTop > cloudTop) {
        out.push(`the folder tree's root row (y=${Math.round(treeTop)}) sits BELOW the Cloud section header (y=${Math.round(cloudTop)}) — it should appear directly under "Folders", not after every later section`);
      }
    }
    const foldersChev = foldersHeader.querySelector('.lib-tree-chev');
    const treeChev = treeRow.querySelector('.lib-tree-chev');
    if (foldersChev && treeChev) {
      const fx = foldersChev.getBoundingClientRect().left, tx = treeChev.getBoundingClientRect().left;
      if (tx <= fx + 2) {
        out.push(`the folder tree's root chevron (x=${Math.round(tx)}) is not indented further right than the "Folders" section header's own chevron (x=${Math.round(fx)}) — reads as a second top-level row, not a child of Folders`);
      }
    }
    return out;
  });
  folderTreeFindings.forEach((f) => findings.push(`[sidebar] Folders/tree relationship: ${f}`));
}

// ── Sidebar render IDEMPOTENCE. Nothing anywhere checked that rendering the sidebar twice
// leaves the same DOM. It does not: a node the render function RELOCATES into the container it
// then rewrites survives one render and is gone after the second, silently and permanently.
// The check is generic — it re-renders and diffs the set of surviving element ids — so it
// catches any future node that gets destroyed by a re-render, not only #lib-tree.
{
  const idem = await app.evaluate(async () => {
    const ids = () => [...document.querySelectorAll('#lib-side [id]')].map((e) => e.id).sort();
    const header = document.querySelector('[data-sec-toggle="collections"]');
    if (!header) return null;
    const a = ids();
    header.click(); await new Promise((r) => setTimeout(r, 250));   // collapse -> re-render
    header.click(); await new Promise((r) => setTimeout(r, 250));   // expand   -> re-render
    const b = ids();
    return { lost: a.filter((i) => !b.includes(i)), gained: b.filter((i) => !a.includes(i)) };
  });
  if (idem && idem.lost.length) {
    findings.push(`[sidebar] re-rendering the sidebar DESTROYS element(s) that were there before: ${idem.lost.map((i) => '#' + i).join(', ')} — they do not come back`);
  }
}

// ── Topbar flag-row borders — HANDOVER 2026-09-08 item #7: the wireframe's .flagbtn has NO
// border property at all (only border-radius + a hover background); the app's flag buttons
// inherit `.lib-btn{border:1px solid var(--bdr)}` from the shared base button class, which
// nothing in `.lib-flagrow .lib-btn-icon` overrides back to none.
{
  const flagBorderW = await app.evaluate(() => {
    const btn = document.querySelector('.lib-flagrow .lib-btn-icon, #lib-flagrow .lib-btn-icon');
    return btn ? parseFloat(getComputedStyle(btn).borderWidth) : null;
  });
  if (flagBorderW != null && flagBorderW > 0) {
    findings.push(`[topbar] flag row buttons: wireframe's .flagbtn has no border (hover background only); app's flag buttons render a ${flagBorderW}px border (inherited from the shared .lib-btn base rule)`);
  }
}

// ── Tree indentation consistency — HANDOVER 2026-09-08 items #4/#5: the wireframe indents by a
// clean staircase per nesting depth (.row.datehead: 0, .row.monthhead: 28px, .row.sub: 66px —
// Library View.html:151-153) via padding-left. Checked structurally, not against a literal px
// value the app is free to differ on (its own row chrome — icons, chevron sizing — differs from
// the wireframe's), but for INTERNAL consistency: every one of the app's own trees (folder,
// date, keyword) should indent a deeper row further right than its own parent, and a keyword or
// folder row's own indent/chevron position should track the SAME depth-to-indent relationship
// the date tree already uses correctly (the date tree is the one tree with an existing,
// deliberately-built correct implementation — see HANDOVER's chevron-split fix).
{
  const indentFindings = await app.evaluate(() => {
    const out = [];
    // For each tree, collect [depth, chevronLeft] pairs by walking .lib-tree-children nesting.
    // Markup-shape-agnostic on purpose: the folder tree wraps each row in a .lib-tree-node
    // (buildTreeNode), the keyword tree does not (keywordsSectionHtml emits bare .lib-tree-row +
    // .lib-tree-children siblings) — depth is computed from how many .lib-tree-children
    // ancestors a row has, not from assuming either specific wrapper shape.
    function depthsFor(rootSel) {
      const root = document.querySelector(rootSel);
      if (!root) return null;
      const pairs = [];
      for (const row of root.querySelectorAll('.lib-tree-row')) {
        const chev = row.querySelector('.lib-tree-chev');
        if (!chev || row.getBoundingClientRect().width === 0) continue;
        let depth = 0, el = row.parentElement;
        while (el && el !== root) { if (el.classList.contains('lib-tree-children')) depth++; el = el.parentElement; }
        pairs.push({ depth, x: Math.round(chev.getBoundingClientRect().left) });
      }
      return pairs;
    }
    const trees = { folder: depthsFor('#lib-tree'), keyword: depthsFor('#lib-keyword-tree') };
    for (const [name, pairs] of Object.entries(trees)) {
      if (!pairs || pairs.length < 2) continue;
      // Group by depth, take the median x per depth, and assert each depth is strictly further
      // right than the previous — the actual "is this a staircase" question, independent of the
      // exact px step size.
      const byDepth = new Map();
      for (const p of pairs) { if (!byDepth.has(p.depth)) byDepth.set(p.depth, []); byDepth.get(p.depth).push(p.x); }
      const depths = [...byDepth.keys()].sort((a, b) => a - b);
      for (let i = 1; i < depths.length; i++) {
        const prevXs = byDepth.get(depths[i - 1]), curXs = byDepth.get(depths[i]);
        const prevMed = prevXs.sort((a, b) => a - b)[Math.floor(prevXs.length / 2)];
        const curMed = curXs.sort((a, b) => a - b)[Math.floor(curXs.length / 2)];
        if (curMed <= prevMed) {
          out.push(`${name} tree: depth ${depths[i]} chevron (x=${curMed}) is not further right than depth ${depths[i - 1]} (x=${prevMed}) — not a staircase`);
        }
      }
      // ALIGNMENT within a depth — HANDOVER 2026-09-08 item #4 ("keywords expand button should
      // be aligned to the rest of the section"): rows at the SAME nesting depth should share the
      // SAME chevron x, whether or not that particular row happens to have children (a leaf's
      // empty chevron slot must occupy the same width as an expandable sibling's real chevron,
      // or the row LABEL that follows it silently drifts out of alignment too). A per-depth
      // median comparison (above) can't see this — it would average two disagreeing x's away.
      for (const depth of depths) {
        const xs = byDepth.get(depth);
        const min = Math.min(...xs), max = Math.max(...xs);
        if (max - min > 2) {
          out.push(`${name} tree: depth ${depth} rows disagree on chevron x (${min}-${max}px, Δ${max - min}) — a leaf's empty chevron slot likely doesn't match an expandable sibling's real chevron width`);
        }
      }
    }
    return { out, trees };
  });
  indentFindings.out.forEach((f) => findings.push(`[sidebar] tree indentation: ${f}`));
}

// ── Zoom icon meaning — HANDOVER 2026-09-08 item #8: the wireframe's zoom icons are plain
// minus/plus LINES (Library View.html:224-226, no <circle> at all); the app's ic('zoomIn')/
// ic('zoomOut') (chromasmith-22.html ICONS) draw a full magnifying-glass metaphor (a <circle>
// + a diagonal handle) with a tiny +/- inside — a different icon FAMILY, not just a style
// variation. A blanket wireframe-vs-app icon-shape diff is deliberately not done anywhere else
// in this file (the two apps use different icon sets on purpose, see the icon-baseline comment
// above) — this one is hand-curated because the user named it specifically, and "does it draw a
// circle" is a robust, cheap proxy for "is this a magnifying glass" without needing exact path
// matching.
{
  const zoomIsMagnifier = await app.evaluate(() => {
    const zoomIcons = Array.from(document.querySelectorAll('#lib-thumbsize')).flatMap((input) => {
      const wrap = input.closest('.lib-zoomrow');
      return wrap ? Array.from(wrap.querySelectorAll('svg')) : [];
    });
    return zoomIcons.some((svg) => svg.querySelector('circle'));
  });
  if (zoomIsMagnifier) {
    findings.push('[topbar] zoom icons: wireframe uses plain minus/plus lines (no circle); app draws a magnifying-glass (circle+handle) — a different icon metaphor, not just a style difference');
  }
}

// ── Icon COLOUR differentiation — found live 2026-09-08, not by any prior check: the filter
// chip row's 4 flag icons (pick/reject/favorite/unflagged) all rendered plain white, no tint at
// all, even though the wireframe deliberately colours each one differently (Library View.html
// :76-79 — reject=danger, pick=primary, fav=warning, none=muted) to make the four roles tell
// apart from each other at a glance. No check anywhere compares icon FILL/STROKE colour — the
// zone loop below only ever looks at font-size/font-family/position, and the icon-shape
// baseline (--icons-baseline) only records path/circle geometry, never colour. This is the gap.
//
// Not a full wireframe-vs-app colour diff (the two apps' icon sets differ throughout by design,
// same reasoning as the icon-shape baseline) — instead, a SELF-consistency check per side: does
// this icon family actually use more than one colour? If the wireframe's family is
// multi-coloured (a deliberate signal) and the app's corresponding family renders every icon in
// the SAME colour, that's the exact failure mode that shipped here — regardless of which exact
// hues either side picked (the app is free to reuse its own established colour language, as it
// did: green-pine/red-oxide/orange-ember instead of the wireframe's primary-blue for "pick").
const ICON_COLOR_FAMILIES = [
  { label: 'filter-row flag chips', wf: '.filterrow .chip.iconchip svg', app: '.lib-filterrow .lib-iconchip svg' },
  { label: 'topbar flag row', wf: '.flagrow svg', app: '#lib-flagrow svg' },
];
async function distinctStrokeFillColors(page, sel) {
  return page.evaluate((s) => {
    const els = Array.from(document.querySelectorAll(s));
    if (!els.length) return null;
    const colors = els.map((el) => {
      const cs = getComputedStyle(el);
      return (cs.stroke !== 'none' ? cs.stroke : '') + '|' + (cs.fill !== 'none' ? cs.fill : '');
    });
    return { count: els.length, distinct: new Set(colors).size };
  }, sel);
}
for (const fam of ICON_COLOR_FAMILIES) {
  const wCol = await distinctStrokeFillColors(wf, fam.wf);
  const aCol = await distinctStrokeFillColors(app, fam.app);
  if (!wCol || !aCol) continue; // one side doesn't have this family right now — not a finding here
  if (wCol.distinct > 1 && aCol.distinct === 1) {
    findings.push(`[selfconsist] icon colour: "${fam.label}" — the wireframe uses ${wCol.distinct} distinct icon colours across its ${wCol.count} icons (a deliberate per-role signal) but the app's ${aCol.count} corresponding icons are ALL the same colour — the role distinction (e.g. reject vs pick vs favorite) is invisible`);
  }
}

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

  // The grid zone is excluded from every COUNT-based comparison below (row-count, MISSING/
  // EXTRA, atom count, font tallies). Both sides gate their flag/rate icons behind opacity:0
  // until hovered or already .set/.on, and the wireframe's own `i%7===0` pre-flag seed vs. the
  // app's independent synthetic mock leaves the two sides with a DIFFERENT number of
  // currently-visible icons for reasons that have nothing to do with fidelity — comparing tallies
  // here just compares two unrelated random photo samples. The deliberate flag-visibility/
  // reject-dimming checks above already cover the grid's real, meaningful behaviour; icon
  // centering below (position-based, not count-based) still runs for it.
  const wClean = w.atoms.filter((x) => !isDataNoise(x));
  const aClean = a.atoms.filter((x) => !isDataNoise(x));
  const wSig = summarize(wClean), aSig = summarize(aClean);
  if (zone.label !== 'grid') {
  // Row-count parity for noisy rows: same number of dynamic-data atoms, even though their exact
  // text will never match (mock counts vs the wireframe's hand-picked numbers).
  const wNoise = w.atoms.filter(isDataNoise).length, aNoise = a.atoms.filter(isDataNoise).length;
  if (wNoise !== aNoise) {
    findings.push(`[${zone.label}] dynamic-data row count: wireframe ${wNoise} vs app ${aNoise}`);
  }

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

  // Geometry of the first few atoms — catches "search jammed against the logo" (an x-offset
  // difference), which no per-element computed-style check can express. Also skipped for grid:
  // "the Nth atom" means nothing when the two sides show different photos in a different order.
  for (let i = 0; i < Math.min(6, wSig.length, aSig.length); i++) {
    if (wSig[i] !== aSig[i]) { findings.push(`[${zone.label}] order@${i}: wireframe ${wSig[i]} vs app ${aSig[i]}`); break; }
    const dx = Math.abs(wClean[i].x - aClean[i].x);
    if (dx > 12) findings.push(`[${zone.label}] x-offset of ${wSig[i]}: wireframe ${wClean[i].x}px vs app ${aClean[i].x}px (Δ${dx})`);
  }
  } // zone.label !== 'grid'

  // Icon centering — HANDOVER 2026-09-08 item #6 (topbar icons not centered in their shapes).
  // Runs for every zone including grid: it's a per-icon POSITION check (icon vs. its own hit-
  // shape), not a count/order comparison across the two sides, so the grid's differing photo
  // sample doesn't make it meaningless the way the tallies above are.
  const ICON_CENTER_TOLERANCE = 1.5; // px — sub-pixel rounding noise, not a real miscentering
  for (const icon of aClean.filter((x) => x.kind === 'icon' && x.centerOffset != null)) {
    if (icon.centerOffset > ICON_CENTER_TOLERANCE) {
      findings.push(`[${zone.label}] icon off-center by ${icon.centerOffset}px within its hit-shape (icon#${aClean.indexOf(icon)})`);
    }
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

// ⚠️ HARD GATE. This used to gate on REGRESSIONS ONLY — compare against the previous run, then
// overwrite that same report in the same run. Two consequences, both of which actually bit:
//   1. A newly-introduced defect failed EXACTLY ONE run. The run that caught it also wrote it
//      into the baseline, so every run after that reported it as "persisting" and exited 0.
//   2. On a clean checkout the report file doesn't exist, `recheck` returns null, and the
//      script ALWAYS exited 0 — 35 findings and "RESULT: FAIL" on stdout coexisting with a
//      green exit code, which is how the 14 reported defects shipped under a passing suite.
// Anything genuinely accepted belongs in test/wireframe_accepted.json with a written reason,
// where it is visible and zone-scoped — not in a self-refreshing baseline nobody reads.
// The report is still written, purely as a diff aid for the next run.
const records = { mismatches: unaccepted.map((raw) => ({ raw })), missing: [] };
const rc = await recheck(REPORT_PATH, records);
printRecheck(rc);
await writeReport(REPORT_PATH, records);
process.exit(unaccepted.length ? 1 : 0);
