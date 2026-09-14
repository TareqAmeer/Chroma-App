#!/usr/bin/env python3
"""PostToolUse/Write|Edit hook body: bumps chromasmith-22.html's BUILD stamp to today's date
whenever an edit lands and the stamp is stale. See CLAUDE.md §2's build-stamp note.

Kept as a real .py file (not a `python - <<HEREDOC` inline block in the .sh wrapper) because a
heredoc passed to `python -` becomes the interpreter's stdin — the SAME stream the wrapper pipes
the hook's JSON payload through — so the program source consumes the payload and json.load()
always failed silently. Called as: bump-build-stamp.py <path-to-chromasmith-22.html>, with the
hook's JSON payload arriving on this script's own stdin (nothing else uses stdin now).
"""
import json
import os
import re
import sys
import datetime


def main():
    if len(sys.argv) != 2:
        return 0
    f = sys.argv[1]

    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0

    edited = payload.get("tool_input", {}).get("file_path", "")
    # Compare basenames, not full resolved paths: under git-bash on Windows the wrapper's $repo
    # (built from `pwd`) is POSIX-style ("/c/Users/..."), while the harness hands this script a
    # native Windows path ("C:\Users\...") for tool_input.file_path — a native python.exe's
    # os.path.realpath does not reconcile those two spellings of the same file, so a full-path
    # comparison silently mismatches on Windows even though both name the same file. There is
    # exactly one chromasmith-22.html in this repo, so a basename check is sufficient.
    if os.path.basename(edited).lower() != os.path.basename(f).lower():
        return 0

    try:
        with open(f, "r", encoding="utf-8") as fh:
            html = fh.read()
    except FileNotFoundError:
        return 0

    today = datetime.date.today().isoformat()
    m = re.search(r"const BUILD='([0-9-]+)[a-z]*'", html)
    if m and m.group(1) == today:
        return 0  # already stamped today

    new_html, n = re.subn(r"const BUILD='[0-9-]*[a-z]*'", f"const BUILD='{today}a'", html, count=1)
    if n:
        with open(f, "w", encoding="utf-8", newline="") as fh:
            fh.write(new_html)
    return 0


if __name__ == "__main__":
    sys.exit(main())
