---
name: chromasmith-calib
description: Procedure for tuning the halation/bloom emission model (FXR.CAL.halation) or any calib/ constant against the Dehancer reference. Enforces the order lessons in AGENTS.md §6 — render-and-look before point-samples, a fast all-requirements gate before any long optimization run. Use whenever asked to adjust halation, bloom, grain, or DCP calibration constants, or when a scorecard/optimizer result needs interpreting.
---

# Halation / calibration workflow

This encodes AGENTS.md §6 lessons 1–3, which were each learned expensively. The order below
is not optional — skipping straight to optimization is the mistake that cost the most time on
this project.

## 0. Environment

```bash
python3 -m venv .calibvenv && source .calibvenv/bin/activate   # first time only
pip install -r calib/requirements.txt                          # first time only
```

Needs `calib/IMG_5774_2x.PNG` and `calib/dehancer halation x2.png` (gitignored — ask the user
to supply if missing).

## 1. Baseline the scorecard FIRST, always

```bash
python calib/scorecard.py
```

This is the fast, all-requirements PASS/FAIL gate (gap halo per colour, interior flood,
grey/warm/cool/white bars, thin-line R&G, halo softness) — run it before touching any
constant, so you have a baseline to diff against.

## 2. Render and LOOK before trusting any number

```bash
python calib/render_chart.py
```

Point-sample metrics (`validate_v22.py`) structurally cannot see interior flooding — the most
visible defect to a human eye. Walk the rendered side-by-side against the Dehancer reference
visually, checking flat **interiors** (not just gaps/edges), before trusting any metric.
Prior work done blind on point-samples alone shipped regressions invisible to that metric.

## 3. Validate the mechanism on a few read-only computations before editing files

If you have a hypothesis about a fix (a new term, a different exponent), prove it on a few
point computations first — no file edit, no optimization run. The high-pass glow fix in this
project's history was proven this way (interior flood 0.305→0.000 at identical params, gap R
unchanged) in seconds before any code changed.

## 4. Only THEN run the optimizer, and never on a loss missing a requirement

```bash
python calib/optimize_hal.py     # or calib/optimize_hal_twochannel.py for the two-channel model
```

⚠️ **The optimizer trades away anything not encoded in its loss function.** A prior long
optimization run "improved the loss" while collapsing `gainG→0` (killing the yellow hue gate)
because the loss under-weighted that requirement. Before trusting a multi-minute
Nelder-Mead run, confirm the loss function actually scores every requirement the scorecard
checks — if it doesn't, fix the loss before running it, not after.

## 5. Re-run the scorecard after any constant change

```bash
python calib/scorecard.py
```

Compare BASELINE vs NEW in the table. A constant change that isn't validated against the full
requirement table (not just the one metric you were optimizing) is how regressions like the
gainG collapse above happened.

## Reference

Committed model constants and the physical reasoning behind the emission formula (two-channel
warm-red + hue-gated green, asymmetric blue suppression, magenta driver, high-pass glow) are
in AGENTS.md §5. Read that before changing the model shape, not just the constants — the
"why" there rules out several tempting-looking simplifications that were already tried and
rejected (see the "Two-sigma investigation" subsection for one that looked promising and
wasn't).
