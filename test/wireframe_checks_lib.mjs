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
const ZONE_RE = /^\[([a-z]+)\]/;
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
