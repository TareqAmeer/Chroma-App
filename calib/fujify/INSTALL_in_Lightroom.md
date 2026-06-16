# Installing the recreated looks in Lightroom Classic

You do **not** need the `.xmp` form — Lightroom Classic 7.3+ imports `.cube` files
directly as profiles (it writes Adobe's internal table itself, and gives you the same
**Amount** slider your fujify presets have).

## Which files to use — RECOMMENDED SET
Use these 7 together (best accuracy per look, validated against the screenshots):
- **`composed_cubes/`** (6 looks) — Classic Chrome, Eterna Bleach Bypass, Eterna
  Cinema, Pro Neg Std, Provia, Reala Ace. Built by composing accurate third-party
  V-Log cubes through a derived STD↔V-Log transform; validated end-to-end on Velvia
  (the one look with full ground truth) at ~1 dE off the best-possible ceiling — and
  it beats the montage fit on most of these looks (see README "Composition" section).
- **`montage_cubes/pro_neg_hi_montage.cube`** (1 look) — Pro Neg Hi has no third-party
  V-Log source, so this best-effort montage fit is the only option for it.

## Fallback / reference sets (lower accuracy, kept for comparison)
- **`montage_cubes/`** — all 7 looks fit directly from the comparison-screenshot
  montages (degree-3 polynomial). Use if a `composed_cubes/` look looks off on your
  own photos.
- **`repo_cubes_std/`** — same third-party V-Log cubes rebased via generic Panasonic
  math instead of the derived transform; darker/more contrasty. Superseded by
  `composed_cubes/` for the same 6 looks.

## Steps
1. Lightroom Classic → **Develop** module.
2. In the **Basic** panel, open the **Profile** dropdown → **Browse…** (Profile Browser).
3. Click the **`+`** at the top-right of the Profile Browser → **Import Profiles…**.
4. Select the `.cube` files (or the whole `montage_cubes` folder). They appear as a new
   group named after the folder.
5. Click a look to apply; drag the **Amount** slider to taste (like fujify's SupportsAmount).
6. Use it on a photo taken/edited with the **Camera Standard** profile — that's the base
   these LUTs were built from.

To save any look as a reusable **preset** afterward: apply the profile (set Amount),
then **Develop → New Preset**, tick *Profile*, save.

## If you specifically need redistributable `.xmp` files
Two routes:
- After importing the `.cube` and setting Amount, **New Preset** → exports a `.xmp` that
  references the imported profile.
- Or Photoshop → **Filter ▸ Camera Raw Filter** → Alt/Option-click the ⋯ menu →
  **Create Profile** → tick *Color Lookup Table*, load the `.cube` → restart Lightroom;
  the profile shows up under Camera Raw settings.
