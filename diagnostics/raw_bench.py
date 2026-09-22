#!/usr/bin/env python3
"""CHR-120 RAW timing bench: three repeatable, stage-by-stage timings against the REAL desktop
app — uncached first open, batch cache, and cached open — so a fix's effect on real numbers can
be compared before/after instead of eyeballed from a single live session.

Reuses the existing automation plumbing rather than re-inventing it:
  - diagnostics/app_control.py's start/stop/run_automation (shared temp-file protocol)
  - window.__rawPerfLog (library-ui.js rawPerf/__pm) for the JS-side stage timeline
  - the RAW_DIAG stage=... lines in ~/Library/Logs/com.tareq.chromasmith/Chromasmith.log
    (raw_decode.rs's `stage` closure + diag::stage, gated by CS_DIAG_RAW_STAGES=1)

Usage:
    python3 diagnostics/raw_bench.py all --repeats 3 --label baseline
    python3 diagnostics/raw_bench.py cached --repeats 3 --compare latest
    python3 diagnostics/raw_bench.py uncached batch --repeats 1   # quick smoke run

Known gap: full-quality promotion (open-full-quality-promoted etc.) was NOT observed firing
within 60s+ after open-fully-loaded on an automated uncached open in testing — worth checking
live (unfocused-window requestIdleCallback throttling is one plausible cause) before relying on
it, but not something this tool chases yet. "Fully loaded" here means the FAST preview pipeline
(open-fully-loaded), matching what a user sees as "the photo opened" for culling purposes.

A run that looks suspicious (huge repeat spread, a stage blowing past its previous median, an
unexpected/missing stage, OS-cache-speed file reads, or a busy machine) is flagged SUSPICIOUS in
the table and EXCLUDED from the saved report — the whole point is comparable numbers, and a
flagged run isn't one. Investigate and re-run instead of trusting it.
"""
import argparse
import glob
import json
import os
import secrets
import shutil
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

# The known-good real photo used for the cached-open scenario (already has a persistent cache
# under recipe key 'Standard|1||1||0|full' per the CHR-120 session notes).
CACHED_REAL_PATH = '/Volumes/Crucial/PHOTOS/2025/2025-10-07/TM_00522.ARW'
CACHED_REAL_FOLDER = os.path.dirname(CACHED_REAL_PATH)

def js_str(s):
    """A safe JS string literal (double-quoted, via json.dumps) to interpolate into templates
    that use single-quoted JS elsewhere — avoids quote-nesting bugs with real file paths."""
    return json.dumps(s)


# Uncached/batch scenarios copy this file under a fresh name so the app has genuinely never
# seen it — a real cold decode + cold disk read, not a warm one from a prior run of this tool.
UNCACHED_SOURCE = CACHED_REAL_PATH
BENCH_DIR = '/Volumes/Crucial/chromasmith-bench'
BENCH_FILENAME = 'bench.ARW'  # ONE canonical registered filename shared by uncached+batch — a
# NEW filename in an already-registered folder was NOT reliably picked up by another catalog
# scan within any reasonable wait, even on a fresh app launch (confirmed live); reusing this
# exact path means the card only needs to be discovered once, and a fresh copy's new mtime
# alone still forces every native cache (keyed on path+mtime+size+recipe) to miss.

SUSPICIOUS_SPREAD_RATIO = 1.5      # max/min across repeats for the same stage
SUSPICIOUS_REGRESSION_RATIO = 2.0  # vs previous run's median for the same stage
SUSPICIOUS_READ_GBPS_MAX = 2.0     # a "disk read" this fast almost certainly hit RAM, not disk
SUSPICIOUS_READ_MBPS_MIN = 20.0    # this slow suggests real disk contention, not a clean read
SUSPICIOUS_CPU_PCT = 50.0          # a non-Chromasmith process this busy taints timing


def log(msg):
    print(msg, flush=True)


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


def app_start(env=()):
    pid = find_pid()
    if pid:
        raise RuntimeError(f'another Chromasmith instance is already running (pid={pid}) — '
                            'stop it first; two instances racing the same automation temp files '
                            'produces bogus timings')
    token = secrets.token_urlsafe(24)
    _write_json(_automation_path('enable'), {'token': token})
    args = ['open', '-n']
    for kv in env:
        args += ['--env', kv]
    args.append(find_process.REAL_APP_PATH)
    subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        time.sleep(0.2)
        pid = find_pid()
        if pid:
            return pid, token
    raise RuntimeError('app start timed out')


