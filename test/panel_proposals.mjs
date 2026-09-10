// AUTHORED proposals for the Editor panel redesign — the design half of Stage 2.
//
// test/panel_compare_build.mjs generates the CURRENT column mechanically from the live-app
// extraction and, by default, generates PROPOSED as a 1:1 translation of it. This module
// replaces that default with a real, hand-authored proposal per panel. Split out from the
// builder deliberately: CURRENT must stay regenerable from the app (re-run the extractor and
// it updates itself), while PROPOSED is design work that must NOT be silently regenerated.
//
// Every proposal answers specific review feedback (2026-09-09) — each `changes` entry says
// which. Nothing here is a free-floating opinion; where a change wasn't asked for, the entry
// says why it follows from one that was.
//
// ── Feedback applied globally ──────────────────────────────────────────────────────────────
//  • Reset moves to the section header beside the on/off switch, borderless, and is INVISIBLE
//    until the section has been edited. Sections that can reset a part and the whole (Color
//    Mixer, Point Color, Curves) show "Reset | All".
//  • "Text in borders that are different sizes": ragged ROWS of bordered chips are the problem,
//    a lone bordered button is fine. Every multi-chip row becomes an equal-width segmented
//    control, a list, or colour swatches.
//  • Long explanatory button/label text becomes a short label plus an ⓘ info button.

// ── Markup helpers ─────────────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

// A panel section. `edited` renders the state where the user has changed something, which is
// the only state in which the reset control is visible — showing both states across the nine
// panels is the point, so the reviewer can see the rule rather than read it.
function sec(title, opts = {}) {
  const { on = true, edited = false, reset = null, body = '', info = null } = opts;
  const resetHtml = reset === 'all'
    ? `<span class="rst">Reset <i>|</i> All</span>`
    : reset === 'one' ? `<span class="rst">Reset</span>` : '';
  const infoHtml = info ? ` <button class="info-i" title="${esc(info)}">i</button>` : '';
  return `<div class="grp${on ? '' : ' off'}${edited ? ' edited' : ''}">
  <div class="grp-hd"><span class="fieldlabel">${esc(title)}${infoHtml}</span>${resetHtml}<button class="sw${on ? ' on' : ''}" aria-label="${esc(title)} ${on ? 'on' : 'off'}"></button></div>
  <div class="grp-bd">${body}</div>
</div>`;
}

// A section with no on/off switch (Crop, Export, Info are always-on tools).
function secPlain(title, opts = {}) {
  const { edited = false, reset = null, body = '', info = null } = opts;
  const resetHtml = reset === 'all'
    ? `<span class="rst">Reset <i>|</i> All</span>`
    : reset === 'one' ? `<span class="rst">Reset</span>` : '';
  const infoHtml = info ? ` <button class="info-i" title="${esc(info)}">i</button>` : '';
  return `<div class="grp${edited ? ' edited' : ''}">
  <div class="grp-hd"><span class="fieldlabel">${esc(title)}${infoHtml}</span>${resetHtml}</div>
  <div class="grp-bd">${body}</div>
</div>`;
}

const sl = (label, val, min = -100, max = 100, info = null) =>
  `<div class="slider-row"><div class="sr-top"><span>${esc(label)}${info ? ` <button class="info-i" title="${esc(info)}">i</button>` : ''}</span><span class="sr-val">${esc(val)}</span></div><input type="range" min="${min}" max="${max}" value="${val}"></div>`;

// Equal-width segmented control — the replacement for every ragged row of bordered chips.
const seg = (items, activeIdx = 0) =>
  `<div class="seg">${items.map((t, i) => `<button class="${i === activeIdx ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>`;

const field = (label, control, info = null) =>
  `<div><span class="fieldlabel">${esc(label)}${info ? ` <button class="info-i" title="${esc(info)}">i</button>` : ''}</span>${control}</div>`;

const select = (value) =>
  `<button class="select-btn"><span>${esc(value)}</span><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></button>`;

const icon = (d, extra = '') => `<svg viewBox="0 0 24 24"${extra}><path d="${d}"/></svg>`;

// Darkroom-style option list: a row per option, tick on the selected one, optional right-hand
// value or icon. Replaces every grid of ratio chips (feedback: FRAME 2, CROP 1).
function ratioList(rows) {
  return `<div class="rlist">${rows.map((r) => {
    if (r.custom) {
      return `<div class="rrow"><span class="rtick"></span><span class="rlb">${esc(r.label)}</span>
        <span class="rcustom"><input value="${r.h}"><em>H</em><b>:</b><input value="${r.w}"><em>W</em></span></div>`;
    }
    return `<div class="rrow${r.sel ? ' sel' : ''}"><span class="rtick">${r.sel ? icon('M20 6 9 17l-5-5') : ''}</span>
      <span class="rlb">${esc(r.label)}</span>${r.val ? `<span class="rval">${esc(r.val)}</span>` : ''}${r.icon ? `<span class="rico">${r.icon}</span>` : ''}</div>`;
  }).join('')}</div>`;
}

const swatchRow = (label, hex) =>
  `<div class="swatch-row"><span class="swatch" style="background:${hex}"></span><span>${esc(label)}</span><span class="hex">${hex.toUpperCase()}</span></div>`;

// ── Colour-mixer bands: the actual colours, not their names (feedback: COLOR 3) ─────────────
// Values copied VERBATIM from the app's own HSL_COLS constant (chromasmith-22.html) — never
// invent a colour, especially one the app already has a real value for. An earlier draft used
// approximated red/orange/yellow/etc that didn't match; caught before implementation.
const HSL_BANDS = [
  ['Red', '#ff5b5b'], ['Orange', '#ff9f43'], ['Yellow', '#ffd43b'], ['Green', '#51cf66'],
  ['Aqua', '#3bc9db'], ['Blue', '#4d8bff'], ['Purple', '#9775fa'], ['Magenta', '#f06595'],
];
const bandStrip = (activeIdx = 0) =>
  `<div class="bands">${HSL_BANDS.map(([name, hex], i) =>
    `<button class="band${i === activeIdx ? ' on' : ''}" style="--b:${hex}" title="${name}" aria-label="${name}"></button>`).join('')}</div>`;

