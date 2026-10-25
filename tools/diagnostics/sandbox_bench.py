#!/usr/bin/env python3
"""Start the real app against a sandbox catalog (CS_CATALOG_DIR) and a sandbox library root, so benches never touch
the real library. Usage: python3 sandbox_bench.py setup  (starts app, points the library at /tmp/csbox5k/photos, waits for the scan)
The sandbox photos are hardlinks (see docs/plans/perf-quality-progress.md run 3 for how they are generated)."""
import os, sys, time
os.environ.setdefault('CS_CATALOG_DIR', '/tmp/csbox5k/catalog')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import raw_bench as rb, raw_open_bench as rob
ROOT = '/tmp/csbox5k/photos'
SAVED = '/tmp/csbox5k/lib_root.saved'  # the user's chromasmith_lib_root BEFORE the sandbox overwrote it (WebKit storage is shared; HOME=... does NOT isolate it, verified)

def restore(t):
    """Put the user's saved lib root back (or remove the sandbox one if there was none). Run `python3 sandbox_bench.py restore` after every sandbox session."""
    import json
    prev = json.load(open(SAVED)) if os.path.exists(SAVED) else None
    rb.app_eval(t, 'localStorage.removeItem("chromasmith_lib_root")' if prev is None else 'localStorage.setItem("chromasmith_lib_root",%s)' % json.dumps(prev))
    if os.path.exists(SAVED): os.remove(SAVED)

if __name__ == '__main__':
    t = rob.fresh_start()
    if len(sys.argv) > 1 and sys.argv[1] == 'restore':
        restore(t); print('restored'); sys.exit(0)
    import json
    cur = rb.app_eval(t, 'localStorage.getItem("chromasmith_lib_root")')
    if cur != ROOT and not os.path.exists(SAVED): json.dump(cur, open(SAVED, 'w'))  # only the first run records the real value
    print(rb.app_eval(t, '(async()=>{localStorage.setItem("chromasmith_lib_root",%r);const t0=performance.now();await window.chromasmithOpenFolder(%r);return Math.round(performance.now()-t0)})()' % (ROOT, ROOT), timeout=900))
