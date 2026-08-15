# Current state

_Last updated: 2026-08-15._

This file tracks **what is in flight right now**. Anything finished and durable belongs in
`CLAUDE.md`; anything planned belongs in `ROADMAP.md`. If this file is older than the last few
commits, trust `git log` over it.

## The performance / feature / UI plan

Full plan: `~/.claude/plans/identify-additional-performance-feature-elegant-boole.md`. It came out
of an audit across the three surfaces (Tauri desktop, Pages web, Capacitor iOS) plus a comparison
against Dehancer (the film lane) and RapidRAW/Lightroom (the editor lane).

### ✅ Shipped

| | what landed |
|---|---|
| **A** | Payload + main thread: **17.7MB → 3.02MB** (gzip 10.2 → 1.76MB), lazy Looks gallery, LRU preset cache, `bakeDcpLUT`/`exportSharpen` in a worker (1157ms freeze → ~18ms) |
| **B** | `ingest.rs` (card import) and `subject.rs` (PerSAM one-shot subject recognition) |
| **C** | The UI for both, plus auto-seeded skin samples and a shoot-wide skin target |
| **D** | Per-mask Clarity, Defringe, gate weave + film breath — one shader cycle |
| **E2** | Perspective / keystone (a real homography) + Rotate + Scale |
| **F1** | Virtual copies (backward-compatible sidecar versions) |
| **G** | A 375×812 phone pass in `ui_audit`, and the 12×20px tap target it found |
| **D4** | Film frames — procedural (ISO 1007 geometry) + MIT plate + user-loaded plates; crop defaults to "As shot" |

### ⏳ Not done

- **D4 for VIDEO.** Stills are done; `_videoComposeBorderMatte` precomputes its sizes once per
  clip, so the frame needs folding into that rather than being called per frame.
- **E1 — spot removal / clone / heal.** The largest remaining item: needs a clone-source picker,
  the stamp paint path (reuse `mskPaintAt`), and a heal blend. Not started.
- **E2's auto-horizon** — needs line detection (a Hough pass), which is its own piece of work
  rather than another slider. Manual Rotate ships in the meantime.
- **F2 — library polish**: full colour labels, metadata/info panel, undo for Delete and Reset
  edit, empty-state CTA, `#lib-bottom` as a real status bar, batch-operations bar.
- **F3 — grid virtualization + thumbnail decode tiering.**

## Things a future session should know

- **Two tests on this machine are flaky, and both are characterised in `CLAUDE.md` §2.** Re-run
  before bisecting. The export harness one is a confirmed **WebGL context loss** (SwiftShader) and
  the harness now retries once; the `video_harness` "still byte-exact after video" check fails
  about 2 runs in 5 on the *clean* tree and is still unattributed.
- **`subject.rs`'s header is the source of truth for what subject recognition can and cannot do.**
  Read it before building anything on top: ~77-80% recall, no usable "is it present" signal, so it
  must stay a suggestion the user confirms.
- Phase B/C added Rust commands, so a `dist/`-only refresh is no longer enough to update the
  installed app — `desktop/install-app.sh` (full `cargo build`) is required.
