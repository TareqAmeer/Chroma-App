#!/usr/bin/env python3
"""Cached-open stage bench: opens photos that ALREADY have a persistent decode (A,B,C,A,B,C,...) and
prints where each open's time goes, from the rawPerf events openInEditorInner emits. HDR preview is
toggled per pass (--hdr on|off|both). Files must have been opened/cached once before (this does not
decode them cold — a cold open shows src=decode and is flagged).

    python3 tools/diagnostics/cached_open_bench.py --label before \
        /Volumes/.../P_TM3705.RW2 /Volumes/.../P_TM0525.RW2 /Volumes/.../__TM0032.RW2
"""
import argparse, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import raw_bench as rb  # noqa: E402
import raw_open_bench as rob  # noqa: E402

JS = """(async()=>{window.__rawPerfLog=[];const t0=performance.now();await window.chromasmithOpenInEditor(%s);
const ms=Math.round(performance.now()-t0);const ev=(window.__rawPerfLog||[]);
const fl=ev.find(e=>e.event==='open-fully-loaded');const st=ev.find(e=>e.event==='open-start');const b=st?st.t:t0;
return JSON.stringify({ms,src:fl&&fl.source,ev:ev.filter(e=>/^open-(cache|hdr|display|mark|sidecar|waited|full)/.test(e.event)).map(e=>[e.event,Math.round(e.t-b),e.ms!=null?Math.round(e.ms):null])})})()"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('--hdr', default='both')
    ap.add_argument('--rounds', type=int, default=3)
    ap.add_argument('--label', default='run')
    a = ap.parse_args()
    tok = rob.fresh_start()
    out = {}
    for hdr in (['on', 'off'] if a.hdr == 'both' else [a.hdr]):
        rb.app_eval(tok, "(localStorage.setItem('chromasmithHdrPreview','%s'),window.chromasmithHdrPreview=%s,'ok')" % ('1' if hdr == 'on' else '0', 'true' if hdr == 'on' else 'false'))
        for f in a.files:  # prime: make sure the cache + marker/companion exist under this setting
            rob.open_photo(tok, f); time.sleep(1)
        rows = []
        for r in range(a.rounds):
            for f in a.files:
                time.sleep(3)  # let the previous photo's background promotion settle
                d = json.loads(rb.app_eval(tok, JS % json.dumps(f), timeout=120))
                d['file'] = os.path.basename(f); rows.append(d)
                rb.log(f'hdr={hdr} {d["file"]}: {d["ms"]}ms src={d["src"]}')
                print('   ' + ' '.join(f'{n.replace("open-","")}@{t}' + (f'={m}' if m is not None else '') for n, t, m in d['ev']))
        out[hdr] = rows
    d = os.path.join(rb.REPO_ROOT, 'tools', 'diagnostics', 'reports', 'cached-open-bench'); os.makedirs(d, exist_ok=True)
    json.dump(out, open(os.path.join(d, time.strftime('%Y-%m-%d-%H%M') + f'-{a.label}.json'), 'w'), indent=1)

if __name__ == '__main__':
    main()