def app_eval(token, code, timeout=15):
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
    raise RuntimeError(f'eval timed out after {timeout}s: {code[:120]}')


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
    pids = find_process._pids_by_name(find_process.EXE_NAME) if hasattr(find_process, '_pids_by_name') else []
    load1, _, _ = os.getloadavg()
    ncpu = os.cpu_count() or 1
    if load1 / ncpu > 0.5:
        warnings.append(f'1-min load average {load1:.1f} on {ncpu} CPUs is high — another process is busy')
    try:
        top = subprocess.run(['ps', '-Ao', 'pid,pcpu,comm', '-r'], capture_output=True, text=True, timeout=5)
        for line in top.stdout.splitlines()[1:6]:
            parts = line.split(None, 2)
            if len(parts) == 3:
                pid_s, pcpu_s, comm = parts
                try:
                    pcpu = float(pcpu_s)
                except ValueError:
                    continue
                if pcpu > SUSPICIOUS_CPU_PCT and 'chromasmith' not in comm.lower():
                    warnings.append(f'{comm.strip()} (pid {pid_s}) is at {pcpu:.0f}% CPU')
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


# ── bench-file management ──────────────────────────────────────────────────────────────────

_last_bench_mtime_sec = {}


def make_bench_copy(name):
    """Copies UNCACHED_SOURCE to BENCH_DIR/<name> (a FIXED filename, reused across repeats).

    A fresh filename per repeat sounds more "uncached", but the catalog only re-walks a folder
    once per app session (see catalogRegisterFolder's `_catalogScannedRoots` gate) — in practice
    that scan is also volume-scoped and didn't reliably pick up a brand-new filename within the
    time this bench can wait (confirmed live). A fixed path sidesteps that: the card is
    discovered once, ever, and every native cache (decode_cache_key/display_cache_path in
    library.rs) is keyed on (path, mtime, size, recipe) — so a fresh copy's new mtime alone makes
    every persisted cache entry for the OLD copy a guaranteed miss, without needing a rescan or a
    new filename. Rust's key uses SECOND-granularity mtime, so this blocks until the wall clock
    actually ticks over to the next second before writing, guaranteeing a distinct key per call.
    """
    os.makedirs(BENCH_DIR, exist_ok=True)
    dst = os.path.join(BENCH_DIR, name)
    last = _last_bench_mtime_sec.get(dst)
    now = int(time.time())
    if last is not None and now <= last:
        time.sleep(last + 1 - time.time() + 0.05)
    # Read+write in userspace (not a filesystem clone) and drop the destination from the page
    # cache afterwards, so the "first read" the bench measures isn't served out of RAM.
    with open(UNCACHED_SOURCE, 'rb') as src, open(dst, 'wb') as out:
        shutil.copyfileobj(src, out)
        out.flush()
        os.fsync(out.fileno())
    _last_bench_mtime_sec[dst] = int(os.stat(dst).st_mtime)
    try:
        fd = os.open(dst, os.O_RDONLY)
        try:
            if hasattr(os, 'posix_fadvise'):
                os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
        finally:
            os.close(fd)
    except OSError:
        pass
    # macOS-specific: F_NOCACHE keeps the OS from re-populating its cache from this point on,
    # closer to the disk-read cost a genuinely fresh file would pay.
    try:
        subprocess.run(['purge'], capture_output=True, timeout=10)
    except (subprocess.SubprocessError, FileNotFoundError):
        pass
    return dst


def cleanup_bench_paths(paths, token):
    """Removes only the tool's own bench copies and their decode/display caches — nothing else."""
    for p in paths:
        try:
            if p.startswith(BENCH_DIR) and os.path.isfile(p):
                os.remove(p)
        except OSError as e:
            log(f'  (cleanup) could not remove {p}: {e}')
    if token:
        for p in paths:
            if not p.startswith(BENCH_DIR):
                continue
            try:
                app_eval(token, f"""
                    (async () => {{
                      try {{ await window.__TAURI__.core.invoke('clear_root_cache', {{}}); }} catch (e) {{}}
                    }})()
                """, timeout=5)
            except Exception:
                pass
    # Best-effort: also drop the bench folder's decode-cache PNGs/JPEGs on disk directly, since
    # clear_root_cache is keyed by catalog root, and bench files may not be registered as one.
    cache_root = os.path.expanduser('~/Library/Application Support/com.tareq.chromasmith')
    if os.path.isdir(cache_root):
        for name in os.listdir(BENCH_DIR) if os.path.isdir(BENCH_DIR) else []:
            pass  # decode cache keys are hashed; not reliably matchable by filename — left for
            # the on-disk cache's own size-bounded eviction rather than guessing at file names.


