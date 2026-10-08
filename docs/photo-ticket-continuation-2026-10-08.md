# Photo-ticket continuation — 8 October 2026

This record covers the handoff tickets and related unfinished photo-editing issues inspected in Linear. It is an evidence handoff, not a claim that every repository proposal has been implemented. No issue was marked Done.

## Delivered and published in this continuation

| Ticket | Evidence | Publication | Linear |
| --- | --- | --- | --- |
| CHR-201 / CHR-202 | Real WebView2→Rust failed disk write; 20 photos × 3 recipes; retry produces 60 files, preserving SHA-256 of the 59 successful files. Destination restoration, suffix/skip and native Explorer reveal command pass. | `7b396b4898137be88368b643483ead245ea076f7` | In Review; CHR-202 retry AC checked |
| CHR-208 | Fixed imported XMP metadata loss. JPEG+PNG ingest → four JPEG/PNG exports retain creator/copyright/caption/job/keywords/custom field. Backup XMP matches; unrenamed re-import skips both. | `8af4b0654bfad103f6a5086ae18bf0364ea89af6` | In Progress; broader AC3/AC5 open |
| CHR-275 | Fixed rebound modifier state not reaching brush painting. Native 35/35 raster checks: Shift erase, stationary cursor, release, old Alt removal, cleanup, undo/redo and snapshot pixels. | `ea3a56c7d3f9cfebc21c913ead0a2a23aeecb7fc` | In Progress; rebinding AC checked |
| CHR-199 / CHR-268 | Native mixed-size source crops, linked/unlinked pan, eight-cell Survey. Both panes match independently decoded source crops: MAE ≈0.312, max difference 1. | `93c874aaaecf0b8cd84c9afa059ede6037bf605e` | In Progress; CHR-199 source-detail AC checked |
| CHR-205 | Focused native bundle suite 4/4: WAL snapshot, staged capture/restore, tamper/path-traversal rejection, existing-destination refusal. | `632a2389663db7c013b564cc796bb3149a6575e5` | In Progress; no new AC |
| CHR-262 | Focused actual Rust backend 9/9; CHR-208 import metadata regression also 1/1 in the same test binary. | Evidence in `69f2fb2b7e221a3e9fb2bbabe5b07f68ffbb178e` | In Progress; no quality/platform AC inferred |

Fresh fetch, remote `ls-remote`, and integration ancestry verified the publication commits. Source-detail publication is a test-only change plus the repository commit hook's BUILD marker; its integrated test syntax/whitespace checks passed.

## Significant remaining dependencies and validation gaps

| Ticket | Remaining boundary; keep unchecked |
| --- | --- |
| CHR-208 | Renamed re-import still duplicates copies. TIFF/WebP/RAW metadata lanes and saved-job-recipe native UI end-to-end were not validated by the bounded JPEG/PNG fixture. |
| CHR-205 | Separate-folder restore does not implement clean-install activation/rollback or cross-machine relinking. Browser IndexedDB assets and relationship/version/people/keyword semantic equivalence need complete inventory and a representative fixture. |
| CHR-249 | Validated/licensed local 2× model and Raw Details backend are missing; complete RAW denoise editability/model delivery remains open. Accepted Lightroom references/tolerances and five-photo sign-off are absent. |
| CHR-246 | Previously observed person/pole semantic smearing prevents object-removal and natural-image 100% quality acceptance. This continuation adds no inpainting/model quality evidence. |
| CHR-262 | Real colour/B&W negative RAW/TIFF pairs with accepted known-good conversions/tolerances and native grade/export checks are missing. iOS validation cannot run on this Windows host. |
| CHR-275 | Full feather/density settings parity, pen/touch acceptance, Heal/Spot erase targeting and complete stroke/modifier-conflict coverage remain open. |
| CHR-199 | Combined linked/source/rating/winner criterion and advisory-focus behavior still need complete acceptance evidence. Shared advisory analysis depends on CHR-269. |
| CHR-268 | Per-cell prefetch/no-flash selection transitions are not established by source-detail/layout tests. |
| CHR-267 | Real 45MP RAW prefetch timing gate, confirmed native Trash behavior and all-action undo remain unverified. Synthetic grouping/grid scale is separate evidence. |
| CHR-269 | Validated local eye/expression analysis, catalog focus/filter and durable suggestion jobs; labelled precision/recall and accepted false-reject thresholds remain missing. |
| CHR-200 | Cross-job restart-safe recovery/interruption semantics, stalled-vs-failed messaging and foreground responsiveness are not established by one-process native export retry. |
| CHR-271 | Persistent raster-owning flatten/undo boundary is not implemented. Named checkpoint tests do not prove destructive flatten identity or post-flatten undo. |
| CHR-244 | Published backend refuses three-photo input; general feature-match/homography/seam/projection stitching and its dependent output/job/catalog lanes are not implemented. |

These are not all external blockers: several are substantial unfinished backend requirements. Linear comments distinguish those implementation gaps from unavailable quality/platform fixtures. Incomplete issues remain In Progress; their checkboxes were not upgraded from unrelated synthetic tests.

## Native setup and preservation

The MSVC archive access-denied error was bypassed with authorized unsandboxed execution. A temporary configuration excluding missing AI bundle resources allowed native import/export and focused Rust validation. This does not validate omitted AI assets. Generated frontend files were staged into the binary runtime directory; an early stale-frontend rerun was rejected as evidence.

The dirty root checkout's tracked changes were preserved. Work stayed in named feature worktrees and the clean integration checkout, with exact-file commits and fast-forward main pushes. The old CHR-202 worktree was removed only after clean status, exact published product/test comparison and branch-preservation checks; `codex/chr202-metadata-policy` still retains `962f6a3deff8eda8170f8eb52ab13defc089b3c0`. New evidence worktrees and ignored fixtures remain available; none was force-removed.
