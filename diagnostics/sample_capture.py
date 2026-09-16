"""
Capture a stack sample of a hung process using stock macOS tools —
no Xcode/Instruments required.

`sample <pid> <seconds>` is the default (fast, no sudo needed in most
configurations). `spindump` is the escalation for a process so wedged
that even `sample` can't get a response; it typically needs sudo.

Windows (2026-09-16): there's no `sample`/Instruments equivalent built into the OS, and the
release binary ships without symbols on every platform (cargo build's `-C strip=symbols`) —
so even a real stack walk mostly resolves to "??? (in chromasmith)" per symbolicate.py's own
comment. Given that, a full symbol-resolving reader (cdb/WinDbg, or Python's `minidump`
package) buys little over the free, no-install signal .NET's `Process.Threads` already
exposes: per-thread `ThreadState`/`WaitReason`. A thread reporting `Wait`/`EventPairLow` or
`Wait`/`LpcReceive` is blocked on a kernel object (mutex, IPC, condvar) — a deadlock/stall
shape; `Running` with no wait reason is spinning — a busy-loop shape. That distinction is
exactly what's needed to tell "stuck waiting on something that will never signal" from "burning
CPU in a loop", and needs zero code inside chromasmith.exe. `_thread_states_windows` produces
this, formatted to match `sample`'s own conventions (THREAD_HEADER_RE/FRAME_RE in
symbolicate.py) so the existing summarizer/report pipeline needs no separate Windows path.

Sysinternals `procdump.exe -ma <pid> <out_path>` (Microsoft's own tool, a single signed .exe,
no install) is captured ALONGSIDE the thread-state text, as a heavier fallback: a full-memory
minidump an engineer can open in WinDbg/Visual Studio later for a real symbol-resolved stack
walk if the lightweight signal above isn't enough. capture_sample() returns True if either
capture succeeds; the .txt (thread states) is what summarize() actually reads.
"""
import os
import shutil
import subprocess
import sys
import textwrap

IS_WINDOWS = sys.platform == 'win32'

# One PowerShell one-liner, no admin rights needed: enumerate every thread of the target
# process and print (id, state, wait reason, total CPU time) in a fixed, parseable format.
# `-ErrorAction Stop` on Get-Process turns "no such pid" into a catchable terminating error
# instead of writing to stderr and returning nothing (which would look like "0 threads").
_PS_THREAD_DUMP = textwrap.dedent("""
    $ErrorActionPreference = 'Stop'
    $p = Get-Process -Id {pid}
    foreach ($t in $p.Threads) {{
        $wait = try {{ $t.WaitReason }} catch {{ 'N/A' }}
        "{{0}}|{{1}}|{{2}}|{{3}}" -f $t.Id, $t.ThreadState, $wait, $t.TotalProcessorTime
    }}
""").strip()


def _find_procdump():
    """Look for procdump(64).exe on PATH, or the common winget/Sysinternals/diagnostics/tools install locations."""
    for name in ('procdump64.exe', 'procdump.exe'):
        found = shutil.which(name)
        if found:
            return found
    for candidate in (
        os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Microsoft', 'WinGet', 'Links', 'procdump64.exe'),
        os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Microsoft', 'WinGet', 'Links', 'procdump.exe'),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tools', 'procdump64.exe'),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tools', 'procdump.exe'),
    ):
        if candidate and os.path.exists(candidate):
            return candidate
    return None


def _thread_states_windows(pid, out_path, seconds=3):
    """
    Write a `sample`-shaped text file summarizing every thread's ThreadState/WaitReason —
    see module docstring for why this, instead of a full symbol-resolving stack walk.
    Returns True if at least one thread line was captured.
    """
    try:
        result = subprocess.run(
            ['powershell', '-NoProfile', '-NonInteractive', '-Command',
             _PS_THREAD_DUMP.format(pid=pid)],
            capture_output=True, text=True, timeout=seconds + 15,
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        return False
    lines = [ln for ln in result.stdout.splitlines() if ln.strip() and '|' in ln]
    if not lines:
        return False
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    out = ['Windows thread-state snapshot (no symbols - see sample_capture.py docstring)', '']
    for ln in lines:
        parts = ln.split('|')
        if len(parts) != 4:
            continue
        tid, state, wait, cpu_time = parts
        # Formatted to satisfy symbolicate.py's THREAD_HEADER_RE (leading count + "Thread_...")
        # and FRAME_RE (leading count + frame text) so the existing summarizer needs no
        # Windows-specific branch — a "frame" here is just the state/wait-reason pair.
        out.append(f"  1 Thread_{tid}   CPU: {cpu_time}")
        out.append(f"  1 {state} (wait reason: {wait})")
        out.append('')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out))
    return True


def _capture_sample_windows(pid, out_path, seconds=3):
    got_states = _thread_states_windows(pid, out_path, seconds=seconds)
    procdump = _find_procdump()
    if procdump is not None:
        dump_path = out_path + '.dmp'
        try:
            subprocess.run(
                # -ma: full dump (all process memory) so a reader can walk every thread's stack,
                # not just the faulting one. -accepteula: procdump's EULA prompt is interactive
                # and would hang this call forever on a first-ever invocation otherwise.
                [procdump, '-accepteula', '-ma', str(pid), dump_path],
                capture_output=True, text=True, timeout=seconds + 30,
            )
        except (subprocess.SubprocessError, FileNotFoundError):
            pass
    return got_states or (os.path.exists(out_path) and os.path.getsize(out_path) > 0)


def capture_sample(pid, out_path, seconds=3):
    """Run `sample` (or, on Windows, procdump) and write its report to out_path. Returns True on success."""
    if IS_WINDOWS:
        return _capture_sample_windows(pid, out_path, seconds=seconds)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    try:
        subprocess.run(
            ['sample', str(pid), str(seconds), '-f', out_path],
            capture_output=True, text=True, timeout=seconds + 15,
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        return False
    return os.path.exists(out_path) and os.path.getsize(out_path) > 0


def capture_spindump(pid, out_path, seconds=3):
    """Run `spindump` (may prompt for sudo) and write its report to out_path."""
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    try:
        subprocess.run(
            ['sudo', 'spindump', str(pid), '-notarget', str(seconds), '-o', out_path],
            capture_output=True, text=True, timeout=seconds + 30,
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        return False
    return os.path.exists(out_path) and os.path.getsize(out_path) > 0
