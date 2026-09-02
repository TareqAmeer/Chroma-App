"""
Capture what code produced a run's behavior: git commit, dirty-file list,
chromasmith-22.html's own BUILD stamp (CLAUDE.md: "Bump it in every
session that edits the file"), and — the actual running binary's mtime
compared against HEAD's commit time. This exists because a stale-deploy
question ("is this really today's build?") previously took manually
grep'ing dist files and comparing binary timestamps against git HEAD by
hand; here it's answered in the header instead.

Written once per run as meta.json so a report found later is self-describing
without needing the conversation that produced it.
"""
import os
import re
import subprocess

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML_PATH = os.path.join(REPO, 'chromasmith-22.html')

BUILD_RE = re.compile(r"const BUILD='([^']+)'")


def _run(cmd):
    try:
        out = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, timeout=5)
    except (subprocess.SubprocessError, FileNotFoundError):
        return None
    if out.returncode != 0:
        return None
    # rstrip only — `git status --porcelain` lines are meaningfully
    # space-prefixed (XY<space>path); a full .strip() eats the leading
    # space of the FIRST line only, misaligning every line[3:] parse below.
    return out.stdout.rstrip('\n')


def capture(binary_path=None):
    commit = _run(['git', 'rev-parse', 'HEAD'])
    commit_short = _run(['git', 'rev-parse', '--short', 'HEAD'])
    branch = _run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])
    dirty_out = _run(['git', 'status', '--porcelain'])
    dirty_files = [l[3:] for l in dirty_out.splitlines()] if dirty_out else []

    commit_time = None
    commit_time_out = _run(['git', 'log', '-1', '--format=%ct'])
    if commit_time_out:
        try:
            commit_time = float(commit_time_out)
        except ValueError:
            pass

    # chromasmith-22.html is ~17MB (base64 LUT presets precede the BUILD
    # const by ~2.3MB) — grep is far cheaper than loading it into Python.
    build_stamp = None
    grep_out = _run(['grep', '-m1', '-o', r"const BUILD='[^']*'", HTML_PATH])
    if grep_out:
        m = BUILD_RE.search(grep_out)
        if m:
            build_stamp = m.group(1)

    # Answers "is the running binary actually today's build?" directly: a
    # Rust source edit needs a real `cargo build` + full app restart (a
    # plain in-app reload only picks up JS/CSS from disk) — this compares
    # the binary's own mtime against the commit it's supposedly built from,
    # rather than the user grep'ing dist files and timestamps by hand.
    binary_mtime = None
    binary_stale = None
    if binary_path and os.path.exists(binary_path):
        try:
            binary_mtime = os.path.getmtime(binary_path)
        except OSError:
            pass
    if binary_mtime is not None and commit_time is not None:
        # "stale" here means the binary predates HEAD by more than a minute
        # of build/copy slop — a binary built AFTER HEAD's commit time (the
        # normal case: you commit, then build) is not stale.
        binary_stale = binary_mtime < commit_time - 60

    return {
        'commit': commit,
        'commit_short': commit_short,
        'commit_time': commit_time,
        'branch': branch,
        'dirty_files': dirty_files,
        'build_stamp': build_stamp,
        'binary_path': binary_path,
        'binary_mtime': binary_mtime,
        'binary_stale': binary_stale,
    }
