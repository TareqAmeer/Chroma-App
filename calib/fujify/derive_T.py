#!/usr/bin/env python3
"""Derive the look-independent base transform T = STD->VLOG from matched cube pairs.

For a matched look p (present as both STD and VLOG cubes):
    STD_p(x) = VLOG_p( T(x) )   =>   T(x) = VLOG_p^{-1}( STD_p(x) )
STD_p(x) at the lattice x is just the STD cube's stored values. We invert VLOG_p at
those values to get T on the lattice. Three looks over-determine T; we combine by
median and report the per-node spread (the consistency gate).
"""
import os
import numpy as np
import cube_io as C

HERE = os.path.dirname(__file__)
STD_DIR = os.path.join(HERE, "..", "..", "Fujify Luts and XMP")
VLOG_DIR = os.path.join(HERE, "vlog_cubes")

MATCHED = {
    "astia":      ("astia.cube",       "FLog2C_to_ASTIA_VLog.cube"),
    "velvia":     ("velvia.cube",      "FLog2C_to_Velvia_VLog.cube"),
    "classic_neg":("classic_neg.cube", "FLog2C_to_CLASSIC-Neg_VLog.cube"),
}


def derive_T_single(std_lut, vlog_lut):
    """T on the lattice from one matched pair."""
    std_out = std_lut                      # STD_p evaluated at lattice == stored STD cube
    return C.invert_at(vlog_lut, std_out)  # VLOG_p^{-1}(std_out), shape (N,N,N,3)


def load(name):
    std = C.read_cube(os.path.join(STD_DIR, MATCHED[name][0]))["lut"]
    vlog = C.read_cube(os.path.join(VLOG_DIR, MATCHED[name][1]))["lut"]
    return std, vlog


def combine(Ts):
    """Median across looks -> robust T; also return per-node spread (max pairwise)."""
    stack = np.stack(Ts, axis=0)              # (k, N,N,N,3)
    T = np.median(stack, axis=0)
    spread = stack.max(0) - stack.min(0)      # range across looks, per channel
    return T, spread


def main():
    Ts = {}
    for name in MATCHED:
        std, vlog = load(name)
        Ts[name] = derive_T_single(std, vlog)
        print(f"derived T from {name}")
    names = list(Ts)
    T, spread = combine([Ts[n] for n in names])
    sp = C.delta_e_approx(np.zeros_like(spread), spread)  # spread magnitude in dE units
    print("\n3-way T agreement (range across looks, dE-scaled):")
    print(f"  mean={sp.mean():.3f}  median={np.median(sp):.3f}  p95={np.percentile(sp,95):.3f}  max={sp.max():.3f}")
    np.save(os.path.join(HERE, "T.npy"), T)
    print(f"\nsaved T -> {os.path.join(HERE,'T.npy')}  shape={T.shape}")


if __name__ == "__main__":
    main()
