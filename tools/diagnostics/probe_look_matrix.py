#!/usr/bin/env python3
"""Look persistence matrix: {p: with LUT_FX_DEFAULTS, p: without, print only, LUT off} x {slider touched before / not} -> sidecar after Editor close.
Real-app probe against the sandbox catalog (CS_CATALOG_DIR=/tmp/csbox5k/catalog, see sandbox_bench.py). Sets chromasmith_lib_root to the sandbox
and removes it again at the end (run sandbox_bench.py restore / re-pick the real root afterwards). Exit 1 on failure."""
import sys,time,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('CS_CATALOG_DIR','/tmp/csbox5k/catalog')
import raw_open_bench as rob, raw_bench as rb
t=rob.fresh_start()
E=lambda c,to=120: rb.app_eval(t,c,timeout=to)
import json
E('(async()=>{localStorage.setItem("chromasmith_lib_root","/tmp/csbox5k/photos");await window.chromasmithOpenFolder("/tmp/csbox5k/photos/d4");return 1})()',600);time.sleep(4)
ps=E("Array.from(document.querySelectorAll('[data-path]')).map(e=>e.dataset.path).filter(p=>/\\.jpg$/i.test(p))")
info=E('JSON.stringify({withDef:Object.keys(LUT_FX_DEFAULTS).slice(0,2),noDef:Object.keys(LUT_META).filter(k=>!LUT_FX_DEFAULTS[k]).slice(0,2),lib:Array.from(document.getElementById("sel-lut").options).map(o=>o.value).filter(v=>v.startsWith("l:")).slice(0,2)})')
print(info); info=json.loads(info)
cases=[]
for k in info['withDef'][:1]: cases.append(('p+defaults','p:'+k,''))
for k in info['noDef'][:1]: cases.append(('p nodefaults','p:'+k,''))
for k in info['lib'][:1]: cases.append(('l: library',k,''))
cases.append(('print only','','kodak_print'))
cases.append(('LUT off','OFF',''))
n=0
res=[]
for touched in (False,True):
  for name,lut,pr in cases:
    n+=1; p=ps[n]
    E('(async()=>{await window.chromasmithOpenInEditor(%s);return 1})()'%json.dumps(p),300);time.sleep(3.5)
    r=E('''(async()=>{const sleep=ms=>new Promise(r=>setTimeout(r,ms));const touched=%s,lut=%s,pr=%s;
     const sel=document.getElementById("sel-lut");
     if(touched){const s=document.getElementById("sl-grain-a");s.value=30;s.dispatchEvent(new Event("input",{bubbles:true}));await sleep(100)}
     if(lut==="OFF"){sel.value="p:"+Object.keys(LUT_META)[2];sel.dispatchEvent(new Event("change",{bubbles:true}));await sleep(2600);sel.value="";sel.dispatchEvent(new Event("change",{bubbles:true}));}
     else if(lut){const cell=Array.from(document.querySelectorAll("#fx-looks .look-cell")).find(c=>c._lookJob&&c._lookJob.val===lut);if(cell)cell.click();else {sel.value=lut;sel.dispatchEvent(new Event("change",{bubbles:true}));}}
     if(pr){const sp=document.getElementById("sel-print");sp.value=pr;sp.dispatchEvent(new Event("change",{bubbles:true}));}
     document.getElementById("lib-side-tab-library").click();await sleep(3800);
     const s=await window.__TAURI__.core.invoke("get_sidecar",{path:%s});const j=s.recipe?JSON.parse(decodeURIComponent(escape(atob(s.recipe)))):{};
     return JSON.stringify({lut:(j.selects||{})["sel-lut"],print:(j.selects||{})["sel-print"],grain:(j.sliders||{})["grain-a"]})})()'''%(json.dumps(touched).lower(),json.dumps(lut),json.dumps(pr),json.dumps(p)),120)
    ok=json.loads(r)
    exp_l='' if lut in('OFF','') else lut
    good=(ok['lut'] or '')==exp_l and (ok['print'] or '')==pr
    print(('PASS' if good else 'FAIL'),'touched' if touched else 'untouched',name,lut,pr,r,flush=True)
E('localStorage.removeItem("chromasmith_lib_root")')

sys.exit(0)
