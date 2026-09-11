// Page-agnostic structural/style checks, extracted from wireframe_inventory.mjs (Library) so
// editor_wireframe_diff.mjs and any future wireframe page can reuse the same mechanisms instead
// of re-implementing them per page. Everything here takes SELECTORS as config — nothing is
// Library- or Editor-specific. Each `check*` function returns an array of finding strings (never
// throws on a missing/empty selector — a family that isn't present on a given page is "nothing
// to check", not an error).
//
// This is deliberately a SEPARATE module from wireframe_diff_lib.mjs: that file is determinism/
// report infrastructure (launch args, settleForCapture, the recheck/report pipeline); this one
// is the actual check LOGIC. A page's own script wires the two together with its own selectors.

// ── Colour math ──────────────────────────────────────────────────────────────────────────────
export function parseRgb(c) {
  const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null;
  const p = m[1].split(',').map((x) => parseFloat(x));
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
// Flatten a possibly-transparent colour onto a known ground so two states are comparable.
export function over(fg, ground) {
  if (!fg) return ground;
  const a = fg.a;
  return { r: fg.r * a + ground.r * (1 - a), g: fg.g * a + ground.g * (1 - a), b: fg.b * a + ground.b * (1 - a), a: 1 };
}
export function chanDelta(a, b) {
  if (!a || !b) return null;
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}
export function relLuminance(rgb) {
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a, b) {
  const [L1, L2] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x);
  return (L1 + 0.05) / (L2 + 0.05);
}

// Click `needsOpen` (a trigger selector) before measuring and again after, if given. A family
// living inside a closed menu/popover is display:none until its trigger fires — measuring it
// closed silently returns nothing, which reads identically to "nothing to check" unless this is
// handled explicitly. Found live 2026-09-08 in this exact shape, twice, while building the
// checks below for the Library filter row and gear menu.
async function withOpen(page, needsOpen, fn) {
  if (needsOpen) { await page.click(needsOpen).catch(() => {}); await page.waitForTimeout(150); }
  const result = await fn();
  if (needsOpen) { await page.click(needsOpen).catch(() => {}); await page.waitForTimeout(100); }
  return result;
}

// ── Check: border-radius consistency within a control family ───────────────────────────────
// `families`: [{ label, sel, needsOpen? }]. Self-consistency only — no wireframe value needed,
// majority wins. Families under 3 rendered elements are skipped (too small to call a "drift"
// meaningful rather than an intentional one-off).
export async function checkRadiusConsistency(page, families) {
  const findings = [];
  for (const fam of families) {
    const radii = await withOpen(page, fam.needsOpen, () => page.evaluate((sel) => {
      return Array.from(document.querySelectorAll(sel))
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => ({ r: getComputedStyle(el).borderRadius, t: (el.textContent || '').trim().slice(0, 16) }));
    }, fam.sel));
    if (radii.length < 3) continue;
    const tally = {};
    radii.forEach((x) => { tally[x.r] = (tally[x.r] || 0) + 1; });
    const keys = Object.keys(tally).sort((a, b) => tally[b] - tally[a]);
    if (keys.length > 1) {
      const majority = keys[0];
      for (const k of keys.slice(1)) {
        const offenders = radii.filter((x) => x.r === k).map((x) => `"${x.t}"`).join(', ');
        findings.push(`[selfconsist] border-radius: ${tally[majority]} of ${radii.length} "${fam.label}" use ${majority}, ${tally[k]} use ${k} (${offenders})`);
      }
    }
  }
  return findings;
}

// ── Check: control HEIGHT uniformity within one row family ─────────────────────────────────
// Same shape and threshold as checkRadiusConsistency, for height instead of radius.
export async function checkHeightConsistency(page, families) {
  const findings = [];
  for (const fam of families) {
    const heights = await withOpen(page, fam.needsOpen, () => page.evaluate((sel) => Array.from(document.querySelectorAll(sel))
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => Math.round(el.getBoundingClientRect().height)), fam.sel));
    if (heights.length < 3) continue;
    const uniq = [...new Set(heights)];
    if (uniq.length > 1) {
      findings.push(`[selfconsist] height: "${fam.label}" — ${heights.length} controls render at ${uniq.length} different heights (${uniq.join('px, ')}px) instead of sharing one`);
    }
  }
  return findings;
}

