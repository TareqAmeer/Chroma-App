"""
Capture a stack sample of a hung process using stock macOS tools —
no Xcode/Instruments required.

`sample <pid> <seconds>` is the default (fast, no sudo needed in most
configurations). `spindump` is the escalation for a process so wedged
that even `sample` can't get a response; it typically needs sudo.

Windows (2026-09-15): there's no `sample`/Instruments equivalent built into the OS. Research
finding: Sysinternals `procdump.exe -ma <pid> <out_path>` (Microsoft's own tool, a single
signed .exe, no install) writes a full minidump on demand without admin rights for a process
owned by the current user. This is a BEST-EFFORT substitute, not a like-for-like port: `sample`
returns a human-readable symbolicated-ish stack text file that symbolicate.py greps directly;
a minidump is a binary format that needs a separate reader (`cdb`/WinDbg, or Python's `minidump`
package — neither wired up here) to get frame text back out. capture_sample() on Windows writes
the dump and returns True/False on capture success only; symbolicate.py's summarize() will not
find any 'write'/'writev'-shaped text in it (see child_watch.py's pipe_fd_count docstring for
the related, and equally genuine, fd-count gap on Windows) until a minidump reader is added.
"""
import os
import shutil
import subprocess
import sys

IS_WINDOWS = sys.platform == 'win32'


def _find_procdump():
    """Look for procdump(64).exe on PATH, or the common winget/Sysinternals install locations."""
    for name in ('procdump64.exe', 'procdump.exe'):
        found = shutil.which(name)
        if found:
            return found
    for candidate in (
        os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Microsoft', 'WinGet', 'Links', 'procdump64.exe'),
        os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Microsoft', 'WinGet', 'Links', 'procdump.exe'),
    ):
        if candidate and os.path.exists(candidate):
            return candidate
    return None


def _capture_sample_windows(pid, out_path, seconds=3):
    procdump = _find_procdump()
    if procdump is None:
        return False
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    dump_path = out_path if out_path.endswith(('.dmp', '.mdmp')) else out_path + '.dmp'
    try:
        subprocess.run(
            # -ma: full dump (all process memory) so a reader can walk every thread's stack,
            # not just the faulting one. -accepteula: procdump's EULA prompt is interactive
            # and would hang this call forever on a first-ever invocation otherwise.
            [procdump, '-accepteula', '-ma', str(pid), dump_path],
            capture_output=True, text=True, timeout=seconds + 30,
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        return False
    return os.path.exists(dump_path) and os.path.getsize(dump_path) > 0


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
