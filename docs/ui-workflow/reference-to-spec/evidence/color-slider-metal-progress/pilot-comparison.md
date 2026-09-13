# Color Mixer liquid-progress pilot comparison

Scope is deliberately limited to the registry-listed Color Mixer HSL inputs: `#sl-hsl-h`, `#sl-hsl-s`, and `#sl-hsl-l`. No other slider family is styled or scheduled.

| Dimension | MetalForge reference | Chroma pilot | Difference / status |
| --- | ---: | ---: | --- |
| Bar silhouette | 1950 × 262 px, 7.44:1 | Existing compact native HSL range, 16 px interaction height | Intentional compact adaptation; not a geometry match. The visual front is confined to the real track rather than enlarging the control. |
| 0%, 20%, 50%, 100% | Front respectively clips left, progresses, settles centrally, clips right | Test gate records those four canonical range states and captures each when browser execution is available | Pending live capture in this restricted environment. |
| Colour hierarchy | RGB 32,32,35 unfilled; front RGB 80,155,248; core reaches 190,253,254 | Existing `--bdr`/HSL functional track stays visible; Canvas uses `--acc` haze/front and `--txt` core | Token-role mapping is implemented; exact RGB parity is intentionally not claimed. |
| Glow / deformation | Broad attached haze; lobe/pinch evolves while moving | One shared Canvas 2D layer renders an attached radial haze plus two phase-shifted waves; reduced motion removes waves and scheduling | Closest browser-native result; no WebGPU shader parity. |
| Motion | Three differently paced traversals, reversal, endpoint holds | Pointer drag tracks directly; keyboard/programmatic values ease toward the canonical native value; endpoint squash prevents overshoot | Proposed Chroma timing only, not attributed to MetalForge. |

The test command is `node test/color_slider_metal_pilot.mjs`. It checks native Home/End/Arrow and drag behavior, aria-hidden/pointer-events on the decorative Canvas, min/default/max Color-panel widths, clipping, reduced motion, scheduler idling, and p95 draw time against the 1 ms proposed budget. It writes screenshots and numerical output to `test/output/color-slider-metal-pilot/` when a local browser is available.

This environment denied both loopback server binding (`EPERM`) and Chromium Mach-port registration, so live screenshots, motion frames, and browser performance data could not be produced here. This is an environment limitation, not an app result; the source-level prototype and deterministic test gate remain available for an unrestricted run.
