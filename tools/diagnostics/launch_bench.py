#!/usr/bin/env python3
"""Cold-launch bench: quit -> relaunch the real app -> time until the boot splash is gone.

Per run it records wall-clock from `open` to splash-gone, the page's own performance.now() at that
moment (navigation start -> grid, i.e. includes the 17.7MB single-file parse) and the navigation
timing milestones (domInteractive / DCL / load), so parse cost can be told apart from library boot.

    python3 tools/diagnostics/launch_bench.py --n 3 --label baseline
Check `uptime` first: other processes skew these numbers.
"""
import argparse, json, os, statistics, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
AC = os.path.join(HERE, 'app_control.py')
REPORTS = os.path.join(HERE, 'reports', 'launch-bench')
PROBE = ("(()=>{const s=document.getElementById('boot-splash');"
         "const gone=!s||s.offsetParent===null||getComputedStyle(s).display==='none'||getComputedStyle(s).opacity==='0';"
         "const n=performance.getEntriesByType('navigation')[0]||{};"
         "return JSON.stringify({gone,now:performance.now(),di:n.domInteractive,dcl:n.domContentLoadedEventEnd,load:n.loadEventEnd});})()")


def ac(*a, check=False):
    return subprocess.run([sys.executable, AC, *a], capture_output=True, text=True)


def probe():
    r = ac('run', '--action', 'eval', '--code', PROBE, '--timeout', '3')
    if r.returncode:
        return None
    try:
        out = json.loads(r.stdout)
        v = out.get('result', out.get('value'))
        return json.loads(v) if isinstance(v, str) else v
    except Exception:
        return None


def one(timeout):
    ac('stop'); time.sleep(1.5)
    t0 = time.time()
    ac('start', '--automation')
    while time.time() - t0 < timeout:
        p = probe()
        if p and p.get('gone'):
            p['wall_ms'] = round((time.time() - t0) * 1000)
            return p
        time.sleep(0.15)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--n', type=int, default=3)
    ap.add_argument('--label', default='run')
    ap.add_argument('--timeout', type=float, default=60)
    a = ap.parse_args()
    runs = [r for r in (one(a.timeout) for _ in range(a.n)) if r]
    med = lambda k: round(statistics.median(r[k] for r in runs if r.get(k) is not None)) if runs else None
    rep = {'label': a.label, 'load_avg': os.getloadavg()[0], 'runs': runs,
           'median': {k: med(k) for k in ('wall_ms', 'now', 'di', 'dcl', 'load')}}
    os.makedirs(REPORTS, exist_ok=True)
    path = os.path.join(REPORTS, f"{time.strftime('%Y-%m-%d-%H%M')}-{a.label}.json")
    json.dump(rep, open(path, 'w'), indent=1)
    print(json.dumps(rep['median']), 'load', round(rep['load_avg'], 1), 'runs', len(runs), '->', path)


main()
