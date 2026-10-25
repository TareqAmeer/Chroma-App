#!/usr/bin/env python3
"""Real-app regression: pick a look from the gallery (no slider touched), close the Editor, check the
sidecar on disk holds the look, open another photo, reopen the first -> look still selected.
Needs the sandbox (CS_CATALOG_DIR=/tmp/csbox5k/catalog, see sandbox_bench.py). Saves/restores chromasmith_lib_root.
Usage: python3 probe_look_persist.py [jpg|raf|rw2] [photo_index]   exit 1 on failure."""
import os, sys, time
os.environ.setdefault('CS_CATALOG_DIR', '/tmp/csbox5k/catalog')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import raw_open_bench as rob, raw_bench as rb
t = rob.fresh_start()
E = lambda c, to=120: rb.app_eval(t, c, timeout=to)
ext = sys.argv[1] if len(sys.argv) > 1 else 'jpg'; idx = int(sys.argv[2]) if len(sys.argv) > 2 else 10
saved = E('localStorage.getItem("chromasmith_lib_root")')
ok = False
try:
    E('(async()=>{localStorage.setItem("chromasmith_lib_root","/tmp/csbox5k/photos");await window.chromasmithOpenFolder("/tmp/csbox5k/photos/d0");return 1})()', 600)
    time.sleep(3)
    ps = E("Array.from(document.querySelectorAll('[data-path]')).map(e=>e.dataset.path).filter(p=>/\\.%s$/i.test(p))" % ext)
    p, other = ps[idx], ps[idx + 1]
    op = lambda x: E('(async()=>{await window.chromasmithOpenInEditor(%r);return 1})()' % x, 300)
    op(p); time.sleep(4)
    E("(()=>{document.querySelectorAll('#fx-looks .look-cell')[9].click();return 1})()")
    E('document.getElementById("lib-side-tab-library").click()')  # close immediately
    time.sleep(4)
    disk = E('(async()=>{const s=await window.__TAURI__.core.invoke("get_sidecar",{path:%r});return atob(s.recipe||"")})()' % p)
    print('sidecar has look:', '"sel-lut":"p:' in disk)
    op(other); time.sleep(3); op(p); time.sleep(4)
    cur = E('document.getElementById("sel-lut").value')
    print('reopened sel-lut =', repr(cur))
    ok = '"sel-lut":"p:' in disk and cur.startswith('p:')
finally:
    if saved is not None: E('localStorage.setItem("chromasmith_lib_root",%r)' % saved)
print('PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
