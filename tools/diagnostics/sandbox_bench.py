#!/usr/bin/env python3
"""Start the real app against a sandbox catalog (CS_CATALOG_DIR) and a sandbox library root, so benches never touch
the real library. Usage: python3 sandbox_bench.py setup  (starts app, points the library at /tmp/csbox5k/photos, waits for the scan)
The sandbox photos are hardlinks (see docs/plans/perf-quality-progress.md run 3 for how they are generated)."""
import os, sys, time
os.environ.setdefault('CS_CATALOG_DIR', '/tmp/csbox5k/catalog')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import raw_bench as rb, raw_open_bench as rob
ROOT = '/tmp/csbox5k/photos'
if __name__ == '__main__':
    t = rob.fresh_start()
    print(rb.app_eval(t, '(async()=>{localStorage.setItem("chromasmith_lib_root",%r);const t0=performance.now();await window.chromasmithOpenFolder(%r);return Math.round(performance.now()-t0)})()' % (ROOT, ROOT), timeout=900))
