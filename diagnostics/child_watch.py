"""
Tracks child processes of the watched app.

Why this exists: the freeze detector only pings the app's main-thread
AppleEvent responsiveness (freeze_detector.py) — that stays perfectly
healthy even when a BACKGROUND CHILD PROCESS (e.g. a `--face-scan-worker`
subprocess) is fully deadlocked, because the UI never blocks on it. A hung
child was previously entirely invisible to this tool, including to its own
freeze detector — this module is the fix: it discovers descendants of the
watched PID, samples their CPU, and flags one that goes idle for a
sustained window while still alive.

It's also the direct fix for one specific, well-known bug class: a child
blocked writing to a full, undrained stdout/stderr pipe (verified via web
research this is a standard failure mode — e.g. github.com/oven-sh/bun#26762,
ajitabhpandey.info's "64KB Pipe Trap" — and that `lsof` (pipe fd state) +
`sample` (the blocked thread's own stack, which shows `write`/`writev` at
the top) is the standard way to CONFIRM it directly, not just infer it from
source or DB state). When a stall is detected, this module captures the
child's own stack sample and checks both signals together.
"""
import subprocess
import time

import sample_capture
import symbolicate
import pipe_dtrace

STALL_CPU_THRESHOLD = 1.0    # % — below this counts as "not doing visible work"
STALL_WINDOW_S = 20.0        # how long CPU must stay low before flagging a stall


def _pgrep_children(pid):
    try:
        out = subprocess.run(['pgrep', '-P', str(pid)], capture_output=True, text=True, timeout=5)
    except (subprocess.SubprocessError, FileNotFoundError):
        return []
    if out.returncode != 0:
        return []
    return [int(p) for p in out.stdout.split() if p.strip()]


def find_descendants(pid):
    """All children, grandchildren, etc. of pid."""
    direct = _pgrep_children(pid)
    out = list(direct)
    for c in direct:
        out.extend(find_descendants(c))
    return out


def _proc_cmd(pid):
    try:
        out = subprocess.run(['ps', '-o', 'comm=', '-p', str(pid)],
                              capture_output=True, text=True, timeout=5)
    except (subprocess.SubprocessError, FileNotFoundError):
        return None
    return out.stdout.strip() or None


def _proc_cpu(pid):
    try:
        out = subprocess.run(['ps', '-o', 'pcpu=', '-p', str(pid)],
                              capture_output=True, text=True, timeout=5)
    except (subprocess.SubprocessError, FileNotFoundError):
        return None
    txt = out.stdout.strip()
    try:
        return float(txt)
    except ValueError:
        return None


def pipe_fd_count(pid):
    """
    Number of open PIPE file descriptors — a process blocked writing to a
    full, undrained pipe holds one open indefinitely while otherwise idle,
    which is exactly the signature that distinguishes this from a process
    that's merely sleeping/polling for legitimate reasons.
    """
    try:
        out = subprocess.run(['lsof', '-p', str(pid)], capture_output=True, text=True, timeout=10)
    except (subprocess.SubprocessError, FileNotFoundError):
        return None
    # lsof exits 1 when some fds are inaccessible (common, unprivileged) — stdout is still usable.
    if out.returncode not in (0, 1):
        return None
    return sum(1 for line in out.stdout.splitlines() if 'PIPE' in line.split())


class ChildProcessWatcher:
    def __init__(self, on_event, samples_dir, use_dtrace=False):
        self.on_event = on_event
        self.samples_dir = samples_dir
        self.use_dtrace = use_dtrace
        self._known = {}  # pid -> {'cmd', 'low_cpu_since', 'flagged'}

    def poll(self, main_pid):
        now = time.time()
        current = set(find_descendants(main_pid))
        known_pids = set(self._known)

        for pid in current - known_pids:
            cmd = _proc_cmd(pid)
            self._known[pid] = {'cmd': cmd, 'low_cpu_since': None, 'flagged': False}
            self.on_event({'ts': now, 'category': 'child_process', 'kind': 'started',
                            'pid': pid, 'cmd': cmd,
                            'msg': f"child process started: {cmd} (pid {pid})"})

        for pid in known_pids - current:
            info = self._known.pop(pid, {})
            self.on_event({'ts': now, 'category': 'child_process', 'kind': 'exited',
                            'pid': pid, 'cmd': info.get('cmd'),
                            'msg': f"child process exited: {info.get('cmd')} (pid {pid})"})

        for pid in current:
            info = self._known[pid]
            cpu = _proc_cpu(pid)
            self.on_event({'ts': now, 'category': 'process', 'kind': 'child_process',
                            'pid': pid, 'cmd': info['cmd'], 'cpu_percent': cpu, 'role': 'child'})

            if cpu is None:
                continue
            if cpu > STALL_CPU_THRESHOLD:
                info['low_cpu_since'] = None
                info['flagged'] = False
                continue
            if info['low_cpu_since'] is None:
                info['low_cpu_since'] = now
            elif now - info['low_cpu_since'] >= STALL_WINDOW_S and not info['flagged']:
                info['flagged'] = True
                self._investigate_stall(pid, info, now)

    def _investigate_stall(self, pid, info, now):
        fds = pipe_fd_count(pid)
        sample_path = f"{self.samples_dir}/child_stall_{pid}_{int(now)}.sample.txt"
        stack_summary = None
        if sample_capture.capture_sample(pid, sample_path, seconds=2):
            stack_summary = symbolicate.summarize(sample_path)
        else:
            sample_path = None

        looks_like_pipe_block = bool(
            fds and fds > 0 and stack_summary
            and any(w in stack_summary.lower() for w in ('write', 'writev', 'fwrite'))
        )

        dtrace_confirmed = None
        if self.use_dtrace:
            # Direct confirmation instead of the heuristic above — see pipe_dtrace.py's own
            # header for why this is opt-in (needs sudo) rather than the default.
            dtrace_confirmed = pipe_dtrace.confirm_blocked_write(pid)
            if dtrace_confirmed:
                looks_like_pipe_block = True
        msg = (f"child process {info['cmd']} (pid {pid}) idle for {STALL_WINDOW_S:.0f}s+ "
               f"with {fds if fds is not None else '?'} open pipe fd(s)")
        if stack_summary:
            msg += f"; stack: {stack_summary}"
        if dtrace_confirmed is True:
            msg += " — dtrace CONFIRMED it is currently inside write()"
        elif looks_like_pipe_block:
            msg += " — looks like a blocked pipe write (see diagnostics/README.md)"

        self.on_event({
            'ts': now, 'category': 'child_process', 'kind': 'possible_stall',
            'pid': pid, 'cmd': info['cmd'], 'pipe_fd_count': fds,
            'stack_summary': stack_summary, 'sample_path': sample_path,
            'looks_like_pipe_block': looks_like_pipe_block,
            'dtrace_confirmed': dtrace_confirmed, 'msg': msg,
        })
