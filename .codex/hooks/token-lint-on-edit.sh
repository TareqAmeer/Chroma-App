#!/bin/sh
# PostToolUse/Edit hook: flags raw colour/size literals an Edit just ADDED to chromasmith-22.html's
# <style> block or desktop/library-ui.js's CSS template literal, instead of reusing a design/tokens.json
# token. Advisory only (never blocks) — prints violations to stderr so they surface without
# interrupting the edit.
#
# Why lint only what the edit ADDED (new_string minus old_string), not the whole file: <style>
# already carries 940 pre-existing raw literals (115 of them "1px") from before design/tokens.json
# existed. Whole-block linting would report that old debt on every unrelated edit; this only
# flags literals this specific Edit introduced that weren't already there.
#
# Why a plain string search for "is this inside <style>/a CSS template literal", not a git diff:
# measured at 0.12-0.26s here vs 0.3-0.4s for `git diff -U0` on the 17.7MB HTML file (S1(c),
# docs/ui-workflow/STATE.md) — a git diff also can't run mid-edit before the tool has committed
# anything to the working tree in a way this hook could rely on being fast.
repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
input=$(cat)

file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
old=$(printf '%s' "$input" | jq -r '.tool_input.old_string // empty' 2>/dev/null)
new=$(printf '%s' "$input" | jq -r '.tool_input.new_string // empty' 2>/dev/null)

[ -n "$file" ] || exit 0
[ -n "$new" ] || exit 0

case "$file" in
  "$repo/chromasmith-22.html") kind=html ;;
  "$repo/desktop/library-ui.js") kind=js ;;
  *) exit 0 ;;
esac

node -e '
const fs = require("fs");
const [, kind, file, oldStr, newStr] = process.argv;

const stripCommentsAndDecls = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, "")           // block comments
  .replace(/--[a-zA-Z0-9-]+\s*:\s*[^;{}]*/g, ""); // --x: token definitions (defs, not usages)

function literals(s) {
  const cleaned = stripCommentsAndDecls(s);
  const hex = cleaned.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  const px = (cleaned.match(/-?\d+(\.\d+)?px\b/g) || []).filter((v) => v !== "1px" && v !== "-1px");
  const counts = {};
  for (const v of [...hex, ...px]) counts[v] = (counts[v] || 0) + 1;
  return counts;
}

function containmentOk() {
  let full;
  try { full = fs.readFileSync(file, "utf8"); } catch { return false; }
  const idx = full.indexOf(newStr);
  if (idx === -1) return true; // cannot locate (already further edited) — do not block on it
  if (kind === "html") {
    const styleOpen = full.lastIndexOf("<style>", idx);
    const styleClose = full.indexOf("</style>", idx);
    const prevClose = full.lastIndexOf("</style>", idx);
    return styleOpen !== -1 && styleClose !== -1 && prevClose < styleOpen;
  }
  // js: must sit inside a backtick-delimited template literal
  const before = full.slice(0, idx);
  const backticks = (before.match(/`/g) || []).length;
  return backticks % 2 === 1;
}

if (!containmentOk()) process.exit(0);

const oldCounts = literals(oldStr || "");
const newCounts = literals(newStr || "");
const added = [];
for (const [lit, n] of Object.entries(newCounts)) {
  const extra = n - (oldCounts[lit] || 0);
  for (let i = 0; i < extra; i++) added.push(lit);
}
if (added.length) {
  console.error(`token-lint: ${file.replace(process.cwd()+"/","")} — new literal(s) not using a design/tokens.json token: ${added.join(", ")}`);
  console.error("  If this value already exists as a token, reference it (or var(--x) / a CSS var); otherwise add it to design/tokens.json and regenerate via scripts/build-tokens.mjs.");
}
' "$kind" "$file" "$old" "$new"

exit 0
