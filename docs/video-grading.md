# Video grading (in progress)

Deep-dive on the video-grading feature — demux/mux, per-frame grain seeding, HLG handling, trim/export, audio passthrough. Load this before touching anything video-related (`fxVideo*`, `vendor/mediabunny/`, `test/video_harness.mjs`).

## 12. Video grading (in progress)

Single-clip video grading through the existing `FXR` pipeline: load an MP4, scrub/grade with the
same LUT/grain/halation/adjustment stack as stills, export a graded MP4. Explicitly NOT a timeline
NLE — one clip, global adjustments, trim in/out at most. Full design doc, gap analysis vs.
comparable apps (Dehancer, FilmBox, Lightroom video), and phased plan:
`~/.claude/plans/review-the-video-editing-elegant-squid.md` (or wherever it was moved — ask if
missing). Phases V0 ("play it") → V4 ("trim + audio"), V5 opportunistic polish.

- **Demux/mux: `vendor/mediabunny/`**, NOT hand-rolled. Use its high-level API
  (`Input`/`VideoSampleSink`/`Output`/`CanvasSource`) — it already solves rotation metadata,
  exact-frame seeking, audio passthrough, and WebCodecs timestamp/keyframe/flush correctness.
  Lazy `import()`, same pattern as `getLibRaw()` (`:6418`). Kept out of the inline `<script>`
  blocks (unlike pako/utif2) because MPL-2.0 is file-level copyleft.
- **Reject clearly, at load, with a named reason:** fragmented MP4, HLS, AVI, MKV, edit lists —
  whatever `ALL_FORMATS` can't handle.
- ⚠️ **Grain/artifact seeds must become per-frame, but naively.** The stills design deliberately
  makes `seed`/`artSeed` STABLE (preview==export, tiles byte-identical) — for video, stable-across-
  frames is grain freezing to the screen. Use a HASH of frameIndex, not a linear step
  (`clipSeed + frameIndex*k`) — a linear step near-repeats whenever `13×k` lands close to a
  multiple of 100, producing a periodic grain "pulse". A `Grain motion` slider blends toward the
  clip-constant seed to control boil vs. freeze.
- ⚠️ **Never `getPixels()` on the export path** — full GPU stall + JS row-flip per frame. Render
  into the same composite canvas used for borders/watermark and hand that to `CanvasSource`.
- ⚠️ **`setImage`'s unconditional `gl.deleteTexture(this.imgTx)` will delete a live video texture**
  if a video's `imgTx` is aliased to a persistent `vidTx` and a photo is then loaded. Guard:
  `if(this.imgTx && this.imgTx!==this.vidTx) gl.deleteTexture(this.imgTx)`.
- **Every new shader uniform (`srcFlipY`, `srcXf`, range remap, HLG tonemap, dither, grain motion)
  must default to today's behaviour exactly** — all 18 PNGs in `test/golden/` must stay byte-exact
  through every phase of this work. Run `node test/export_harness.mjs` after any shader touch and
  watch for `[console.error] GLSL compile error` (§3's "quieter bug class" — it will not
  white-screen the app, it silently no-ops the whole program).
- ⚠️ GLSL reserved words are an active risk here specifically: **`sample` and `output`** are
  exactly the identifiers a video feature reaches for, and both are reserved in GLSL ES. Prefix:
  `vidSample`, `vidOut`.
- **`test/video_harness.mjs`** (`npm run video:test`, same Playwright/SwiftShader rig as
  `export_harness.mjs`) is headless-testable because Chromium's `VideoDecoder`/`VideoEncoder` use
  software codecs even under SwiftShader. Fixture: `test/fixtures/video_tiny.mp4` — 10 frames,
  160×120, 10fps, each frame's luma = `(frameIndex*20) mod 255` (an exact, content-addressable way
  to verify a seek landed on the RIGHT frame without a perceptual diff; regenerate with
  `ffmpeg -f lavfi -i "color=c=black:s=160x120:r=10:d=1,geq=lum='mod(N*20\,255)':cb=128:cr=128"
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart video_tiny.mp4`). Currently covers V0: demux
  metadata (frameCount/rotation/isVfr/isHdr), per-frame seek correctness, seek determinism
  (walking a clip 0→9 and 9→0 must produce identical frames — this is the "grain differs between
  preview and export" class of check, still valid before frame-seeded grain exists because it's
  really testing `fxVideoSeekTo`'s stale-result generation-counter guard), and the guard that
  matters most: loading a video must not perturb a still render (`chart.png x identity` re-rendered
  on the SAME page after video code has run, diffed byte-for-byte against its own golden).
  ⚠️ **`getSample(0)` returned `null` on a real irregular-timestamp fixture during V0 testing** even
  though the same file decoded fine via the `.samples()` async iterator — `loadFXVideoFile` grabs
  the first frame via the iterator for exactly this reason; don't regress it back to `getSample(0)`.
  Not yet covered (lands with later phases): encode/export, rotation-metadata fixtures (ffmpeg on
  this dev machine won't reliably write an ISOBMFF `colr`/rotation matrix box — a real phone-shot
  fixture will be needed), HDR fixtures (same tooling gap).
- **Playback (V1)** does not chase real-time — `fxVideoPlayTick` tracks wall-clock elapsed time
  against the clip's fps and jumps straight to whichever frame SHOULD be showing now, dropping
  any it can't render in time, rather than queuing (a queue makes lag compound; a drop just reads
  as a lower live frame rate). Paused automatically on every photo/video switch (`fxSyncTransportUI`
  calls `fxVideoPause()`) so switching away can't leave a RAF loop targeting the outgoing item.
