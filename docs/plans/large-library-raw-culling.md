# Large-library RAW culling execution plan

Date: 11 October 2026. Initial baseline: origin/main `180355a8`. User authorization: review the culling queue, formalize this plan, execute, validate, and install necessary dependencies while limiting disk consumption.

## Product contract

Most photos are RAW. Review must use developed sensor data, not camera-embedded JPEGs: their colour rendering differs from the Editor. A JPEG *encoded from our developed RAW rendering* is a permissible cache format; its provenance and measured colour fidelity matter. Never silently substitute camera JPEGs on cache miss. Show loading/unavailable status and keep metadata actions bound to the intended photo. Fit previews are not proof of native 100% focus detail.

## Ticket/evidence map

| Ticket | Current evidence | Work remaining / priority |
| --- | --- | --- |
| CHR-267 | Cull layout, undoable keyboard metadata, grouping, bounded prefetch, trash restoration; all original criteria checked | P1 navigation scale; new RAW-only review requirement; representative performance follow-up |
| CHR-268 | Compare/Survey 2–8, linked native detail, metadata, bounded switching; original checklist checked | Preserve behavior; measure mixed RAW memory and traverse all selected photos clearly |
| CHR-199 | Paged four-photo cull, keeper/advance, native inspection checked | Preserve linked comparison and prove advisory behavior; reconcile overlapping checklist with evidence |
| CHR-269 | Duplicate/burst suggestions, local focus scores/filter, face crops and explicit confirmation | Durable background analysis, refresh completed scores, labelled accuracy; eye/expression inference remains unimplemented |
| CHR-200 | Persistent activity history and bounded index recovery | Restart-safe preparation where feasible and foreground responsiveness under native work |
| CHR-276 | Optional split layout and shared actions implemented in slices | Shared colour/recipe rendering, <=1s thumbnail freshness, state continuity and complete validation |
| CHR-198 / CHR-272 | Workspace foundations overlap | Reconcile before adding controls; persist task layout and clamp to small screens |
| CHR-184 | Library undo implementation exists in slices | Verify all relevant metadata/keeper actions, failures and rollback; preserve trash receipt recovery |

CHR-267's native performance report uses two hard-linked paths to one warmed Nikon Z 7 capture. It proves its documented warm conditions, not varied cameras, cold decode or whole-library throughput. Keep historical checks; new requirements get separate unchecked criteria.

## Findings that determine order

1. Grid keyboard arrows and Quick Look neighbor selection repeatedly filter/sort all records. At 50k this incurs O(N log N) work per key. `renderGrid` already computes a suitable sequence. Metadata writes can change order/filter membership without a render, so a reusable snapshot needs invalidation, not unconditional reuse of `_virtAll`.
2. Quick Look calls `get_quicklook_preview`; RAW native code explicitly extracts embedded preview/thumbnail pixels without demosaic. Compare/Survey instead render Editor-loaded sources. Unify RAW provenance without opening/mutating the Editor as a shortcut.
3. Editor display proxies come from finished native decodes. Cache misses need actual preparation; probing cache paths does not decode an uncached neighbor. Preserve saved NR/demosaic/profile/lens settings, source signature, and recipe version in keys.
4. Virtual DOM is bounded, but client records and repeated ordering still scale with the whole library. Native catalog pages use OFFSET/count and correlated stack lookups. Measure deep-page latency before changing catalog query semantics.
5. Focus recommendations capture entry scores when culling begins; completed background scores need guarded refresh. Whole-image sharpness is not eye/face suitability.

## Execution sequence and gates

### 1. Navigation responsiveness (CHR-267)

Publish a current navigation snapshot and path-index map; lazily rebuild only after membership/order changes. Cover folder, source, page append, sort/filter/search/stack, optimistic metadata changes, failure and undo. Reuse it for arrows, adjacent prefetch and auto-advance where the semantics match. Keep Lightroom-source guards. Validate 50k rapid forward/reverse keys, expected selected paths, no repeated rebuild per unchanged key, and metadata/sort/filter invalidation. Record timings as synthetic UI evidence only.

### 2. RAW review provenance and colour (CHR-267/276)

Use the existing native RAW decode/DCP pipeline and recipe-keyed display cache. Resolve per-photo sidecar settings without altering current Editor globals; never run expensive High neural NR automatically. Apply the same edit recipe/geometry when displaying an edited review. Replace embedded RAW review loading, including prefetch, with developed preview loading. Keep existing pixels/source identity safe until replacement is ready; errors remain explicit. Verify with mocks that RAW never calls embedded-preview IPC, and with actual native RAW compare developed outputs against Editor at matched size, recipe, colour space and resampling. Set/document measured tolerance before claiming colour parity. Detail uses native-source crops, not enlarged proxies.

### 3. Bounded preparation and durable background work (CHR-200/269)