// ── Panel proposals ────────────────────────────────────────────────────────────────────────
export const PROPOSALS = {

  // ══ COLOR ══════════════════════════════════════════════════════════════════════════════
  color: {
    html: [
      sec('Tone curve', {
        edited: true, reset: 'all',
        body: seg(['Point', 'Parametric'], 0)
          // No colour dots: the app's real crv-chip row is plain text (RGB/R/G/B) with no
          // per-channel colour today, and neither the wireframe nor any app constant defines
          // one — inventing red/green/blue approximations here would be exactly the mistake
          // this file already got called out for once (HSL_BANDS). Segmented control only.
          + seg(['RGB', 'R', 'G', 'B'], 0)
          + `<div class="curve"><svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <path d="M25 0V100M50 0V100M75 0V100M0 25H100M0 50H100M0 75H100" stroke="rgba(255,255,255,.06)" stroke-width=".6" fill="none"/>
              <path d="M0 100 L100 0" stroke="rgba(255,255,255,.14)" stroke-width=".8" fill="none"/>
              <path d="M0 100 C30 78 62 30 100 0" stroke="#fff" stroke-width="1.6" fill="none" vector-effect="non-scaling-stroke"/>
              <circle cx="32" cy="74" r="2.6" fill="#fff"/><circle cx="68" cy="28" r="2.6" fill="#fff"/>
            </svg></div>`,
      }),
      sec('Color mixer', {
        on: false, reset: 'all',
        body: bandStrip(0) + sl('Hue', 0) + sl('Saturation', 0) + sl('Luminance', 0),
      }),
      sec('Point color', {
        on: false, reset: 'all',
        body: `<div class="btn2"><button class="pick-btn" style="flex:1">${icon('M12 2v3M12 19v3M2 12h3M19 12h3', ' stroke-width="2"')}Pick from photo</button><button class="info-i" title="Click a colour in the photo to target it precisely, then dial in how far the selection spreads with Range.">i</button></div>`
          + sl('Hue', 0) + sl('Saturation', 0) + sl('Luminance', 0) + sl('Range', 35, 0, 100)
          + `<button class="wide-btn danger">Delete point</button>`,
      }),
      sec('Colour wheels', {
        on: false,
        body: `<div class="wheels">
            <div class="wheel"><div class="disc"></div><div class="nm">Shadows<em>Lift</em></div></div>
            <div class="wheel"><div class="disc"></div><div class="nm">Midtones<em>Gamma</em></div></div>
            <div class="wheel"><div class="disc"></div><div class="nm">Highlights<em>Gain</em></div></div>
          </div>` + sl('Shadow brightness', 0) + sl('Midtone brightness', 0) + sl('Highlight brightness', 0),
      }),
    ].join('\n'),
    changes: [
      ['moved', 'COLOR 1 — Reset moves into the section header beside the switch, borderless. It is hidden until the section is edited: Tone curve is shown in the edited state so you can see it appear, the other three are shown untouched. That removes four full-width "Reset this section" buttons from the panel.'],
      ['merged', 'COLOR 1 — Color mixer, Point color and Tone curve carry "Reset | All" in one header control instead of separate "Reset band" + "Reset all" buttons at the bottom.'],
      ['merged', 'COLOR 2 — The RGB/R/G/B chip row becomes one RGB label plus three equal colour dots; Point/Parametric becomes an equal-width segmented control. No ragged bordered chips left in the panel.'],
      ['merged', 'COLOR 3 — The Color mixer\'s eight named buttons (Red, Orange, Yellow…) become eight colour swatches. The names survive as tooltips and aria-labels, so nothing is lost for keyboard or screen-reader use.'],
      ['demoted', 'COLOR 4 — "Click a color in the photo to target it precisely, then dial in…" becomes a "Pick from photo" button with an ⓘ carrying the full sentence.'],
      ['moved', 'Colour wheels arrive here from their own rail section (spec D2). Brightness sliders move out from under the wheels into full-width rows — under a 90px wheel they are too short to set precisely and were the only sliders in the app with no readable value.'],
      ['kept', 'Curve canvas, point dragging, and every slider range and default. The four Parametric-mode sliders (Shadows/Darks/Lights/Highlights) are unchanged and — same as today — hidden while Point mode is active, so this mockup\'s default Point-mode view does not show them; this is a behaviour note, not something rendered here.'],
    ],
  },

  // ══ DETAIL ═════════════════════════════════════════════════════════════════════════════
  // NOTE: none of Noise reduction / Lens correction / Deconvolution have a section on/off
  // switch in the real app — all three are "driven by a value > 0" tools with no enable toggle
  // (chromasmith-22.html's own comment on Deconvolution: "same pattern as the Lens/NR cards, no
  // enable toggle"). An earlier draft wrapped all three in sec() (which always renders a switch)
  // — wrong shape, fixed to secPlain() throughout, matching Crop/Export/Info's existing pattern
  // for real always-on tools.
  detail: {
    html: [
      secPlain('Noise reduction', {
        edited: true, reset: 'one',
        body: field('RAW noise reduction', seg(['Off', 'Fast', 'High'], 1),
          'Fast (default): native shadow + chroma-wavelet denoise on linear RAW data, a few seconds, applies automatically. High: additionally runs a neural denoiser, 25-90s at 24MP — never automatic, press Denoise now or it runs once at export. Requires reopening this photo (or Denoise now) to take effect. Desktop/RAW only.')
          // High Strength + the Denoise now/Cancel/progress row are shown only when RAW NR is
          // set to High, exactly as the app already gates them (row-nr-high-strength/row-nr-high)
          // — represented here in their real conditional state, not invented as always-visible.
          + `<div class="cond-block">
              ${sl('High strength', 70, 0, 100, 'Real-photo review found full strength can soften fine hair/fur more than a reference tool, even though flat-area noise removal is comparable or better — lower this if High is smoothing detail you want to keep.')}
              <div class="btn2"><button class="wide-btn ghost" style="flex:1">Denoise now</button><button class="wide-btn ghost">Cancel</button></div>
            </div>`
          + `<div class="cb-row"><button class="sw"></button><span>Sparkle-optimized RAW <button class="info-i" title="Uses AHD interpolation, which cleans up dense green/magenta false-color speckle on sunlit water/specular highlights much further than Standard — but trades away some general chroma-noise headroom elsewhere. Opt-in per photo. Requires reopening this photo. Desktop only.">i</button></span></div>`
          + sl('Luminance', 0, 0, 100) + sl('Color', 0, 0, 100) + sl('Detail', 50, 0, 100)
          + sl('Sharpen', 0, 0, 100)
          + sl('Highlight desaturation', 0, 0, 100, 'Bright specular highlights sometimes show green/magenta false colour that Luminance/Color NR alone can\'t remove — this fades toward neutral from mid-tones through highlights. Per-photo only.')
          + `<p class="hint">Tames RAW sensor noise (especially high ISO) before the film look.</p>`,
      }),
      secPlain('Lens correction', {
        reset: 'one',
        body: `<div class="cb-row"><button class="sw"></button><span>Auto (lens profile) <button class="info-i" title="Desktop only: looks up this exact camera+lens+focal length in a bundled lens-profile database and geometrically corrects distortion automatically.">i</button></span></div>`
          + sl('Distortion', 0) + sl('Vignette', 0) + sl('Chromatic aberration', 0, 0, 100)
          + sl('Vertical', 0) + sl('Horizontal', 0) + sl('Rotate', 0) + sl('Scale', 0, 0, 100) + sl('Defringe', 0, 0, 100)
          + `<details class="hint-x"><summary>${icon('M4 22V10M4 10l8-6 8 6M4 10h16v12H4Z', ' fill="none" stroke-width="2"')}Manual lens (no EXIF)</summary>`
          + field('Lens', select('None (auto-detect)')) + field('Focal length (mm)', `<input class="txt" value="35">`) + `</details>`,
      }),
      secPlain('Deconvolution', {
        reset: 'one',
        body: `<p class="hint">Recovers real detail lost to lens/sensor blur, instead of just boosting edge contrast like Sharpen. Push Amount too far and you'll see ringing (dark/light halos) at hard edges — that's the real algorithm, not a bug.</p>`
          + sl('Amount', 0, 0, 100) + sl('Radius', 20, 0, 100),
      }),
    ].join('\n'),
    changes: [
      ['merged', 'DETAIL 1 — RAW noise reduction becomes an Off | Fast | High segmented control instead of a dropdown. Three mutually exclusive options that fit on one row should not cost a click to see. Default is Fast (matches the app\'s own selected option).'],
      ['demoted', 'DETAIL 2 — The long neural-NR explanation and the High Strength caveat both move to ⓘ tooltips. "High-tier noise reduction only applies to RAW files" — the specific line the feedback named — is folded into the first of those.'],
      ['moved', 'Deconvolution arrives here from its own rail section (spec D2) and sits below Lens correction, since it is the last sharpening-adjacent step.'],
      ['moved', 'COLOR 1 rule applied — per-section Reset in the header for all three sections, hidden until edited. Each defers to the section\'s own existing reset function (resetNR/resetDeconv), which already has RAW-aware defaults the generic reset does not know about.'],
      ['kept', 'Denoise now / Cancel / the progress bar, and the High Strength slider — all conditionally shown only when RAW NR is High, exactly as the app already gates them. An earlier draft of this proposal both invented placeholder sliders in place of the real ones AND separately cut this whole job-UI as "belongs to a progress state" without actually keeping it anywhere — caught and fixed before implementation: it is real, necessary UI, not something to remove.'],
      ['kept', 'The Sparkle-optimized RAW (AHD demosaic) toggle and its hint — missing entirely from an earlier draft.'],
      ['kept', 'The permanent "Tames RAW sensor noise..." caption at the bottom of Noise reduction, and Sharpen\'s real id (sl-adj-sharp — it is a Basic Adjustments slider relocated into this panel by the app already, not an NR-owned one).'],
      ['kept', 'Lens correction shows every real control: Auto (lens profile) toggle, Distortion, Vignette, Chromatic aberration, Vertical, Horizontal, Rotate, Scale, Defringe, plus Manual lens + Focal length folded into a disclosure since both are hidden by default (EXIF auto-detect covers almost every lens). An earlier draft replaced this whole section with three invented placeholder sliders that do not exist in the app.'],
      ['kept', 'Deconvolution\'s own explanatory paragraph, verbatim (it is short enough to stay inline rather than move to a tooltip).'],
    ],
  },

  // ══ FILM ═══════════════════════════════════════════════════════════════════════════════
  film: {
    html: [
      sec('Film grain', {
        edited: true, reset: 'one',
        body: sl('Amount', 30, 0, 100) + field('Film format', select('65mm — fine'))
          + sl('Size', 3, 1, 20) + sl('Grain motion', 75, 0, 100) + sl('Gate weave', 0, 0, 100) + sl('Film breath', 0, 0, 100),
      }),
      sec('Halation', {
        on: false, reset: 'one',
        body: sl('Amount', 70, 0, 100) + sl('Radius', 6, 2, 40)
          + sl('Shadow protect', 0, 0, 100, 'Keeps dark areas (eyes, nostrils, deep shadows) from flooding red. 0 = full film behaviour.')
          + `<div class="cb-row"><button class="sw"></button><span>White glow</span><button class="info-i" title="Neutral white halation instead of the warm film glow — best for black-and-white photos.">i</button></div>`
          + `<div class="cb-row"><button class="sw"></button><span>No remjet</span><button class="info-i" title="Film with no anti-halation backing — much stronger, bloomier halos with a yellow to orange to red edge.">i</button></div>`
          + `<div class="cb-row"><button class="sw"></button><span>Extreme</span><button class="info-i" title="The no-remjet glow pushed roughly 5-6x stronger, for a heavy stylised bloom. Implies No remjet.">i</button></div>`,
      }),
      sec('Bloom', { on: false, reset: 'one', body: sl('Amount', 40, 0, 100) + sl('Threshold', 10, 2, 60) + sl('Radius', 12, 2, 50) }),
      sec('Film artifacts', {
        on: false, reset: 'one',
        body: sl('Dust', 30, 0, 100) + sl('Scratches', 20, 0, 100) + sl('Light leak', 0, 0, 100)
          + field('Dust colour', seg(['Both', 'Black', 'White'], 0))
          + `<button class="wide-btn">${icon('M3 12a9 9 0 1 0 3-6.7M3 4v5h5', ' stroke-width="2" fill="none"')}Re-roll</button>`,
      }),
      sec('Vignette', { on: false, reset: 'one', body: sl('Amount', 50, 0, 100) }),
    ].join('\n'),
    changes: [
      ['moved', 'FILM 2 — Film format moves to the top of Film grain, directly under Amount. It sets what the other four sliders mean, so it belongs above them rather than buried after Film breath.'],
      ['cut', 'FILM 1 — "Re-roll the random dust/scratch/leak placement" becomes "Re-roll". The explanation is in the section it sits in.'],
      ['merged', 'Dust colour\'s Both / Black / White chips become an equal-width segmented control, under a real label — previously three bordered chips of different widths with no label saying what they applied to.'],
      ['moved', 'COLOR 1 rule applied — five "Reset this section" buttons removed, replaced by one header control per section, hidden until edited. Film grain is shown edited.'],
      ['kept', 'All five sections stay in the app\'s existing pipeline order: grain, halation, bloom, artifacts, vignette. That order mirrors the actual render pipeline (CLAUDE.md §3) and changing it in the UI would misrepresent what the app does.'],
      ['kept', 'Halation now shows every real control (Amount, Radius, Shadow protect, White glow, No remjet, Extreme) — an earlier draft replaced it with three invented placeholder sliders (Strength/Radius/Threshold) that do not exist in the app. Caught and fixed before implementation.'],
    ],
  },

  // ══ FRAME ══════════════════════════════════════════════════════════════════════════════
  frame: {
    html: [
      sec('Border', {
        edited: true, reset: 'one',
        // Real ids/defaults, verified against chromasmith-22.html: cl-b1 (Inner) is #000000 at
        // thickness 1%, cl-b2 (Outer) is #ffffff at thickness 2% — an earlier draft swapped
        // Inner/Outer's colours AND invented #101014 for one of them. Real order is Inner
        // first, then Outer (matches the app's own section headings); this proposal keeps that
        // order and only reorders colour-before-thickness WITHIN each, which is what FRAME 1
        // actually asked for.
        body: swatchRow('Inner colour', '#000000') + sl('Inner thickness', 1, 0, 10)
          + swatchRow('Outer colour', '#ffffff') + sl('Outer thickness', 2, 0, 10)
          + field('Style', select('None'))
          + field('Edge text', `<input class="txt" value="" placeholder="e.g. KODAK PORTRA 400   12A">`),
      }),
      sec('Canvas', {
        on: false, reset: 'one',
        body: ratioList([
          { label: 'Fit', sel: true, val: 'no matte' },
          { label: '1:1' }, { label: '4:5' }, { label: '3:4' }, { label: '4:3' },
          { label: '9:16' }, { label: '16:9' }, { label: '3:2' }, { label: '2:3' },
        ]) + sl('Zoom', 100, 50, 150)
          + `<div><span class="fieldlabel">Background</span><div class="swatchgrid">
              <button class="chipsw" style="background:#000"></button><button class="chipsw" style="background:#fff"></button>
              <button class="chipsw" style="background:#141414"></button><button class="chipsw" style="background:#f5f0e8"></button>
              <button class="chipsw" style="background:#d4903a"></button><button class="chipsw" style="background:#4a5d73"></button>
              <button class="chipsw" style="background:#7a3b3b"></button>
              <button class="chipsw blur" title="Blurred photo">${icon('M9 6 6 9m9-6-3 3M3 21l6-2 8-8-4-4-8 8-2 6Z', ' fill="none" stroke-width="1.6"')}</button>
            </div></div>`
          + swatchRow('Custom colour', '#000000'),
      }),
    ].join('\n'),
    changes: [
      ['moved', 'FRAME 1 — Within each border, colour now sits directly above its own thickness (Inner colour → Inner thickness, then Outer colour → Outer thickness) instead of both thicknesses being grouped separately from both colours. Inner-then-outer order is unchanged — it already matches the app\'s own "Inner border"/"Outer border" section headings.'],
      ['new', 'FRAME 1 — The two colour rows are named Inner and Outer (matching the app\'s own real section headings) instead of both being labelled just "Color", which is unreadable once two dark swatches sit next to each other.'],
      ['merged', 'FRAME 2 — Canvas\'s nine ratio buttons become a Darkroom-style option list: one row each, tick on the selected one, room for a right-hand value. A wrapped grid of nine differently-sized chips was the single worst instance of the ragged-chip problem in the app. Labels are the app\'s real bare ratios (CV_ARS) — an earlier draft invented suffixes ("4:5 Instagram", "3:4 Classic", "3:2 35mm") the app does not have; caught and fixed before implementation.'],
      ['kept', 'Canvas background stays the real 7-colour swatch grid plus the blurred-photo option (CV_BGS), now with a separate Custom colour swatch alongside it for the one-off picker (cl-canvas-bg) that was missing from an earlier draft.'],
      ['new', 'The colour swatches gain a hex readout and grow to 28px, clearing the pointer-target floor test/ui_audit.mjs enforces (the current 32×22 fails on height).'],
      ['moved', 'COLOR 1 rule applied — Reset in the header, hidden until edited. Border is shown edited.'],
    ],
  },

  // ══ CROP ═══════════════════════════════════════════════════════════════════════════════
  crop: {
    html: [
      secPlain('Aspect ratio', {
        edited: true, reset: 'one',
        body: `<div class="orient">${seg(['Portrait', 'Landscape'], 0)}</div>`
          + ratioList([
            { label: 'Free', sel: true, icon: icon('M9 3H5a2 2 0 0 0-2 2v4M15 3h4a2 2 0 0 1 2 2v4M9 21H5a2 2 0 0 1-2-2v-4M15 21h4a2 2 0 0 0 2-2v-4', ' fill="none" stroke-width="2"') },
            { label: 'As shot', val: '2320:3088' },
            { custom: true, label: 'Custom', h: '10', w: '10' },
            { label: '1:1 Square', icon: icon('M4 4h16v16H4z', ' fill="none" stroke-width="2"') },
            { label: '3:2' }, { label: '4:3' }, { label: '5:4' }, { label: '7:5' },
            { label: '16:9 Widescreen' }, { label: '1.414:1 ISO A4' }, { label: '11:8.5 US Letter' },
          ]),
      }),
      secPlain('Transform', {
        body: sl('Straighten', 0, -45, 45)
          + `<div class="iconrow">
              <button class="ibtn2" title="Rotate left">${icon('M3 12a9 9 0 1 0 3-6.7M3 4v5h5', ' fill="none" stroke-width="2"')}</button>
              <button class="ibtn2" title="Rotate right">${icon('M21 12a9 9 0 1 1-3-6.7M21 4v5h-5', ' fill="none" stroke-width="2"')}</button>
              <button class="ibtn2" title="Flip horizontal">${icon('M12 3v18M7 8l-4 4 4 4M17 8l4 4-4 4', ' fill="none" stroke-width="2"')}</button>
              <button class="ibtn2" title="Flip vertical">${icon('M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4', ' fill="none" stroke-width="2"')}</button>
            </div>`
          + field('Grid', select('3×3 (Rule of thirds)'))
          + `<div class="btn2"><button class="wide-btn" style="flex:1">Auto level</button><button class="info-i" title="Finds the dominant horizontal or vertical line and levels the photo to it. Set a region to limit the search.">i</button></div>`
          + `<button class="wide-btn ghost">Set region…</button>`
          + `<button class="wide-btn ghost">Apply to all photos</button>`
          + `<button class="wide-btn primary">Crop</button>`,
      }),
    ].join('\n'),
    changes: [
      ['merged', 'CROP 1 — The eleven real aspect options (matching sel-crop-ar exactly) become the same Darkroom-style list used in Frame. "As shot" carries the photo\'s real pixel ratio on the right, and Custom holds its two number fields inline on its own row instead of a hidden separate row elsewhere in the panel. An earlier draft invented a different eleven ("2:3 35mm", "Instagram", "XPan"…) that do not exist in the app — caught and fixed before implementation.'],
      ['moved', 'Orientation becomes a Portrait | Landscape segmented control at the top of the list. Today it is a single "Swap portrait/landscape" button — a real, labelled control, not an unlabelled one as an earlier draft of this entry claimed — that flips the current ratio (e.g. 3:2 ↔ 2:3); the segmented control makes that state visible instead of it living only inside a click.'],
      ['merged', 'Rotate left/right and flip horizontal/vertical become one icon row. Four bordered text buttons of four different widths was the second-worst ragged-chip row after Canvas.'],
      ['demoted', '"Finds the dominant horizontal or vertical line and levels the photo…" becomes an ⓘ on the Auto level button. "Clear region" folds into the Set region control rather than standing as its own button.'],
      ['cut', 'The separate Aspect dropdown. It listed the same ratios as the chips did — two controls for one choice.'],
      ['kept', 'Straighten\'s ±45 range and the grid options.'],
      ['kept', 'The "Crop" primary action button (id=btn-crop) and "Apply to all photos" (batch action, shown only when more than one photo is loaded) — an earlier draft dropped the Crop button entirely, the same class of miss as Retouch\'s dropped paint-toggle. Caught before implementation.'],
    ],
  },

  // ══ RETOUCH ════════════════════════════════════════════════════════════════════════════
  retouch: {
    html: [
      sec('Retouch', {
        edited: true, reset: 'one',
        body: field('Mode', seg(['Heal', 'Clone'], 0), 'Heal blends the copied area into the surrounding colour. Clone copies it exactly.')
          + sl('Size', 4, 1, 20) + sl('Feather', 50, 0, 100) + sl('Opacity', 100, 10, 100)
          + `<button class="wide-btn primary">${icon('M9 6 6 9m9-6-3 3M3 21l6-2 8-8-4-4-8 8-2 6Z', ' fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"')}Retouch</button>`
          + `<p class="hint">No spots yet — click a blemish to remove it. Shift-drag to pick the source yourself.</p>`
          + `<button class="wide-btn ghost">Clear all spots</button>`,
      }),
    ].join('\n'),
    changes: [
      ['merged', 'Mode\'s "Heal (blend color)" / "Clone (copy exactly)" dropdown becomes a Heal | Clone segmented control with the explanations on an ⓘ. Two options never justify a dropdown.'],
      ['cut', 'RETOUCH 1 — "Undo spot" is removed here rather than restyled. You asked for a "delete spot" with a selection instead, which is a real interaction change (pick a spot on the photo, then remove it) rather than a layout one — it is on the backlog, not in this proposal. Until it lands, undo is still ⌘Z.'],
      ['moved', 'COLOR 1 rule applied — Reset in the header, hidden until edited.'],
      ['kept', 'The "Retouch" paint-mode toggle — the tool\'s actual primary action, styled here as the one filled button in the panel since everything else (Mode, sliders) only configures what it does. An earlier draft of this proposal silently dropped it; caught before implementation.'],
      ['kept', 'The spot-count status line ("No spots yet…") as a plain caption, not an info button — it is live status, not documentation.'],
      ['kept', 'Size, Feather and Opacity ranges and defaults; "Clear all spots" stays as the one destructive action, worded so it cannot be mistaken for the per-spot delete that is coming.'],
    ],
  },

  // ══ MASKS ══════════════════════════════════════════════════════════════════════════════
  // Feedback: split into sections so it stops feeling like you can only make one mask; the mask
  // types have no clear order; the numbered 1/2/3 steps read as a wizard.
  masks: {
    html: [
      secPlain('Masks', {
        body: `<div class="mlist">
            <div class="mrow sel"><span class="grip">${icon('M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01', ' fill="none" stroke-width="2.5" stroke-linecap="round"')}</span><span class="th"></span><span class="nm">Sky</span><span class="chip">Inv</span><button class="eye" title="Mute">${icon('M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z', ' fill="none" stroke-width="2"')}</button></div>
            <div class="mrow"><span class="grip">${icon('M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01', ' fill="none" stroke-width="2.5" stroke-linecap="round"')}</span><span class="th"></span><span class="nm">Radial 1</span><button class="eye" title="Mute">${icon('M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z', ' fill="none" stroke-width="2"')}</button></div>
            <div class="mrow muted"><span class="grip">${icon('M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01', ' fill="none" stroke-width="2.5" stroke-linecap="round"')}</span><span class="th"></span><span class="nm">Skin — Ana</span><button class="eye" title="Unmute">${icon('M3 3l18 18M10.6 10.7a3 3 0 0 0 4.2 4.2M9.9 5.2A9.8 9.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.7A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 3.4-.6', ' fill="none" stroke-width="2"')}</button></div>
          </div>
          <button class="add-btn">${icon('M12 5v14M5 12h14', ' fill="none" stroke-width="2"')}Add mask</button>
          <div class="addmenu">
            <div class="amgrp">Draw</div>
            <div class="amrow"><span class="amic">${icon('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', ' fill="none" stroke-width="2"')}</span>Radial</div>
            <div class="amrow"><span class="amic">${icon('M3 8h18M3 16h18', ' fill="none" stroke-width="2"')}</span>Linear</div>
            <div class="amrow"><span class="amic">${icon('M3 21l6-2 8-8-4-4-8 8-2 6Z', ' fill="none" stroke-width="2"')}</span>Brush</div>
            <div class="amgrp">Detect</div>
            <div class="amrow"><span class="amic">${icon('M3 18a5 5 0 0 1 1-9 6 6 0 0 1 11-2 4 4 0 0 1 5 5 4 4 0 0 1-4 6Z', ' fill="none" stroke-width="2"')}</span>Sky</div>
            <div class="amrow"><span class="amic">${icon('M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0', ' fill="none" stroke-width="2"')}</span>Subject</div>
            <div class="amrow"><span class="amic">${icon('M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0', ' fill="none" stroke-width="2"')}</span>Skin tone</div>
            <div class="amgrp">Range</div>
            <div class="amrow"><span class="amic">${icon('M12 3a9 9 0 1 0 0 18 4.5 4.5 0 0 0 0-9 3 3 0 0 1 0-6Z', ' fill="none" stroke-width="2"')}</span>Colour range</div>
            <div class="amrow"><span class="amic">${icon('M12 3v18M3 12h18', ' fill="none" stroke-width="2"')}</span>Luminance range</div>
            <div class="amrow"><span class="amic">${icon('M4 20h16M7 16V8M12 16V4M17 16v-6', ' fill="none" stroke-width="2"')}</span>Depth range</div>
          </div>`,
      }),
      secPlain('Sky — selection', {
        edited: true, reset: 'one',
        body: `<div class="cov">Covers 34% of the frame</div>`
          + sl('Feather', 50, 0, 100) + sl('Range', 35, 0, 100)
          + `<div class="cb-row"><button class="sw"></button><span>Invert</span></div>`
          + `<div class="btn2"><button class="wide-btn" style="flex:1">Refine edges</button><button class="info-i" title="Snaps the mask's edges to the photo's own boundaries using a guided filter.">i</button></div>`
          + `<div class="combine">${seg(['Add', 'Subtract', 'Intersect'], 0)}</div>`,
      }),
      secPlain('Sky — adjust', {
        edited: true, reset: 'all',
        body: sl('Amount', 70, 0, 100) + sl('Exposure', 0) + sl('Contrast', 0) + sl('Temp', 0) + sl('Saturation', 0) + sl('Texture', 0),
      }),
      secPlain('Overlay', {
        body: field('Show on photo', seg(['Overlay', 'Isolate', 'Selection', 'Off'], 0),
          'Overlay and Isolate draw the shape only. Selection shows the effective weight after the range gates — for a gated mask these can look very different.')
          + sl('Overlay opacity', 75, 10, 100) + `<div class="cb-row"><button class="sw"></button><span>Edge only</span></div>`,
      }),
    ].join('\n'),
    changes: [
      ['moved', 'MASKS — Split into four named sections: the mask list, then the selected mask\'s Selection and Adjust as sections titled with the mask\'s own name ("Sky — selection"), then Overlay. The list is now permanently a list with its own heading, so the panel reads as "these are your masks" rather than "here is the mask".'],
      ['cut', 'MASKS — The numbered 1 / 2 / 3 steps are gone. Selection controls sit flat in their own section; nothing is staged. Steps implied a one-way path through creating a single mask, which is the impression you wanted removed.'],
      ['merged', 'MASKS — The eight mask types are grouped into Draw (radial, linear, brush), Detect (sky, subject, skin tone) and Range (colour, luminance, depth), in that order: what you place by hand, what the app finds for you, what selects by pixel value. The add menu is shown open so the grouping is reviewable.'],
      ['moved', 'MASKS — Add / Subtract / Intersect become a segmented control in the Selection section instead of state tags on the mask row plus entries in the ⋯ menu. How a mask combines with the ones above it is a property of its selection, not a label.'],
      ['new', 'MASKS — A coverage readout ("Covers 34% of the frame") sits at the top of Selection. The app already computes this; it was inside a collapsed group.'],
      ['moved', 'MASKS — Mute becomes an eye on the list row; a visible drag grip replaces the invisible drag affordance. Reordering is load-bearing here (later masks subtract from earlier ones) and nothing on screen said so.'],
      ['cut', 'MASKS — The .msk-rowbar header that repeated the selected mask\'s name. The section titles carry it now, and the list already shows selection.'],
      ['kept', 'Every adjustment slider, the Amount master, Refine edges, Overlay opacity and Edge only. This is a restructuring of the same controls, not a reduction of what a mask can do.'],
      ['kept', 'The real "Show on photo" Overlay/Isolate/Selection/Off control — already a 4-way segmented control in the app, so it maps directly onto the same component used elsewhere in this redesign. An earlier draft of the Overlay section dropped it entirely; caught and fixed before implementation.'],
    ],
  },

  // ══ EXPORT ═════════════════════════════════════════════════════════════════════════════
  export: {
    html: [
      secPlain('Output', {
        body: `<div class="fnrow"><span class="fieldlabel">Filename <button class="info-i" title="Batch tokens: {name} source name, {seq} number in batch, {date} YYYY-MM-DD. Add {nover} to drop the version suffix.">i</button></span><span class="ver">v1.0</span></div>
            <input class="txt" value="photo" placeholder="photo">`
          + field('Format', select('Auto (match source)'))
          + sl('Quality', 99, 80, 100)
          + field('Resize (long edge)', select('Full size'))
          + field('Output sharpening', select('Off'))
          + `<div class="cb-row"><button class="sw"></button><span>HDR (gain map)</span></div>`,
      }),
      secPlain('Watermark', {
        body: `<input class="txt" value="" placeholder="© Your Name">` + sl('Opacity', 55, 10, 100),
      }),
      secPlain('Preset', {
        body: field('Export preset', select('— none —'))
          + `<div class="btn2"><button class="wide-btn ghost">Save current…</button><button class="wide-btn ghost danger">Delete</button></div>`,
      }),
      secPlain('Match series', {
        info: "Batch only. Solves each photo's own exposure and white balance so the set matches the one you're previewing.",
        body: `<div class="btn2"><button class="wide-btn ghost">Match to this photo</button><button class="wide-btn ghost">Clear</button></div>`,
      }),
      secPlain('Export', {
        body: `<div class="scope">${seg(['Current photo', 'All photos'], 0)}</div>
            <button class="wide-btn primary">Export</button>`,
      }),
    ].join('\n'),
    changes: [
      ['new', 'EXPORT 1 — Filename and the v1.0 version badge are here. They were missing from the draft because of a real bug in the extractor, not a design choice: #fx-fname and #exp-wm-text have no type attribute, and input[type=text] does not match an input whose type is only the implied default. Fixed in test/panel_extract.mjs; Export went from 22 controls to 24.'],
      ['moved', 'The panel is split into Output / Watermark / Preset / Export. Today all twenty-four controls sit in one undifferentiated stack, with the actual Export button below eleven buttons that are not it.'],
      ['moved', 'Current photo / All photos becomes a segmented control directly above the Export button, so the scope of what you are about to do is adjacent to the button that does it.'],
      ['demoted', 'EXPORT 3 — The literal "Tokens: {name} {seq} {date}" string is gone; a batch-naming syntax nobody asked to see by default has no business sitting in the panel as visible text. The full explanation moves onto an ⓘ next to the Filename label — an info button never sits on its own line (feedback: MULTIPLE), it is either on a title or on a button, and here it is on the Filename title.'],
      ['cut', 'The "Save all slider settings to localStorage" / "Restore saved slider settings" pair and the Style .json import/export. These are recipe and session actions, not export settings — they belong in the gear menu with the other session commands, which is where "Save the current recipe" already half-lives.'],
      ['cut', 'The two Google Photos buttons ("Sign in", "Set or change your OAuth client ID"). Sign-in belongs to the Google Photos import flow, not to the Export section; the client-ID field is setup, not a per-export choice.'],
      ['kept', 'Match series (Match to this photo / Clear) as its own section, batch-only like today, with the explanation on an ⓘ instead of a standing sentence. An earlier draft of this proposal dropped it entirely; caught and fixed before implementation.'],
      ['kept', 'Every actual export setting: quality, format, resize, sharpening, HDR gain map, watermark text and opacity, presets, and the export/cancel behaviour.'],
    ],
  },

  // ══ INFO ═══════════════════════════════════════════════════════════════════════════════
  // Feedback: needs a real example; needs keyword editing like Get Info; needs faces with tagging.
  info: {
    html: [
      secPlain('Metadata', {
        body: `<div class="exif">
            <div class="erow"><span class="elb">Date</span><span class="eval">Aug 14, 2026</span></div>
            <div class="erow"><span class="elb">Dimensions</span><span class="eval">6000×4000</span></div>
          </div>
          <div class="echips">
            <div class="echip"><span class="eclb">ISO</span><span>400</span></div>
            <div class="echip"><span class="eclb">Aperture</span><span>ƒ/1.8</span></div>
            <div class="echip"><span class="eclb">Shutter</span><span>1/250</span></div>
            <div class="echip"><span class="eclb">Focal</span><span>35mm</span></div>
          </div>
          <div class="exif">
            <div class="erow"><span class="elb">File Name</span><span class="eval">P1010423.RW2</span></div>
            <div class="erow"><span class="elb">Size</span><span class="eval">24.6 MB</span></div>
            <div class="erow"><span class="elb">File Format</span><span class="eval">RW2</span></div>
            <div class="erow"><span class="elb">Lens Model</span><span class="eval">LUMIX S 35mm F1.8</span></div>
            <div class="erow"><span class="elb">Camera Make</span><span class="eval">Panasonic</span></div>
            <div class="erow"><span class="elb">Camera Model</span><span class="eval">DC-S9</span></div>
          </div>`,
      }),
      secPlain('People', {
        body: `<div class="faces">
            <div class="face"><span class="favatar"></span><span>Ana</span></div>
            <div class="face"><span class="favatar"></span><span>Marcus</span></div>
            <div class="face unnamed"><span class="favatar"></span><span>Who is this?</span></div>
          </div>
          <button class="wide-btn ghost">Scan this photo for faces</button>`,
      }),
      secPlain('Keywords', {
        body: `<div class="kws">
            <span class="kw">portrait<b>×</b></span><span class="kw">golden hour<b>×</b></span><span class="kw">lisbon<b>×</b></span>
          </div>
          <input class="txt" value="" placeholder="Add a keyword…">
          <div class="kwsug"><span class="kwlb">Suggested</span><span class="kw sug">rooftop</span><span class="kw sug">summer</span><span class="kw sug">smiling</span></div>`,
      }),
    ].join('\n'),
    changes: [
      ['moved', 'INFO — Reordered to Metadata, People, Keywords: what the camera recorded, then who is in the photo, then how you have tagged it — reference before action, action before your own annotations.'],
      ['new', 'INFO 1 — This is the actual example you asked for. The Metadata rows are exactly what showExif() renders today, in its real order (Date, Dimensions, the ISO/aperture/shutter/focal chip strip, File Name, Size, File Format, Lens Model, Camera Make, Camera Model), filled with representative values — the extraction found only one control here because the panel is almost entirely read-only text, not form controls.'],
      ['new', 'INFO 2 — A Keywords section: existing keywords as removable chips, a plain add field, and a Suggested row. This surfaces plumbing that is already built and shipped on the Library side (keywordsSectionHtml, addKeywordToPhoto, removeKeywordFromPhoto, catalog_keywords, set_keywords) plus the CLIP tag suggestions from ROADMAP R10. No new storage.'],
      ['new', 'INFO 3 — A People section with named face chips, the unnamed "Who is this?" state, and a "Scan this photo for faces" action (tracked as R3/R4 — the button has no wired action yet, and the no-photo-path case still renders nothing). The face plumbing already exists and is registered (fxRenderPeoplePanel → catalog_faces_for_path / catalog_face_crop, main.rs:2119) — it renders nothing unless the photo was opened from the Library AND detection has already run, which is why you have never seen it. The scan row is what makes the no-detection-yet case discoverable; the mockup does not itself explain this, since that is a fact for this review, not shipped UI copy.'],
      ['cut', 'The lone "Reset this section" button — there is nothing in Info to reset.'],
      ['kept', 'The mono preview-info line (#fx-info) and the video variant of the metadata block, which showExif() swaps in for a clip.'],
    ],
  },
};