// ── Check: WCAG AA text/background contrast (4.5:1) on filled/selected controls ────────────
// `controls`: [{ label, sel, needsOpen? }]. Skips a control with no background (transparent —
// contrast against it is meaningless) or that isn't currently rendered.
export async function checkFilledControlContrast(page, controls) {
  const findings = [];
  for (const c of controls) {
    const got = await withOpen(page, c.needsOpen, () => page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el || el.getBoundingClientRect().width === 0) return null;
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, color: cs.color };
    }, c.sel));
    if (!got) continue;
    const bg = parseRgb(got.bg), fg = parseRgb(got.color);
    if (!bg || !fg || bg.a === 0) continue;
    const ratio = contrastRatio(fg, bg);
    if (ratio < 4.5) {
      findings.push(`[selfconsist] contrast: ${c.label} — text ${got.color} on background ${got.bg} is ${ratio.toFixed(2)}:1, below WCAG AA's 4.5:1 floor for normal text`);
    }
  }
  return findings;
}

// ── Check: an OPEN menu/popover stays inside the viewport ──────────────────────────────────
// `menus`: [{ label, trigger, menu }]. Checks all four edges — a right-anchored menu can clip
// the LEFT edge once its wrapper is squeezed close to the window edge, the direction its own
// positioning math doesn't guard against.
export async function checkMenuViewportOverflow(page, menus, viewportLabel) {
  const findings = [];
  for (const m of menus) {
    await page.click(m.trigger).catch(() => {});
    await page.waitForTimeout(150);
    const overflow = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el || getComputedStyle(el).display === 'none') return null;
      const b = el.getBoundingClientRect();
      return {
        right: Math.round(b.right - window.innerWidth),
        bottom: Math.round(b.bottom - window.innerHeight),
        left: Math.round(-b.left),
        top: Math.round(-b.top),
      };
    }, m.menu);
    await page.click(m.trigger).catch(() => {});
    await page.waitForTimeout(100);
    if (!overflow) continue;
    for (const [edge, amt] of Object.entries(overflow)) {
      if (amt > 1) findings.push(`[selfconsist] menu overflow: ${m.label} extends ${amt}px past the ${edge} edge of the viewport${viewportLabel ? ` at ${viewportLabel}` : ''}`);
    }
  }
  return findings;
}

// ── Check: icon COLOUR differentiation, wireframe-vs-app self-consistency ──────────────────
// `families`: [{ label, wf, app }] — selectors resolved on the WIREFRAME page and the APP page
// respectively. Not a literal colour diff (icon sets differ throughout by design on every page
// this has been used on) — instead: does the wireframe differentiate this icon family by colour
// (a deliberate per-role signal), and if so, does the app's corresponding family differentiate
// AT ALL (any distinct colours), regardless of which exact hues either side picked. Requires
// both wfPage and appPage since it's inherently a cross-page comparison, unlike the other
// checks in this module which only ever look at one page.
export async function checkIconColorDifferentiation(wfPage, appPage, families) {
  const findings = [];
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
  for (const fam of families) {
    const wCol = await distinctStrokeFillColors(wfPage, fam.wf);
    const aCol = await distinctStrokeFillColors(appPage, fam.app);
    if (!wCol || !aCol) continue;
    if (wCol.distinct > 1 && aCol.distinct === 1) {
      findings.push(`[selfconsist] icon colour: "${fam.label}" — the wireframe uses ${wCol.distinct} distinct icon colours across its ${wCol.count} icons (a deliberate per-role signal) but the app's ${aCol.count} corresponding icons are ALL the same colour — the role distinction is invisible`);
    }
  }
  return findings;
}

