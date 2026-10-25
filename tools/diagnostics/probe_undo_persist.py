#!/usr/bin/env python3
"""Undo / redo / Reset after a look-only edit must rewrite the sidecar (expected: A, B, A, B, empty).
Real-app probe against the sandbox catalog (CS_CATALOG_DIR=/tmp/csbox5k/catalog, see sandbox_bench.py). Sets chromasmith_lib_root to the sandbox
and removes it again at the end (run sandbox_bench.py restore / re-pick the real root afterwards). Exit 1 on failure."""
import sys,time,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('CS_CATALOG_DIR','/tmp/csbox5k/catalog')
import raw_open_bench as rob, raw_bench as rb
t=rob.fresh_start()
E=lambda c,to=120: rb.app_eval(t,c,timeout=to)
import json
E('(async()=>{localStorage.setItem("chromasmith_lib_root","/tmp/csbox5k/photos");await window.chromasmithOpenFolder("/tmp/csbox5k/photos/d5");return 1})()',600);time.sleep(4)
ps=E("Array.from(document.querySelectorAll('[data-path]')).map(e=>e.dataset.path).filter(p=>/\\.jpg$/i.test(p))")
p=ps[4]
E('(async()=>{await window.chromasmithOpenInEditor(%s);return 1})()'%json.dumps(p),300);time.sleep(4)
JS='''(async()=>{const sleep=ms=>new Promise(r=>setTimeout(r,ms));const P=%s;const out=[];
 const side=async()=>{const s=await window.__TAURI__.core.invoke("get_sidecar",{path:P});const j=s.recipe?JSON.parse(decodeURIComponent(escape(atob(s.recipe)))):{};return (j.selects||{})["sel-lut"]||""};
 const pick=async(v)=>{const c=Array.from(document.querySelectorAll("#fx-looks .look-cell")).find(c=>c._lookJob&&c._lookJob.val===v);c.click();};
 const keys=Object.keys(LUT_META).filter(k=>!LUT_FX_DEFAULTS[k]);const A="p:"+keys[0],B="p:"+keys[1];
 await pick(A);await sleep(3200);out.push(["after pick A",await side()]);
 await pick(B);await sleep(3200);out.push(["after pick B",await side()]);
 await fxUndo();await sleep(3200);out.push(["after undo (want A)",await side(),document.getElementById("sel-lut").value]);
 await fxRedo();await sleep(3200);out.push(["after redo (want B)",await side(),document.getElementById("sel-lut").value]);
 await fxResetAll();await sleep(3200);out.push(["after reset (want empty)",await side(),document.getElementById("sel-lut").value]);
 return JSON.stringify(out)})()'''%json.dumps(p)
out=json.loads(E(JS,300)); print(out)
want=["p:a_beach_preset","p:astia","p:a_beach_preset","p:astia",""]
ok=[o[1] for o in out]==want
print("PASS" if ok else "FAIL (sidecar after undo/redo/reset != expected)",want)
E('localStorage.removeItem("chromasmith_lib_root")')
sys.exit(0 if ok else 1)
E('localStorage.removeItem("chromasmith_lib_root")')
