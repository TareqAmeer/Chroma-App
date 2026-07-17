# Chromasmith-22 Halation/Bloom Analysis

## High-Level Picture

We are matching chromasmith-22.html halation+bloom to Dehancer reference PNGs.
All testing uses the **2x images** (4800×6400): `IMG_5774_2x.PNG`, `dehancer halation x2.png`, `dehancer bloom x2.png`.

---

## What We Measured (Raw Dehancer Pixel Data)

### Zone 7 thin lines — glow at d=5px above each line (x=2400, center)

| Source color | sRGB | R_lin | G_lin | Dehancer R | Dehancer G |
|---|---|---|---|---|---|
| white  | (255,255,255) | 1.00 | 1.00 | 0.396 | 0.020 |
| warm   | (255,160,80)  | 1.00 | 0.35 | 0.596 | 0.078 |
| cool   | (80,160,255)  | 0.09 | 0.35 | 0.027 | 0.016 |
| red    | (255,80,80)   | 1.00 | 0.09 | 0.349 | 0.000 |

### Zone 5 color matrix — glow at d=4px above 100% brightness row

| Source | sRGB | Dehancer R |
|---|---|---|
| red    | (255,0,0)   | ~0.620 (d=4px from 100% cell) |
| green  | (0,200,0)   | ~0.000 |
| cyan   | (0,200,200) | ~0.000 |
| yellow | (200,200,0) | ~0.620 |
| purple | (200,0,200) | ~0.620 |
| white  | (255,255,255)| ~0.620 |

---

## Key Findings

### Finding 1: The G channel SUPPRESSES the R halation

Comparing warm vs red (both have R_lin=1.0, same B_lin≈0.09):
- warm (G=0.35): Dehancer R = 0.596
- red  (G=0.09): Dehancer R = 0.349

More G → stronger R halation. This is counterintuitive but matches the data.
Explanation: this is the AMBER tint of real film halation. The warm color has more
green channel content, and when blurred with the wide red Gaussian, the combination
creates a stronger apparent R reading at the measurement point because green content
also contributes to what the R sensor sees (after the warm tint is applied).

**OR more likely**: Dehancer's halation emission is driven by luminance or "warmth"
of the source, not purely by the R channel. Warm amber has higher perceptual warmth.

### Finding 2: G channel gain is too high

V22 G at d=5 for any source = 0.235. Dehancer max G = 0.078 (warm).
**gainG needs to drop from 0.50 → ~0.10**

### Finding 3: R+0.5*G emission wrongly halates cool sources

Cool (80,160,255): R_lin=0.09, G_lin=0.35.
R+0.5*G = 0.09 + 0.175 = 0.265 → strong R halo.
Dehancer shows R=0.027 → almost nothing.
The model must suppress when B_lin is high.

### Finding 4: Bloom threshold is too high in linear space

At thr=0.10 linear, bloom doesn't start until lum_lin > 0.10.
Step 5 (33% sRGB) has lum_lin ≈ 0.09 < 0.10 → no bloom.
Dehancer shows bloom starting at step 2 (13% sRGB, lum_lin≈0.003).
**Bloom thr needs to be much lower (~0.003-0.01 linear), OR computed in sRGB space.**

---

## Root Causes

### Halation emission model: `clamp(R_lin + 0.5*G_lin, 0, 1)` is wrong because:
1. It gives cool sources too much emission (G_lin=0.35 → +0.175 contribution)
2. It doesn't explain warm > white (both clamped to 1.0)
3. It gives all saturated-R sources identical emission

### Correct emission model (derived from data):
The ordering warm > white > red (all with R=1) AND cool ≈ 0 can be explained by:

**emit = smoothstep_gate × max(R_lin + α*G_lin - β*B_lin, 0)**
where β is large enough to suppress cool (B_lin=1.0) to near zero.

For cool=0: 0.09 + 0.35α - β ≈ 0 → β ≈ 0.09 + 0.35α

For warm > red (same R, same B): 0.35α > 0.09α → α > 0 ✓

For warm > white: (1 + 0.35α - 0.09β) > (1 + α - β)
→ 0.91β > 0.65α → β/α > 0.714

With β = 0.09 + 0.35α and β/α > 0.714:
0.09/α + 0.35 > 0.714 → α < 0.247

So: **0 < α < 0.247** (G adds positively, but modestly)

