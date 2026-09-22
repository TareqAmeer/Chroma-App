#!/usr/bin/env python3
"""CHR-120 RAW timing bench: three repeatable, stage-by-stage timings against the REAL desktop
app, driven through the REAL Library UI (card click / Cache RAWs button) — uncached first open,
batch cache, and cached open — so a fix's effect on real numbers can be compared before/after
instead of eyeballed from a single live session.

Design: ONE app launch for the whole run. Restarting the app between repeats was the source of
nearly every reliability problem in an earlier version of this tool (a fresh launch's whole-
volume catalog scan, one-time codesign verification on a freshly rebuilt binary, and the
automation bridge simply not being up yet all showed up as flaky hangs) — none of that exists
once the app just stays open. Each repeat instead uses a DIFFERENT real, already-cataloged photo
from the user's real library, so "the app has never decoded this" / "already cached" are true
without ever touching a file the app hasn't already indexed. Only rebuild+relaunch when the code
under test actually changed (`--rebuild`); otherwise this attaches to whatever's running, or
starts the packaged app once and leaves it running for next time.

Reuses the existing automation plumbing rather than re-inventing it:
  - diagnostics/app_control.py's start/stop/run_automation (shared temp-file protocol)
  - window.__rawPerfLog (library-ui.js rawPerf/__pm) for the JS-side stage timeline
  - the RAW_DIAG stage=... lines in ~/Library/Logs/com.tareq.chromasmith/Chromasmith.log
    (raw_decode.rs's `stage` closure + diag::stage in main.rs/library.rs, gated by
    CS_DIAG_RAW_STAGES=1 — set automatically by this tool)

Usage:
    python3 diagnostics/raw_bench.py all --repeats 3 --ext RW2 --label baseline
    python3 diagnostics/raw_bench.py cached --repeats 3 --compare latest
    python3 diagnostics/raw_bench.py --rebuild all --repeats 3   # rebuild first, then measure

A run that looks suspicious (huge repeat spread, a stage blowing past its previous median, an
unexpected/missing stage, or a busy machine) is flagged SUSPICIOUS in the table and EXCLUDED from
the saved report — the whole point is comparable numbers, and a flagged run isn't one.
Investigate and re-run instead of trusting it.
"""
import argparse
import glob
import json
import os
import secrets
import statistics
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import find_process  # noqa: E402
import log_file  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORTS_DIR = os.path.join(REPO_ROOT, 'diagnostics', 'reports', 'raw-bench')
DESKTOP_DIR = os.path.join(REPO_ROOT, 'desktop')

# A real folder in the user's own library with plenty of RW2s never opened by hand — see
# --library-root/--ext to point this at a different folder or format.
DEFAULT_LIBRARY_ROOT = '/Volumes/Crucial/PHOTOS/2026/2026-05-24'
DEFAULT_EXT = 'RW2'

SUSPICIOUS_SPREAD_RATIO = 1.5      # max/min across repeats for the same stage
SUSPICIOUS_REGRESSION_RATIO = 2.0  # vs previous run's median for the same stage
SUSPICIOUS_CPU_PCT = 50.0          # a non-Chromasmith process this busy taints timing
IN_PROCESS_CACHE_SLOTS = 3         # MAX_IN_PROCESS_RAW_CACHES in main.rs — LRU-evicts past this


def log(msg):
    print(msg, flush=True)


def js_str(s):
    """A safe JS string literal (double-quoted, via json.dumps) to interpolate into templates
    that use single-quoted JS elsewhere — avoids quote-nesting bugs with real file paths."""
    return json.dumps(s)


# ── app_control glue (import, don't shell out — same process, same temp-file protocol) ────────

def _automation_path(kind):
    return os.path.join(tempfile.gettempdir(), f'chromasmith_automation_{kind}.json')


