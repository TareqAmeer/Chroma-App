#!/usr/bin/env python3
"""Generate small synthetic PNG fixtures for the export-gate test harness.
No external downloads — pure PIL. Keep each <=300KB, 512x384.
Deterministic (no randomness) so goldens stay reproducible.
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.dirname(os.path.abspath(__file__))
W, H = 512, 384


def gen_gradient():
    """Smooth tone gradient — exercises tone curve / basic adjustments (exposure,
    contrast, WB) on a low-frequency signal with no hard edges."""
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        for x in range(W):
            r = int(255 * (x / (W - 1)))
            g = int(255 * (y / (H - 1)))
            b = int(255 * (1 - (x / (W - 1) + y / (H - 1)) / 2))
            px[x, y] = (r, g, b)
    img.save(os.path.join(OUT, "gradient.png"), optimize=True)


def gen_chart():
    """Solid color blocks + a bright white edge on black — exercises halation/
    bloom/grain (needs saturated colour + a strong bright/dark edge)."""
    img = Image.new("RGB", (W, H), (10, 10, 10))
    d = ImageDraw.Draw(img)
    blocks = [
        ((255, 40, 40), 0),
        ((40, 220, 60), 1),
        ((40, 90, 255), 2),
        ((230, 210, 40), 3),
        ((230, 40, 230), 4),
        ((40, 220, 220), 5),
    ]
    bw = W // len(blocks)
    for color, i in blocks:
        d.rectangle([i * bw, 0, (i + 1) * bw - 1, H // 2 - 1], fill=color)
    # bright white edge/bar against black lower half for halation
    d.rectangle([0, H // 2, W - 1, H - 1], fill=(5, 5, 5))
    d.rectangle([W // 4, H // 2 + 40, W // 4 + 60, H // 2 + 100], fill=(255, 255, 255))
    d.rectangle([W // 2, H // 2 + 40, W - 40, H - 40], fill=(255, 255, 255))
    img.save(os.path.join(OUT, "chart.png"), optimize=True)


def gen_portrait_like():
    """Mid-tone flat block with a soft-edged bright disc — a cheap stand-in for a
    skin/eye scenario (basic adjust + local contrast) without needing a real photo."""
    img = Image.new("RGB", (W, H), (180, 140, 120))
    d = ImageDraw.Draw(img)
    d.ellipse([W // 2 - 70, H // 2 - 70, W // 2 + 70, H // 2 + 70], fill=(250, 235, 210))
    d.ellipse([W // 2 - 20, H // 2 - 20, W // 2 + 20, H // 2 + 20], fill=(40, 30, 25))
    img.save(os.path.join(OUT, "portrait.png"), optimize=True)


def gen_orientation_portrait():
    """TALLER-than-wide (384x512) — every existing fixture above is 512x384 (landscape
    orientation, "portrait.png" just means "portrait-like content"), so no fixture actually
    exercises a portrait-ORIENTED photo (crop/rotate/canvas aspect logic). Added for
    docs/ui-workflow/STATE.md's layout-matrix scenario states."""
    w, h = 384, 512
    img = Image.new("RGB", (w, h), (150, 130, 150))
    d = ImageDraw.Draw(img)
    d.ellipse([w // 2 - 70, h // 2 - 100, w // 2 + 70, h // 2 + 40], fill=(250, 235, 210))
    d.rectangle([0, h - 60, w - 1, h - 1], fill=(60, 50, 70))
    img.save(os.path.join(OUT, "orientation_portrait.png"), optimize=True)


def gen_orientation_panorama():
    """Very wide (1600x400, 4:1) — no fixture with a panorama aspect ratio existed."""
    w, h = 1600, 400
    img = Image.new("RGB", (w, h))
    px = img.load()
    for x in range(w):
        t = x / (w - 1)
        r = int(40 + 180 * t)
        g = int(120 + 60 * (1 - abs(t - 0.5) * 2))
        b = int(200 - 160 * t)
        for y in range(h):
            px[x, y] = (r, g, b)
    d = ImageDraw.Draw(img)
    d.rectangle([0, h - 40, w - 1, h - 1], fill=(20, 20, 25))
    img.save(os.path.join(OUT, "orientation_panorama.png"), optimize=True)


if __name__ == "__main__":
    gen_gradient()
    gen_chart()
    gen_portrait_like()
    gen_orientation_portrait()
    gen_orientation_panorama()
    for f in ("gradient.png", "chart.png", "portrait.png", "orientation_portrait.png", "orientation_panorama.png"):
        p = os.path.join(OUT, f)
        print(f, os.path.getsize(p), "bytes")