Deduplicate requests by source signature plus decode/recipe version. Foreground requests take priority; warm nearby eligible frames through a small queue. Bound *decoded bytes*, not merely image count: 45 MP RGBA is about 180 MB per source. Reuse existing byte budgets before adding caches. Long preparation uses the existing Jobs/history journal, file-boundary cancellation and restart checkpoints; completed cache entries remain reusable. Preserve offline behavior. Exercise cancel/restart/failure/stale source and simultaneous foreground activity.

### 4. Shoot traversal and state (CHR-199/268/198/184)

Reuse stable Compare/Survey cells and existing paged Cull. Make partial-selection limits explicit and add batch traversal if needed. Preserve linked/unlinked normalized native-detail pan across mixed dimensions, keeper/advance, rating preferences, current photo/scroll/filter, recipe and workspace. Every metadata action stays undoable; persisted success controls auto-advance. Test delayed/failed writes and moving focus while a write is pending. Reconcile duplicated Linear criteria only after obtaining supporting evidence.

### 5. Advisory analysis (CHR-269)

Refresh current suggestions after new focus scores arrive using source/token guards. Explain whole-image focus limitations. Duplicate/burst, focus and face/eye findings remain advisory; no automatic rejection/deletion. Eye/expression work requires a licensed local model, versioned unknown/confidence states, representative labelled held-out data, and explicit precision/recall/false-reject/unknown reporting. Do not install a large model before these prerequisites are documented.

### 6. Representative validation and publication

Use existing RAW fixtures first; acquire only a small licensed set needed to cover varied Bayer/X-Trans/DNG, orientation, dimensions, exposure/white-balance and saved edits. Do not duplicate source assets into checkouts. At 50k, exercise native page depth plus synthetic virtual-grid/grouping and rapid input. On named hardware/build record cold decode, prepared fit, 100% detail, p50/p95/max latency, memory peak, cache bytes and navigation during background jobs. Existing warm targets: <100 ms sharp presentation, <500 ms 100% view; distinguish cache state explicitly. Browser mocks prove contracts, not native RAW quality or performance. Run affected focused tests first, then required Library/Editor gates once per integrated slice. Record existing gate failures distinctly.

## Disk and token controls

- Reuse `.worktrees/main-integration` serially on task branches, then its clean integration branch. Create no per-ticket worktrees. Keep unrelated primary-checkout edits and unpublished feature commits preserved.
- Use the shared Cargo target cache and existing Node/Playwright installation. Check real user paths when sandbox environment variables redirect caches. Install only a missing required dependency, once, into its canonical shared location.
- Keep the working-folder target <=50 GB; record generated-cache headroom before native builds. No per-checkout model/vendor copies, complete catalog/RAW library copies, full model installs for speculative probes, or repeated full builds. Cache cleanup requires path/status/process checks; never `git clean -fdx`.
- Use small Linear lists (ID/title/priority/status), full descriptions only for selected work, and compact updates. Two bounded Luna audits found independent bottlenecks; reuse them for targeted follow-ups. Implement serially and request independent review only for substantive changes.
- Tests use deterministic counters/invariants plus measurements. Broaden only after new changes/failures warrant it. Save verbose output locally and report compact results.
- Feature commit only task-owned files + DEVLOG; refresh clean main, integrate only missing patches, validate, push without force, verify remote commit, record publication in DEVLOG/Linear. Keep completed issues In Review for user testing; tick only criteria supported by evidence.

## Research supporting the RAW decision