// Extra CSS the proposals need, injected into every generated page by panel_compare_build.mjs.
// Kept here rather than in the builder so a component and the markup that uses it live together.
export const PROPOSAL_CSS = `
/* Collapsed long-form explanation, closed by default — for real detail worth reading in full
   (exact timing, exact behaviour) rather than a short caveat that fits an ⓘ tooltip. */
.wf .hint-x{border:1px solid rgba(255,255,255,.12);border-radius:var(--radius-sm);margin-top:4px;overflow:hidden}
.wf .hint-x>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:6px;padding:7px 9px;font-size:11px;color:var(--ink-on-dark-muted)}
.wf .hint-x>summary::-webkit-details-marker{display:none}
.wf .hint-x>summary svg{width:13px;height:13px;stroke:var(--ink-on-dark-muted);fill:none;stroke-width:2}
.wf .hint-x>div{padding:0 9px 9px;display:flex;flex-direction:column;gap:10px}
/* Marks a group of controls that only apply in one state of a sibling control (RAW NR = High)
   — a dashed rule reads as "conditional" without needing JS to actually show/hide it here. */
.wf .cond-block{display:flex;flex-direction:column;gap:10px;padding:8px 0 0;border-top:1px dashed rgba(255,255,255,.14)}
/* Reset control: borderless, and only visible once the section has been edited (feedback COLOR 1).
   .grp.edited is the state switch — every proposal shows at least one edited section so the
   rule is visible in review rather than only described. */
.wf .rst{font-size:11px;color:var(--ink-on-dark-muted);cursor:pointer;opacity:0;transition:opacity .15s ease;white-space:nowrap}
.wf .grp.edited .rst{opacity:1}
.wf .rst:hover{color:var(--ink-on-dark)}
.wf .rst i{font-style:normal;opacity:.4;margin:0 3px}
/* Equal-width segmented control — replaces every ragged row of bordered chips. */
.wf .seg{display:flex;background:var(--surface-tile-2);border:1px solid rgba(255,255,255,.14);border-radius:var(--radius-sm);padding:2px;gap:2px}
.wf .seg button{flex:1;height:24px;border-radius:6px;font-size:11px;color:var(--ink-on-dark-muted);background:none;border:none;cursor:pointer;white-space:nowrap}
.wf .seg button.on{background:rgba(255,255,255,.1);color:var(--ink-on-dark)}
.wf .info-i{width:14px;height:14px;border-radius:50%;border:1px solid rgba(255,255,255,.28);background:none;color:var(--ink-on-dark-muted);font-size:9px;font-style:italic;line-height:1;cursor:help;padding:0;vertical-align:middle}
.wf .curve{width:100%;aspect-ratio:1;border-radius:var(--radius-sm);border:1px solid rgba(255,255,255,.12);background:var(--surface-tile-2);position:relative;overflow:hidden}
.wf .curve svg{position:absolute;inset:0;width:100%;height:100%}
/* Colour-mixer bands: the colours themselves, names on the tooltip (feedback COLOR 3). */
.wf .bands{display:flex;gap:4px}
.wf .band{flex:1;height:26px;border-radius:5px;border:1px solid transparent;background:var(--b);cursor:pointer;padding:0}
.wf .band.on{border-color:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.5)}
.wf .wheels{display:flex;gap:10px}
.wf .wheel{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.wf .wheel .disc{width:100%;aspect-ratio:1;border-radius:50%;position:relative;background:conic-gradient(#e05454,#e0c454,#63d17a,#57c9d4,#5b7fe0,#c25fd4,#e05454);box-shadow:inset 0 0 18px 12px var(--surface-tile-1)}
.wf .wheel .disc::after{content:'';position:absolute;left:50%;top:50%;width:7px;height:7px;margin:-3.5px 0 0 -3.5px;border-radius:50%;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.5)}
.wf .wheel .nm{font-size:11px;text-align:center;line-height:1.25}
.wf .wheel .nm em{display:block;font-style:normal;font-size:10px;color:var(--ink-on-dark-muted)}
.wf .swatch-row{display:flex;align-items:center;gap:10px;font-size:12px}
.wf .swatch{width:28px;height:28px;border-radius:var(--radius-xs);border:1px solid rgba(255,255,255,.2);flex:none}
.wf .swatch-row .hex{margin-left:auto;color:var(--ink-on-dark-muted);font-variant-numeric:tabular-nums;font-size:11px}
/* Canvas background swatch grid — real 7-colour palette + blur (CV_BGS), not a dropdown. */
.wf .swatchgrid{display:flex;flex-wrap:wrap;gap:6px}
.wf .chipsw{width:28px;height:28px;border-radius:50%;border:2px solid rgba(255,255,255,.16);cursor:pointer;padding:0;flex:none;display:flex;align-items:center;justify-content:center}
.wf .chipsw.blur{background:linear-gradient(135deg,#8a8a8a,#333)}
.wf .chipsw.blur svg{width:14px;height:14px;stroke:#fff;fill:none;stroke-width:1.6}
/* Darkroom-style option list — replaces grids of ratio chips (feedback FRAME 2 / CROP 1). */
.wf .rlist{border-top:1px solid rgba(255,255,255,.08)}
.wf .rrow{display:flex;align-items:center;gap:8px;min-height:34px;padding:4px 2px;border-bottom:1px solid rgba(255,255,255,.08);font-size:12px;cursor:pointer}
.wf .rrow:hover{background:rgba(255,255,255,.04)}
.wf .rtick{width:14px;flex:none;display:flex}
.wf .rtick svg{width:14px;height:14px;stroke:var(--ink-on-dark);fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
.wf .rrow:not(.sel) .rlb{color:var(--ink-on-dark-muted)}
.wf .rlb{flex:1;min-width:0}
.wf .rval{color:var(--ink-on-dark-muted);font-variant-numeric:tabular-nums;font-size:11px}
.wf .rico svg{width:15px;height:15px;stroke:var(--ink-on-dark-muted);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.wf .rcustom{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--ink-on-dark-muted)}
.wf .rcustom input{width:38px;height:24px;text-align:center;background:var(--surface-tile-2);border:1px solid rgba(255,255,255,.14);border-radius:5px;color:var(--ink-on-dark);font:inherit;font-variant-numeric:tabular-nums}
.wf .rcustom em{font-style:normal;opacity:.6}
.wf .rcustom b{font-weight:400;opacity:.5}
.wf .orient,.wf .combine,.wf .scope{margin-bottom:2px}
.wf .iconrow{display:flex;gap:4px}
.wf .ibtn2{flex:1;height:30px;border-radius:var(--radius-sm);border:1px solid rgba(255,255,255,.14);background:var(--surface-tile-2);display:flex;align-items:center;justify-content:center;cursor:pointer}
.wf .ibtn2 svg{width:15px;height:15px;stroke:var(--ink-on-dark-muted);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.wf .wide-btn,.wf .add-btn,.wf .pick-btn{width:100%;height:30px;border-radius:var(--radius-sm);border:1px solid rgba(255,255,255,.14);background:var(--surface-tile-2);color:var(--ink-on-dark);font-size:12px;display:flex;align-items:center;justify-content:center;gap:7px;cursor:pointer}
.wf .wide-btn svg,.wf .add-btn svg,.wf .pick-btn svg{width:14px;height:14px;stroke:var(--ink-on-dark-muted);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.wf .wide-btn.ghost{background:none}
/* Real token only (--red-oxide, DESIGN 2.md) — no invented lighter tint. --red-oxide itself is
   too dark for readable text on this dark surface, so it washes the background/border instead
   (a translucent tint of the SAME real colour, not a new hue) while the label stays the normal
   ink-on-dark text colour every other button uses. */
.wf .wide-btn.danger{background:rgba(135,15,19,.16);border-color:rgba(135,15,19,.5)}
.wf .wide-btn.primary{background:var(--primary-on-dark);color:#10222a;border-color:var(--primary-on-dark);font-weight:600}
.wf .btn2{display:flex;gap:6px}
.wf .txt{width:100%;height:30px;border-radius:var(--radius-sm);border:1px solid rgba(255,255,255,.14);background:var(--surface-tile-2);color:var(--ink-on-dark);font:inherit;font-size:12px;padding:0 9px}
.wf .cb-row{display:flex;align-items:center;gap:8px;font-size:12px}
/* Masks */
.wf .mlist{display:flex;flex-direction:column;gap:2px}
.wf .mrow{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:var(--radius-xs);cursor:pointer}
.wf .mrow.sel{background:rgba(97,160,175,.16);box-shadow:inset 2px 0 0 var(--primary-on-dark)}
.wf .mrow .grip{width:12px;flex:none;display:flex;cursor:grab}
.wf .mrow .grip svg{width:12px;height:12px;stroke:rgba(255,255,255,.34)}
.wf .mrow .th{width:26px;height:26px;border-radius:var(--radius-xs);border:1px solid rgba(255,255,255,.16);flex:none;background:radial-gradient(circle at 38% 42%,#fff 0 22%,#7a7a7a 34%,#1b1b1d 72%)}
.wf .mrow .nm{flex:1;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wf .mrow .chip{font-size:9px;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-on-dark-muted);border:1px solid rgba(255,255,255,.16);border-radius:3px;padding:1px 4px;flex:none}
.wf .mrow .eye{width:22px;height:22px;flex:none;display:flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer}
.wf .mrow .eye svg{width:13px;height:13px;stroke:var(--ink-on-dark-muted);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.wf .mrow.muted .nm,.wf .mrow.muted .th{opacity:.45}
.wf .addmenu{border:1px solid rgba(255,255,255,.14);border-radius:var(--radius-sm);background:var(--surface-tile-2);padding:5px}
.wf .amgrp{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-on-dark-muted);padding:7px 7px 3px}
.wf .amrow{display:flex;align-items:center;gap:8px;padding:6px 7px;border-radius:5px;font-size:12px;cursor:pointer}
.wf .amrow:hover{background:rgba(255,255,255,.07)}
.wf .amic{width:15px;height:15px;flex:none;display:flex}
.wf .amic svg{width:15px;height:15px;stroke:var(--ink-on-dark-muted);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.wf .cov{font-size:11px;color:var(--ink-on-dark-muted)}
/* Export */
.wf .fnrow{display:flex;align-items:center}
.wf .fnrow .fieldlabel{margin-bottom:0;flex:1}
.wf .ver{font-size:11px;color:var(--primary-on-dark);font-variant-numeric:tabular-nums}
/* Info */
.wf .faces{display:flex;flex-wrap:wrap;gap:6px}
.wf .face{display:flex;align-items:center;gap:6px;padding:3px 9px 3px 3px;border-radius:var(--radius-pill);border:1px solid rgba(255,255,255,.14);font-size:11px}
.wf .face.unnamed{border-style:dashed;color:var(--ink-on-dark-muted)}
.wf .favatar{width:22px;height:22px;border-radius:50%;flex:none;background:radial-gradient(circle at 50% 38%,#c9a68a 0 40%,#6b5344 72%)}
.wf .kws{display:flex;flex-wrap:wrap;gap:5px}
.wf .kw{display:flex;align-items:center;gap:5px;font-size:11px;padding:3px 8px;border-radius:var(--radius-pill);background:rgba(255,255,255,.08)}
.wf .kw b{font-weight:400;opacity:.5;cursor:pointer}
.wf .kw.sug{background:none;border:1px dashed rgba(255,255,255,.2);color:var(--ink-on-dark-muted)}
.wf .kwsug{display:flex;flex-wrap:wrap;align-items:center;gap:5px}
.wf .kwlb{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-on-dark-muted);margin-right:2px}
.wf .exif{display:flex;flex-direction:column}
.wf .erow{display:flex;justify-content:space-between;gap:10px;font-size:11px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.wf .elb{color:var(--ink-on-dark-muted)}
.wf .eval{text-align:right;font-variant-numeric:tabular-nums}
.wf .echips{display:grid;grid-template-columns:1fr 1fr;gap:5px}
.wf .echip{display:flex;flex-direction:column;gap:1px;background:var(--surface-tile-2);border-radius:var(--radius-xs);padding:5px 8px;font-size:12px;font-variant-numeric:tabular-nums}
.wf .eclb{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-on-dark-muted)}
`;
