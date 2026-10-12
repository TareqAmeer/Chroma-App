#!/usr/bin/env python3
"""Culling-flow bench: flips through consecutive never-cached photos in a Library folder the way a
cull does (open photo, dwell, next) and reports what each step cost.

  dwell   open each photo, wait --dwell-ms (looking/rating), open the next. The time-to-visible of
          step N shows whether neighbour warm-up (prefetch) landed in time.
  rapid   held arrow key: fire an open every --rapid-ms WITHOUT awaiting the previous, then time
          how long after the LAST key the final photo is on screen (stale decodes must not queue).

Reuses raw_open_bench.py / raw_bench.py plumbing (real chromasmithOpenInEditor, visible window,
folder navigation through the live Library). Usage:
    python3 tools/diagnostics/culling_bench.py --folder /Volumes/.../2026-07-20 --n 8 --dwell-ms 3000 --label before
"""
import argparse, glob, json, os, statistics, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import raw_bench as rb  # noqa: E402
import raw_open_bench as rob  # noqa: E402

STEP_JS = """
(async () => {{
  const p = {path};
  window.__rawPerfLog = [];
  const t0 = performance.now();
  try {{ await window.chromasmithOpenInEditor(p); }} catch (e) {{ return JSON.stringify({{ok:false, error:String(e)}}); }}
  const ms = performance.now() - t0;
  const ev = (window.__rawPerfLog || []);
  const fl = ev.find(e => e.event === 'open-fully-loaded');
  return JSON.stringify({{ok:true, ms, src: fl && fl.source, ev: ev.filter(e => (e.ms != null && e.ms > 150) || /hdr|warm|neigh|cache|decode-start|native-fast|clear/i.test(e.event)).map(e => e.event + '@' + Math.round(e.t - t0) + (e.ms != null ? '=' + Math.round(e.ms) : '') + (e.reason ? ':' + e.reason + (e.entries != null ? '/' + e.entries : '') : ''))}});
}})()
"""

