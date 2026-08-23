# SCRFD face detection model (AI stack Phase A)

`scrfd_500m_bnkps.onnx` — SCRFD-500M with 5-point keypoints (bnkps), from
[deepinsight/insightface](https://github.com/deepinsight/insightface)'s SCRFD family. The
original `insightface` GitHub-release URL for this file (`v0.7/scrfd_500m_bnkps.onnx`) is dead
(404, verified 2026-08-23). Downloaded instead from the mirror `markrai/seen`
(GPL-3.0, see CLAUDE.md's AI-stack briefing for the license decision authorizing use of that
project's code/asset references) documents and uses itself:

```
https://huggingface.co/ykk648/face_lib/resolve/main/face_detect/scrfd_onnx/scrfd_500m_bnkps.onnx
```

Downloaded 2026-08-23, 2,524,155 bytes (matches the size `markrai/seen`'s own fetch reports).

## Verified I/O contract (onnx.load() + a real onnxruntime Run(), not assumed)

```
input  "input.1"   [1, 3, H, W]   dynamic H/W, NCHW, RGB, float32
outputs (one triple per FPN stride 8/16/32):
  "score_{s}"  [1, N_s, 1]
  "bbox_{s}"   [1, N_s, 4]    distance-encoded (l, t, r, b) * stride, relative to anchor center
  "kps_{s}"    [1, N_s, 10]   5 (x,y) landmark offsets * stride, relative to anchor center
```

At a 640x640 input: `N_8=12800, N_16=3200, N_32=800`, i.e. `(640/stride)^2 * 2` — confirms
`num_anchors=2` identical anchor centers per spatial location, matching insightface's own
`scrfd.py` reference decoder. `src/scrfd.rs`'s `detect()` ports that decode algorithm (anchor
generation, distance-decode, per-stride NMS-thresholded candidate collection, then IoU NMS)
directly against this verified contract.

Preprocessing: letterbox-resize (aspect-preserving, top-left aligned, zero-pad) to a fixed
640x640, then `(pixel - 127.5) / 128.0` per channel — insightface's own documented
`input_mean=127.5, input_std=128.0` for this model family.

## Verified against a real photo (2026-08-23, outside the repo)

No face photo is checked into this repo (`scrfd.rs`'s test for this skips gracefully when
`__TM3390.jpg` is absent, same convention `faceparse.rs`'s test already uses), so the decode was
validated with a standalone Python/onnxruntime script against personal photos elsewhere on this
machine, using the identical algorithm `scrfd.rs` implements: a 1080x720 portrait photo detected
one face at score 0.75 with a plausible bbox (~20% image width, ~44% image height — correctly
face-shaped, not a spurious full-frame or degenerate box).

⚠️ **Known limitation, not a bug**: two 6240x4160 photos produced zero detections. SCRFD-500m's
own 640px input means a 6240px-wide source is downscaled ~10x before detection — a face that
was, say, 400px wide in the original shrinks below ~40px, well into the range this lightweight
model is known to miss (this is the tradeoff `buffalo_s`-tier models make vs. `buffalo_l`, per
the AI-stack plan's own reasoning for picking the lightweight tier). Whether those two photos
had faces at all wasn't confirmed either way. Tiling/multi-scale detection for high-res sources
is a reasonable Phase A follow-up if recall on full-res photos turns out to matter in practice —
not built here.

## License

SCRFD models from `deepinsight/insightface` are released under the project's own license
(non-commercial research use per InsightFace's stated terms for its pretrained models) — same
caveat already recorded for `vendor/faceparse/README.md`: fine for this personal, non-distributed
build; re-check before any public release or redistribution.