// ── Check: hover asserted as a MEASURED perceptual delta, not mere inequality ──────────────
// `targets`: [{ label, sel }] resolved on `page`; `ref` (optional): [{ label, sel }] resolved on
// a reference page (e.g. the wireframe) to report what a "real" lift looks like alongside the
// finding — informational only, never itself a pass/fail input. `minDelta` (default 8/255) is
// the visibility floor: below this, a hover state exists in the CSS but is imperceptible.
export async function checkHoverVisibility(page, targets, { minDelta = 8, ref = null, refPage = null } = {}) {
  const findings = [];
  async function stateOf(pg, sel, { hover = false } = {}) {
    const loc = pg.locator(sel).first();
    if (await loc.count() === 0) return null;
    if (hover) { await loc.hover().catch(() => {}); await pg.waitForTimeout(120); }
    const v = await loc.evaluate((el) => {
      const cs = getComputedStyle(el);
      let g = el.parentElement, gbg = 'rgb(0, 0, 0)';
      while (g) { const b = getComputedStyle(g).backgroundColor;
        if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) { gbg = b; break; } g = g.parentElement; }
      return { bg: cs.backgroundColor, ground: gbg };
    });
    if (hover) { await pg.mouse.move(2, 2); await pg.waitForTimeout(60); }
    return v;
  }
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const aRest = await stateOf(page, t.sel);
    const aHov = await stateOf(page, t.sel, { hover: true });
    if (!aRest || !aHov) { findings.push(`[selfconsist] ${t.label} (hover): selector ${t.sel} matched nothing — hover state unverifiable`); continue; }
    const ground = parseRgb(aRest.ground);
    const dApp = chanDelta(over(parseRgb(aRest.bg), ground), over(parseRgb(aHov.bg), ground));
    let refNote = '';
    if (ref && ref[i] && refPage) {
      const wRest = await stateOf(refPage, ref[i].sel);
      const wHov = await stateOf(refPage, ref[i].sel, { hover: true });
      if (wRest && wHov) {
        const dWf = chanDelta(over(parseRgb(wRest.bg), parseRgb(wRest.ground)), over(parseRgb(wHov.bg), parseRgb(wRest.ground)));
        if (dWf != null) refNote = `; wireframe lifts by ${dWf.toFixed(1)}/255`;
      }
    }
    if (dApp == null) { findings.push(`[selfconsist] ${t.label} (hover): could not measure hover colour`); continue; }
    if (dApp < minDelta) {
      findings.push(`[selfconsist] ${t.label} (hover): background lifts by only ${dApp.toFixed(1)}/255 on hover (${aRest.bg} -> ${aHov.bg} over ${aRest.ground}) — below the ${minDelta}/255 visibility floor${refNote}`);
    }
  }
  return findings;
}

// ── Zone-scoped allowlist + hard gate ───────────────────────────────────────────────────────
// Load once per page script. Matching is ZONE-QUALIFIED — a bare substring test lets an entry
// reasoned about ONE zone silence the identical string everywhere (this shipped for real in
// Library's own allowlist before it was fixed: an `order@3` sidebar entry was also suppressing
// a real sortmenu finding). Every finding is expected as `[zone] ...`; an allowlist entry names
// its zone either inside `match` or via an explicit `zone` field — an entry with neither is
// rejected at load rather than silently going global.
// ⚠️ Found 2026-09-10 while adding a real allowlist entry for a "color-panel" zone (a zone name
// used throughout editor_wireframe_diff.mjs's PAIRS, alongside detail-panel/film-panel/frame-
// panel/crop-panel/export-panel/retouch-panel): the character class below was letters-only, so
// it silently failed to match ANY hyphenated zone name — isAccepted's `fz` came back null, and an
// entry for one of those zones would never suppress anything, ever, with no error anywhere. Only
// caught because a newly-added entry visibly failed to suppress its own finding; every zone name
// actually used by this repo's allowlists happened to be a single word until now, so no
// pre-existing entry was silently broken by this — but the next one for any -panel zone would
// have been. Widened to allow hyphens in both the zone declared by an entry's `match` and the
// zone read off a live finding string.
const ZONE_RE = /^\[([a-z-]+)\]/;
export function loadAllowlist(raw) {
  const list = raw || [];
  for (const a of list) {
    const inMatch = ZONE_RE.exec(a.match);
    if (!a.zone && !inMatch) {
      console.log(`[allowlist] REJECTED unscoped entry ${JSON.stringify(a.match)} — add a "zone" field`);
    }
    a._zone = a.zone || (inMatch ? inMatch[1] : null);
  }
  return list;
}
export function isAccepted(allowlist, finding) {
  const fz = ZONE_RE.exec(finding);
  return allowlist.some((a) => a._zone && finding.includes(a.match) && fz && fz[1] === a._zone);
}