RAPID_JS = """
(async () => {{
  const ps = {paths}, gap = {gap};
  window.__rawPerfLog = [];
  const t0 = performance.now();
  const ps_ = [];
  for (let i = 0; i < ps.length; i++) {{
    ps_.push(window.chromasmithOpenInEditor(ps[i]).catch(() => {{}}));
    await new Promise(r => setTimeout(r, gap));
  }}
  const lastKey = performance.now();
  await Promise.all(ps_);
  const settle = performance.now() - lastKey;
  const ev = window.__rawPerfLog || [];
  const decodes = ev.filter(e => e.event === 'native-fast-invoke').length;
  return JSON.stringify({{ok:true, keysMs: lastKey - t0, settleAfterLastKeyMs: settle, nativeDecodes: decodes, opened: window.chromasmithOpenedPath || null}});
}})()
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--folder', required=True)
    ap.add_argument('--ext', default='RW2')
    ap.add_argument('--n', type=int, default=8)
    ap.add_argument('--dwell-ms', type=int, default=3000)
    ap.add_argument('--rapid-ms', type=int, default=0, help='also run a held-key scenario with this gap')
    ap.add_argument('--skip', type=int, default=0, help='skip this many never-cached files first (so scenarios do not reuse files)')
    ap.add_argument('--label', default='run')
    ap.add_argument('--reverse', action='store_true', help='walk the run in descending filename order (the grid is date-descending)')
    ap.add_argument('--warm-delay-ms', type=int, default=0, help='set window.chromasmithWarmDelayMs for this run')
    args = ap.parse_args()
    token = rob.fresh_start()
    cands = sorted(p for p in glob.glob(os.path.join(args.folder, f'*.{args.ext}')) if not os.path.basename(p).startswith('.'))
    rob.open_photo(token, cands[-1])  # warm-up
    key = rb.app_eval(token, 'window.chromasmithRawRecipeKey()')
    full = rb.app_eval(token, 'window.chromasmithRawRecipeKey(true)')
    pool = cands[:args.skip + 400]
    probe = {}
    for i in range(0, len(pool), 40):
        probe.update(json.loads(rb.app_eval(token, rob.PROBE_JS.format(paths=json.dumps(pool[i:i + 40]), keys=json.dumps([key, full])), timeout=180)))
    fresh = [p for p in pool if not probe.get(p)]
    # a consecutive run in folder order (the library's default order), not scattered picks
    start = None
    idx = {p: i for i, p in enumerate(cands)}
    for i, p in enumerate(fresh[args.skip:]):
        run = [q for q in cands[idx[p]: idx[p] + args.n + 1]]
        if len(run) == args.n + 1 and all(not probe.get(q, True) is True for q in run):
            start = idx[p]; break
    if start is None:
        raise SystemExit('no consecutive never-cached run of that length in the first 400 files')
    run = cands[start:start + args.n + (8 if args.rapid_ms else 0)]
    rb.app_eval(token, rb.OPEN_LIBRARY_JS)
    rb.log('navigating folder (first visit of a large folder can take minutes)...')
    rb.app_eval(token, rb.OPEN_FOLDER_JS.format(path=rb.js_str(args.folder)), timeout=600)
    try:  # the card is only cosmetic (reveal aspect); a virtualised/filtered grid must not abort the bench
        rb.app_poll(token, rb.CARD_EXISTS_JS.format(path=rb.js_str(run[0])), lambda r: r is True, 20)
    except RuntimeError:
        rb.log('card not rendered in the grid — opening by path anyway')
    # first visit of a folder starts catalog/thumbnail indexing — time photos only once the app is idle
    pid = rb.find_pid(); quiet = 0; t_end = time.time() + 300
    while quiet < 5 and time.time() < t_end:
        cpu = float(os.popen(f'ps -o %cpu= -p {pid}').read().strip() or 0)
        quiet = quiet + 1 if cpu < 40 else 0
        time.sleep(1)
    rb.log(f'app idle (quiet={quiet}) — starting timed run')
    if args.warm_delay_ms:
        rb.app_eval(token, f'(window.chromasmithWarmDelayMs={args.warm_delay_ms},"ok")')
    steps = []
    seq = list(reversed(run[:args.n])) if args.reverse else run[:args.n]
    for p in seq:
        r = json.loads(rb.app_eval(token, STEP_JS.format(path=rb.js_str(p)), timeout=120))
        r['file'] = os.path.basename(p); steps.append(r)
        rb.log(f'dwell step {r["file"]}: {r.get("ms", -1):.0f}ms src={r.get("src")} {r.get("ev")}')
        time.sleep(args.dwell_ms / 1000)
    out = {'label': args.label, 'dwell_ms': args.dwell_ms, 'steps': steps}
    ms = [s['ms'] for s in steps[1:] if s.get('ok')]
    out['median_ms_after_first'] = round(statistics.median(ms)) if ms else None
    out['max_ms'] = round(max(ms)) if ms else None
    out['sources'] = [s.get('src') for s in steps]
    if args.rapid_ms:
        time.sleep(3)
        r = json.loads(rb.app_eval(token, RAPID_JS.format(paths=json.dumps(run[args.n:args.n + 8]), gap=args.rapid_ms), timeout=240))
        out['rapid'] = r
        rb.log(f'rapid {args.rapid_ms}ms x8: {r}')
    rb.log(json.dumps({k: v for k, v in out.items() if k != 'steps'}))
    d = os.path.join(rb.REPO_ROOT, 'tools', 'diagnostics', 'reports', 'culling-bench'); os.makedirs(d, exist_ok=True)
    f = os.path.join(d, time.strftime('%Y-%m-%d-%H%M') + f'-{args.label}.json')
    json.dump(out, open(f, 'w'), indent=1)
    rb.log('saved ' + f)


if __name__ == '__main__':
    main()
