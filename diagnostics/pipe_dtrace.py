"""
Optional instant confirmation for a suspected pipe-blocked child, using
dtrace instead of child_watch.py's default CPU-idle-then-sample heuristic.

Why this exists as a SEPARATE, opt-in path rather than the default:
dtrace was researched and tested directly against this machine before
choosing child_watch.py's lsof+sample approach as the default — it is NOT
simply "the first idea that worked."  Two things were verified empirically,
not assumed:
  1. SIP does NOT block tracing this app or its own worker subprocesses —
     SIP only restricts tracing Apple's own system binaries — so dtrace
     genuinely can watch our own processes' syscalls.
  2. dtrace still requires root regardless of SIP/target-binary status —
     confirmed live: `dtrace -n '...'` without sudo fails immediately with
     "DTrace requires additional privileges" — and this environment has no
     passwordless sudo, so it cannot be the tool's always-on default path.
Also tested and ruled out: macOS's own `ps -o stat,wchan` — unlike Linux's
D-state, it gives no signal distinguishing a process blocked in write() from
any other idle sleep (`STAT=SN WCHAN=-` on a synthetic reproduction that was,
in fact, blocked in write()).

So: child_watch.py's CPU-idle-then-sample heuristic (no privilege needed) is
the default and already gave a precise, correct confirmation in testing —
this module is for when you're willing to grant sudo once (the exact same
tradeoff `sample_capture.capture_spindump` already asks for) and want to
catch the block AT THE MOMENT it happens instead of waiting out
child_watch.STALL_WINDOW_S.

⚠️ Not live-verified with an interactive sudo prompt in this environment —
same disclosure standard as sample_capture.capture_spindump's own sudo path.
Verify against a real stalled pid before relying on it.
"""
import subprocess


def confirm_blocked_write(pid, duration_s=3):
    """
    Runs a short dtrace probe watching write()/writev() entry+return for pid.
    Returns True if a write() entry fires with no matching return before the
    probe ends (the process is IN the syscall, not merely about to call it) —
    a direct confirmation, not an inference from CPU%% or an fd count. Returns
    False if dtrace ran cleanly and saw no such stuck call, and None if dtrace
    itself couldn't run (no sudo, SIP fully blocking, dtrace missing, etc.).
    """
    script = (
        f'syscall::write*:entry /pid == {pid}/ {{ self->in_write = 1; }} '
        f'syscall::write*:return /pid == {pid}/ {{ self->in_write = 0; }} '
        f'tick-{int(duration_s)}sec {{ printf("STILL_IN_WRITE=%d", self->in_write); exit(0); }}'
    )
    try:
        result = subprocess.run(
            ['sudo', '-n', 'dtrace', '-n', script],
            capture_output=True, text=True, timeout=duration_s + 15,
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        return None
    if result.returncode != 0:
        return None  # no sudo / dtrace unavailable / SIP fully blocking — not a hard error
    return 'STILL_IN_WRITE=1' in result.stdout
