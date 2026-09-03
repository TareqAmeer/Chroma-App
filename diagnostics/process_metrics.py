"""
Process-level sampler: CPU%, RSS, thread count, open FD count.

Uses psutil (the one new pip dependency this tool adds — see requirements.txt).
Falls back to shelling out to `ps` for CPU/RSS if psutil is missing so the
rest of the tool can still run in a pinch, just with less detail.
"""
import subprocess
import time

try:
    import psutil
except ImportError:
    psutil = None


class ProcessGone(RuntimeError):
    pass


def sample(pid, cpu_interval=None):
    """
    Return a dict of current process metrics for pid, or raise ProcessGone.

    cpu_interval=None (default, used by the polling watcher loop) assumes the
    caller already primed a baseline via prime_cpu_percent — cheap, but reads
    0.0 on a truly first call. Pass a small positive interval (e.g. 0.1) for
    an ACCURATE single-shot read with no prior baseline — inspect.py's whole
    point is exact numbers on demand, so it can't rely on priming from a loop
    that was never running.
    """
    if psutil is not None:
        try:
            p = psutil.Process(pid)
            # A real interval must be OUTSIDE oneshot() — verified live: oneshot() batches
            # attribute reads under an instantaneous-snapshot assumption, which silently
            # breaks cpu_percent's need to sleep and diff two real time-separated reads
            # (interval=0.1 read 0.0% inside oneshot() against a process `ps` showed at
            # 217% CPU; the identical call outside oneshot() correctly read 291%).
            cpu = p.cpu_percent(interval=cpu_interval) if cpu_interval else None
            with p.oneshot():
                if cpu is None:
                    cpu = p.cpu_percent(interval=None)
                mem = p.memory_info()
                threads = p.num_threads()
                try:
                    fds = len(p.open_files())
                except (psutil.AccessDenied, psutil.Error):
                    fds = None
            return {
                'ts': time.time(),
                'category': 'process',
                'pid': pid,
                'cpu_percent': cpu,
                'rss_mb': round(mem.rss / (1024 * 1024), 2),
                'threads': threads,
                'open_files': fds,
            }
        except psutil.NoSuchProcess:
            raise ProcessGone(f"pid {pid} no longer running")

    # stdlib-only fallback
    try:
        out = subprocess.run(
            ['ps', '-o', 'pcpu=,rss=,nlwp=', '-p', str(pid)],
            capture_output=True, text=True, timeout=5,
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        raise ProcessGone(f"could not query pid {pid}")
    if out.returncode != 0 or not out.stdout.strip():
        raise ProcessGone(f"pid {pid} no longer running")
    parts = out.stdout.split()
    cpu = float(parts[0]) if len(parts) > 0 else None
    rss_kb = float(parts[1]) if len(parts) > 1 else None
    nlwp = int(parts[2]) if len(parts) > 2 else None
    return {
        'ts': time.time(),
        'category': 'process',
        'pid': pid,
        'cpu_percent': cpu,
        'rss_mb': round(rss_kb / 1024, 2) if rss_kb is not None else None,
        'threads': nlwp,
        'open_files': None,
    }


def prime_cpu_percent(pid):
    """psutil's cpu_percent needs a first throwaway call to establish a baseline."""
    if psutil is not None:
        try:
            psutil.Process(pid).cpu_percent(interval=None)
        except psutil.NoSuchProcess:
            raise ProcessGone(f"pid {pid} no longer running")
