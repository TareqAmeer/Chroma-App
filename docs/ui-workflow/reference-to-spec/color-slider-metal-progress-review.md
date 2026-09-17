# Color slider: liquid-progress reference specification

Status: **draft for approval; no implementation authorised**  
Scope: Color-family sliders only  
Production files changed: **none**

## Evidence and authority

1. **Motion authority:** the supplied 22.767-second screen recording (2096×452, H.264, 1,099 frames; nominal 60 fps).
2. **Static authority:** the supplied 2118×394 screenshot, SHA-256 `c550939dd2a9a99d2d903280b26013b4aad0f3b3f0736a65c8960ca6f6e458fa`.
3. **Supporting evidence only:** the supplied MetalForge URL parameters. They name `progress=52`, `lag=0.55`, `amount=0.085`, `echo=0.055`, `bloom=1`, `jitter=0.3`, `frontIn=-0.12`, `frontOut=0.12`, `pulse=0.28`, and related controls, but do not disclose units, equations, or implementation.
4. **Chroma authority:** `design/tokens.json`, `docs/design-tokens.md`, the slider component contract, and the current native range behavior.

The live reference exposes a locked generated WebGPU shader, so source parity is not available and is not claimed.

## Static specification

| Property | Measured observation | Chroma adaptation |
|---|---:|---|
| Reference canvas | 2118×394 px | No fixed canvas size |
| Main bar bounds | x=55, y=52, w=1950, h=262 px | Preserve the **7.44:1** proportion as a visual target; responsive width |
| Unfilled sample | RGB **32, 32, 35** at (1800,190) | Use Chroma surface tokens, not the sampled MetalForge colour |
| Front sample | RGB **80, 155, 248** at (1068,183) | Use Chroma Slate/Mist action roles; preserve luminance hierarchy, not hue identity |
| Front crop | x=980, y=52, w=175, h=262 px; max RGB 190,253,254 | A narrow white/Mist core plus a wider low-opacity Mist/Slate haze |
| Content placement | Feature block left; percentage right; both vertically centred inside bar | Put the existing Color label/context and current value inside the control surface |
| Copy behavior | Stationary and visually crisp above the animated fill | Real HTML text above the effect; never blur/filter the label, value, or focus ring |
| Corners | Rounded in raster reference | Exact radius is **not measurable**; choose an existing Chroma radius during implementation review |
| Typography | Bold uppercase feature, spaced uppercase support line, large percentage | Preserve Chroma’s SF Pro Text/SF Mono stacks and current type tokens; do not copy unknown MetalForge font metrics |

The screenshot’s broad crop statistics and exact point samples are stored in `docs/ui-workflow/reference-to-spec/evidence/color-slider-metal-progress/`. Crop boundaries are analyst-selected; they are not semantic masks.

## Motion specification

One-second samples from the recording show this visible sequence:

`0, 0, 0, 8, 23, 30, 44, 51, 61, 72, 76, 84, 92, 100, 93, 65, 41, 0, 30, 80, 100, 100, 100%`

This establishes three differently paced traversals and endpoint holds. It does **not** reveal the hidden target signal, so `lag=0.55` cannot be converted into an easing duration with confidence.

Required visible behavior:

- The fill boundary follows the displayed value along the bar.
- While moving, the front changes shape continuously: rounded outward lobes alternate with concave pinches. It is not one rigid translated silhouette.
- Deformation strength rises with movement and settles toward a narrower front during idle holds.
- A broad, soft blue haze stays attached behind the bright core. There is **no detached trail**.
- At 0%, the front disappears into the left edge. At 100%, it clips and compresses into the rounded right edge; neither endpoint may overshoot the bar.
- The fill moves behind stationary, crisp HTML content. The percentage reflects the value shown by the visual front.
- Direction reversal must be continuous: no teleport, detached echo, or residual blob.

Recommended Chroma timing for a first implementation candidate (proposal, not measured): direct front tracking during pointer drag; 120–220 ms visual catch-up for programmatic/keyboard changes; 120 ms maximum deformation settle after input stops. These values must be tuned against a recorded side-by-side review and may not be attributed to MetalForge.

## Behavior and accessibility contract

- Keep the current native `<input type="range">` as the focusable, semantic control. Existing pointer, keyboard, Home/End, step, min/max, input/change events, undo/history, and value persistence must remain unchanged.
- The enlarged surface may be a visual wrapper and hit area, but must not create a second control or substitute pointer math for native range behavior.
- The visible percentage is derived from the same canonical value as the range. Non-percentage Color controls require their existing unit/format, not forced `%` text.
- Focus remains a crisp Chroma token ring outside the effect. Labels and values remain exposed to accessibility APIs once, with no duplicate Canvas/SVG announcement.
- Functional Color gradients must retain their meaning. The liquid shading may modulate luminance locally but must not replace hue/saturation information.

## Closest native implementation

Best fit: **native range + HTML copy + a shared panel-level Canvas 2D effect layer**.

- HTML/CSS owns layout, typography, themes, focus, disabled state, and the transparent/native input.
- One Canvas 2D layer draws the visible bars’ fill, attached haze, and procedural front. Two or three phase-shifted low-frequency waves/noise samples are sufficient for the rounded lobe/pinch silhouette; speed controls amplitude and bloom width.
- A single panel-level canvas and one scheduler avoid a WebGL context or SVG filter per slider. This is closer to Chroma’s single-file JavaScript architecture and avoids coupling the control to the image renderer’s WebGL pipeline.
- WebGL is the fallback only if Canvas 2D cannot meet the visual/performance gate. An SVG `feTurbulence`/blur filter is less suitable because animated filter cost and WebKit behavior are harder to bound, and filtering risks softening content unless layers are carefully separated.

## Performance requirements

- One shared `requestAnimationFrame` scheduler; no per-slider perpetual loops.
- Animate only the active slider and any slider completing its short settle. Idle bars render once and stop.
- Cap backing-store device pixel ratio at 2; redraw only on value, theme, size, or active-motion changes.
- No allocations in the per-frame draw path after geometry is prepared; cache gradients/paths where dimensions allow.
- Production acceptance target: p95 effect draw cost **≤1 ms/frame** on the project’s supported desktop baseline, no additional long tasks over 50 ms, and no measurable idle CPU after settle. These are proposed budgets and require live profiling.
- Confirm behavior with the full running Color-panel inventory, not one demo: every visible slider, both themes, min/default/max, keyboard changes, fast reversals, panel resize bounds, and narrow layouts.

## Reduced motion

When `prefers-reduced-motion: reduce` is active:

- snap the front and displayed value directly to the canonical range value;
- disable wave evolution, lag, bloom pulsing, and settle animation;
- retain a static narrow boundary and endpoint compression;
- run no animation frame after the value has been painted.

The recording contains no reduced-motion state; this section is a Chroma requirement, not a measured MetalForge behavior.

## Explicitly not measurable

- Exact lag/easing equation or the units behind any URL parameter.
- Shader/noise functions, frequency spectrum, seed, bloom kernel, or colour-space math.
- Exact corner radius, font family, font metrics, or intended design tokens.
- Pointer/keyboard/accessibility behavior, reduced motion, performance, memory, battery, Safari/WebKit parity, or multi-slider scaling.

## Approval gate

Approval should answer only whether this specification is the correct direction for an isolated implementation prototype. Approval does not authorise production integration. Open choices for the prototype are: enlarged 7.44:1 reference density versus a compact Color-panel adaptation, and whether the effect applies to all Color sliders or only selected primary controls.