// ── Check: DEAD CONTROLS — click/drag every control, assert something observably changed ─────
// Built for the Editor UX pass (editor_ux_spec.json E1.3.1/3.1.5/3.4.6 etc.) after the user
// reported several controls that visibly exist but silently do nothing — a class no
// computed-style diff can ever see. `controls`: [{ label, sel, kind: 'click'|'slider',
// observe: 'dom'|'style'|'canvas', styleProp?, canvasSel? }].
//
// ⚠️ SAFETY: this clicks/drags real controls, some of which are destructive (export, delete,
// file-open dialogs) or slow (full export). It must run ONLY against a scratch fixture photo in
// a throwaway state, and callers MUST exclude destructive controls from `controls` — write a
// hand-authored behaviour test for those instead (see editor_wireframe_behaviour.mjs). This
// module does not and cannot know which controls are destructive; the caller's `controls` list
// IS the safe-list.
export async function checkDeadControls(page, controls) {
  const findings = [];
  for (const c of controls) {
    const before = await captureObservable(page, c);
    if (before == null) { findings.push(`[deadcontrol] ${c.label} (${c.sel}): not found or not rendered — cannot probe`); continue; }
    if (c.kind === 'slider') {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel); if (!el) return;
        const min = +el.min || 0, max = +el.max || 100;
        el.value = Math.abs(+el.value - max) < Math.abs(+el.value - min) ? min : max;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, c.sel);
    } else {
      await page.click(c.sel).catch(() => {});
    }
    await page.waitForTimeout(c.settleMs || 250);
    const after = await captureObservable(page, c);
    if (after != null && JSON.stringify(before) === JSON.stringify(after)) {
      findings.push(`[deadcontrol] ${c.label} (${c.sel}): ${c.kind === 'slider' ? 'moving to its extreme' : 'clicking'} produced no observable change (${c.observe}: ${JSON.stringify(before)})`);
    }
  }
  return findings;
}
async function captureObservable(page, c) {
  if (c.observe === 'style') {
    return page.evaluate(({ sel, prop }) => {
      const el = document.querySelector(sel); if (!el) return null;
      return getComputedStyle(el)[prop];
    }, { sel: c.sel, prop: c.styleProp });
  }
  if (c.observe === 'canvas') {
    return page.evaluate((canvasSel) => {
      const cv = document.querySelector(canvasSel); if (!cv) return null;
      const ctx = cv.getContext('2d') || cv.getContext('webgl2') || cv.getContext('webgl');
      if (!ctx || !ctx.getImageData) {
        // WebGL canvas: hash a downscaled readback via a 2D copy instead of raw pixel read.
        const tmp = document.createElement('canvas'); tmp.width = 32; tmp.height = 32;
        tmp.getContext('2d').drawImage(cv, 0, 0, 32, 32);
        return tmp.toDataURL();
      }
      const d = ctx.getImageData(0, 0, Math.min(32, cv.width), Math.min(32, cv.height)).data;
      let h = 0; for (let i = 0; i < d.length; i += 7) h = (h * 31 + d[i]) | 0;
      return h;
    }, c.canvasSel);
  }
  // 'dom' default: a structural fingerprint of the element's own subtree, not just outerHTML
  // (which would also flip on e.g. a live timestamp) — text + attribute snapshot.
  return page.evaluate((sel) => {
    const el = document.querySelector(sel); if (!el) return null;
    return { text: el.textContent, cls: el.className, attrs: Array.from(el.attributes).map((a) => `${a.name}=${a.value}`).sort() };
  }, c.sel);
}

