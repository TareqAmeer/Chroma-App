#!/usr/bin/env node
// Responsive/squeeze audit for the Editor — mirrors test/library_responsive_qa.mjs's answer to
// the same gap: nothing swept the Editor's topbar/rail/panel across viewport widths before this.
// Also carries the E4 aspect-ratio invariant (editor_ux_spec.json: "photos get squeezed instead
// of shrinking") via wireframe_checks_lib.mjs's checkAspectRatioInvariant.
//
//   node test/editor_responsive_qa.mjs              # PASS/FAIL table, exit 1 on any finding
//   node test/editor_responsive_qa.mjs --json        # dump the full finding list
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS, settleForCapture } from './wireframe_diff_lib.mjs';
import { checkAspectRatioInvariant } from './wireframe_checks_lib.mjs';

const ROOT = process.cwd();
const DUMP_JSON = process.argv.includes('--json');

// Same viewport list as library_responsive_qa.mjs, plus the wireframe's OWN stated floor
// (Editor (Developer) View.dc.html:17, .app{min-width:760px}) as an explicit checkpoint: below
// it the app must degrade gracefully, not overlap — the wireframe itself gives up below this,
// so this is the one width where "it looks broken" is expected and only OVERLAP/true clipping
// are real findings, not merely "it's cramped".
const VIEWPORTS = [
  { w: 1440, h: 900, label: '1440x900 (normal)' },
  { w: 1200, h: 800, label: '1200x800' },
  { w: 1024, h: 768, label: '1024x768 (small laptop)' },
  { w: 960, h: 760, label: '960x760' },
  { w: 900, h: 760, label: '900x760' },
  { w: 820, h: 700, label: '820x700 (narrow — the squeeze floor)' },
  { w: 760, h: 700, label: '760x700 (wireframe\'s own min-width floor)' },
  { w: 700, h: 700, label: '700x700 (below the wireframe\'s floor — must degrade, not overlap)' },
];

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
const findings = [];

// Serialized in the page. Reuses library_responsive_qa.mjs's own leaf-descent/overlap/wrap
// algorithm verbatim (copied, not re-derived — see that file's own hard-won comments on why a
// naive direct-children-only or scrollWidth-based version misses real defects) against the
// Editor's own topbar/rail containers instead of the Library's.
const AUDIT_FN = `(containerIds) => {
  const out = { overlaps: [], wrapped: [] };
  const leaves = (root) => Array.from(root.children).flatMap((el) => {
    if (el instanceof SVGElement) return [el];
    const isControl = /^(BUTTON|INPUT|SELECT|A)$/.test(el.tagName);
    const kids = Array.from(el.children).filter((k) => k.getBoundingClientRect().width > 0);
    return (!isControl && kids.length > 1) ? leaves(el) : [el];
  });
  for (const cid of containerIds) {
    const top = document.getElementById(cid);
    if (!top) continue;
    const visibleKids = leaves(top).filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0;
    });
    for (let i = 0; i < visibleKids.length; i++) {
      for (let j = i + 1; j < visibleKids.length; j++) {
        const a = visibleKids[i].getBoundingClientRect(), bb = visibleKids[j].getBoundingClientRect();
        const ix = Math.min(a.right, bb.right) - Math.max(a.left, bb.left);
        const iy = Math.min(a.bottom, bb.bottom) - Math.max(a.top, bb.top);
        if (ix > 1 && iy > 1) {
          const nm = (el) => {
            if (el.id) return '#' + el.id;
            const t = (el.getAttribute && el.getAttribute('title')) || '';
            const lbl = (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 18);
            return el.tagName.toLowerCase() + (t ? ' "' + t + '"' : (lbl ? ' "' + lbl + '"' : ''));
          };
          out.overlaps.push([cid, nm(visibleKids[i]), nm(visibleKids[j]), Math.round(ix)]);
        }
      }
    }
    for (const btn of top.querySelectorAll('button')) {
      const cs = getComputedStyle(btn);
      const bx = btn.getBoundingClientRect();
      if (bx.width === 0 || bx.height === 0) continue;
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
      const label = btn.querySelector('.fx-rail-lb, .lbl')
        || [...btn.querySelectorAll('span')].reverse().find((sp) => sp.textContent.trim());
      if (!label) continue;
      const lb = label.getBoundingClientRect();
      if (lb.height > lh * 1.6 && lb.width > 0) {
        out.wrapped.push({ id: cid, text: label.textContent.trim().slice(0, 30), h: Math.round(lb.height), lineH: Math.round(lh) });
      }
    }
  }
  return out;
}`;

const page = await b.newPage({ ...DETERMINISTIC_CONTEXT_OPTIONS });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&deskx=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  document.querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === 'Got it') b.click(); });
  if (typeof applyFxLayout === 'function') applyFxLayout();
});
await page.keyboard.press('Escape'); // exit the boot-watchdog Library full-view race — see editor_wireframe_diff.mjs's comment
await page.waitForTimeout(150);
const fixtureB64 = (await readFile(path.join(ROOT, 'test/fixtures/portrait.png'))).toString('base64');
await page.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const file = new File([bytes], 'portrait.png', { type: 'image/png' });
  if (typeof window.loadFXImages === 'function') await window.loadFXImages([file]);
}, fixtureB64);
await page.waitForFunction(() => typeof fxImages !== 'undefined' && fxImages && fxImages.length > 0, { timeout: 10000 }).catch(() => {});
await settleForCapture(page);

const CONTAINERS = ['fx-deskbar', 'fx-toolrail'];
for (const vp of VIEWPORTS) {
  await page.setViewportSize({ width: vp.w, height: vp.h });
  await page.waitForTimeout(200);
  const result = await page.evaluate(`(${AUDIT_FN})(${JSON.stringify(CONTAINERS)})`);
  for (const [cid, a, bId, overlapPx] of result.overlaps) {
    findings.push({ viewport: vp.label, kind: 'OVERLAP', detail: `[${cid}] "${a}" overlaps "${bId}" by ${overlapPx}px` });
  }
  for (const w of result.wrapped) {
    findings.push({ viewport: vp.label, kind: 'WRAP', detail: `[${w.id}] label "${w.text}" wrapped to a second line (${w.h}px tall vs ${w.lineH}px line-height)` });
  }
}

// E4 — the preview canvas's aspect ratio must stay constant as the window narrows (squeeze vs
// scale). Reuses wireframe_checks_lib.mjs's checkAspectRatioInvariant so Library gets it free.
const aspectFindings = await checkAspectRatioInvariant(page, '.fx-canvas-wrap, #fx-wrap', VIEWPORTS.map((v) => v.w), 800);
for (const f of aspectFindings) findings.push({ viewport: 'across the full sweep', kind: 'ASPECT', detail: f });

await page.close();
await b.close();
server.close();

if (DUMP_JSON) {
  console.log(JSON.stringify(findings, null, 2));
} else {
  const byKind = new Map();
  for (const f of findings) { if (!byKind.has(f.kind)) byKind.set(f.kind, []); byKind.get(f.kind).push(f); }
  console.log(`editor_responsive_qa: ${findings.length} finding(s) across ${VIEWPORTS.length} viewports\n`);
  for (const [kind, list] of byKind) {
    console.log(`  ${kind} (${list.length})`);
    for (const f of list.slice(0, 15)) console.log(`    [${f.viewport}] ${f.detail}`);
    if (list.length > 15) console.log(`    ...and ${list.length - 15} more`);
  }
  console.log(findings.length ? '\nRESULT: FAIL' : '\nRESULT: PASS');
}
process.exit(findings.length ? 1 : 0);
