#!/usr/bin/env python3
"""Proves every app CSS var in the three source blocks (chromasmith-22.html :root ~50-98,
its body.light override ~1263-1301, desktop/library-ui.js's DS token block ~695-776) is either
present in design/tokens.json ($extensions.chromasmith.appVar) or listed in
design/token-conflicts.md. Run: python3 design/verify_tokens.py
"""
import json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

def declared_vars(path, start, end):
    lines = path.read_text().split("\n")
    seg = "\n".join(lines[start - 1:end])
    return sorted(set(re.findall(r'--[a-zA-Z0-9-]+(?=\s*:)', seg)))

def find_block(path, marker, span=200):
    lines = path.read_text().split("\n")
    for i, l in enumerate(lines, 1):
        if marker in l:
            return i
    return None

html = ROOT / "chromasmith-22.html"
lib = ROOT / "desktop/library-ui.js"

root_start, root_end = 50, 98
light_line = find_block(html, "body.light{", )
# second occurrence is the real override block (first is the one-liner at line 99)
lines = html.read_text().split("\n")
light_lines = [i for i, l in enumerate(lines, 1) if l.strip().startswith("body.light{")]
light_start = light_lines[-1]
# find matching closing brace
light_end = light_start
depth = 0
for i in range(light_start - 1, len(lines)):
    depth += lines[i].count("{") - lines[i].count("}")
    if depth == 0 and i > light_start - 1:
        light_end = i + 1
        break

lib_start = find_block(lib, "const DS_FONTS")
lib_end_marker = None
lib_lines = lib.read_text().split("\n")
for i, l in enumerate(lib_lines, 1):
    if l.strip() == "`;" and i > lib_start:
        lib_end_marker = i
        break

wanted = set()
wanted |= set(declared_vars(html, root_start, root_end))
wanted |= set(declared_vars(html, light_start, light_end))
wanted |= set(declared_vars(lib, lib_start, lib_end_marker))

tokens = json.loads((ROOT / "design/tokens.json").read_text())

covered = set()
def walk(node):
    if isinstance(node, dict):
        ext = node.get("$extensions", {}).get("chromasmith")
        if ext and "appVar" in ext:
            covered.add(ext["appVar"])
        for v in node.values():
            walk(v)
walk(tokens)

conflicts_text = (ROOT / "design/token-conflicts.md").read_text()
conflict_vars = set(re.findall(r'`(--[a-zA-Z0-9-]+)`', conflicts_text))

missing = sorted(v for v in wanted if v not in covered and v not in conflict_vars)

print(f"declared app vars found: {len(wanted)}")
print(f"covered by tokens.json:  {len(covered & wanted)}")
print(f"listed in conflicts.md:  {len(conflict_vars & wanted)}")
if missing:
    print(f"\nMISSING ({len(missing)}) — not in tokens.json nor token-conflicts.md:")
    for m in missing:
        print(" ", m)
    sys.exit(1)
print("\nOK — every declared app var is a token or a documented conflict.")
