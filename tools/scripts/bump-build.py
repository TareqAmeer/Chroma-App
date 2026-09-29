#!/usr/bin/env python3
"""Pre-commit: stamp chromasmith-22.html BUILD as 1.MMDDx (x = A,B,C... per commit that day).
Letter is derived from HEAD's BUILD, so it is idempotent. Patches the working file AND the
index blob, so other agents' unstaged edits in the file are never staged by this."""
import datetime, re, subprocess

F = "chromasmith-22.html"
RE = re.compile(r"const BUILD='[^']*'")
def sh(*a, inp=None):
    return subprocess.run(a, input=inp, capture_output=True, check=True).stdout

today = datetime.date.today().strftime("%m%d")
try:
    head = sh("git", "show", "HEAD:" + F).decode("utf-8", "replace")
    m = re.search(r"const BUILD='1\.(\d{4})([A-Z])'", head)
except subprocess.CalledProcessError:
    m = None
letter = chr(ord(m.group(2)) + 1) if m and m.group(1) == today and m.group(2) < "Z" else "A"
new = "const BUILD='1.%s%s'" % (today, letter)

def patch(b):
    return RE.sub(new, b, count=1)

work = open(F, encoding="utf-8", newline="").read()
open(F, "w", encoding="utf-8", newline="").write(patch(work))
staged = sh("git", "show", ":" + F)
blob = sh("git", "hash-object", "-w", "--stdin", inp=patch(staged.decode("utf-8")).encode("utf-8")).decode().strip()
mode = sh("git", "ls-files", "-s", F).split()[0].decode()
sh("git", "update-index", "--cacheinfo", "%s,%s,%s" % (mode, blob, F))
print("BUILD ->", new)