def _write_json(path, value):
    fd, tmp = tempfile.mkstemp(prefix='chromasmith-automation-', dir=os.path.dirname(path))
    with os.fdopen(fd, 'w') as f:
        json.dump(value, f)
    os.replace(tmp, path)


def find_pid():
    try:
        return find_process.find_chromasmith_pid()[0]
    except find_process.ProcessNotFound:
        return None


def app_stop():
    pid = find_pid()
    if not pid:
        return
    os.kill(pid, 15)
    for _ in range(50):
        time.sleep(0.2)
        if not find_pid():
            return
    raise RuntimeError(f'stop timed out pid={pid}; refusing to force-kill — check for a stuck app')


_session_token = None  # the automation token for the app THIS tool started/attached to


def ensure_app_running():
    """Starts the app with automation + CS_DIAG_RAW_STAGES enabled if it isn't already running,
    and leaves it running — repeats and scenarios all reuse this one session. Returns the
    automation token. If an instance is already running from before this tool touched it, its
    automation token is unknown, so this refuses rather than guessing (mismatched token = every
    eval fails) — stop it yourself first, or just let this start its own.
    """
    global _session_token
    if _session_token is not None and find_pid():
        return _session_token
    pid = find_pid()
    if pid:
        raise RuntimeError(f'Chromasmith is already running (pid={pid}) from outside this tool — '
                            'stop it first (this tool needs to know its own automation token).')
    token = secrets.token_urlsafe(24)
    _write_json(_automation_path('enable'), {'token': token})
    subprocess.Popen(['open', '-n', '--env', 'CS_DIAG_RAW_STAGES=1', find_process.REAL_APP_PATH],
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        time.sleep(0.2)
        if find_pid():
            break
    else:
        raise RuntimeError('app start timed out')
    _session_token = token
    return token


def rebuild_app():
    """`npm run build` in desktop/ — only when the code under test actually changed."""
    log('Rebuilding (npm run build)...')
    app_stop()
    global _session_token
    _session_token = None
    result = subprocess.run(['npm', 'run', 'build'], cwd=DESKTOP_DIR, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f'build failed:\n{result.stdout[-4000:]}\n{result.stderr[-4000:]}')
    log('Build OK.')


def app_eval(token, code, timeout=45):
    # 45s: on a cold launch the automation bridge isn't ready the instant the process exists, and
    # a freshly-rebuilt binary pays a one-time macOS codesign check on its first launch — a short
    # timeout here reads as "automation broken" when it's really just "not up yet" (confirmed
    # live). Once the app is warm (the normal case — this tool doesn't relaunch between repeats)
    # every eval call returns in well under a second.
    cmd_id = secrets.token_hex(8)
    _write_json(_automation_path('command'), {'id': cmd_id, 'token': token, 'action': 'eval', 'code': code})
    result_path = _automation_path('result')
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with open(result_path) as f:
                out = json.load(f)
            if out.get('id') == cmd_id:
                if not out.get('ok'):
                    raise RuntimeError(f'eval failed: {out}')
                return out.get('result')
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        time.sleep(0.1)
    raise RuntimeError(f'eval timed out after {timeout}s: {code[:160]}')


def app_poll(token, code, predicate, timeout, interval=0.2):
    """Repeatedly eval `code`, returning the first result where predicate(result) is true."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = app_eval(token, code)
        if predicate(last):
            return last
        time.sleep(interval)
    raise RuntimeError(f'poll timed out after {timeout}s; last result: {json.dumps(last)[:400]}')


# ── preflight ───────────────────────────────────────────────────────────────────────────────

def preflight():
    """Checks that make a bad number explainable before it's ever measured, not after."""
    warnings = []
    load1, _, _ = os.getloadavg()
    ncpu = os.cpu_count() or 1
    if load1 / ncpu > 0.5:
        warnings.append(f'1-min load average {load1:.1f} on {ncpu} CPUs is high — another process is busy')
    try:
        top = subprocess.run(['ps', '-Ao', 'pid,pcpu,comm,state', '-r'], capture_output=True, text=True, timeout=5)
        for line in top.stdout.splitlines()[1:8]:
            parts = line.split(None, 3)
            if len(parts) == 4:
                pid_s, pcpu_s, comm, state = parts
                try:
                    pcpu = float(pcpu_s)
                except ValueError:
                    continue
                if pcpu > SUSPICIOUS_CPU_PCT and 'chromasmith' not in comm.lower():
                    warnings.append(f'{comm.strip()} (pid {pid_s}, state {state}) is at {pcpu:.0f}% CPU')
                if state.startswith('U') and 'rsync' in comm.lower():
                    warnings.append(f'{comm.strip()} (pid {pid_s}) is in uninterruptible I/O wait — possibly wedged')
    except (subprocess.SubprocessError, FileNotFoundError):
        warnings.append('could not read `ps` output to check for busy processes')
    if not os.path.ismount('/Volumes/Crucial'):
        warnings.append('/Volumes/Crucial is not mounted')
    return warnings


_caffeinate_proc = None


def keep_awake_start():
    global _caffeinate_proc
    if _caffeinate_proc is None:
        _caffeinate_proc = subprocess.Popen(['caffeinate', '-dims'])


def keep_awake_stop():
    global _caffeinate_proc
    if _caffeinate_proc is not None:
        _caffeinate_proc.terminate()
        _caffeinate_proc = None


# ── photo pool: real, already-cataloged files from the user's own library ─────────────────────

def _list_candidates(library_root, ext):
    pattern = os.path.join(library_root, f'*.{ext}')
    paths = sorted(p for p in glob.glob(pattern) if not os.path.basename(p).startswith('.'))
    if not paths:
        raise RuntimeError(f'no .{ext} files found in {library_root} — pass --library-root/--ext')
    return paths


BENCH_RECIPE_KEY = 'Standard|1||1||0|full'  # srgb/fast/no-lens shape, matches the direct-invoke probe below


def never_cached(token, path):
    """True if no persistent decode cache exists yet for this exact (path, mtime, size) under
    the app's current default recipe — checked via the same probe the display-proxy prefetch
    uses (get_decode_cache_path), so a file this reports as clean really has never been decoded
    by cache_raw_decode/decode_raw_v2's persistent-cache write."""
    code = f"""
(async () => {{
  try {{
    await window.__TAURI__.core.invoke('get_decode_cache_path', {{path: {js_str(path)}, recipeKey: {js_str(BENCH_RECIPE_KEY)}}});
    return 'exists';
  }} catch (e) {{ return 'missing'; }}
}})()
"""
    return app_eval(token, code) == 'missing'


def pick_fresh_files(token, library_root, ext, n, exclude=()):
    """Picks N real files from library_root that have never been persistently cached, for a
    genuinely uncached measurement without copying anything or touching the catalog."""
    candidates = [p for p in _list_candidates(library_root, ext) if p not in exclude]
    picked = []
    for p in candidates:
        if never_cached(token, p):
            picked.append(p)
        if len(picked) == n:
            return picked
    raise RuntimeError(f'only found {len(picked)}/{n} never-cached .{ext} files in {library_root} — '
                        'point --library-root at a folder with more unopened photos, or pass --repeats lower')


# ── Library UI driving (real card click / Cache RAWs button — same as a user's own actions) ────

OPEN_LIBRARY_JS = "(() => { if (!window.chromasmithToggleLibrary) return 'no-toggle'; if (!document.getElementById('lib-overlay') || !document.getElementById('lib-overlay').classList.contains('on')) window.chromasmithToggleLibrary(); return 'opened'; })()"

OPEN_FOLDER_JS = """
(async () => {{
  if (!window.chromasmithOpenFolder) return 'no-open-folder';
  await window.chromasmithOpenFolder({path});
  return 'navigated';
}})()
"""

CARD_EXISTS_JS = """
(() => {{
  const el = document.querySelector(".lib-card[data-path='" + {path} + "'] .lib-thumb-wrap");
  return !!el;
}})()
"""

CLICK_OPEN_JS = """
(() => {{
  const el = document.querySelector(".lib-card[data-path='" + {path} + "'] .lib-thumb-wrap");
  if (!el) return 'missing-card';
  el.onclick({{shiftKey:false,metaKey:false,ctrlKey:false,webkitForce:1}});
  return 'clicked';
}})()
"""

CLICK_SELECT_JS = """
(() => {{
  const el = document.querySelector(".lib-card[data-path='" + {path} + "'] .lib-thumb-wrap");
  if (!el) return 'missing-card';
  el.onclick({{shiftKey:false,metaKey:false,ctrlKey:false}});
  return 'selected';
}})()
"""

CLICK_CACHE_RAW_JS = """
(() => {{
  const btn = document.querySelector('[data-act="cache-raw"]');
  if (!btn) return 'missing-button';
  btn.onclick();
  return 'clicked';
}})()
"""

PERFLOG_FOR_PATH_JS = """
JSON.stringify((window.__rawPerfLog || []).filter(e => e.path === {path} || (e.path || '').includes({basename})))
"""

CLEAR_PERFLOG_JS = "(() => { window.__rawPerfLog = []; return 'cleared'; })()"

_navigated_folders = set()


def ensure_folder_open(token, folder_path, target_path, timeout=25):
    """Navigates the Library to folder_path if it isn't already showing it this session, and
    waits for target_path's card. Cheap after the first call for a given folder (catalog stays
    warm all session — no relaunch, so no repeated whole-volume scans).

    Drives the REAL navigation via window.chromasmithOpenFolder (library-ui.js), the same
    openFolder() a folder-tree row's own click handler calls — setting localStorage's "last
    view" only affects the NEXT app boot, never a live already-open session (confirmed live: the
    grid kept showing the previous folder indefinitely because nothing was ever actually told to
    navigate)."""
    opened = app_eval(token, OPEN_LIBRARY_JS)
    if opened == 'no-toggle':
        raise RuntimeError('chromasmithToggleLibrary not found — is the app actually running the built app?')
    if folder_path not in _navigated_folders:
        nav = app_eval(token, OPEN_FOLDER_JS.format(path=js_str(folder_path)), timeout=90)
        if nav == 'no-open-folder':
            raise RuntimeError('window.chromasmithOpenFolder not found — rebuild with --rebuild first '
                                '(this hook was added alongside this tool).')
        _navigated_folders.add(folder_path)
        # First-ever navigation to a real, large, already-registered folder still needs a real
        # wait (metadata/sidecar sync), just not a fresh whole-volume catalog_scan every repeat.
        timeout = max(timeout, 60)
    app_poll(token, CARD_EXISTS_JS.format(path=js_str(target_path)), lambda r: r is True, timeout)


def collect_perflog(token, path):
    basename = os.path.basename(path)
    raw = app_eval(token, PERFLOG_FOR_PATH_JS.format(path=js_str(path), basename=js_str(basename)))
    try:
        return json.loads(raw) if isinstance(raw, str) else (raw or [])
    except (json.JSONDecodeError, TypeError):
        return []


# ── log-file stage collection ──────────────────────────────────────────────────────────────

def read_raw_diag_lines(since_offset):
    path = log_file.LOG_PATH
    try:
        size = os.path.getsize(path)
    except OSError:
        return since_offset, []
    if size < since_offset:
        since_offset = 0
    events = []
    with open(path, 'r', errors='replace') as f:
        f.seek(since_offset)
        for line in f:
            marker = ' RAW_DIAG '
            at = line.find(marker)
            if at < 0:
                continue
            fields = {}
            for tok in line[at + len(marker):].split():
                if '=' in tok:
                    k, v = tok.split('=', 1)
                    fields[k] = v
            events.append(fields)
        since_offset = f.tell()
    return since_offset, events


def log_offset():
    try:
        return os.path.getsize(log_file.LOG_PATH)
    except OSError:
        return 0


# ── scenario runners (each takes one real photo path) ───────────────────────────────────────
#
# All three call the native decode_raw_v2/cache_raw_decode commands directly (window.__TAURI__.
# core.invoke), the same commands the real Library UI card-click / Cache RAWs button call —
# NOT by clicking through the Library grid. This was a deliberate, confirmed-live pivot: driving
# a real (never-before-registered) folder through window.chromasmithOpenFolder — the same
# openFolder() a folder-tree row's click handler calls — reliably hung the whole automation
# bridge for MULTIPLE different real folders (a 999-file one and a 30-file one alike), evidently
# something about registering a new catalog root mid-session in a long-lived process with a lot
# of accumulated prior-session catalog state, not a folder-size issue. Direct invoke sidesteps
# the catalog/grid entirely — same file, same disk, same native decode/cache code path and
# RAW_DIAG stages — at the cost of the JS-side reveal/lfx-* stages that only fire from
# openInEditor's own instrumentation, and of not exercising the catalog-scan/prefetch path
# itself. "cached" specifically re-invokes cache_raw_decode on a file batch already wrote a
# persistent cache for — the SAME "already cached" shortcut branch main.rs's own comment
# documents as a real, previously-buggy path (it used to warm nothing at all).

DECODE_RAW_V2_DIRECT_JS = """
(async () => {{
  try {{
    const bytes = await window.__TAURI__.core.invoke('read_file_bytes', {{path: {path}}});
    const json = {{mode: 'srgb', autoLens: false, rawNr: 'fast', demosaicAlgo: '', fast: false}};
    const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    const payload = new Uint8Array(bytes);
    const framed = new Uint8Array(4 + jsonBytes.length + payload.length);
    new DataView(framed.buffer).setUint32(0, jsonBytes.length, true);
    framed.set(jsonBytes, 4);
    framed.set(payload, 4 + jsonBytes.length);
    const t0 = performance.now();
    await window.__TAURI__.core.invoke('decode_raw_v2', framed);
    return JSON.stringify({{ok: true, ms: performance.now() - t0}});
  }} catch (e) {{ return JSON.stringify({{ok: false, error: String(e)}}); }}
}})()
"""

CACHE_RAW_DECODE_DIRECT_JS = """
(async () => {{
  try {{
    const t0 = performance.now();
    const result = await window.__TAURI__.core.invoke('cache_raw_decode', {{
      path: {path}, recipeKey: {recipe_key}, mode: 'srgb', lutKey: '', rawNr: 'fast',
      autoLens: false, demosaicAlgo: '', lensOverride: '', lensOverrideFocal: 0
    }});
    return JSON.stringify({{ok: true, result, ms: performance.now() - t0}});
  }} catch (e) {{ return JSON.stringify({{ok: false, error: String(e)}}); }}
}})()
"""


def run_uncached_open(token, folder, path):
    log_off = log_offset()
    raw = app_eval(token, DECODE_RAW_V2_DIRECT_JS.format(path=js_str(path)), timeout=60)
    out = json.loads(raw)
    if not out.get('ok'):
        raise RuntimeError(f'decode_raw_v2 failed on {path}: {out.get("error")}')
    _, native_events = read_raw_diag_lines(log_off)
    native_events = [e for e in native_events if os.path.basename(path) in e.get('path', '')]
    return {'wall_ms': out['ms'], 'file_bytes': os.path.getsize(path),
            'js_events': [{'event': 'decode_raw_v2', 'ms': out['ms']}],
            'native_events': native_events, 'path': path}


def run_batch_cache(token, folder, path):
    log_off = log_offset()
    raw = app_eval(token, CACHE_RAW_DECODE_DIRECT_JS.format(
        path=js_str(path), recipe_key=js_str(BENCH_RECIPE_KEY)), timeout=60)
    out = json.loads(raw)
    if not out.get('ok'):
        raise RuntimeError(f'cache_raw_decode failed on {path}: {out.get("error")}')
    _, native_events = read_raw_diag_lines(log_off)
    native_events = [e for e in native_events if os.path.basename(path) in e.get('path', '')]
    return {'wall_ms': out['ms'], 'file_bytes': os.path.getsize(path),
            'js_events': [{'event': 'cache_raw_decode', 'ms': out['ms']}],
            'native_events': native_events, 'path': path}


def run_cached_open(token, folder, path):
    """path must already have a persistent disk cache — run_batch_cache on it first. This
    re-invokes cache_raw_decode, which takes its "already cached" shortcut branch (see the
    module doc comment above) rather than the full editor-open JS flow."""
    log_off = log_offset()
    raw = app_eval(token, CACHE_RAW_DECODE_DIRECT_JS.format(
        path=js_str(path), recipe_key=js_str(BENCH_RECIPE_KEY)), timeout=30)
    out = json.loads(raw)
    if not out.get('ok'):
        raise RuntimeError(f'cache_raw_decode (cached-shortcut) failed on {path}: {out.get("error")}')
    if out.get('result') != 'cached':
        raise RuntimeError(f'expected the already-cached shortcut for {path}, got result={out.get("result")!r} '
                            '— run_batch_cache must run on this exact path first')
    _, native_events = read_raw_diag_lines(log_off)
    native_events = [e for e in native_events if os.path.basename(path) in e.get('path', '')]
    return {'wall_ms': out['ms'], 'js_events': [{'event': 'cache_raw_decode_cached', 'ms': out['ms']}],
            'native_events': native_events, 'path': path}


# ── aggregation / reporting ─────────────────────────────────────────────────────────────────

def stage_durations_from_js(js_events):
    out = {}
    for e in js_events:
        name = e.get('event')
        if not name:
            continue
        if isinstance(e.get('ms'), (int, float)):
            out[name] = e['ms']
        if isinstance(e.get('renderMs'), (int, float)):
            out[f'{name}.renderMs'] = e['renderMs']
    return out


def stage_durations_from_native(native_events):
    out = {}
    for e in native_events:
        name = e.get('stage')
        ms = e.get('duration_ms')
        if not name or ms is None:
            continue
        try:
            ms = float(ms)
        except ValueError:
            continue
        op = e.get('op', 'decode')
        out[f'{op}:{name}'] = ms
    return out


def aggregate_repeats(repeats):
    all_stage_names = set()
    per_repeat_stages = []
    for r in repeats:
        stages = {}
        stages.update(stage_durations_from_js(r['js_events']))
        stages.update(stage_durations_from_native(r['native_events']))
        stages['wall_ms'] = r['wall_ms']
        per_repeat_stages.append(stages)
        all_stage_names.update(stages.keys())

    summary = {}
    reasons = []
    for name in sorted(all_stage_names):
        values = [s[name] for s in per_repeat_stages if name in s]
        if len(values) < len(repeats):
            reasons.append(f'stage "{name}" missing in {len(repeats) - len(values)}/{len(repeats)} repeats')
        if not values:
            continue
        med = statistics.median(values)
        lo, hi = min(values), max(values)
        if lo > 0 and hi / lo > SUSPICIOUS_SPREAD_RATIO:
            reasons.append(f'stage "{name}" spread {lo:.0f}-{hi:.0f}ms ({hi / lo:.1f}x) across repeats')
        summary[name] = {'median_ms': med, 'min_ms': lo, 'max_ms': hi, 'n': len(values)}
    return summary, reasons


def compare_to_previous(summary, previous_summary):
    reasons = []
    if not previous_summary:
        return reasons
    for name, cur in summary.items():
        prev = previous_summary.get(name)
        if not prev:
            continue
        prev_med = prev.get('median_ms', 0)
        if prev_med > 0 and cur['median_ms'] / prev_med > SUSPICIOUS_REGRESSION_RATIO:
            reasons.append(f'stage "{name}" is {cur["median_ms"] / prev_med:.1f}x its previous median '
                            f'({prev_med:.0f}ms -> {cur["median_ms"]:.0f}ms)')
    return reasons


def print_table(scenario, summary, previous_summary, flags):
    log(f'\n── {scenario} ' + '─' * max(1, 60 - len(scenario)))
    if flags:
        log(f'  SUSPICIOUS: {"; ".join(flags)}')
    width = max([len(k) for k in summary] + [10])
    log(f'  {"stage".ljust(width)}  median    min-max          Δ vs previous')
    for name in sorted(summary, key=lambda n: -summary[n]['median_ms']):
        s = summary[name]
        prev = (previous_summary or {}).get(name)
        delta = ''
        if prev and prev.get('median_ms'):
            pct = (s['median_ms'] - prev['median_ms']) / prev['median_ms'] * 100
            delta = f'{pct:+.0f}%'
        log(f'  {name.ljust(width)}  {s["median_ms"]:7.1f}ms  {s["min_ms"]:7.1f}-{s["max_ms"]:7.1f}ms  {delta}')


def load_report(path):
    with open(path) as f:
        return json.load(f)


def find_latest_report():
    os.makedirs(REPORTS_DIR, exist_ok=True)
    files = sorted(glob.glob(os.path.join(REPORTS_DIR, '*.json')))
    return files[-1] if files else None


def git_sha():
    try:
        return subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=REPO_ROOT,
                               capture_output=True, text=True, timeout=5).stdout.strip()
    except (subprocess.SubprocessError, FileNotFoundError):
        return 'unknown'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('scenarios', nargs='*', default=['all'], choices=['all', 'uncached', 'batch', 'cached'])
    ap.add_argument('--repeats', type=int, default=3)
    ap.add_argument('--compare', help='"latest" or a report path to diff stage medians against')
    ap.add_argument('--label', default='')
    ap.add_argument('--library-root', default=DEFAULT_LIBRARY_ROOT, help='real folder to pick test photos from')
    ap.add_argument('--ext', default=DEFAULT_EXT, help='file extension to test, e.g. RW2 or ARW')
    ap.add_argument('--rebuild', action='store_true', help='npm run build (in desktop/) before measuring')
    args = ap.parse_args()

    scenarios = ['uncached', 'batch', 'cached'] if 'all' in args.scenarios else args.scenarios

    if args.rebuild:
        rebuild_app()

    warnings = preflight()
    if warnings:
        log('Preflight warnings (these can explain a SUSPICIOUS flag below):')
        for w in warnings:
            log(f'  - {w}')

    previous = None
    if args.compare:
        prev_path = find_latest_report() if args.compare == 'latest' else args.compare
        if prev_path and os.path.isfile(prev_path):
            previous = load_report(prev_path)
            log(f'Comparing against {prev_path}')
        else:
            log(f'--compare requested but no report found ({args.compare})')

    keep_awake_start()
    results = {}
    any_suspicious = False
    try:
        token = ensure_app_running()

        # One photo pool for the whole run: `repeats` for uncached, `repeats` for batch, and
        # `repeats + IN_PROCESS_CACHE_SLOTS` for cached — batch-caching that many in a row LRU-
        # evicts the first `repeats` of them from the small in-process cache (see
        # run_cached_open's doc comment), so opening THOSE afterwards is a genuine disk-cache
        # measurement, not the even-faster in-memory one, all without ever relaunching the app.
        # "cached" no longer needs an eviction buffer — see run_cached_open's doc comment: it
        # re-invokes cache_raw_decode's own "already cached" shortcut branch, which only checks
        # decode_cache_exists() on disk, not the small in-process RAW_EDITOR_CACHE.
        need_cached = args.repeats if 'cached' in scenarios else 0
        total_needed = (args.repeats if 'uncached' in scenarios else 0) \
            + (args.repeats if 'batch' in scenarios else 0) + need_cached
        log(f'Picking {total_needed} never-cached .{args.ext} files from {args.library_root}...')
        pool = pick_fresh_files(token, args.library_root, args.ext, total_needed)
        cursor = 0

        if 'uncached' in scenarios:
            log(f'\n=== uncached: {args.repeats} repeat(s) ===')
            repeats = []
            for i in range(args.repeats):
                path = pool[cursor]; cursor += 1
                log(f'  repeat {i + 1}/{args.repeats}: {os.path.basename(path)}')
                repeats.append(run_uncached_open(token, args.library_root, path))
            summary, flags = aggregate_repeats(repeats)
            prev_summary = (previous or {}).get('scenarios', {}).get('uncached', {}).get('stages')
            flags += compare_to_previous(summary, prev_summary)
            print_table('uncached', summary, prev_summary, flags)
            results['uncached'] = {'stages': summary, 'suspicious': flags, 'repeats': args.repeats}
            any_suspicious = any_suspicious or bool(flags)

        if 'batch' in scenarios:
            log(f'\n=== batch: {args.repeats} repeat(s) ===')
            repeats = []
            for i in range(args.repeats):
                path = pool[cursor]; cursor += 1
                log(f'  repeat {i + 1}/{args.repeats}: {os.path.basename(path)}')
                repeats.append(run_batch_cache(token, args.library_root, path))
            summary, flags = aggregate_repeats(repeats)
            prev_summary = (previous or {}).get('scenarios', {}).get('batch', {}).get('stages')
            flags += compare_to_previous(summary, prev_summary)
            print_table('batch', summary, prev_summary, flags)
            results['batch'] = {'stages': summary, 'suspicious': flags, 'repeats': args.repeats}
            any_suspicious = any_suspicious or bool(flags)

        if 'cached' in scenarios:
            log(f'\n=== cached: {args.repeats} repeat(s) '
                f'(batch-caching each photo first, then re-measuring the already-cached path) ===')
            cached_pool = pool[cursor:cursor + need_cached]
            for i, path in enumerate(cached_pool):
                log(f'  warming {i + 1}/{need_cached}: {os.path.basename(path)}')
                run_batch_cache(token, args.library_root, path)
            repeats = []
            for i, path in enumerate(cached_pool[:args.repeats]):
                log(f'  repeat {i + 1}/{args.repeats}: {os.path.basename(path)}')
                repeats.append(run_cached_open(token, args.library_root, path))
            summary, flags = aggregate_repeats(repeats)
            prev_summary = (previous or {}).get('scenarios', {}).get('cached', {}).get('stages')
            flags += compare_to_previous(summary, prev_summary)
            print_table('cached', summary, prev_summary, flags)
            results['cached'] = {'stages': summary, 'suspicious': flags, 'repeats': args.repeats}
            any_suspicious = any_suspicious or bool(flags)
    finally:
        keep_awake_stop()
        # The app is deliberately left running — see the module doc comment. Only --rebuild
        # stops it, and only to relaunch the freshly built binary.

    if any_suspicious:
        log('\nOne or more scenarios are SUSPICIOUS — investigate before trusting these numbers. '
            'Not saved as a comparable report.')
        sys.exit(1)

    os.makedirs(REPORTS_DIR, exist_ok=True)
    sha = git_sha()
    label = f'-{args.label}' if args.label else ''
    out_path = os.path.join(REPORTS_DIR, f'{time.strftime("%Y-%m-%d")}-{sha}-{args.ext.lower()}{label}.json')
    with open(out_path, 'w') as f:
        json.dump({'ts': time.time(), 'sha': sha, 'label': args.label, 'ext': args.ext, 'scenarios': results}, f, indent=2)
    log(f'\nSaved {out_path}')


if __name__ == '__main__':
    main()