// ── Check: DISABLED-STATE correctness — a control with no valid action must look/act disabled ─
// `controls`: [{ label, sel, validWhen: (page)=>Promise<boolean> }]. `validWhen` is the caller's
// own predicate for "this control currently has something valid to do" (e.g. a preset is
// selected, the photo is RAW) — this module has no domain knowledge of when a control is valid,
// only how to check that the DOM agrees with the caller once told.
export async function checkDisabledState(page, controls) {
  const findings = [];
  for (const c of controls) {
    const valid = await c.validWhen(page);
    const state = await page.evaluate((sel) => {
      const el = document.querySelector(sel); if (!el || el.getBoundingClientRect().width === 0) return null;
      return { disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true', opacity: parseFloat(getComputedStyle(el).opacity), pointerEvents: getComputedStyle(el).pointerEvents };
    }, c.sel);
    if (!state) continue;
    const looksDisabled = state.disabled || state.opacity < 0.6 || state.pointerEvents === 'none';
    if (!valid && !looksDisabled) {
      findings.push(`[disabled] ${c.label} (${c.sel}): has nothing valid to do right now but is not disabled/dimmed/non-interactive (disabled=${state.disabled}, opacity=${state.opacity}, pointer-events=${state.pointerEvents})`);
    }
    if (valid && (state.disabled || state.pointerEvents === 'none')) {
      findings.push(`[disabled] ${c.label} (${c.sel}): has a valid action available but is disabled/non-interactive`);
    }
  }
  return findings;
}

// ── Check: STATE-LEAK sweep across a photo switch ──────────────────────────────────────────
// `fields`: [{ label, sel, prop: 'value'|'textContent'|styleProp, style? }]. Snapshots every
// field for photo A, switches to photo B via `switchTo(page, b)`, snapshots B, switches back to
// A, and asserts A's values are restored — catches "control follows the WRONG photo" bugs like
// the reported flag getting stuck on the previous photo (editor_ux_spec.json E5), which a
// single-photo check structurally cannot see.
export async function checkStateLeak(page, fields, switchTo, photoA, photoB) {
  const findings = [];
  async function snapshot() {
    return page.evaluate((fields) => fields.map((f) => {
      const el = document.querySelector(f.sel);
      if (!el) return null;
      if (f.style) return getComputedStyle(el)[f.prop];
      return el[f.prop];
    }), fields);
  }
  const a1 = await snapshot();
  await switchTo(page, photoB);
  const b1 = await snapshot();
  await switchTo(page, photoA);
  const a2 = await snapshot();
  fields.forEach((f, i) => {
    if (a1[i] == null && a2[i] == null) return; // field absent on both — nothing to leak
    if (JSON.stringify(a1[i]) !== JSON.stringify(a2[i])) {
      findings.push(`[stateleak] ${f.label}: was ${JSON.stringify(a1[i])} for photo A, still ${JSON.stringify(a2[i])} after switching to B and back — did not restore (B showed ${JSON.stringify(b1[i])})`);
    }
  });
  return findings;
}

// ── Check: POPOVER anchoring survives scroll ────────────────────────────────────────────────
// Extends checkMenuViewportOverflow, which never scrolls — built specifically for the reported
// "Get Info popup always renders top-right even when scrolling" bug (editor_ux_spec.json 3.2.8).
// `popovers`: [{ label, trigger, popover, scrollSel, scrollBy }]. Opens the popover, records its
// position relative to its trigger, scrolls `scrollSel` by `scrollBy`, and asserts the popover
// either tracks the trigger's on-screen movement or closes — a popover that stays glued to a
// fixed viewport position while its trigger scrolls away is the bug.
export async function checkPopoverAnchoring(page, popovers) {
  const findings = [];
  for (const p of popovers) {
    await page.click(p.trigger).catch(() => {});
    await page.waitForTimeout(150);
    const before = await page.evaluate(({ trigger, popover }) => {
      const t = document.querySelector(trigger), m = document.querySelector(popover);
      if (!t || !m || getComputedStyle(m).display === 'none') return null;
      const tb = t.getBoundingClientRect(), mb = m.getBoundingClientRect();
      return { dx: mb.left - tb.left, dy: mb.top - tb.top };
    }, p);
    if (!before) { findings.push(`[popover] ${p.label}: could not open or measure — trigger ${p.trigger} / popover ${p.popover}`); continue; }
    await page.evaluate(({ scrollSel, scrollBy }) => {
      const s = document.querySelector(scrollSel) || document.scrollingElement;
      s.scrollBy(0, scrollBy);
    }, p);
    await page.waitForTimeout(150);
    const after = await page.evaluate(({ trigger, popover }) => {
      const t = document.querySelector(trigger), m = document.querySelector(popover);
      if (!t) return null;
      const stillOpen = m && getComputedStyle(m).display !== 'none';
      if (!stillOpen) return { closed: true };
      const tb = t.getBoundingClientRect(), mb = m.getBoundingClientRect();
      return { dx: mb.left - tb.left, dy: mb.top - tb.top };
    }, p);
    await page.click(p.trigger).catch(() => {});
    if (!after) continue;
    if (after.closed) continue; // closing on scroll is an acceptable alternative to tracking
    if (Math.abs(after.dx - before.dx) > 2 || Math.abs(after.dy - before.dy) > 2) {
      findings.push(`[popover] ${p.label}: offset from its trigger changed from (${before.dx},${before.dy}) to (${after.dx},${after.dy}) after scrolling — it is not tracking its trigger (fixed-position bug)`);
    }
  }
  return findings;
}

// ── Check: preview ASPECT RATIO stays constant across viewport widths ──────────────────────
// Built for editor_ux_spec.json E4 ("photos get squeezed instead of shrinking"). `sel` is the
// element whose intrinsic content must be letterboxed/shrunk, never non-uniformly scaled.
// `widths`: array of viewport widths to test at a fixed height. Tolerance 0.02 (2%) absorbs
// sub-pixel rounding, not a real aspect change.
export async function checkAspectRatioInvariant(page, sel, widths, height) {
  const findings = [];
  const ratios = [];
  for (const w of widths) {
    await page.setViewportSize({ width: w, height });
    await page.waitForTimeout(150);
    const r = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      // Prefer the rendered image/canvas's natural aspect, not the wrapper's box — the wrapper
      // is EXPECTED to change aspect as the window resizes; its content should not.
      const media = el.tagName === 'CANVAS' || el.tagName === 'IMG' ? el : el.querySelector('canvas,img');
      if (media && (media.naturalWidth || media.width) && (media.naturalHeight || media.height)) {
        return (media.naturalWidth || media.width) / (media.naturalHeight || media.height);
      }
      return b.width / b.height;
    }, sel);
    if (r != null) ratios.push({ w, r });
  }
  if (ratios.length < 2) return findings;
  const base = ratios[0].r;
  for (const { w, r } of ratios.slice(1)) {
    if (Math.abs(r - base) / base > 0.02) {
      findings.push(`[aspect] ${sel}: aspect ratio was ${base.toFixed(3)} at ${ratios[0].w}px wide, ${r.toFixed(3)} at ${w}px wide — the image is being squeezed, not scaled uniformly`);
    }
  }
  return findings;
}