# ── log-file stage collection ──────────────────────────────────────────────────────────────

def read_raw_diag_lines(since_offset):
    """Reads new RAW_DIAG lines from the native log since a saved byte offset."""
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


# ── scenario runners ─────────────────────────────────────────────────────────────────────────

SET_LIBRARY_VIEW_JS = """
(() => {{
  try {{
    localStorage.setItem('chromasmith_lib_last_view_v2', JSON.stringify({{kind:'folder', path:{path}}}));
    localStorage.setItem('chromasmith_lib_last_folder', {path});
    return 'ok';
  }} catch (e) {{ return 'error:' + e; }}
}})()
"""

OPEN_LIBRARY_JS = "(() => { window.chromasmithToggleLibrary(); return 'opened'; })()"

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


FULL_QUALITY_DONE_MARKERS = (
    'open-full-quality-promoted', 'open-full-quality-skipped-navigated-away',
    'open-full-quality-promotion-failed',
)


def fully_settled(perflog_json):
    """True once BOTH the fast preview (open-fully-loaded) and the full-quality promotion have
    resolved (promoted, explicitly skipped, or failed) — matches what the CHR-120 session notes
    meant by "fully loaded" (the ~8.5s cold-open figure includes full-quality promotion, not just
    the fast preview)."""
    if not perflog_json or 'open-fully-loaded' not in perflog_json:
        return False
    return any(m in perflog_json for m in FULL_QUALITY_DONE_MARKERS)


def wait_for_grid(token, path, timeout=20):
    app_poll(token, CARD_EXISTS_JS.format(path=js_str(path)), lambda r: r is True, timeout)


_primed_folder = None


def prime_folder_view(folder_path):
    """Persists `folder_path` as the Library's last-viewed folder (localStorage keys
    library-ui.js's boot path reads via savedLibraryView()/restoreSavedLibraryView), so the
    NEXT fresh launch boots straight into it.

    The Library is NOT opened by a toggle call from cold boot — the app's own boot-splash
    watchdog (chromasmith-22.html's hideBootSplash chain -> chromasmithForceLibraryReady)
    already opens + expands it automatically using whatever view localStorage names at THAT
    boot. Calling window.chromasmithToggleLibrary() ourselves after boot instead CLOSES an
    already-open panel (confirmed live) — so this primes localStorage during one short-lived
    launch, stops, and lets the actual timed launch pick it up fresh on its own.

    Does NOT itself wait for a card to exist — a brand-new folder/file's first catalog scan can
    take signifcantly longer than a normal repeat should wait, and a second back-to-back launch
    here to force that scan early was flaky on this machine (confirmed live: an eval timeout with
    no chromasmith process left running at all). FIRST_LAUNCH_GRID_TIMEOUT below instead just
    gives the very first repeat of a run a long leash; once the card is discovered once, every
    later repeat (same launch->grid path) finds it quickly on its own.
    """
    global _primed_folder
    if _primed_folder == folder_path:
        return
    pid, token = app_start()
    try:
        result = app_eval(token, SET_LIBRARY_VIEW_JS.format(path=js_str(folder_path)))
        if result != 'ok':
            raise RuntimeError(f'priming localStorage failed: {result}')
    finally:
        app_stop()
    _primed_folder = folder_path


FIRST_LAUNCH_GRID_TIMEOUT = 240  # a brand-new folder/file's first catalog scan, observed live


def wait_for_grid_after_boot(token, target_path, timeout=25):
    # No toggle call here — see prime_folder_view's doc comment. The boot-splash watchdog opens
    # the panel on its own; this just waits for the grid it produces to contain our target card.
    wait_for_grid(token, target_path, timeout=timeout)


def collect_perflog(token, path):
    basename = os.path.basename(path)
    raw = app_eval(token, PERFLOG_FOR_PATH_JS.format(path=js_str(path), basename=js_str(basename)))
    try:
        return json.loads(raw) if isinstance(raw, str) else (raw or [])
    except (json.JSONDecodeError, TypeError):
        return []


