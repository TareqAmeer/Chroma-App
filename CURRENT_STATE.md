# Current State — Chromasmith Halation Calibration

_Last updated: 2026-06-07, end of v22.1b purple-strength session — holding for user review._

## Objective
Calibrate `chromasmith-22.html`'s halation/bloom WebGL effect to match Dehancer film
emulation reference PNGs — indistinguishable **at a glance**, then refined numerically.

**This session's sub-goal (now COMPLETE, pending review):** close the deferred
purple-strength gap left over from v22.1 (gap-R 0.187 vs Dehancer's 0.325 — presence
was fixed, magnitude was not). The user explicitly approved attempting "a quick
single/two-knob nudge, scorecard-gated" rather than a fuller re-tune.

**Result: fixed.** Added one new term — a "magenta/purple driver" `+bP·min(R,B)`,
`bP=2.10` — to the emission `warmth` formula. Purple gap-R is now **0.327 vs
Dehancer's 0.325** (Δ=+0.002, effectively exact). `calib/scorecard.py` now reports
**0 FAIL rows — ALL PASS** (down from 1 deferred FAIL in v22.1, 3 in the original
committed model). This is model **v22.1b**.

## Decisions Made
- **The new lever is `min(R,B)`, not `bB`.** Read-only validation proved `bB` is
  *provably inert* on this chart's purple swatch `(200,0,200)`: R and B are exactly
  equal, so `max(B−R,0)=0` and bB (an excess-suppressor by construction) cannot
  affect it — confirmed by sweeping bB from 0.97→0.0 and observing bit-identical
  purple emission throughout. A genuinely different driver was required.
- **`min(R,B)` is the chosen driver** because it's a clean "magenta-ness" detector:
  provably zero whenever *either* channel is zero (red/orange/yellow/green have B=0;
  cyan/blue have R=0), so it activates *only* for hues where R and B are both
  present — magenta/purple/pink (and slightly warm/the (255,80,80) "red" thin-line,
  which both carry a small B). This is the same "two emission terms" philosophy
  that underlies the whole model: no single existing term could boost purple
  without also moving some other hue that must stay put.
- **`bP = 2.10`** — chosen by a fine sweep against Dehancer's measured purple gap-R
  (0.325); 2.10 lands at 0.327 (closest achievable given 8-bit blur quantization
  step sizes — 1.90/2.00/2.05 all land at 0.318, 2.10–2.20 at 0.327, 2.30 at 0.336).
- **Validated read-only BEFORE any file edit** (per the standing process rule): swept
  `bP` 0→3.0 through full renders; every other color's gap-R *and* interior-flood-G
  was bit-identical across the entire sweep. Then ran the full scorecard on the
  candidate before touching any file — confirmed 0 FAIL / 0 new-fail / fixes exactly
  the one deferred row — *then* edited `chromasmith-22.html`.
- **All Python tooling kept in sync**: `halmodel.py` (`emit_rule` gained optional
  `bP=0.0` param + full doc-comment explaining both purple-specific terms),
  `scorecard.py` (`P` dict + `emit()`), `validate_v22.py` (`HAL` dict +
  `apply_halation_crop`), `best_params.json` (added `"bP": 2.10"` + updated `_note`).
- **CLAUDE.md updated**: STATUS header now "v22.1b", new "v22.1b fix" subsection
  with full mechanism + validation numbers, model pseudocode formula updated, the
  Phase-B "Remaining ideas" purple item marked `~~struck through~~` as FIXED.

## Open Issues
- **A second instance of the backtick-in-GLSL-comment bug was introduced AND caught
  in this same session.** While writing the `bP` doc-comment I used `` `max(B-R,0)=0` ``
  (markdown-style inline-code backticks) inside a `//` GLSL comment that lives inside
  a JS template literal — the exact same bug class that broke the entire page in the
  prior session (then: `` `R - bB*B` ``). This time it was caught **immediately**
  (within the same edit-test cycle) because this session reloads the live page in a
  real browser after every shader-source change — not just at the end. Fixed by
  switching to double-quotes (`"max(B-R,0)=0"`). **Verified clean**: page loads,
  logs "WebGL2 ready + float buffers" / "Chromasmith ready", halation toggle enables
  without error, `gl.getError()===0`, zero page-originated console exceptions.
  → CLAUDE.md's STATUS section now documents BOTH instances explicitly as a
  "lesson reinforced twice" — **never use backticks or `${` inside a GLSL comment
  inside a JS template literal; reload the live page after every shader edit, even
  comment-only ones.**
- **Two Phase-B items remain explicitly deferred** (NOT touched this session, still
  documented in CLAUDE.md, scorecard still flags as PASS-but-could-be-stronger):
  gray80 bar gap halo (0.431 vs 0.604) and cool-edge halo strength (user point #5).
  The bP change did not move either (confirmed bit-identical in the scorecard).
- **Nothing has been committed or pushed.** Working tree now also has: modified
  `CLAUDE.md`, `chromasmith-22.html`, `calib/{halmodel,scorecard,validate_v22}.py`,
  `calib/best_params.json`; new `CURRENT_STATE.md`; new render/diagnostic PNGs
  (`cmp_v22_1b_*.png`, `zoom_purple_review*.png`) plus older untracked diagnostic
  PNGs/JSONs from earlier rounds that still need triage before any commit.

## Next Steps
1. **Report results to the user** (this is the natural next message): purple
   strength fixed (0.187→0.327, target 0.325), scorecard 0 FAIL/ALL PASS, harness
   shows no PASS-zone regression (3/4/6 still 0.041/0.040/0.036), visual confirmation
   via `calib/zoom_purple_review_v22_1b.png`, and the self-caught-and-fixed second
   backtick bug (transparency about an error introduced and immediately corrected).
2. **Hold for explicit user review/approval before any commit or push** to
   `claude/magical-fermat-VIryB` — per standing process. Do not commit proactively.
3. **If/when approved to commit**: first triage the untracked diagnostic PNGs/JSONs
   (many are stale from abandoned experiment rounds — `best_params_r2.json`,
   `cmp_rule_r2_*.png`, `optimize_hal2.py`-era files) — ask the user which to keep.
4. **Do NOT start on gray80/cool Phase-B items** unless the user explicitly asks —
   they remain deferred by the user's own scope choice, and a `kW`/`kC` change to
   help them could move purple/red again, requiring the same gate-then-edit rigor.
