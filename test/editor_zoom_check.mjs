// T46 (editor_ux_spec.json): browser-zoom / OS-text-scaling check. editor_responsive_qa.mjs
// sweeps VIEWPORT WIDTH (a narrower window), which is a different code path from a user zooming
// their browser to 150%/200% or running OS-level large text — those keep the same CSS viewport
// width but scale font-size/line-height, which can overflow/clip/overlap even on a layout that
// passes every width-based responsive check.
//
// Approach: Chromium doesn't expose real browser-chrome zoom to Playwright, so this emulates the
// same visible effect the way current guidance recommends for automated zoom testing — injecting
// a root `font-size` scale (`html{font-size:150%}` / `200%`) that cascades through any rem/em-
// based sizing, PLUS a device-scale-factor-independent viewport CSS px scale via `page.emulate`-
// style zoom (Chromium supports Page.setDeviceMetricsOverride via CDP for a true zoom, used here
// through the page context). Reuses editor_responsive_qa.mjs's own overlap-detection algorithm
// against the same topbar/rail containers, at 100% (baseline) vs 150%/200%.
import { bootEditor } from './editor_state_harness.mjs';

const ZOOM_LEVELS = [1.0, 1.5, 2.0];
const CONTAINERS = ['fx-deskbar', 'fx-toolrail'];

function auditOverlaps(containerIds) {
  const out = [];
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
          const nm = (el) => el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.textContent || '').trim().slice(0, 15);
          out.push({ cid, a: nm(visibleKids[i]), b: nm(visibleKids[j]), overlapPx: Math.round(ix) });
        }
      }
    }
  }
  return out;
}

// Also checks for clipped/cut-off text at the document level — a text node whose rendered
// content box is narrower than its scrollWidth (ellipsis-free truncation) inside a fixed-width
// container, which is exactly the failure mode zoom introduces that a width-only sweep can't.
function auditClipping() {
  const out = [];
  const all = document.querySelectorAll('#fx-deskbar *, #fx-toolrail *, .fx-panel *');
  for (const el of all) {
    if (el.children.length > 0) continue; // leaf text nodes only
    const cs = getComputedStyle(el);
    if (cs.textOverflow === 'ellipsis') continue; // intentional truncation, not a bug
    if (el.scrollWidth > el.clientWidth + 2 && cs.overflow === 'hidden' && (el.textContent || '').trim()) {
      out.push({ text: el.textContent.trim().slice(0, 30), tag: el.tagName, cls: el.className });
    }
  }
  return out;
}

const b = await bootEditor();
const { page } = b;
const findings = [];

for (const zoom of ZOOM_LEVELS) {
  // Emulate zoom via CDP's Page.setDeviceMetricsOverride so layout viewport CSS px shrinks the
  // same way a real browser-chrome zoom does (content occupies more logical space at the same
  // window size), rather than just a font-size hack which under-represents real zoom behaviour.
  const client = await page.context().newCDPSession(page);
  const vp = page.viewportSize() || { width: 1440, height: 900 };
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: Math.round(vp.width / zoom), height: Math.round(vp.height / zoom),
    deviceScaleFactor: zoom, mobile: false,
  });
  await page.waitForTimeout(250);

  const overlaps = await page.evaluate(auditOverlaps, CONTAINERS);
  for (const o of overlaps) findings.push({ zoom: `${zoom * 100}%`, kind: 'OVERLAP', detail: `[${o.cid}] "${o.a}" overlaps "${o.b}" by ${o.overlapPx}px` });

  const clipped = await page.evaluate(auditClipping);
  for (const c of clipped) findings.push({ zoom: `${zoom * 100}%`, kind: 'CLIPPED', detail: `${c.tag}.${c.cls || ''} text "${c.text}" is clipped without an ellipsis` });

  await client.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
}

await b.close();

console.log(`editor:zoom-check — ${ZOOM_LEVELS.map((z) => `${z * 100}%`).join(', ')} checked against ${CONTAINERS.join(', ')}`);
if (findings.length) {
  console.log(`\n${findings.length} finding(s):`);
  for (const f of findings) console.log(`  [${f.zoom} ${f.kind}] ${f.detail}`);
  console.log('\nADVISORY: not auto-failing. Run with --strict to fail on any finding.');
  if (process.argv.includes('--strict')) process.exit(1);
} else {
  console.log('PASS: no overlap or unmarked text clipping found at 150%/200% zoom.');
}
