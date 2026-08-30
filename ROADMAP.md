# Chromasmith — roadmap

Full history of every shipped/rejected item lives in git log + commit messages — this file
tracks what's still open. Delivered and rejected items are compact tables below; **do not
re-add prose write-ups for closed items here** — that's what made this file 900+ lines.

---

## Delivered

| item | summary |
|---|---|
| Skin Tone tool (items 1,2,3,5,6,7,8,9,14,16,A,B,C,D,E) | Multi-sample colour gate, per-mask Amount, mask reorder/raster/edge-refine, mask cap 4→8, per-mask Texture, frequency-separated lightness evening, Colour/Luminance Range as mask types, Dehaze, export presets+watermark, face-parse auto-exclusion, mask panel UI, Selection view in loupe (mostly), ⌘K palette, desktop slider ergonomics, first-run tour. See CLAUDE.md §5b for the skin-path detail. |
| Item 4 — Skin mask | Segmentation-first (SAM scribble + colour refine), **desktop-only** by decision (browser/iOS port dropped). Dedicated skin (not subject) segmentation still open — see Open items. |
| Item 10 — Spot removal/clone/heal | Pre-pass on the source image before grading; heal matches the annulus around a spot, not the disc. See CLAUDE.md's Retouch section. |
| Item 11 — Perspective/keystone + auto-horizon | Real homography + a real Hough transform (0.30° worst error). Known limitation: strongest-line-wins can pick a wrong line on a busy horizon — documented in CLAUDE.md, not a bug to "fix" by tuning. |
| Item 12 — Auto lens correction | Was withdrawn as "already exists" — `tg-lens-auto`, EXIF LensModel, real Rust geometric remap. Desktop-only; browser/iOS gap folded into F5/F-series territory. |
| Item 13 — 16-bit/HDR from RAW | Measured: full 16-bit render buys ≤1/255, not the real gate. Real fix was DCP LookTable headroom → gain-map HEIC export (ISO 21496-1). See CLAUDE.md's "HDR from RAW". |
| Item 15 — Auto-match series to reference | `matchSeriesToReference`: exposure (in stops) + WB after brightness equalisation, per photo into `adjustOverride`. |
| Library view (15 items) | All closed except Reset-edit undo (still open, below). 2-D keyboard nav, star ratings, drag & drop, filter popover, grid virtualization (profiled: 5k files went from >30s timeout to ~3-4s), full colour labels, EXIF panel, empty state, status bar, batch ops bar, thumbnail-decode tiering (embedded preview first, full decode on idle). |
| N1 — Load-screen redesign | Shipped from an approved wireframe: always-visible progress bar (no bare-spinner frame), indeterminate→determinate mode switch, thumbnail cache-prefetch before first paint, real empty-state actions, offline-drive badges + status bar. Covered by `test/library_perf.mjs` + `?libnoroot=1`/`?liboffline=1`. |
| N2.0/N2.1 — CoreML EP | Appended via `sam.rs`'s libloading pattern (symbol/flags hand-declared against ONNX Runtime's real header, not guessed). **Measured on this Intel Mac (no ANE): ~20x slower cold-start** (2.77s→54.38s), so shipped **opt-in** (`CS_COREML=1`), not default. Correctness unaffected either way. |
| R8 — Colour-matrix fallback | `srgb_rgba` (desktop's un-DCP'd-camera path) now applies the shot's real camera→XYZ→sRGB matrix instead of gamma-only on raw primaries. Row-normalization bug (dcraw's own technique) found and fixed via a neutral-grey regression test before trusting the math. This is darktable/RawTherapee's own "standard" base tier — tier 4 of 5 in the resolution order; F1 covers tier 1. |
| R1 — Scene-referred highlight roll-off | **Two-part delivery**: (1) float FBOs through the whole halation/bloom/comp chain + a real ITU-R BT.2390 Hermite-knee shoulder (ported, not invented — same standard family already used for HLG), gated behind `useTonemap`, byte-exact at defaults by construction (unreachable code when off). (2) The part that actually matters for RAW: `apply_lut_rgba_ext` (Rust) now returns the unquantized per-channel value alongside the clamped u8 body, threaded through `decode_raw_v2`/`denoise_raw_high`'s wire format as an opt-in trailing segment, so a real blown highlight survives to `FX.setImage`'s new RGBA16F upload path instead of being clamped before the GPU ever sees it. Auto-enables the tonemap chain when real headroom is measured — no user toggle needed. Found and fixed a real pre-existing bug along the way: `hrOut`/`sceneLinear` were block-scoped `const`s checked with `typeof` *outside* their block, so the browser path's `_hdrHeadroom` stash had never actually fired — confirmed with a Node repro before fixing. **Still open**: `maskAdjust`/curves/HSL stay clamped even with the flag on; no UI toggle (auto-fires on measured headroom only). R4 (Spektrafilm's real film roll-off) depends on R1 being complete — this is close but not 100% (masks/curves/HSL gap remains). |
| R3 — Spektrafilm profiles as presets, tier (a) | 20 new "Spektrafilm" presets baked from the real `spektrafilm-lut` CLI (project's own tool, run not vendored — GPLv3 code, CC BY-SA 4.0 profiles/LUTs) — one 33³ `.cube` per film stock (`spektrafilm-lut list film`'s full 20-stock registry: 16 colour negatives + 4 reversal/slide stocks), each paired with a real print/paper stock (negatives use their profile's own documented `target_print`; the 4 reversals — which the tool requires a `--print` for regardless of type, confirmed by running it, not guessed — paired with the brand-matching paper, the same default the project's own comparison script uses). Baked to **display space** only (`--input srgb --output srgb`, hard clip at 1.0) — purely additive `vendor/luts/spektra_*.bin` + `LUT_META` entries, zero engine/shader change, +133 bytes gzipped on `chromasmith-22.html`. Attribution + full stock/print table in `LICENSES-MODELS.md`. R4 (the real scene-referred roll-off) is separate, larger work — not started. |
| F1/F1a/F1b — Adobe DCP resolver | Reads real, locally-installed Camera Raw profiles for any camera (`dcp_store.rs`), not just the 2 bundled. Path-traversal hardened (component-reject + canonicalize-and-check-root, both required). `KNOWN_DCP_MAKES`'s fixed 2-brand allowlist replaced with a positive assertion that scales to any brand. F1b: `parseDCP` tolerates a missing ProfileToneCurve (201/210 real Adobe Standard files lack it) via an identity curve. Verified against 3 real installed brands (Canon/Nikon/Fujifilm) plus path-traversal unit tests. |
| F2 — Auto-detect V-Log (PhotoStyle) | `panasonic_photo_style()` auto-enables the V-Log input transform. PhotoStyle turned out to live inside a JPEG preview embedded under RW2's own tag `0x002e`, not in any MakerNote the container itself exposes — found by tracing, not assumed. Verified against real files for all 4 documented values (1/3/17/22). Known limit: one global `#sel-input` control, so a mixed-style batch has the last-loaded V-Log file win for the whole batch. |
| F3 — Desktop dialog filter parity | Resolved as a non-issue: there is no native file-open dialog with an extension filter anywhere in the app (every `dialog\|open` call is folder-only); nothing to widen. |
| F8 — Regenerate build outputs | `desktop/dist/` and iOS `www/`/`public/` resynced via `build-desktop.sh`/`npm run sync`. iOS `pod install` itself fails on this dev Mac (no full Xcode) — pre-existing, documented, CI is the real iOS build path. |
| F9 — ARW purple-edge band | `decode_and_demosaic` never read rawler's `crop_area`/`active_area`, so Sony's masked optical-black sensor columns demosaiced as real image data. Fixed by cropping post-demosaic (pre-demosaic would need CFA-phase re-derivation — checked, real bodies do shift phase, e.g. `sony/a500.toml`'s odd offsets). Also corrected the DC-S9's own native decode to its true 6000×4000 (was 6016×4016, including its own masked border) — applied uniformly per user decision, independently corroborated by `calib/nr_validate.py`'s own pre-existing note about this exact mismatch. |

## Rejected / withdrawn

| item | reason |
|---|---|
| Display-P3 / wide-gamut ICC export | Every calibration constant in `calib/` (113 looks) is fitted against sRGB primaries with no colour-managed reference to verify a wide-gamut change against. Gain-map HDR already ships a bigger visible win (range, not gamut). Revisit only as a final-stage export conversion. |
| Undo for Delete | `trash_file` already hands off to the macOS Trash (Finder-recoverable). An in-app `restore_from_trash` would duplicate an OS affordance. |
| JXL / AVIF decode | Neither the user's camera nor phone produces these; would mean vendoring a WASM decoder for formats with no real source files to test against. HEIC (which they do produce) shipped instead. |
| A second hand-written WGSL renderer (desktop-only) | Two copies of the calibrated model kept pixel-identical forever, across languages where the `toString` generation trick doesn't apply. Superseded by R5 (Naga single-source), a different proposition, still open. |
| A full 16-bit render pipeline as the route to better highlights | Measured directly: ≤1/255 difference. Bit depth was never the gap — headroom is (see R1). Don't re-litigate this as a precision problem. |
| Chasing camera colour breadth by hand-calibrating bodies | Use rawler's embedded per-camera matrices instead — same well every other converter draws from (see R8, shipped). |
| Lifting any RapidRAW source | AGPL-3.0. Their published ideas/benchmarks are fair game; their code is not. |
| A WGSL/WGPU renderer port purely for slider-latency speed | RapidRAW's own headline "20fps→120fps" win was deleting a JPEG-over-IPC round trip this app never had (it renders in-page already). R5 remains the only sanctioned route to a second backend, spike-gated. |

---

## Open items

Grouped by area. Read `CLAUDE.md` §5b first if an item touches the skin path; §2/§3 before
touching `bakeDcpLUT` or any GLSL shader source (both have named failure classes that don't
announce themselves).

### Mask system

- **Item 4 remainder** — a dedicated *skin* segmentation (face/skin parsing, not subject
  segmentation) would separate lips/brows/hair without any hand-brushing. `desktop/src-tauri/
  src/faceparse.rs` already does face-feature exclusion; this would be the selector itself.
- **Item 6 remainder** — true edge-aware per-mask noise reduction. Texture/Clarity (bipolar,
  shipped) cover sharpen/soften; a genuinely different NR operator is its own piece of work.
- **UX item B remainder** — Selection-view opacity slider + an edge-only outline mode. The
  loupe integration itself is done.

### Library

- **Reset-edit undo** — still irreversible (Delete-undo was rejected above; this wasn't).

### Boot/offline

- **N1a — Offline edit queue + apply-on-reconnect** (not started, size unknown). N1's approved
  wireframe described this; deliberately not built since it's real, separate work with real
  data-loss risk if rushed: needs (1) a real decode source for a cached-only photo — today
  editing always reads the real file from disk, so offline editing doesn't work at all yet, (2) a
  persisted queue distinct from the `.xmp` sidecar path, (3) reconnect detection wired to replay
  it, (4) conflict handling if the original changed elsewhere while disconnected. Today's status
  bar says the honest narrower thing ("Reconnect to edit or export"). Revisit on real demand.

### GPU/CPU offload (N2)

- **N2.2** — Cleanup-pass fusion in `raw_decode.rs`: merge the pointwise per-pixel traversals
  (shadows NR, false-colour, defringe are candidates; leave wavelet/PPG alone, neighbourhood-
  dependent). Needs an exact byte-comparison gate against a real RW2 — this is calibrated colour.
- **N2.3** — Pool sizing (`cores - 2` in `main.rs`) + a JS worker pool (today: one `_cpuWorker`,
  `bakeDcpLUT` and `exportSharpen` queue behind each other). Only worth it if a real measurement
  shows the queueing actually costs anything.

### RapidRAW competitive review

Source: a review of [CyberTimon/RapidRAW](https://github.com/CyberTimon/RapidRAW) against this
codebase. Full working notes: `~/.claude/plans/can-you-review-rapidraw-virtual-glacier.md`.

**Findings still worth keeping:**
- Both stacks are Rust + Tauri 2 + rawler + Lensfun + ONNX — the divergence is only render
  surface and pixel precision, not architecture.
- Every native competitor (darktable, RawTherapee, Lightroom/C1/DxO) is desktop-only; our
  WebGL2 choice is what buys web *and* iOS, which none of them have — not a disadvantage to fix.
- Apps shipping both desktop and mobile do it via one kernel source, machine-translated (Dehancer's
  `dehancer-gpulib-cpp`, Lightroom's shared C++ core). Nobody hand-maintains two shader copies —
  R5 (Naga) is the only sanctioned path there, gated on its own spike.
- RapidRAW's film emulations run scene-referred inside their own WGSL shader, and their whole
  pipeline is 32-bit throughout — same direction R1 took, independently confirmed by darktable
  ("all core functions operate on 4×32-bit float buffers... pixels prepared for display only at
  the last stage").
- Licensing: RapidRAW is AGPL-3.0 (ideas fair game, code isn't); Spektrafilm profiles are
  CC BY-SA 4.0 (attribution + share-alike).

| # | item | size | note |
|---|---|---|---|
| R2 | AgX (or filmic) as an optional input transform | M | Cheap partial win alongside R1; slots in beside `useVlog`. Port darktable's/Blender's published AgX curve, don't derive one. |
| R4 | Spektrafilm live in-shader — tier (b) | L | Real roll-off. **Depends on R1's masks/curves/HSL gap closing** — don't start first. |
| R5 | Naga single-source shaders (WGSL→WGPU desktop + generated GLSL ES 3.0 web/iOS) | L | Author once, generate both. **Spike first**: port only `comp`, require all 18 goldens byte-exact from each backend. |
| R6 | Deconvolution sharpening | M | Models lens/sensor PSF and inverts it. More compute; needs a conservative ring-artifact cap. |
| R7 | Depth mask + depth-driven lens blur/tilt-shift | M | Depth Anything V2 as a 4th ONNX model, same pattern as `sam.rs`/`faceparse.rs`. |
| R9 | Virtual copies | M | A persisted second edit record against the same path. Not what Compare mode does (transient, persists nothing). Touches the sidecar format + `catalog.rs`. |
| R10 | CLIP auto-tagging | S | We already run CLIP for search (`clip.rs`) — this is surfacing those embeddings as visible keywords, a UI layer, not new inference. |
| R11 | Dehaze, colour wheels (lift/gamma/gain), parametric curves | S each | Conventional controls we don't have (we have point curves + 8-band HSL). |
| R12 | HDR merge (deghost+align), focus stacking | M–L | Native Rust, reusing `raw_decode.rs`. |
| R13 | Astro stacking, panorama stitching, collage | L | Lowest priority of the merge family. |
| R14 | Camera tethering (libgphoto2) | L | macOS/Linux only — Windows driver conflict even for them. |
| R15 | JXL/AVIF export; headless CLI export | S each | `image` crate features + an export-format entry; CLI is an argv path into existing Tauri commands. |
| R16 | Draggable panel workspace + unified Library/Edit view | M | Removes the mode switch between grid and editor; persists panel order. |

Sequencing: R2 before R4 (R4 depends on R1's remaining gap + is the "real" version of R2's cheap
stand-in). R3/R10/R15 are session-sized wins needing nothing else. R5 is the biggest single bet,
gated on its own spike.

### Format widening

Pass 1 shipped 2026-08-28 (`b193b38`): format registry consolidated, RAW widened 8→32 formats,
desktop-only still path added (EXR/HDR/TGA/DDS/QOI/FF/PNM*/JXL). Full design reasoning (resolution
order, path-traversal handling, the ForwardMatrix survey) lives in
`~/.claude/plans/and-these-as-well-validated-wadler.md` — re-read before starting F4/F5/F6.

⚠️ **`bakeDcpLUT` is compiled into the pixel worker via `Function.prototype.toString`**
(CLAUDE.md §2) and `perf_bench.mjs` asserts worker/main-thread agreement to **max|Δ|=0**. Any new
parameter touching that function must be a plain argument threaded through, never a captured
module-scope constant. Run `npm run perf:test` immediately after, in isolation.

| # | item | size | note |
|---|---|---|---|
| F4 | EXR/HDR real headroom instead of clamp | M | `still_decode.rs`'s `hdr_to_srgb8` clamps >1.0 with a logged note — reuse the RAW path's `hrOut`/`HR_MAX_STOPS` headroom channel instead (now genuinely wired end-to-end per R1's desktop fix). |
| F5 | Linear/demosaiced-DNG passthrough | S | `raw_decode.rs` currently rejects linear DNG (iPhone ProRAW, Foveon→DNG) with a named error — real, common file. When `photometric` is RGB, skip demosaic and take pixels directly. |
| F6 | ICO/DDS frame picker | S | `still_decode.rs` reports a frame count but always takes the first/largest; a picker is a follow-on. |
| F7 | Hands-on desktop verification (partial) | S | Confirmed this session: ARW open, 3-brand DCP resolution. Still needed: a Fuji RAF, a Nikon NEF, a JXL, an EXR, a DDS opened in the built `.app`, Library thumbnail vs. editor agreement. |

Sequencing: F4/F5/F6 are independent, self-contained follow-ups with no ordering constraint
between them. F7 is cheap session-filler alongside any of them.