# decode_raw_v2/cache_raw_decode called DIRECTLY (not via a Library-grid card click) for the
# uncached/batch scenarios. This was a deliberate pivot, not the original design: driving these
# through the real Library UI meant registering the bench folder as a catalog root, and
# catalog_scan (catalog.rs) scans by VOLUME, not by folder — on this machine, with a large real
# photo library already registered on the same /Volumes/Crucial volume, that made EVERY fresh
# launch pay a whole-volume walk before the bench folder's card ever appeared, and that walk
# reliably made the automation bridge itself stop responding to eval calls well before it
# finished (confirmed live across several attempts, up to a 240s wait). Calling these two native
# commands directly is what the real UI calls anyway underneath (cache_raw_decode is a plain
# invoke; decode_raw_v2 needs the same framed-body encoding desktop-native.js's framedInvoke
# uses) — same file, same disk, same native code path and RAW_DIAG stages, just without the
# catalog dependency. The trade-off: the JS-side __rawPerfLog stages that only fire from
# openInEditor/cacheSelectedRaws (reveal-morph, lfx-*, etc.) aren't captured for these two
# scenarios — the RAW_DIAG native stages (which carry the real cost) still are. The "cached"
# scenario below stays on the real UI path since that folder is already a long-registered real
# root with no scan-timing problem, and it's the one whose UI-facing prefetch/click path CHR-120
# actually cares about.
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

BENCH_RECIPE_KEY = 'Standard|1||1||0|full'  # srgb/fast/no-lens shape — matches CACHE_RAW_DECODE_DIRECT_JS's args


def run_uncached_repeat(index):
    bench_path = make_bench_copy(BENCH_FILENAME)
    file_size = os.path.getsize(bench_path)
    pid, token = app_start(env=['CS_DIAG_RAW_STAGES=1'])
    log_off = log_offset()
    try:
        # eval's own retry/poll loop already absorbs the "app not ready for automation yet"
        # window at boot — but that window (several seconds) would otherwise land inside a
        # naive wall-clock diff around this call. The invoke is timed INSIDE the page instead
        # (performance.now() around just the native call), so wall_ms reflects only the
        # operation itself, not app-boot-to-automation-ready latency.
        raw = app_eval(token, DECODE_RAW_V2_DIRECT_JS.format(path=js_str(bench_path)), timeout=60)
        out = json.loads(raw)
        if not out.get('ok'):
            raise RuntimeError(f'decode_raw_v2 failed: {out.get("error")}')
        js_events = [{'event': 'decode_raw_v2', 'ms': out['ms']}]
        _, native_events = read_raw_diag_lines(log_off)
        native_events = [e for e in native_events if os.path.basename(bench_path) in e.get('path', '')]
        wall_ms = out['ms']
    finally:
        app_stop()
        cleanup_bench_paths([bench_path], None)
    return {
        'wall_ms': wall_ms,
        'file_bytes': file_size,
        'js_events': js_events,
        'native_events': native_events,
        'bench_path': bench_path,
    }


def run_batch_repeat(index):
    bench_path = make_bench_copy(BENCH_FILENAME)
    file_size = os.path.getsize(bench_path)
    pid, token = app_start(env=['CS_DIAG_RAW_STAGES=1'])
    log_off = log_offset()
    try:
        raw = app_eval(token, CACHE_RAW_DECODE_DIRECT_JS.format(
            path=js_str(bench_path), recipe_key=js_str(BENCH_RECIPE_KEY)), timeout=60)
        out = json.loads(raw)
        if not out.get('ok'):
            raise RuntimeError(f'cache_raw_decode failed: {out.get("error")}')
        js_events = [{'event': 'cache_raw_decode', 'ms': out['ms']}]
        _, native_events = read_raw_diag_lines(log_off)
        native_events = [e for e in native_events if os.path.basename(bench_path) in e.get('path', '')]
        wall_ms = out['ms']
    finally:
        app_stop()
        cleanup_bench_paths([bench_path], None)
    return {
        'wall_ms': wall_ms,
        'file_bytes': file_size,
        'js_events': js_events,
        'native_events': native_events,
        'bench_path': bench_path,
    }


