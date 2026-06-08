#!/usr/bin/env python3
"""Detect the 4x3 grid in each fujify comparison montage and crop the 12 panels.

Montage structure: white margins/gutters; each panel is an image with a small
centered text label beneath it. We locate content (non-white) bands:
  - columns -> 4 column bands (panels)
  - rows    -> tall content runs are image bands; thin runs are label text (dropped)
Panel (row,col) -> look name via the fixed fujify order.
"""
import os, sys, glob
import numpy as np
from PIL import Image

HERE = os.path.dirname(__file__)
MONTAGE_DIR = os.path.join(HERE, "..", "..", "Fujify Luts and XMP")

# fixed 4x3 order (row-major), confirmed from the pasted grids + landscape sample
ORDER = [
    "Camera Standard", "Astia", "Classic Chrome", "Classic Neg",
    "Eterna Bleach Bypass", "Eterna Cinema", "Nostalgic Neg", "Pro Neg Hi",
    "Pro Neg Std", "Provia", "Reala Ace", "Velvia",
]
NCOLS, NROWS = 4, 3


def _runs(mask):
    """Return list of (start, end_exclusive) for True-runs in 1D bool array."""
    out = []
    i = 0
    n = len(mask)
    while i < n:
        if mask[i]:
            j = i
            while j < n and mask[j]:
                j += 1
            out.append((i, j))
            i = j
        else:
            i += 1
    return out


def _content_range(profile_dark, total, min_frac):
    """Largest run of 'content' (True) in a 1D bool profile; returns (start,end)."""
    rr = [r for r in _runs(profile_dark) if (r[1] - r[0]) > total * min_frac]
    if not rr:
        return (0, total)
    rr.sort(key=lambda r: r[1] - r[0], reverse=True)
    return rr[0]


def detect_grid(img, white=235):
    """Return list of 12 (x0,y0,x1,y1) panel boxes, row-major. Handles both layouts:
    landscape montages have clean dark row-bands; portrait ones are evenly packed."""
    g = np.asarray(img.convert("L"), dtype=np.float64)
    H, W = g.shape
    colb = g.mean(axis=0)
    rowb = g.mean(axis=1)

    # content x-box (trim outer near-white margins), then even-split into NCOLS
    xc0, xc1 = _content_range(colb < white, W, 0.4)
    cols = [(int(xc0 + i * (xc1 - xc0) / NCOLS), int(xc0 + (i + 1) * (xc1 - xc0) / NCOLS))
            for i in range(NCOLS)]

    # rows: prefer detected dark bands (landscape); else even-split content y-box
    dark_row_runs = [r for r in _runs(rowb < white) if (r[1] - r[0]) > H * 0.08]
    if len(dark_row_runs) == NROWS:
        rows = dark_row_runs
    else:
        yc0, yc1 = _content_range(rowb < white, H, 0.4)
        rows = [(int(yc0 + j * (yc1 - yc0) / NROWS), int(yc0 + (j + 1) * (yc1 - yc0) / NROWS))
                for j in range(NROWS)]

    boxes = []
    for (y0, y1) in rows:
        for (x0, x1) in cols:
            boxes.append((x0, y0, x1, y1))
    return boxes


def crop_panels(path, inset=0.04, bottom_inset=0.10):
    """Return dict name -> HxWx3 uint8 array. Insets drop borders/edge bleed; the
    larger bottom inset drops the label strip on evenly-split (portrait) montages."""
    img = Image.open(path).convert("RGB")
    boxes = detect_grid(img)
    arr = np.asarray(img)
    out = {}
    for name, (x0, y0, x1, y1) in zip(ORDER, boxes):
        dx = int((x1 - x0) * inset)
        dy = int((y1 - y0) * inset)
        dyb = int((y1 - y0) * bottom_inset)
        out[name] = arr[y0 + dy:y1 - dyb, x0 + dx:x1 - dx].copy()
    return out


def _contact_sheet(panels, path, cell=180):
    cells = []
    for name in ORDER:
        im = Image.fromarray(panels[name]).resize((cell, cell))
        cells.append((name, im))
    sheet = Image.new("RGB", (cell * NCOLS, cell * NROWS), "white")
    for i, (name, im) in enumerate(cells):
        r, c = divmod(i, NCOLS)
        sheet.paste(im, (c * cell, r * cell))
    sheet.save(path)


def _ac_strength(prof, period):
    p = prof - prof.mean()
    ac = np.correlate(p, p, "full")[len(p) - 1:]
    ac = ac / ac[0]
    return float(ac[period]) if 0 < period < len(ac) else 0.0


def is_montage(path, thr=0.4):
    """True only for genuine 4x3 comparison grids (periodic at W/NCOLS, H/NROWS).
    Excludes the single hero photos that share the folder."""
    g = np.asarray(Image.open(path).convert("L"), dtype=np.float64)
    H, W = g.shape
    return (_ac_strength(g.mean(0), W // NCOLS) > thr and
            _ac_strength(g.mean(1), H // NROWS) > thr)


def list_montages():
    files = []
    for ext in ("*.webp", "*.jpg", "*.jpeg", "*.png"):
        files += glob.glob(os.path.join(MONTAGE_DIR, ext))
    return sorted(f for f in files if is_montage(f))


def main():
    files = list_montages()
    print(f"{len(files)} candidate images in montage dir")
    ok = 0
    dump = "--dump" in sys.argv
    for p in files:
        try:
            panels = crop_panels(p)
            shapes = {k: v.shape for k, v in panels.items()}
            cs = panels["Camera Standard"].shape
            print(f"OK  {os.path.basename(p):55s} CamStd panel {cs[1]}x{cs[0]}")
            ok += 1
            if dump:
                tag = "portrait" if Image.open(p).height > Image.open(p).width else "landscape"
                cs_path = os.path.join(HERE, f"_contact_{tag}.png")
                if not os.path.exists(cs_path):
                    _contact_sheet(panels, cs_path)
                    print(f"   contact sheet -> {os.path.basename(cs_path)}")
        except Exception as e:
            print(f"FAIL {os.path.basename(p):55s} {e}")
    print(f"\n{ok}/{len(files)} montages parsed")


if __name__ == "__main__":
    main()
