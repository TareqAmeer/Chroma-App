# App worktree integration — 6 October 2026

Baseline: origin/main at 21379cc2. Scope: app features only; promo video, homepage,
branding and packaging remain in their original local checkouts.

## Why publication was blocked

Main was checked out at 61056ea8 in a worktree with uncommitted Quick Look edits.
The checkout and drafts were preserved on codex/preserve-chr152-20261006; integration
uses a clean main worktree fast-forwarded to origin/main. Remote main advanced to
5ffea4d9 during verification; its pet-clustering fix was integrated by fast-forward
and the app changes reapplied from a preserved Git snapshot. The main-only completion
rule had previously blocked feature-branch commits. Many old worktree changes are
already on main; replacing entire files would have removed newer features.

## Missing changes integrated

- CHR-245: red-eye/pet-eye recipe, controls, preview/export/session/copy integration
  and missing SCRFD native command. Fixed current tool grouping, duplicate operations
  on ellipse drag, stale auto-detection, white-reflection darkening and preview offsets.
- CHR-267 slice: shared Quick Look requests, bounded five-entry LRU and adjacent-image
  prefetch, with stale close/error handling. Full cull presentation, time grouping,
  auto-advance and real 45 MP latency requirements remain future work.
- CHR-113/115/116/117: applicable mobile content-box fitting, slider scrolling and
  visual reset work, preserving main's newer pinch/zoom and section reset handling.
- Windows QA (1b36fe75): Recycle Bin and shell path handling, video poster paths,
  shortcut wording, Settings Escape handling, narrow toolbar and HDR guidance.
  Preserved main's configurable shortcut registry.
- Windows export harness: use ANGLE SwiftShader. The previous direct GL flag lost
  every context/program before rendering on both baseline and integrated main.

## Original worktree audit

| Checkout / branch | Result |
| --- | --- |
| codex/browser | Missing app hunks integrated; other work preserved locally |
| chr152-motion / former main | Quick Look edit integrated; dirty checkout preserved on named branch |
| chr276-split-view / detached | Both commits already published as patch-equivalent 0223af26 and d7ae4400; comment-only edit left local |
| studio-intro / detached | Committed work already on main; video drafts stay local |
| transfer/pilot-v8 | Promo-only commits excluded; files stay local |
| claude/3d-video-quality-improvements-96849b | Already on main |
| claude/android-simulator-testing-ad17ef | Already on main |
| claude/backlog-easy-wins-dbc80f | Already on main |
| claude/windows-app-rebuild-qa-72410b | Windows app changes integrated |
| claude/chromasmith-windows-hdr-export-b432e6 | Already on main |
| claude/chromasmith-windows-video-posters-4e5b22 | Already on main |
| claude/ecstatic-lamarr-b9b4f4 | Already on main |
| claude/editor-gates-concurrency-tune-6a5ff4 | Already on main |
| claude/lib-compare-dropdown-playwright-31d612 | Already on main |
| promo-v11 | Promo-only commits excluded; files stay local |
| codex/chr245-red-eye | App changes integrated |

## Verification and limits

Windows cargo check --offline passes. Existing ignored model/runtime files were
reused locally; no models or generated builds were added to the publication.
Thirty export fixture/recipe images match unchanged main byte-for-byte with the
identical Windows software renderer; the normal export harness also completes all
thirty. Focused tests cover Quick Look deduplication, neighbors and cache bounds;
red-eye neutral/disabled identity, pupil isolation, pet correction, snapshot/export
state, current panel grouping and moving an existing ellipse. Unified layout,
Library scroll anchoring, shortcut registry, HTML validity and phone interactions
were checked. The five retained/added phone checks pass, as do undo, session
round-trip and snapshot coverage. Final native compilation was repeated after
including remote commit 5ffea4d9.

Both full editor gate runs fail the same eleven gate names: inventory, responsive,
wireframe diff, token check, icon check, motion tokens, hover/focus matrix, zoom,
surface coverage, component registry and catalog visual. After correcting panel
grouping the structural inventory matches baseline exactly (878 findings). The UI
audit has the same two baseline findings (Looks search target and phone Studio
contrast). The mixed desktop/mobile responsive sweep flags one additional 3px
quick-bar clipping entry for the new Red Eye button (36 findings versus 35 on
baseline); existing clipping entries are unchanged. Real phone checks confirm all
quick-bar buttons fit after making their height follow the row. This remaining
harness warning is not a claim of a fully clean responsive gate. No gate was
disabled and no visual baseline was regenerated.

This does not establish human/pet flash-photo quality, real native runtime behavior
or CHR-267's real-photo latency targets. Those acceptance items remain for review.
