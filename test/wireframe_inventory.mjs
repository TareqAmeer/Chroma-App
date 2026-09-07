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
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS, settleForCapture } from './wireframe_diff_lib.mjs';

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
      if (isControl || isIcon || ownText) {
        out.push({
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

const b = await chromium.launch({ args: DETERMINISTIC_LAUNCH_ARGS });
const findings = [];

const wf = await b.newPage({ viewport: VIEWPORT, ...DETERMINISTIC_CONTEXT_OPTIONS });
await wf.goto(`http://127.0.0.1:${port}/chromasmith-design/project/Library%20View.html`, { waitUntil: 'load' });
await wf.evaluate(() => document.getElementById('app').classList.add('dark'));
await settleForCapture(wf);

const app = await b.newPage({ viewport: VIEWPORT, ...DETERMINISTIC_CONTEXT_OPTIONS });
app.on('pageerror', (e) => console.log('[pageerror]', e.message));
await app.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&libn=60`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await app.waitForTimeout(2500);
await app.evaluate(() => {
  document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); });
});
await app.evaluate(() => { document.getElementById('lib-overlay')?.classList.add('full'); });
await app.waitForTimeout(400);
await settleForCapture(app);

for (const zone of ZONES) {
  const w = await wf.evaluate(`(${INVENTORY_FN})(${JSON.stringify(zone.wf)})`);
  const a = await app.evaluate(`(${INVENTORY_FN})(${JSON.stringify(zone.app)})`);
  if (!w) { findings.push(`[${zone.label}] wireframe container ${zone.wf} not found`); continue; }
  if (!a) { findings.push(`[${zone.label}] app container ${zone.app} NOT FOUND`); continue; }

  const wSig = summarize(w.atoms), aSig = summarize(a.atoms);
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
  const wFs = fsOf(w.atoms), aFs = fsOf(a.atoms);
  const allFs = new Set([...wFs.keys(), ...aFs.keys()]);
  for (const size of allFs) {
    const wn = wFs.get(size) || 0, an = aFs.get(size) || 0;
    if (wn !== an) findings.push(`[${zone.label}] font-size ${size}: wireframe uses it on ${wn} text atom(s), app on ${an}`);
  }

  // Geometry of the first few atoms — catches "search jammed against the logo" (an x-offset
  // difference), which no per-element computed-style check can express.
  for (let i = 0; i < Math.min(6, wSig.length, aSig.length); i++) {
    if (wSig[i] !== aSig[i]) { findings.push(`[${zone.label}] order@${i}: wireframe ${wSig[i]} vs app ${aSig[i]}`); break; }
    const dx = Math.abs(w.atoms[i].x - a.atoms[i].x);
    if (dx > 12) findings.push(`[${zone.label}] x-offset of ${wSig[i]}: wireframe ${w.atoms[i].x}px vs app ${a.atoms[i].x}px (Δ${dx})`);
  }
}

await wf.close(); await app.close();
await b.close();
server.close();

console.log(`wireframe_inventory: ${findings.length} structural findings\n`);
findings.forEach((f) => console.log('  ' + f));
console.log(findings.length ? '\nRESULT: SEE ABOVE' : '\nRESULT: PASS');