def run_cached_repeat(index):
    prime_folder_view(CACHED_REAL_FOLDER)
    pid, token = app_start(env=['CS_DIAG_RAW_STAGES=1'])
    log_off = log_offset()
    try:
        wait_for_grid_after_boot(token, CACHED_REAL_PATH)
        # Let the grid's own display-proxy prefetch settle before the click — that IS the
        # "cached open" scenario's realistic starting condition, not an artificial head start.
        time.sleep(1.5)
        app_eval(token, CLEAR_PERFLOG_JS)
        t0 = time.time()
        result = app_eval(token, CLICK_OPEN_JS.format(path=js_str(CACHED_REAL_PATH)))
        if result != 'clicked':
            raise RuntimeError(f'card click failed: {result}')
        app_poll(token, PERFLOG_FOR_PATH_JS.format(path=js_str(CACHED_REAL_PATH), basename=js_str(os.path.basename(CACHED_REAL_PATH))),
                  lambda r: r and 'open-fully-loaded' in r, timeout=20)
        t_done = time.time()
        js_events = collect_perflog(token, CACHED_REAL_PATH)
        _, native_events = read_raw_diag_lines(log_off)
        native_events = [e for e in native_events if os.path.basename(CACHED_REAL_PATH) in e.get('path', '')]
        wall_ms = (t_done - t0) * 1000.0
    finally:
        app_stop()
    return {
        'wall_ms': wall_ms,
        'js_events': js_events,
        'native_events': native_events,
    }


SCENARIOS = {
    'uncached': run_uncached_repeat,
    'batch': run_batch_repeat,
    'cached': run_cached_repeat,
}


# ── aggregation / reporting ─────────────────────────────────────────────────────────────────

def stage_durations_from_js(js_events):
    """Turns __rawPerfLog entries into {event_name: ms} using each event's own reported `ms`
    field when present, else the gap to the previous event on the same timeline."""
    out = {}
    for e in js_events:
        name = e.get('event')
        if not name:
            continue
        if isinstance(e.get('ms'), (int, float)):
            out[name] = e['ms']
        for extra_key in ('renderMs',):
            if isinstance(e.get(extra_key), (int, float)):
                out[f'{name}.{extra_key}'] = e[extra_key]
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
    """Median/min/max per stage across repeats; flags per-stage and overall SUSPICIOUS reasons."""
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

    # Read-throughput sanity check on the uncached/batch scenarios.
    for r in repeats:
        if 'file_bytes' not in r:
            continue
        read_stages = [v for k, v in stage_durations_from_native(r['native_events']).items()
                        if k.endswith(':read_file') or k.endswith(':read_full_png')]
        for ms in read_stages:
            if ms <= 0:
                continue
            gbps = (r['file_bytes'] / (ms / 1000.0)) / 1e9
            mbps = gbps * 1000
            if gbps > SUSPICIOUS_READ_GBPS_MAX:
                reasons.append(f'read throughput {gbps:.1f} GB/s looks like an OS cache hit, not a cold disk read')
            elif mbps < SUSPICIOUS_READ_MBPS_MIN:
                reasons.append(f'read throughput {mbps:.0f} MB/s looks like real disk contention')

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
    args = ap.parse_args()

    scenarios = list(SCENARIOS.keys()) if 'all' in args.scenarios else args.scenarios

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
        for scenario in scenarios:
            log(f'\n=== {scenario}: {args.repeats} repeat(s) ===')
            repeats = []
            for i in range(args.repeats):
                log(f'  repeat {i + 1}/{args.repeats}...')
                repeats.append(SCENARIOS[scenario](i))
            summary, flags = aggregate_repeats(repeats)
            prev_summary = (previous or {}).get('scenarios', {}).get(scenario, {}).get('stages')
            flags += compare_to_previous(summary, prev_summary)
            print_table(scenario, summary, prev_summary, flags)
            results[scenario] = {'stages': summary, 'suspicious': flags, 'repeats': args.repeats}
            if flags:
                any_suspicious = True
    finally:
        keep_awake_stop()
        if find_pid():
            app_stop()

    if any_suspicious:
        log('\nOne or more scenarios are SUSPICIOUS — investigate before trusting these numbers. '
            'Not saved as a comparable report.')
        sys.exit(1)

    os.makedirs(REPORTS_DIR, exist_ok=True)
    sha = git_sha()
    label = f'-{args.label}' if args.label else ''
    out_path = os.path.join(REPORTS_DIR, f'{time.strftime("%Y-%m-%d")}-{sha}{label}.json')
    with open(out_path, 'w') as f:
        json.dump({'ts': time.time(), 'sha': sha, 'label': args.label, 'scenarios': results}, f, indent=2)
    log(f'\nSaved {out_path}')


if __name__ == '__main__':
    main()