Capture One documents that Cull uses embedded RAW previews for speed, and that these previews can differ in colour from processed RAW: [Culling images](https://support.captureone.com/hc/en-us/articles/7185822431645-Culling-images), [Colour differences after import](https://support.captureone.com/hc/en-us/articles/30895306664477-Why-do-my-images-look-dull-or-different-after-importing-into-Capture-One). This explains the user's concern; we must trade cold preparation cost for consistent developed colours and regain speed through prepared caches.

Adobe distinguishes camera Embedded & Sidecar previews from rendered Standard/1:1 previews and recommends preparing appropriately sized previews: [Import preview options](https://helpx.adobe.com/fi/lightroom-classic/desktop/import-photos/photo-video-import-options.html), [Performance guidelines](https://helpx.adobe.com/uk/lightroom-classic/desktop/technical-support/performance-guidelines/optimize-performance-lightroom.html). Our inference: bounded, app-rendered fit previews plus on-demand native detail fit this requirement better than camera-JPEG-first review.

## Execution record — 11 October 2026

- CHR-267 navigation/developed RAW review slice published as `cfe5ed5244c2443d56f2e5d99f0f5b426a470055` (evidence follow-up `099697d2`). 50k navigation and RAW browser/native tests pass; real 45.75MP cold development test took 55.10 s. Full creative edit parity and representative native performance remain open.
- Storage audit found roughly 106 GB of logical file lengths in the repository tree, including 22.42 GB in the primary checkout's ignored `desktop/src-tauri/target`. Verified no tracked files, no directory link and no active native processes, then removed only that generated cache. Canonical shared Cargo target remains outside the repository. Remaining historical worktrees/diagnostic dumps are preserved; this does not establish the <=50GB target.
- CHR-269 selected next: refresh focus suggestions on actual scan completion, preserve manual choices and reject stale sessions. No new checkout or dependencies.
- Next RAW scheduling investigation: display-only decode still has full-size transient RGB16/RGBA and no ordinary demosaic cancellation. Reusing the existing interactive pool is a small scheduling improvement; reduced-size demosaic is separate quality-sensitive work. No latency/RSS improvement is claimed without native measurements.

## Further executed slices — 11 October 2026

- CHR-200 selected developed-fit preparation, CHR-269 developed RAW face review, and CHR-276 honest creative-edit omission captions/isolated-renderer plan published through f32b62bb, with verification record d287a03a. Dedicated RAW browser tests pass; legacy JPEG/People compatibility remains tested. Fit face crops do not establish native 100% focus inspection.
- CHR-267 runtime decode-cache maintenance published as b008c789, evidence 31be54c8. Existing 14GB decode tier is maintained by one background worker, with recent-write grace and retained trailing requests. Four deterministic native tests pass. Protected files/failing removal and temporary grace/cooldown overage are explicit limitations.
- Actual Cull/Survey/Compare large cells already develop original RAWs; they do not use grid/camera JPEG pixels. Batch decoding nevertheless used live NR/demosaic before applying the first saved recipe. The current bounded slice transports each surviving source's saved settings explicitly through loadRw2 and native decoding, preserving native dimensions and retaining those settings through unsupported-profile sRGB fallback. Controlled IPC tests prove transport, not photographic quality.

## Next memory and fidelity boundaries

1. Reuse the existing path-backed makePathRawFile/read_file_head flow for native batch reads, so selecting RAWs does not eagerly copy each full compressed source into JavaScript. Keep real file size/source identity and lazy arrayBuffer for explicit consumers; preserve failed-source alignment and browser/non-RAW behavior. Test header transport and on-demand full reads, then verify real native RAW source dimensions.
2. Bound retained full-frame RAW canvases in Compare/Survey independently of display proxies. Compare currently decodes its selected list; Cull pages are four and Survey is capped at eight. Preserve native-resolution focus inspection by reacquiring the focused source with its exact settings rather than calling a fit proxy 100% detail. Design the target/frame ownership contract before introducing eviction; record transient sensor buffers separately from retained frames.
3. Implement immutable creative rendering only under the isolated-renderer plan. Current profile/lens choices remain shared app settings, while saved NR/demosaic are per photo; this slice does not invent per-photo profile persistence. Existing shared creative UI/snapshot behavior and full-renderer parity remain separate work.

The user prioritizes developed RAW colours over camera-JPEG cold-open speed. Preparation and cache reuse are the intended speed path; a failed or missing developed frame must remain visibly unavailable rather than silently changing colour provenance.

## Execution checkpoint — 12 October 2026

- CHR-267 path-backed selected RAW reads and exact finished-cache reuse are published as `d991c124`, with evidence `8ca029e3`. Real source identity and lazy full reads are preserved; failed sources stay aligned.
- CHR-268 Compare now retains at most two private full-resolution frames and serializes native loads; published implementation/evidence `b0a5bdb3`, publication record `8576d103`. Actual native fit/cycle/promote/100% checks pass on the existing 45.75 MP capture. Varied-camera parity and peak-memory/latency measurements remain open.
- CHR-200 RAW preparation journals immutable source/settings, checkpoints each item, and resumes after verifying exact cache outputs. Published implementation/evidence `760a40a9`, publication record `a05521e9`; native renderer recovery and eviction checks pass. Full import/export restart recovery and measured foreground responsiveness remain open.
- CHR-269 full-resolution-source RAW face crops are published through `aed6691c`, with publication record `37809f86`. One transient decode per panel, bounded crop output and inspect/retry/source guards pass browser/native checks. Portrait quality, eye inference and lens-corrected box geometry remain open.
- CHR-192 navigation and Gallery-position preservation are published through `c20bd2ac`, with publication record `7d6e31a2`. Native laptop/theme/keyboard and scroll restoration checks pass. The full Editor gates retain 879 existing findings; no RAW rendering or decode speed improvement is claimed by this UI slice.
- CHR-193 active slice makes geometry copy counted and recoverable across loaded photos, including Reset All and committed history navigation. History retains geometry/weak identity metadata rather than decoded frames. Selected-subset scope across tone/paste/export and durable target-sidecar persistence remain separate work.

The first two earlier memory boundaries now have published implementations; continue from the remaining creative-parity, geometry, labelled-analysis and native-performance requirements rather than repeating those completed slices.
