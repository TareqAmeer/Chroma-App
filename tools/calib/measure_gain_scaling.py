"""
Ground-truth test for "halation looks excessive on lower-resolution images": does directly
RENDERING halation at a lower resolution (what FXR.render() does today, sigma scaled by
`sc=w/REF`, gain unchanged) look different from rendering at full native/calibrated resolution
and simply DOWNSCALING the already-graded result?

Those two should agree if the current sigma-only scaling is sufficient. If direct-low-res
rendering is measurably hotter/stronger, that's the actual, content-grounded confirmation of the
bug (and gives the real correction factor) rather than a guess from an isolated synthetic
feature -- an isolated fixed-absolute-pixel-size synthetic dot/line turned out to be a poor
model of real downscaled photo content (see history: an earlier version of this script used a
fixed-radius synthetic dot/line and found glow amplitude DECREASING at low sc, the opposite of
the reported symptom, because a proper photo's fine detail shrinks proportionally with the image
the way LANCZOS resampling shrinks it -- not staying pinned at a fixed pixel size).

Method, using the real calibration chart (calib/IMG_5774_2x.PNG, 4800x6400, matches
calib/scorecard.py's own P constants for FXR.CAL.halation):

  A) "reference" -- render halation at the native calibrated resolution (4800px, sc=2.0,
     exactly what calib/scorecard.py already validates against Dehancer), then LANCZOS-downscale
     the GRADED result to each target width. This is "what it should look like" if the photo had
     been captured/processed at full resolution and merely displayed/exported smaller.
  B) "current app behavior" -- LANCZOS-downscale the SOURCE chart to each target width first
     (simulating an actually-lower-resolution capture, e.g. a smaller-megapixel photo), then
     render halation directly at that width with sigma*sc and gain UNCHANGED -- exactly what
     FXR.render() does today for a real low-resolution photo.

Compare A vs B at matching target widths: same known zone crops (calib/scorecard.py's
zone2/zone5/zone7 pixel coordinates, rescaled by target_width/4800) for halo strength. If B is
measurably hotter than A, derive gainComp(sc) = (A's halo strength) / (B's halo strength) at
each width, fit a closed form, and require gainComp(sc)=1 for sc>=1 (the calibrated point,
where A and B are the same rendering by construction).

Run: python calib/measure_gain_scaling.py   (inside .calibvenv)
"""
import os
import numpy as np
from PIL import Image
import halmodel as H
import scorecard as SC

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE_PATH = os.path.join(ROOT, 'IMG_5774_2x.PNG')
REF = 2400.0  # FXR.CAL.refWidth (1x)
NATIVE_W = 4800  # calibration chart width = 2x REF -> sc=2.0

P = SC.P  # exact shipped halation constants (chromasmith-22.html FXR.CAL.halation)


def resize_srgb(arr, new_w, new_h):
    img = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))
    return np.asarray(img.resize((new_w, new_h), Image.LANCZOS), dtype=np.float32) / 255.0


def render_at_sc(base_srgb, sc, sigma_floor=0.5):
    """Mirrors FXR.render(): sigma = max(floor, sigma1x*sc), gain UNCHANGED (today's behavior)."""
    p = dict(P)
    p['sigmaR'] = max(sigma_floor, P['sigmaR'] * sc)
    p['sigmaG'] = max(sigma_floor, P['sigmaG'] * sc)
    p['sigmaB'] = max(sigma_floor, P['sigmaB'] * sc)
    return SC.render(base_srgb, p, asymmetric=True, highpass=True)


def zone_crop_metrics(img_srgb, w, h, scale):
    """Rescaled versions of scorecard.py's zone2/zone5/zone7 measurements (originally defined
    for the fixed 4800x6400 chart). `scale` = actual_width/4800."""
    def load_scaled(y0, y1, x0=0, x1=None):
        yy0, yy1 = int(round(y0 * scale)), int(round(y1 * scale))
        xx0 = int(round(x0 * scale))
        xx1 = int(round(x1 * scale)) if x1 is not None else w
        yy0, yy1 = max(0, yy0), min(h, max(yy0 + 1, yy1))
        xx0, xx1 = max(0, xx0), min(w, max(xx0 + 1, xx1))
        return img_srgb[yy0:yy1, xx0:xx1]

    # Zone2 white bar gap halo (from CLAUDE.md geometry): gap y~986-1020 region at 2x -- sample
    # a band just past the white bar edge.
    gap = load_scaled(990, 1015, 2400, 4790)
    interior = load_scaled(860, 980, 2400, 4790)
    # Zone7 thin white line halo (2x y=5240), sample a narrow band straddling it.
    line_glow = load_scaled(5230, 5250, 3400, 3800)
    return dict(
        gap_R=float(gap[..., 0].mean()) if gap.size else float('nan'),
        interior_R=float(interior[..., 0].mean()) if interior.size else float('nan'),
        line_R=float(line_glow[..., 0].mean()) if line_glow.size else float('nan'),
    )


def main():
    base_native = np.asarray(Image.open(BASE_PATH).convert('RGB'), dtype=np.float32) / 255.0
    h0, w0 = base_native.shape[:2]
    assert w0 == NATIVE_W, f"expected {NATIVE_W}px wide chart, got {w0}"

    print("Rendering reference at native resolution (sc=2.0, calibrated)...")
    ref_full = render_at_sc(base_native, sc=NATIVE_W / REF)

    widths = [4800, 2400, 1200, 900, 600, 450, 300]
    print(f"\n{'w':>6} {'sc':>6} | {'A gapR':>8} {'B gapR':>8} {'ratio B/A':>10} | "
          f"{'A lineR':>8} {'B lineR':>8} {'ratio B/A':>10}")

    rows = []
    for w in widths:
        sc = w / REF
        aspect_h = int(round(h0 * w / w0))

        # A: reference-graded-then-downscaled
        a_img = resize_srgb(ref_full, w, aspect_h) if w != NATIVE_W else ref_full

        # B: downscale source first, then render directly at that resolution (today's behavior)
        b_src = resize_srgb(base_native, w, aspect_h) if w != NATIVE_W else base_native
        b_img = render_at_sc(b_src, sc=sc)

        scale = w / NATIVE_W
        a_m = zone_crop_metrics(a_img, w, aspect_h, scale)
        b_m = zone_crop_metrics(b_img, w, aspect_h, scale)

        ratio_gap = (b_m['gap_R'] / a_m['gap_R']) if a_m['gap_R'] else float('nan')
        ratio_line = (b_m['line_R'] / a_m['line_R']) if a_m['line_R'] else float('nan')
        print(f"{w:>6} {sc:>6.3f} | {a_m['gap_R']:>8.4f} {b_m['gap_R']:>8.4f} {ratio_gap:>10.3f} | "
              f"{a_m['line_R']:>8.4f} {b_m['line_R']:>8.4f} {ratio_line:>10.3f}")
        rows.append(dict(w=w, sc=sc, ratio_gap=ratio_gap, ratio_line=ratio_line))

    print()
    print("ratio B/A > 1  => rendering directly at that resolution looks HOTTER than the native")
    print("                  render simply displayed/exported smaller (confirms reported bug)")
    print("ratio B/A < 1  => direct low-res rendering looks WEAKER (opposite of reported bug)")
    print("ratio B/A ~= 1 => no meaningful resolution dependence in this metric")


if __name__ == '__main__':
    main()
