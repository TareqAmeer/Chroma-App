#!/usr/bin/env python3
"""
One-command verification wrapper — runs every fast wireframe/UI gate and prints a compact
PASS/FAIL table instead of five separate `npm run` invocations each dumping their own full
output. Built 2026-09-08 specifically to cut down round-trips during Library/Editor wireframe
alignment work: every "edit -> rebuild -> run a gate -> read a wall of text -> repeat" cycle
costs a full tool-call-plus-context turn when driven by hand. This script front-loads the
rebuild once, runs every fast gate, and only prints the FAILING gates' output in full — a
passing run is a handful of lines, not five screens.

Usage:
    python3 test/verify.py              # rebuild + all fast gates (~20-30s total)
    python3 test/verify.py --no-build   # skip build-desktop.sh (nothing changed since last run)
    python3 test/verify.py --full       # also run the Playwright behaviour suite (~5-8 min)
    python3 test/verify.py --editor     # also run editor_wireframe_diff.mjs (both themes)
    python3 test/verify.py --tail 40    # show more than the default 20 lines on a failing gate
    python3 test/verify.py --editor-ux  # print test/editor_ux_spec.json as a done/open checklist

Exit code is 0 only if every gate that ran passed — safe to use in a script or as a pre-commit
check the way the existing githooks already do for the individual npm scripts.

Deliberately NOT a replacement for reading a specific gate's full output when you need to act on
a failure — `npm run wireframe:test` etc. still exist and print everything. This is for the
"did anything break" loop, where a one-line PASS per gate is all you need 9 times out of 10.
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# (label, command, extra_env). Ordered fast-to-slow so a quick failure surfaces first.
FAST_GATES = [
    ("lint:ai", ["node", "test/lint_ai_origin.mjs"]),
    ("lint:formats", ["node", "test/lint_formats.mjs"]),
    ("lint:library-content", ["node", "test/lint_library_content.mjs"]),
    ("wireframe:test", ["node", "test/wireframe_inventory.mjs"]),
    ("library:responsive-test", ["node", "test/library_responsive_qa.mjs"]),
    ("mask:test", ["node", "test/mask_raster.mjs"]),
]
EDITOR_GATE = ("editor:wireframe-test", ["node", "test/editor_wireframe_diff.mjs"])
FULL_GATE = ("behaviour:test", ["npx", "playwright", "test", "--config=playwright.config.mjs"])


def print_editor_ux_checklist():
    """Prints test/editor_ux_spec.json as a done/open checklist grouped by category, so 'is item
    3.4.8 finished' is a one-glance answer instead of re-reading the user's original 40-item list
    or re-deriving status from memory. Does not run any gate — pure report."""
    spec_path = ROOT / "test" / "editor_ux_spec.json"
    spec = json.loads(spec_path.read_text())
    items = spec["items"]
    by_cat = {}
    for item_id, d in items.items():
        by_cat.setdefault(d["category"], []).append((item_id, d))
    order = ["bug", "topbar", "context-menu", "library-sidebar", "looks-panel"]
    counts = {"open": 0, "fixed": 0, "backlog": 0}
    for cat in order:
        rows = by_cat.get(cat, [])
        if not rows:
            continue
        print(f"\n{cat}")
        for item_id, d in sorted(rows, key=lambda kv: kv[0]):
            mark = {"open": " ", "fixed": "x", "backlog": "-"}.get(d["status"], "?")
            counts[d["status"]] = counts.get(d["status"], 0) + 1
            print(f"  [{mark}] {item_id:<8} {d['source'][:88]}")
    total = sum(counts.values())
    print(f"\n{counts['fixed']} fixed, {counts['open']} open, {counts['backlog']} backlog  ({total} total)")


def run(label, cmd, tail_lines):
    t0 = time.time()
    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    dt = time.time() - t0
    ok = proc.returncode == 0
    out = (proc.stdout or "") + (proc.stderr or "")
    return {"label": label, "ok": ok, "dt": dt, "out": out, "code": proc.returncode}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-build", action="store_true", help="skip build-desktop.sh")
    ap.add_argument("--full", action="store_true", help="also run the Playwright behaviour suite")
    ap.add_argument("--editor", action="store_true", help="also run editor_wireframe_diff.mjs")
    ap.add_argument("--tail", type=int, default=20, help="lines of output to show for a failing gate (default 20)")
    ap.add_argument("--editor-ux", action="store_true", help="print test/editor_ux_spec.json as a done/open checklist and exit (no gates run)")
    args = ap.parse_args()

    if args.editor_ux:
        print_editor_ux_checklist()
        sys.exit(0)

    # Stray Chromium/preview-server processes from ad-hoc probe scripts (a very real failure
    # mode discovered while building this: 9 leftover processes from earlier one-off debugging
    # sessions caused two gates to fail with page.screenshot/waitForFunction timeouts that had
    # nothing to do with the actual code under test — pure resource contention, wasted a full
    # round-trip to diagnose). Clean up before every run.
    # ⚠️ Match ONLY Playwright's own browser binary path (~/Library/Caches/ms-playwright/...),
    # never a bare "chromium" substring — that also matches unrelated apps embedding Chromium
    # (Adobe Creative Cloud's CEF helper processes matched "chromium" during testing and were
    # nearly killed by an earlier, broader version of this pattern; caught before it shipped).
    subprocess.run(["pkill", "-f", "test/preview_server.mjs"], capture_output=True)
    subprocess.run(["pkill", "-f", "ms-playwright.*headless_shell"], capture_output=True)
    time.sleep(1)

    if not args.no_build:
        print("building desktop/dist/ ...", end=" ", flush=True)
        b = subprocess.run(["bash", "build-desktop.sh"], cwd=ROOT, capture_output=True, text=True)
        if b.returncode != 0:
            print("FAILED")
            print(b.stdout[-2000:] + b.stderr[-2000:])
            sys.exit(1)
        print("ok")

    gates = list(FAST_GATES)
    if args.editor:
        gates.append(EDITOR_GATE)
    if args.full:
        gates.append(FULL_GATE)

    results = []
    for label, cmd in gates:
        print(f"running {label} ...", end=" ", flush=True)
        r = run(label, cmd, args.tail)
        results.append(r)
        print(f"{'PASS' if r['ok'] else 'FAIL'} ({r['dt']:.1f}s)")

    print("\n" + "-" * 60)
    width = max(len(r["label"]) for r in results)
    for r in results:
        status = "PASS" if r["ok"] else "FAIL"
        print(f"  {r['label']:<{width}}  {status:<4}  {r['dt']:6.1f}s")
    print("-" * 60)

    failed = [r for r in results if not r["ok"]]
    if failed:
        for r in failed:
            print(f"\n=== {r['label']} — last {args.tail} lines ===")
            lines = r["out"].splitlines()
            print("\n".join(lines[-args.tail:]))
        print(f"\nRESULT: {len(failed)} of {len(results)} gate(s) FAILED")
        sys.exit(1)

    print(f"\nRESULT: all {len(results)} gate(s) PASSED")
    sys.exit(0)


if __name__ == "__main__":
    main()