- **Per-frame grain seed**: `fxVideoFrameSeed` hashes `(clipSeed, frameIndex)` with a sin/fract
  hash, NOT a linear step — verified the rejected linear formula's near-repeat bug for real
  (`clipSeed+frameIndex*7.7371`: frames 13 apart land within 0.58 of each other since
  `13×7.7371≈100.58`) and confirmed the hash keeps >2.8 separation at the same offset. The `Grain
  motion` slider (0..100) blends between the frozen clip-constant seed and the fully independent
  per-frame hash.
- ⚠️ **HLG handling is ENGINE-DEPENDENT, and the desktop app was getting it wrong.** The previous
  note here said "no manual HLG tonemap is needed" — that was measured in **Chromium only**, and
  it was wrong for the shipping desktop app. Its own caveat ("re-check on whatever engine is
  current") turned out to be the important sentence.
  Measured on `IMG_8015.MOV` (HEVC yuv420p10le, BT.2020/HLG/bt2020-ncl), frame 0, identical
  160×90 downsample:

  | rendering | mean | meanSat | maxSat |
  |---|---|---|---|
  | ffmpeg naive (no conversion) | 137.2 | 29.6 | 108 |
  | **Apple ColorSync HLG→709** (`sips --matchTo ITU-709.icc`) | **124.1** | **41.3** | **141** |
  | **WKWebView** (the desktop app) | 137.5 | 30.1 | 118 |
  | **Chromium** (the web build) | 122.9 | 41.3 | 147 |

  **Chromium converts correctly; WKWebView does not** — it decodes HLG and relabels the
  `VideoFrame` as `bt709`/`iec61966-2-1` *without* applying the conversion, so HLG footage rendered
  flat and ~30% under-saturated in the desktop app.
  `fxNeedsHlgTransform(trackColorSpace, videoFrame)` decides this by **comparing the container's
  track colour space against the delivered frame's** — never a UA sniff — so it self-corrects if
  either engine changes. When it fires, `hlg2rec709()` in the lut pass does the conversion.
  ⚠️ The shader chain is the ITU standard, not a hand-rolled curve: HLG inverse OETF → OOTF with
  system gamma from the **BT.2408** formula `1.2 + 0.42·log10(L_W/1000)` → normalise by the
  **BT.2408 reference white of 203 cd/m²** (which is exactly `eotf_BT2100_HLG(0.75)`) → BT.2020→709
  matrix → sRGB encode. `calib/hlg_to_709.py` derives and validates it, cross-checked against the
  **colour-science** reference library (inverse OETF to 2.6e-9, full EOTF to 3.1e-6 cd/m²).
  `L_W` defaults to **400 nits**, the documented nominal for HLG-mastered material.
  ⚠️ **colour-science requires numpy≥2 and will break `.calibvenv`'s scipy pin** — keep it in a
  separate venv (`python3 -m venv /tmp/colourvenv`). This was learned by breaking it.
- ⚠️ **We cannot tone map HDR ourselves, and cannot preview/export HDR.** Verified in Chromium
  against the same clip: `VideoFrame.format === null` for 10-bit and `allocationSize()` throws, so
  `copyTo()` cannot read the planes; uploading to `RGBA16F` with
  `UNPACK_COLORSPACE_CONVERSION_WEBGL=NONE` and reading back through an `RGBA32F` FBO peaks at
  **0.9565 with zero pixels above 1.0** — already clamped to SDR. There is no `rec2100-hlg` canvas
  and no `configureHighDynamicRange`. So a real BT.2446/BT.2390 operator is impossible here; the
  HLG→709 conversion above is a colour-space fix, NOT a tone map. `fxHdrProbe()` re-measures all of
  this in whatever engine is running (diagnostics only; writes JSON in the native shell when
  `diag-on`).
  ⚠️ **macOS previews HLG clips in HDR** (QuickLook shows an HDR badge), so a side-by-side against
  QuickLook is SDR-vs-HDR and will never match exactly — that is not a bug.
- ⚠️ **The extended Log input selector (S-Log3/C-Log3/Log-C) is still deferred, separately from
  HDR above** — no real reference footage for those has been obtained yet, and each needs its own
  verified curve constants. Same rule as before: don't implement from formula alone; get real
  footage (or a known-correct reference still) first.
- ✅ **RESOLVED: the VFR flag was a false-positive bug, not a missing feature.** `probeVfr()` read
  exactly 30 packets in DECODE order and sorted by presentation timestamp — on any B-frame-coded
  stream (i.e. almost all real H.264/HEVC footage) this produces one spurious large gap at the
  TAIL every time, because the last few decode-order packets grabbed are B-frames whose
  presentation timestamps land mid-range, while the packets that would fill the gap haven't been
  read yet. Verified on the same real clip: 29 of 29 real deltas were exactly 0.0333s (perfect
  29.97fps CFR); only the boundary delta was wrong, and it alone triggered the VFR flag. Fixed by
  over-reading a B-frame-reorder margin (16 packets) and discarding the tail before computing
  variance. Separately, researched how open-source editors handle genuine VFR (Shotcut/MLT,
  Kdenlive: detect, then CONFORM to CFR before editing — timelines are frame-indexed) and confirmed
  `fxVideoSeekTo`'s existing time-based seek (`frameIndex/fps` → `samples(t)`) already does the
  lazy equivalent, with no architecture change needed.
- ✅ **Audio passthrough (V4) shipped**: `EncodedAudioPacketSource` re-muxes the original AAC
  packets unchanged. ⚠️ Real AAC streams commonly start at a NEGATIVE presentation timestamp
  (encoder priming/pre-roll) — confirmed on the same real clip ("Timestamps must be non-negative,
  got -0.044s"). Fixed with the standard remux technique (same as ffmpeg's
  `-avoid_negative_ts make_zero`): shift the WHOLE audio stream by the first packet's timestamp so
  it starts at exactly 0 — never clamp packets independently, which collapses several leading
  packets onto the same timestamp. Non-AAC audio gets a clean "video only" export with a warning,
  not a silent transcode.
- ✅ **Fixed: video was exporting/previewing upside down.** `setVideoFrame` never applied
  `UNPACK_FLIP_Y_WEBGL` the way `setImage` does for photos. The original justification (preserving
  a zero-copy blit path for a raw `VideoFrame` upload) didn't match the actual implementation —
  every call site draws the sample onto a plain 2D canvas first via `sample.draw()`, exactly like
  a photo canvas, so it needs the identical flip. Verified with a top/bottom-asymmetric test clip.
- ✅ **Trim now actually trims (V6, first slice).** `trimInFrame`/`trimOutFrame` used to be written
  by the transport sliders and read by nothing — `fxVideoExportSmall` always exported the whole
  clip. It now derives `trimF0/trimF1`, loops only that range, and rebases OUTPUT timestamps to
  start at 0 (same technique the audio pass already used for negative AAC priming timestamps).
  Audio is windowed to the trimmed range the same way, keeping the packet that straddles the
  in-point (the standard ffmpeg/MLT `-ss` convention) so trimmed audio is never short. Playback
  (`fxVideoPlayTick`) now also **loops within the trim window** via a `fxVideoLoop` toggle instead
  of always stopping at the end — the old "stop" behaviour was an explicit V1 simplification, not
  a design choice. Added a Shotcut/Kdenlive-style keyboard map for video (Space play/pause, ←/→
  frame-step, Shift+←/→ second-step, I/O set trim at playhead, Home/End jump to trim in/out) and
  transport buttons (frame-step, loop, Set In/Out) — none of this existed before. `test/video_harness.mjs`
  gained a [5] section covering the transport wiring (trim-set/step/goto/loop), DOM-level so it
  stays fast; the full trimmed-export frame/timestamp math is exercised in the browser directly,
  not yet in the harness — see the open items below.
- ✅ **The rest of the V6 punch list shipped in the same pass** (same plan file):
  - **Geometry (crop/rotate/flip/straighten) now reaches video export.** `fxVideoExportSmall` used
    to draw the raw decoded sample straight into the encoder, bypassing `geomCanvas`'s pipeline
    entirely — the Crop tool visibly did nothing to an exported clip. `geomCanvas` was split into
    `applyGeomTo(canvas,geom)` (pure, reusable) + a one-line `geomCanvas(item)` wrapper so both
    stills and the per-frame export loop share the identical transform, with zero behavior change
    for photos (verified: 18/18 export goldens still byte-exact after the refactor alone).
  - **Borders + canvas matte now render into video export** (`_videoComposeBorderMatte`), mirroring
    `exportFX`/`canvasCompose` exactly — border thickness and matte aspect ratio are constant for
    a whole clip, so their output size is computed ONCE and every frame draws into pre-allocated
    canvases (no per-frame allocation). This is what makes a 9:16/1:1/4:5 video export possible.
  - **Export settings UI**: Quality (Draft/Standard/High/Maximum — bitrate scales off the same
    20Mbps/1080p30 reference the old hardcoded value used, so High+1080p+30fps is byte-for-byte
    the prior default), Resolution (Source/4K/1080p/720p), Codec (H.264/HEVC, HEVC silently falls
    back to H.264 via the same `getFirstEncodableVideoCodec` probe if unencodable), Frame rate
    (Source/30/24 — decimation only, sampling is now TIME-based (`samples(srcTimeS)`) rather than
    frame-index-based specifically so this and trim compose without special-casing).
  - **In-playback audio**: `loadFXVideoFile` decodes the whole track into an `AudioBuffer` via
    `AudioContext.decodeAudioData` at load time (separate from `_mbAudioTrack`, which export still
    uses for the lossless packet-passthrough remux — playback needs decoded PCM, export needs the
    original encoded packets). Once a source node is running, `fxVideoPlayTick` reads
    `AudioContext.currentTime` as its clock instead of `performance.now()` — tighter A/V sync than
    an independent wall-clock RAF loop. Mute is a single global toggle (`fxVideoMuted`); at export
    it just skips `output.addAudioTrack` — no re-encode needed either way.
  - **Fade in/out** (picture only — passthrough audio can't be faded without a decode/re-encode
    pass, out of scope). Applied at export as a black-backdrop alpha composite per frame; the UI
    is two plain number inputs in seconds.
  - **Preview quality proxy**: a Full/½/¼ selector scales ONLY the live preview's WebGL backing
    store (`renderPreview`'s `pw,ph`, gated on `kind==='video'`) — export is never affected. Zero
    behavior change at its default (1×).
  - **Scopes**: histogram/waveform/RGB-parade/vectorscope share one mode selector next to the
    existing histogram toggle and the SAME downsampled sample buffer `drawHistogram` already
    built — switching modes costs nothing extra. Ported ffmpeg's `vf_waveform`/`vf_vectorscope`
    conventions (additive intensity, Rec.709 Cb/Cr wheel, the 6 colour-bar target boxes, the 123°
    skin-tone/I-axis line — see §5b) as plain JS/canvas2D, not vendored, per the "port
    conventions, write the JS" call on this feature (GPL-3.0 makes Shotcut/Kdenlive/ffmpeg's own
    *code* licence-compatible, but it's C++, not JS — not worth a source port for four draw calls).
  - **Guides overlay**: rule-of-thirds + SMPTE 90%/93% title/action-safe boxes, pure SVG overlay,
    never rendered into a preview snapshot or export.
  - **Thumbnail strip** (`fxVideoBuildThumbs`): 16 evenly-spaced low-res frames decoded lazily
    under the scrubber, one `requestAnimationFrame` yield between each so it never blocks
    scrubbing/playback; abandons mid-build if the user switches items.
  - `test/video_harness.mjs` gained a [6] export smoke test — the WHOLE `fxVideoExportSmall` path
    (geometry, borders/matte, quality/codec/fps, fades, audio remux) had zero CI coverage before
    this; it now trims a fixture to 3 frames, stubs `window.saveFile` (bare top-level identifier,
    same override pattern the stills export path already relies on), and asserts a real non-trivial
    MP4 comes out the other end without throwing.
  - **Library integration** (`desktop/src-tauri/src/library.rs` + `desktop/library-ui.js`): `.mp4`/
    `.mov`/`.m4v` now list alongside photos (`is_video` flag, `kind:"video"`), filter by "Video" in
    the type filter, and open into the editor via the exact same `read_file_bytes` → `File` →
    `loadFXImages` path a photo takes (video was already handled there via `VID_EXT_RE`/MIME —
    the gap was purely that the Library filtered clips out of `list_dir` before the editor ever
    saw them). No thumbnail decoder for video (`image` crate can't read MP4; not worth an ffmpeg
    dependency for a grid thumbnail) — `get_thumbnail` fails cleanly for it and the grid shows a
    dark placeholder + ▶ badge instead of a broken `<img>`.
  ⚠️ Genuinely deferred, not attempted blind: a full custom timeline-canvas widget replacing the
  two range sliders (A2 in the plan — the sliders now clamp against each other and paint a range-
  fill background instead, which covers the "can't invert the handles" bug without the bigger
  rewrite); speed ramp/retiming (interacts badly with per-frame grain seeding and forces an audio
  decision, see the plan's non-goals); multi-clip timeline; audio gain/volume (needs `AudioEncoder`,
  breaks Safari); stabilization/deflicker. See the plan file for the full reasoning on each.
