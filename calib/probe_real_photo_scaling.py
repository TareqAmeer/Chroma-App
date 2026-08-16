"""
Same "render-full-then-downscale (A) vs render-directly-at-low-res (B)" ground-truth test as
measure_gain_scaling.py, but on REAL photos (HEIC->PNG) instead of the synthetic calibration
chart, using the EXACT shipped two-channel emission model (FXR.CAL.halation,
chromasmith-22.html:6128-6143) including the hue-gated green/yellow driver -- scorecard.py's
model is a simplified single-warmth-driver approximation good enough for chart validation but
not fully representative of a real photo's green-channel behavior.

Measures whole-frame glow energy (not fixed zone crops, since real photos have no known
coordinates) so it generalizes to arbitrary content.

Run: python calib/probe_real_photo_scaling.py /tmp/heic_test/IMG_2851.png [more paths...]
"""
import sys
import os
import numpy as np
from PIL import Image
import halmodel as H

REF = 2400.0
SIGMA_FLOOR = 0.5

P = dict(thr=0.10, knee=0.141, powL=3.9247, kW=1.0028, kC=0.8860, aG=0.1972, bP=2.10, bB=0.9691,
         powLg=3.9247, gA=-1.0, gB=0.15,
         sigmaR=7.5233, sigmaG=2.9672,
         gainR=1.2380, gainG=0.0764)


def emit_two_channel(lin):
    lum = lin @ H.LUM
    bright = H.smoothstep(P['thr'], P['thr'] + P['knee'], lum)
    sat = lin.max(-1) - lin.min(-1)
    white = np.clip(lum, 0, 1) ** P['powL']
    blue_excess = np.clip(lin[..., 2] - lin[..., 0], 0, None)
    magenta = np.minimum(lin[..., 0], lin[..., 2])
    warmth = lin[..., 0] + P['aG'] * lin[..., 1] - P['bB'] * blue_excess + P['bP'] * magenta
    color = sat * np.clip(warmth, 0, None)
    emitR = bright * (P['kW'] * white + P['kC'] * color)

    gate = H.smoothstep(P['gA'], P['gB'], lin[..., 1] - lin[..., 0])
    emitG = bright * (np.clip(lum, 0, 1) ** P['powLg']) * gate
    return emitR, emitG


def render_halation(base_srgb, sc):
    lin = H.s2l(base_srgb)
    emitR, emitG = emit_two_channel(lin)
    sigR = max(SIGMA_FLOOR, P['sigmaR'] * sc)
    sigG = max(SIGMA_FLOOR, P['sigmaG'] * sc)

    def chan(emit, sig, gain):
        b = H.gauss_blur(emit, sig)
        b = np.clip(b - np.clip(emit, 0, 1), 0, None)
        return b * gain

    glowR = chan(emitR, sigR, P['gainR'])
    glowG = chan(emitG, sigG, P['gainG'])
    glow = np.stack([glowR, glowG, np.zeros_like(glowR)], axis=-1)
    graded = H.l2s(np.clip(H.screen(lin, glow), 0, 1))
    glow_amount = np.stack([glowR, glowG, np.zeros_like(glowR)], axis=-1)
    return graded, glow_amount


def resize_srgb(arr, new_w, new_h):
    img = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))
    return np.asarray(img.resize((new_w, new_h), Image.LANCZOS), dtype=np.float32) / 255.0


def probe(path):
    base_native = np.asarray(Image.open(path).convert('RGB'), dtype=np.float32) / 255.0
    h0, w0 = base_native.shape[:2]
    print(f"\n=== {os.path.basename(path)}  ({w0}x{h0}) ===")

    sc_native = w0 / REF
    ref_full, ref_glow_full = render_halation(base_native, sc_native)

    widths = sorted({w0, 2400, 1200, 900, 600, 450, 300}, reverse=True)
    print(f"{'w':>6} {'sc':>6} | {'A glowMean':>11} {'B glowMean':>11} {'ratio B/A':>10} | "
          f"{'A glowP99':>10} {'B glowP99':>10} {'ratio B/A':>10}")

    for w in widths:
        if w > w0:
            continue
        sc = w / REF
        aspect_h = int(round(h0 * w / w0))

        a_glow = resize_srgb(ref_glow_full, w, aspect_h) if w != w0 else ref_glow_full

        b_src = resize_srgb(base_native, w, aspect_h) if w != w0 else base_native
        _, b_glow = render_halation(b_src, sc)

        a_r = a_glow[..., 0]
        b_r = b_glow[..., 0]
        a_mean, b_mean = float(a_r.mean()), float(b_r.mean())
        a_p99, b_p99 = float(np.percentile(a_r, 99)), float(np.percentile(b_r, 99))
        rm = b_mean / a_mean if a_mean > 1e-9 else float('nan')
        rp = b_p99 / a_p99 if a_p99 > 1e-9 else float('nan')
        print(f"{w:>6} {sc:>6.3f} | {a_mean:>11.6f} {b_mean:>11.6f} {rm:>10.3f} | "
              f"{a_p99:>10.6f} {b_p99:>10.6f} {rp:>10.3f}")


if __name__ == '__main__':
    paths = sys.argv[1:]
    if not paths:
        print("usage: python calib/probe_real_photo_scaling.py <photo.png> [more...]")
        sys.exit(1)
    for p in paths:
        probe(p)