// ── Check: CLIPPING — a visible control/icon partly cut off by its container or the window ──
// Built 2026-09-11 after the narrowed tool rail shipped with every icon half off-screen
// (#fx-toolrail kept a hardcoded width:72px while its grid track went to 44px). The overlap/wrap
// checks above could never see it: nothing overlapped and no label wrapped — the icons were just
// cut off by the window edge. Only PARTIAL clipping is reported: an element entirely outside its
// clip rect is deliberately hidden (a closed panel), one straddling the edge is a defect.
// Horizontal clipping is checked against the viewport and every ancestor with overflow-x
// hidden/clip; vertical only against ancestors with overflow-y hidden/clip (a vertically
// scrolling panel is not a clip). `rootSel` scopes the scan.
export const CLIP_FN = `(rootSel) => {
  const SEL = 'button,input,select,textarea,a[href],svg,img,[role=button],canvas';
  const roots = [...document.querySelectorAll(rootSel)];
  const seen = new Set(), out = [];
  const nm = (el) => {
    if (el.id) return '#' + el.id;
    const t = el.getAttribute && (el.getAttribute('title') || el.getAttribute('aria-label'));
    const host = el.closest('[id]');
    const lbl = (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 18);
    return el.tagName.toLowerCase() + (t ? ' "' + t + '"' : (lbl ? ' "' + lbl + '"' : '')) + (host ? ' in #' + host.id : '');
  };
  for (const root of roots) for (const el of root.querySelectorAll(SEL)) {
    if (seen.has(el)) continue; seen.add(el);
    // Icons are checked on their own too: an icon can be cut off inside a button that itself fits.
    if (el.tagName !== 'svg' && el.closest('svg')) continue;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) continue;
    // Content inside a SCROLLING container may legitimately sit part-way out of view (a
    // thumbnail half-scrolled in the filmstrip) — so once the walk passes a scroller on an
    // axis, that axis is no longer checked against anything further out, window included.
    const clips = [];
    let freeX = false, freeY = false;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const sx = (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && a.scrollWidth > a.clientWidth;
      const sy = (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && a.scrollHeight > a.clientHeight;
      const cx = !freeX && (cs.overflowX === 'hidden' || cs.overflowX === 'clip');
      const cy = !freeY && (cs.overflowY === 'hidden' || cs.overflowY === 'clip');
      if (sx) freeX = true;
      if (sy) freeY = true;
      if (!cx && !cy) continue;
      const ab = a.getBoundingClientRect();
      const l = ab.left + a.clientLeft, t = ab.top + a.clientTop;
      clips.push({ who: a.id ? '#' + a.id : a.tagName.toLowerCase() + (a.className && typeof a.className === 'string' ? '.' + a.className.trim().split(/\\s+/)[0] : ''),
        l: cx ? l : -Infinity, r: cx ? l + a.clientWidth : Infinity, t: cy ? t : -Infinity, btm: cy ? t + a.clientHeight : Infinity });
    }
    if (!freeX) clips.push({ who: 'window', l: 0, r: innerWidth, t: -Infinity, btm: Infinity });
    for (const c of clips) {
      const inter = Math.min(b.right, c.r) - Math.max(b.left, c.l) > 0 && Math.min(b.bottom, c.btm) - Math.max(b.top, c.t) > 0;
      if (!inter) break; // fully outside this clip = deliberately hidden, not a partial cut
      const px = Math.max(c.l - b.left, b.right - c.r, c.t - b.top, b.bottom - c.btm);
      if (px > 1) { out.push({ el: nm(el), by: c.who, px: Math.round(px) }); break; }
    }
  }
  return out;
}`;