Best candidate: α=0.15, β=0.09+0.35*0.15=0.143
- warm: 1 + 0.053 - 0.013 = 1.040
- white: 1 + 0.15 - 0.143 = 1.007
- red: 1 + 0.014 - 0.013 = 1.001
- cool: 0.09 + 0.053 - 0.143 = 0 ✓
- green: 0 + 0.087 - 0 = 0.087 (small, acceptable)

**No upper clamp** — allow emit > 1 so warm retains its advantage over white.

---

## Proposed Fixes

### Fix 1: Halation emission formula (GLSL + Python)
```glsl
// Old:
float emit = bright * clamp(lin.r + 0.5*lin.g, 0.0, 1.0);
// New (no upper clamp, subtract B contribution):
float emit = bright * max(lin.r + 0.15*lin.g - 0.143*lin.b, 0.0);
```

### Fix 2: Recalibrate gainR from Zone 7 warm line
From warm R=0.596 at d=5, with corrected emit:
gainR_target ≈ 3.5–5.0 (to be derived empirically)

### Fix 3: Recalibrate gainG downward
From Zone 7: warm G=0.078 at d=5. gainG ≈ 0.10

### Fix 4: Bloom threshold — change to sRGB-space computation OR lower thr
Lower thr from 0.10 → 0.005 linear (equivalent to ~5.7% sRGB)
OR recompute: bright = smoothstep(sRGB_thr, sRGB_thr+knee, sRGB_lum)

---

## Validation Plan — Element by Element

### APPROACH
- Process as crops (not full image) to avoid OOM
- Measure each element independently (its own crop, no neighboring contamination)
- Compare at consistent distances from each source
- After any param change, re-run ALL elements to check for regressions
- Use 2x images throughout

### Zone 1: Color dots (9 elements)
For each dot: white, warm, cool, red, green, blue, yellow, purple, pink
- Crop: ±50px around each dot center
- Measure: R and G glow at d=8px above dot top edge
- Pass: |ΔR| < 0.05, |ΔG| < 0.05

### Zone 2: Bars (7 elements)
For each bar: white100%, gray80, gray60, gray40, gray20, warm, cool
- Crop: ±40px around each bar
- Measure: R and G at 20px above bar top edge, at x=1800px
- Pass: |ΔR| < 0.06, |ΔG| < 0.04

### Zone 3: Gradients (3 elements × 5 x-positions)
- Neutral gray gradient: sample R glow 15px above strip at x=500,1000,1500,2000,2300
- Warm gradient: sample R and G glow 15px above strip
- Bloom: sample R bloom 10px above strip at bright end
- Pass: |ΔR| < 0.05

### Zone 4: Circle rings (4 large rings, each at d=10,20,30px)
- For each ring: crop ±50px around ring top
- Measure: R and G at 3 distances outside the ring
- Pass: |ΔR| < 0.06, |ΔG| < 0.04

### Zone 5: Color matrix (8 colors × 5 brightness = 40 elements)
- For each cell: measure R and G at d=5px above the cell top edge (close to cell)
- Use cell-specific crop to avoid contamination from neighboring rows
- Pass: |ΔR| < 0.06, |ΔG| < 0.04

### Zone 6: Staircase bloom (15 steps)
- For each step: measure R bloom 10px above the staircase strip
- Pass: |ΔR| < 0.04

### Zone 7: Thin lines (4 lines × 4 distances)
- For each line (white/warm/cool/red): measure R and G at d=5,10,20,30px above thin line
- Use tight crop around just that line
- Pass: |ΔR| < 0.06, |ΔG| < 0.04

---

## Lessons from Previous Session (to avoid repeating)

1. **Validate every zone** — previous session only tested zones where model was expected to work
2. **Full-frame side-by-side FIRST** — render the full chart visually before claiming a match
3. **Never inherit assumptions** — re-derive sigma, gain from current data each time
4. **Separate trigger from colour** — brightness triggers halation; the warm colour comes from channel split
5. **RMSE on black-dominated crops is meaningless** — weight only where there's actual glow
6. **Test onset/coverage** — check which brightness STARTS blooming/halating, not just peak
7. **Small crops prevent OOM** — 4800×6400 float32 = ~350MB; process in strips
8. **Check cross-contamination** — when multiple sources are near each other, measure far from neighbors
9. **Don't commit until validated** — the previous session committed first, validated after, and found failures
10. **Each parameter change = re-test all zones** — a fix for Zone 5 can break Zone 7
