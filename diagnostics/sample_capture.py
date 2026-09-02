"""
Capture a stack sample of a hung process using stock macOS tools —
no Xcode/Instruments required.

`sample <pid> <seconds>` is the default (fast, no sudo needed in most
configurations). `spindump` is the escalation for a process so wedged
that even `sample` can't get a response; it typically needs sudo.
"""
import os
import subprocess


def capture_sample(pid, out_path, seconds=3):
    """Run `sample` and write its report to out_path. Returns True on success."""
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
