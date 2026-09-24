#!/usr/bin/env python3
"""RAW editor-open bench: times the REAL editor open (window.chromasmithOpenInEditor — the same
openInEditor() a Library card click runs) for the scenarios a user actually feels, against the
packaged desktop app and real photos:

  first     a RAW this app has never persisted a decode for
  reopen    the same RAW again later in the same session (after another photo was opened)
  relaunch  the same RAW after quitting and relaunching the app (persistent cache only)
  ipc       how long a trivial IPC (get_meta) takes while a decode is running — a sync command on
            the main thread shows up here as seconds instead of milliseconds

Complements diagnostics/raw_bench.py (which direct-invokes the native commands and so never sees
the JS open path, the reveal or the cache-hit promotion). Reuses its app/automation plumbing.

Usage:
    python3 diagnostics/raw_open_bench.py --folder /Volumes/Crucial/PHOTOS/2026/2026-09-12 --n 3 --label baseline
"""
import argparse
import glob
import json
import os
import statistics
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import raw_bench as rb  # noqa: E402

REPORTS_DIR = os.path.join(rb.REPO_ROOT, 'diagnostics', 'reports', 'raw-open-bench')

OPEN_JS = """
(async () => {{
  const p = {path};
  window.__rawPerfLog = [];
  const t0 = performance.now();
  try {{ await window.chromasmithOpenInEditor(p); }} catch (e) {{ return JSON.stringify({{ok:false, error:String(e)}}); }}
  const openMs = performance.now() - t0;
  // Cache-hit opens promote to full quality ~500ms later, in the background — wait for it
  // (or give up after 20s) so "full quality" is measured, not just "something on screen".
  const deadline = performance.now() + 20000;
  const done = () => (window.__rawPerfLog || []).some(e => e.event === 'open-full-quality-render' || e.event === 'open-full-quality-promotion-failed');
  const log0 = () => (window.__rawPerfLog || []);
  const fl = log0().find(e => e.event === 'open-fully-loaded');
  const needsPromo = fl && fl.source !== 'decode' && log0().some(e => e.event === 'open-cache-display-asset');
  while (needsPromo && !done() && performance.now() < deadline) await new Promise(r => setTimeout(r, 50));
  const fullMs = performance.now() - t0;
  const ev = log0().filter(e => !e.path || e.path === p).map(e => ({{event: e.event, at: Math.round(e.t - t0), ms: e.ms != null ? Math.round(e.ms) : undefined, source: e.source}}));
  return JSON.stringify({{ok:true, openMs, fullMs: needsPromo ? fullMs : openMs, source: fl && fl.source, key: window.chromasmithDecodeRecipeKey || '', events: ev}});
}})()
"""

IPC_DURING_DECODE_JS = """
(async () => {{
  const p = {path}, other = {other};
  window.__rawPerfLog = [];
  const openP = window.chromasmithOpenInEditor(p);
  // Fire the probe only once the native decode is genuinely in flight.
  const dl = performance.now() + 30000;
  while (!(window.__rawPerfLog || []).some(e => e.event === 'native-fast-invoke') && performance.now() < dl) await new Promise(r => setTimeout(r, 20));
  const inFlight = (window.__rawPerfLog || []).some(e => e.event === 'native-fast-invoke');
  await new Promise(r => setTimeout(r, 300));
  const t0 = performance.now();
  await window.__TAURI__.core.invoke('get_meta', {{path: other}});
  const ipcMs = performance.now() - t0;
  await openP;
  const decodeDone = (window.__rawPerfLog || []).find(e => e.event === 'native-lap: decode_raw_v2 FAST (native decode+demosaic+LUT, no NR yet) done at');
  return JSON.stringify({{ok:true, ipcMs, inFlight, returnedBeforeDecode: !!decodeDone && decodeDone.t > t0 + ipcMs}});
}})()
"""

PROBE_JS = """
(async () => {{
  const out = {{}};
  for (const p of {paths}) {{
    let hit = false;
    for (const k of {keys}) {{
      try {{ await window.__TAURI__.core.invoke('get_decode_cache_path', {{path: p, recipeKey: k}}); hit = true; }} catch (e) {{}}
    }}
    out[p] = hit;
  }}
  return JSON.stringify(out);
}})()
"""


def app_rss_mb():
    pid = rb.find_pid()
    if not pid:
        return None
    out = subprocess.run(['ps', '-o', 'rss=', '-p', str(pid)], capture_output=True, text=True).stdout.strip()
    # WebKit's content process holds the page's canvases — include every WebContent child too.
    kids = subprocess.run(['pgrep', '-f', 'com.apple.WebKit.WebContent'], capture_output=True, text=True).stdout.split()
    total = int(out or 0)
    for k in kids:
        r = subprocess.run(['ps', '-o', 'rss=', '-p', k], capture_output=True, text=True).stdout.strip()
        total += int(r or 0)
    return round(total / 1024)


def swap_used_mb():
    s = subprocess.run(['sysctl', '-n', 'vm.swapusage'], capture_output=True, text=True).stdout
    try:
        return float(s.split('used = ')[1].split('M')[0])
    except (IndexError, ValueError):
        return None


def open_photo(token, path, timeout=90):
    if rb.app_eval(token, 'document.visibilityState') != 'visible':
        bring_to_front(token)
    out = json.loads(rb.app_eval(token, OPEN_JS.format(path=rb.js_str(path)), timeout=timeout))
    if not out.get('ok'):
        raise RuntimeError(f'open failed for {path}: {out.get("error")}')
    return out


