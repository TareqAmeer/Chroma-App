"""
Capture what code produced a run's behavior: git commit, dirty-file list,
and chromasmith-22.html's own BUILD stamp (CLAUDE.md: "Bump it in every
session that edits the file" — so it's the fastest way to tell whether a
report came from a build the user actually tested against).

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


def capture():
    commit = _run(['git', 'rev-parse', 'HEAD'])
    commit_short = _run(['git', 'rev-parse', '--short', 'HEAD'])
    branch = _run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])
    dirty_out = _run(['git', 'status', '--porcelain'])
    dirty_files = [l[3:] for l in dirty_out.splitlines()] if dirty_out else []

    # chromasmith-22.html is ~17MB (base64 LUT presets precede the BUILD
    # const by ~2.3MB) — grep is far cheaper than loading it into Python.
    build_stamp = None
    grep_out = _run(['grep', '-m1', '-o', r"const BUILD='[^']*'", HTML_PATH])
    if grep_out:
        m = BUILD_RE.search(grep_out)
        if m:
            build_stamp = m.group(1)

    return {
        'commit': commit,
        'commit_short': commit_short,
        'branch': branch,
        'dirty_files': dirty_files,
        'build_stamp': build_stamp,
    }
