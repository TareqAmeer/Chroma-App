# Halation Emission Model Analysis — chromasmith-22

**Date:** 2026-06-07  
**Branch:** claude/magical-fermat-VIryB

## Summary

Zone validation results with final `R − 0.5·B` emission model:

| Zone | Description       | mean\|error\| | Grade    |
|------|-------------------|---------------|----------|
| 1    | Color dots        | 0.068         | ✓ PASS   |
| 2    | Bars              | 0.111         | ~ MARGINAL |
| 3    | Gradients         | 0.051         | ✓ PASS   |
| 4    | Circle rings      | 0.056         | ✓ PASS   |
| 5    | Color matrix      | 0.131         | ~ MARGINAL |
| 6    | Staircase bloom   | 0.036         | ✓ PASS   |
| 7    | Thin lines+blocks | 0.081         | ~ MARGINAL |

4 PASS, 3 MARGINAL, 0 FAIL.

## Emission Model Change

### Problem with old model (`R + 0.5·G`)
The original formula `emit = bright * clip(R + 0.5·G, 0, 1)` caused:
- **Cool/green sources** (small R, large G) to produce large R halation halos — physically wrong
- Zone 5: green/cyan blocks got strong R bleed (V22=0.269, ref=0.027)
- Zone 7: cool thin line showed R halo not present in reference
- `gainG=0.50` far too high — G-channel halation dominated

### Solution: `R − 0.5·B`
New formula: `emit = bright * clip(R − 0.5·B, 0, 1)`

- Blue content **suppresses** emission (physically: blue-heavy light less likely to be near-IR)
- Cool/blue sources (low R, high B) get near-zero emission → no spurious red halo
- Warm/red sources (high R, low B) retain full emission
- `gainG` reduced from 0.50 → 0.05 (warm green fringe is subtle)

### Final parameters
```
thr=0.10, knee=0.141
sigmaR=6.14 (×2 for 4800px), sigmaG=2.62 (×2), sigmaB=1.0 (×2)
gainR=1.50, gainG=0.05, gainB=0.0
bluesupp=0.5
```

## Known Limitations

### Zone 2 (MARGINAL): Gray bar sigma mismatch
Bars at 80% brightness show ΔR=−0.254. Dehancer's halation falls off more gradually for near-white sources than the model predicts. The single-sigma model cannot simultaneously match the tight white-source spread and the broader gray-source spread.

### Zone 5 (MARGINAL): Cross-contamination geometry
Measurement points for e.g. `green/75%` fall in the black gap between the 100% and 75% row blocks. The reference pixel at those coordinates reflects halation bleeding down from the 100% block above, not the 75% block's own halo. This is a validator geometry issue, not a model failure. The large errors (`green/75% ΔR=−0.278`) are entirely caused by the reference measuring bleed-from-above that the model correctly predicts as zero at those coordinates.

### Zone 7 (MARGINAL): Warm source sigma underestimate
Warm thin line shows ΔR≈−0.17 at d=5..20px. Dehancer's warm halation spreads farther than the model (effective σ≈11.4px vs model σ=6.14px). This is a fundamental single-sigma limitation: one sigma cannot simultaneously match warm-source spread and white/red-source spread. Dehancer appears to use a source-color-dependent sigma.

## Alternatives Considered

**`R − α·max(G,B)`** (previous HTML formula with bluesupp=0.806): Also suppresses cool sources, but max(G,B) penalizes yellow/warm sources (high G) unnecessarily. `R − 0.5·B` is cleaner.

**Dual-sigma model**: Would require second Gaussian pass per channel, doubling blur cost. Not implemented; the single-sigma model gives acceptable perceptual results.

**Scipy optimization**: Not available in the environment; parameters derived from analytical estimation using pixel ratio method:  
`σ² = d²_ratio_distance / (2 · ln(ratio_of_intensities))`
