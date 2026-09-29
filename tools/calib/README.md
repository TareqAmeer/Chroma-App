# Chromasmith halation/bloom auto-calibration

A standalone optimizer that matches Chromasmith's halation+bloom to Dehancer
**without burning Claude tokens** — once set up, you run one command and it
iterates by itself until the render matches the target.

## Why this replaces hand-tuning
The 17 manual HTML iterations failed because one blurred image had to satisfy
two contradictory needs (thin lines stay bright vs large sources don't blow
up) and gains were guessed by eye. Here:

- `effect.py` reimplements the **exact** shader math in numpy, so converged
  constants transplant straight into the GLSL.
- The blur is **two-stage normalized** (small expand → wide glow): thin lines
  get width before the wide blur so they survive, large sources stay
  energy-bounded. This is the tension that broke every prior version.
- Bloom and halation are fit **independently** against isolated targets, then
  the combined stack is only *validated* — so neither effect corrupts the
  other.

## Inputs (place in repo root)
```
IMG_5774.PNG              clean base / source
dehancer bloom 40.JPG     bloom-only target
dehancer halation 70.JPG  halation-only target
dehancer h 70 b 40.JPG    combined validation target
```

## Run (token-free)
```
pip install numpy pillow scipy
python3 calib/calibrate.py
```
Outputs `calib/params.json` and `preview_*.png` side-by-side
`[source | our render | dehancer]` strips. Re-run anytime; it self-iterates.

## Transplant to the app
The keys in `params.json` map 1:1 to shader uniforms (threshold, film tint
R/G/B, sigma_expand, sigma_glow, gain, inner_warm). Drop them into the GLSL
constants — no eyeballing.
