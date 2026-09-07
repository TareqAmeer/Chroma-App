# Handover — UI_SPEC.md implementation

## Plan file
`/Users/tareqameer/.claude/plans/use-the-claude-design-mcp-memoized-abelson.md` — full gap
analysis + step order. Read this first.

## Zone just completed: Step 3 — Library token/behavior cleanup

**What changed** (`desktop/library-ui.js`):
- Moved `#lib-aspect-toggle` ("Real aspect ratio") out of the Filters panel's Display section
  and into the gear `#lib-view-menu`'s Thumbnails group, per spec 2.7. Now styled/behaves like
  the other `opt-toggle` rows (`lib-tree-toggle`) — checkmark shows/hides via the existing `.on`
  class, no wiring changes needed (`overlay.querySelector` is position-agnostic).
- Confirmed the Types dropdown (`lib-type-filter`) already covers the full wireframe list
  (all/raw/jpeg/png/tiff/heic/webp/hdr/other/video) — the plan's "expand it" item was stale,
  no code change.
- Ran the Negative-Constraint-1 hex audit: every selector scoped directly to `#lib-overlay`
  already uses `var(--token)`. Remaining literal hex (flag reject/pick red/green, star gold,
  corrupt/offline banner colors) are semantic status colors with no corresponding DS token in
  this file — a different situation from the prior pass's bug (ignoring an *existing* token) —
  left alone.

**Verified**: `node --check` clean, `npm run lib:test` all PASS, side-by-side screenshot
against `?libtest=1&libcat=1` confirms the toggle now lives in the gear menu and its checkmark
responds. Not yet run through `bash desktop/install-app.sh` on the real installed app.

Also added a `chroma-desktop3` entry to `.claude/launch.json` (this session's scratchpad path,
port 8794) since the previous `chroma-desktop`/`chroma-desktop2` scratchpad paths from earlier
sessions no longer exist on disk — future sessions should add their own numbered variant the
same way rather than trying to reuse a stale path.

## Next logical zone (per plan.md's step order)
**Step 4**: Logo — copy `chromasmith-design/project/assets/chromasmith-logo.png` into the app's
own asset location, replace the text wordmark in both `library-ui.js` and `chromasmith-22.html`
topbars.

Then step 5 (theme store unification — `chromasmith_lib_theme` vs `csTheme`), and the
Editor-side steps 6-8 (native "Tools" menu in `desktop/src-tauri/src/main.rs`,
`#lib-overlay`/`#fx-toolrail`/`.fx-panel` token pass, context menu restructure) — see plan.md
for full detail on each, including the verified selector mapping (filmstrip = docked
`#lib-overlay`, not `#fx-filmstrip`).

## Type `/clear` now, then start the next session by asking to read `HANDOVER.md`.
