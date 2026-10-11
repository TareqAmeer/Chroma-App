"""Run the existing diagnostics CLI without automatic full Windows memory dumps.

Usage: python scripts/diagnostics-light.py start --duration 5m
Pass --full-dumps explicitly when a full process-memory capture is needed.
Metrics, logs, native telemetry and lightweight thread-state samples remain enabled.
"""
import importlib
from pathlib import Path
import subprocess
import sys


def main():
    repo = Path(__file__).resolve().parent.parent
    diagnostics = repo / "diagnostics"
    if not (diagnostics / "cli.py").is_file():
        # Linked checkouts may use the existing toolkit in the primary checkout.
        common = subprocess.check_output(
            ["git", "rev-parse", "--git-common-dir"], cwd=repo, text=True
        ).strip()
        common_path = (repo / common).resolve()
        diagnostics = common_path.parent / "diagnostics"
    if not (diagnostics / "cli.py").is_file():
        raise SystemExit("Existing diagnostics toolkit not found; no watcher started.")
    full_dumps = "--full-dumps" in sys.argv
    sys.argv = [str(diagnostics / "cli.py")] + [arg for arg in sys.argv[1:] if arg != "--full-dumps"]
    sys.path.insert(0, str(diagnostics))
    sample_capture = importlib.import_module("sample_capture")
    if not full_dumps:
        sample_capture._find_procdump = lambda: None
    importlib.import_module("cli").main()


if __name__ == "__main__":
    main()