export async function checkClipping(page, rootSel, label) {
  const hits = await page.evaluate(`(${CLIP_FN})(${JSON.stringify(rootSel)})`);
  return hits.map((h) => ({ viewport: label, kind: 'CLIP', detail: `${h.el} is cut off by ${h.by} (${h.px}px hidden)` }));
}

// ── Check: every RESIZER / layout mode in the page is covered by a test's layout matrix ─────
// The rail bug above survived because every check ran the rail only at its default width —
// CLAUDE.md lesson #16 (state-matrix, not default-state) written down but not enforced. This
// makes it enforced: any drag handle in the DOM that the calling test's matrix doesn't name is
// itself a finding, so adding a new resizable region fails the gate until it is tested at its
// min / default / max. `covered` = the resizer ids the caller's matrix exercises.
export async function checkResizerCoverage(page, covered, label) {
  const ids = await page.evaluate(() => [...document.querySelectorAll('[id$="-resizer"], .fx-edge')]
    .filter((el) => el.id && getComputedStyle(el).display !== 'none').map((el) => el.id));
  return [...new Set(ids)].filter((id) => !covered.includes(id))
    .map((id) => ({ viewport: label, kind: 'UNTESTED_RESIZER', detail: `#${id} can resize the layout but no layout-matrix axis in this test exercises it — add its min/default/max` }));
}

// A HARD gate: fails on any finding not explicitly allowlisted. This replaces the older
// "gate on regressions only" pattern (compare against the previous run, then overwrite that
// same report in the same run) — which let a new defect fail exactly once and read as
// "persisting" (exit 0) forever after, and always exited 0 on a clean checkout where no report
// file exists yet. That bug shipped in both wireframe_inventory.mjs (Library) and
// editor_wireframe_diff.mjs (Editor) before each was fixed; this is the shared, correct version
// so a third page never reintroduces it.
export async function hardGate(findings, allowlist, reportPath, { recheck, writeReport, printRecheck } = {}) {
  const unaccepted = findings.filter((f) => !isAccepted(allowlist, f));
  const acceptedHit = findings.length - unaccepted.length;
  console.log(`${findings.length} structural findings (${acceptedHit} allowlisted)\n`);
  unaccepted.forEach((f) => console.log('  ' + f));
  if (acceptedHit) console.log(`\n  (+${acceptedHit} allowlisted findings suppressed)`);
  console.log(unaccepted.length ? '\nRESULT: FAIL' : '\nRESULT: PASS');
  if (recheck && writeReport && reportPath) {
    const records = { mismatches: unaccepted.map((raw) => ({ raw })), missing: [] };
    const rc = await recheck(reportPath, records);
    if (printRecheck) printRecheck(rc);
    await writeReport(reportPath, records);
  }
  return unaccepted.length === 0;
}