def fresh_start():
    rb.app_stop()
    rb._session_token = None
    token = rb.ensure_app_running()
    rb.app_poll(token, '!!window.chromasmithOpenInEditor', lambda r: r is True, 90, interval=0.5)
    time.sleep(3)  # let boot-time catalog work settle before timing anything
    bring_to_front(token)
    return token


def bring_to_front(token):
    """A hidden/occluded window gets WebKit's background throttling: every large IPC or asset://
    transfer then stalls a flat ~20s (measured: document.visibilityState 'hidden' -> 20s, the
    same call 'visible' -> 50-100ms). Real users open photos in a visible window, so timing a
    hidden one measures macOS, not the app — bring it forward and refuse to time until visible."""
    pid = rb.find_pid()
    subprocess.run(['osascript', '-e', f'tell application "System Events" to set frontmost of (first process whose unix id is {pid}) to true'],
                   capture_output=True)
    rb.app_poll(token, 'document.visibilityState', lambda r: r == 'visible', 30, interval=0.5)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--folder', default='/Volumes/Crucial/PHOTOS/2026/2026-09-12')
    ap.add_argument('--ext', default='RW2')
    ap.add_argument('--n', type=int, default=3)
    ap.add_argument('--label', default='run')
    args = ap.parse_args()

    for w in rb.preflight():
        rb.log(f'PREFLIGHT: {w}')
    rb.keep_awake_start()
    swap0 = swap_used_mb()
    try:
        token = fresh_start()
        cands = sorted(p for p in glob.glob(os.path.join(args.folder, f'*.{args.ext}')) if not os.path.basename(p).startswith('.'))
        if len(cands) < args.n + 2:
            raise SystemExit(f'need at least {args.n + 2} .{args.ext} files in {args.folder}')
        # Learn the app's live recipe key from one warm-up open (it depends on user settings),
        # then pick files with no persisted decode under it (or its "full" variant).
        open_photo(token, cands[-1])  # warm-up: boot-time lazy init shouldn't land on a timed open
        key = rb.app_eval(token, 'window.chromasmithRawRecipeKey()')
        full_key = rb.app_eval(token, 'window.chromasmithRawRecipeKey(true)')
        pool = cands[:max(12, 4 * (args.n + 1))]  # a bounded probe: ~2 IPCs per file on a slow external drive
        probe = json.loads(rb.app_eval(token, PROBE_JS.format(paths=json.dumps(pool), keys=json.dumps([key, full_key])), timeout=120))
        fresh = [p for p in pool if not probe.get(p)]
        if len(fresh) < args.n + 1:
            raise SystemExit(f'only {len(fresh)} never-cached files in {args.folder}; need {args.n + 1}')
        picks, spare = fresh[:args.n], fresh[args.n]
        rb.log(f'recipe key {key!r}; picks: {[os.path.basename(p) for p in picks]}')

        res = {'first': [], 'reopen': [], 'relaunch': [], 'ipc_ms': None}
        rss_peak = 0
        for p in picks:
            r = open_photo(token, p); r['path'] = p; res['first'].append(r)
            rss_peak = max(rss_peak, app_rss_mb() or 0)
            rb.log(f'first    {os.path.basename(p)}: open {r["openMs"]:.0f}ms full {r["fullMs"]:.0f}ms src={r["source"]}')
        for p in picks:
            r = open_photo(token, p); r['path'] = p; res['reopen'].append(r)
            rss_peak = max(rss_peak, app_rss_mb() or 0)
            rb.log(f'reopen   {os.path.basename(p)}: open {r["openMs"]:.0f}ms full {r["fullMs"]:.0f}ms src={r["source"]}')
        ipc = json.loads(rb.app_eval(token, IPC_DURING_DECODE_JS.format(path=rb.js_str(spare), other=rb.js_str(picks[0])), timeout=90))
        res['ipc_ms'] = ipc.get('ipcMs')
        res['ipc_detail'] = ipc
        rb.log(f'ipc      get_meta during a decode: {res["ipc_ms"]:.0f}ms (decode in flight={ipc.get("inFlight")}, returned before decode ended={ipc.get("returnedBeforeDecode")})')
        token = fresh_start()
        for p in picks:
            r = open_photo(token, p); r['path'] = p; res['relaunch'].append(r)
            rss_peak = max(rss_peak, app_rss_mb() or 0)
            rb.log(f'relaunch {os.path.basename(p)}: open {r["openMs"]:.0f}ms full {r["fullMs"]:.0f}ms src={r["source"]}')
        res['rss_peak_mb'] = rss_peak
        res['swap_delta_mb'] = (swap_used_mb() or 0) - (swap0 or 0)

        def med(k, f):
            v = [x[f] for x in res[k]]
            return round(statistics.median(v)) if v else None
        summary = {k: {'open_ms': med(k, 'openMs'), 'full_ms': med(k, 'fullMs'),
                       'sources': [x['source'] for x in res[k]]} for k in ('first', 'reopen', 'relaunch')}
        summary.update(ipc_during_decode_ms=round(res['ipc_ms'] or 0), rss_peak_mb=rss_peak,
                       swap_delta_mb=round(res['swap_delta_mb']))
        rb.log(json.dumps(summary, indent=1))
        os.makedirs(REPORTS_DIR, exist_ok=True)
        sha = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=rb.REPO_ROOT, capture_output=True, text=True).stdout.strip()
        out = os.path.join(REPORTS_DIR, f'{time.strftime("%Y-%m-%d-%H%M")}-{sha}-{args.label}.json')
        with open(out, 'w') as f:
            json.dump({'sha': sha, 'label': args.label, 'summary': summary, 'detail': res}, f, indent=1)
        rb.log(f'saved {out}')
    finally:
        rb.keep_awake_stop()


if __name__ == '__main__':
    main()
