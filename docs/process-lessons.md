# Process lessons (read before tuning)

(moved from CLAUDE.md §6, 2026-09-11)

Learned the hard/expensive way:

1. **Render-and-look FIRST; point-samples are a secondary guardrail.** A lot of prior work
   was done blind on `validate_v22.py`'s gap-only metric, which structurally cannot see
   interior flooding (pink-flood, yellow-bleed) — the most visible defects to a human. Always
   render the full chart side-by-side with the reference and walk a visual checklist before
   trusting any number. Sample flat *interiors*, not just gaps/edges.
2. **A fast all-requirements scorecard gate beats slow blind optimization.** Two multi-minute
   re-optimizations "improved the loss" while collapsing `gainG→0` (hard pure-red halo)
   because the loss under-weighted some requirements. `scorecard.py` computes every
   requirement in seconds. **Never run a long optimization whose loss doesn't encode every
   requirement** — the optimizer trades away anything not in the loss.
3. **Validate the mechanism on a few read-only point computations first.** The high-pass fix
   was proven (interior flood 0.305→0.000 at identical params, gap R unchanged) in seconds,
   before any file edit — no optimization needed.
4. **Never put backticks/`${` in GLSL comments inside JS template literals** (see CLAUDE.md §3), and
   **reload the live page in a real browser after every shader edit**.
5. **`overflow-x:hidden` on `html`/`body` silently disables `position:sticky`** on all
   descendants (it makes the body a scroll-clipping context). Use `overflow-x:clip`.
6. When the user reports a RAW colour mismatch, **first ask what's rendering the comparison**
   (Preview shows the embedded JPEG, not the RAW).
7. The app preset list must mirror its `.cube` sources — `calib/LUT LIBRARY/` (46) plus
   `calib/dehancer/cubes/` (67) = the 113 keys in `LUT_META`; a LUT with a real
   non-`_composed` source (astia/classic_neg/velvia) beats its composed recreation.
   ⚠️ Adding presets is not free any more — see CLAUDE.md §2's payload note. A new look belongs in
   `vendor/luts/`, not inline, and `LUT_META` is what makes it appear.
8. **`column-count:1` does NOT mean "not multi-column"** — it still establishes a multicol
   formatting context, and a multicol box with a definite block-size fragments overflow into
   extra side-by-side columns instead of scrolling vertically (bit `.fx-panel` once, made a tall
   tool panel's bottom half unreachable). Use `columns:initial` to leave the context entirely.
   Now caught by `test/ui_audit.mjs`'s FRAGMENT check if it recurs.
9. **`.fx-row` assigns `order` to three specific children** (`.fx-label`:1, `.fx-val`:2,
   `.fx-slider`:3); anything else (checkbox, `<select>`, colour input) needs an `order` too or it
   paints before its own label under the flex default `order:0`. `.fx-row>*{order:2}` is the base
   rule that prevents this now; `test/ui_audit.mjs` also checks for it.
10. **A comment claiming a complexity class is not evidence.** `_boxFilterJS` was documented as
   an O(w·h) prefix sum and written as a naive O(w·h·r) window sum — it even computed a row
   total into `acc` and never used it. Six calls at 2048×1365 cost ~2s of blocked main thread
   per "Refine edges". When a hot path feels slow, read the loop, don't trust the header.
11. **Typed arrays do not survive `JSON.stringify`.** `Uint8ClampedArray` serializes to
   `{"0":…,"1":…}`, which is both enormous and lossy on the way back. Every mask persistence
   path (session, Library sidecar, copy/paste recipe, undo history) must go through
   `_mskToSnap`/`_mskFromSnap`, never a raw JSON clone of a live mask.
12. **Seeded-`Math.random` goldens are order-dependent.** Every `FX.render` without an explicit
   `opts.seed` consumes one number from the stream, so the three grain goldens depended on how
   many PREVIEW renders happened during harness setup — adding a live preview render shifted all
   three with no change to export output. `export_harness.mjs` now reseeds immediately before the
   render. To prove an app change is output-neutral, render the pre-change file through the same
   harness and byte-compare; don't reason about it.
13. **Hiding a disabled section with `display:none` also hides it from the UI audit.** Switching
   off-sections to dimmed-but-rendered immediately surfaced a control that had been unreadable
   for a long time (an 8px "BLR" text label in a 24px circle). Anything permanently hidden is
   permanently unaudited.
14. **The Library (`desktop/library-ui.js`) is native-gated, so an ordinary browser page-load
   check renders nothing — a layout bug there is invisible unless you specifically drive
   `?libtest=1`** (mocks the Tauri commands + `window.lrCloud` so the real Library DOM/CSS
   renders in a plain browser; `window.libtestLrConnect()` flips the mock Lightroom to
   connected). Two consecutive builds shipped with the sidebar invisible before this was
   caught — always screenshot-verify Library layout changes through `?libtest=1` before
   rebuilding the app, not after. Relatedly: a UI redesign must **migrate persisted state, not
   just change defaults** — stale `localStorage` (e.g. an old tree-collapsed flag) can silently
   override a new default. Use a new storage key (and delete the legacy one) whenever a
   persisted choice's meaning changes.
15. **Before changing `display`/`visibility` on any container you didn't just create in the
   same edit, read its full children list first** — not just confirm the one element you want
   is somewhere inside it. Toggling a wrapper to reveal one child can reveal unrelated siblings
   bundled into the same container (2026-09-09: widening the docked Library filmstrip revealed
   the Library/Develop tab pair as intended, but also the full Collections/By-Date navigation
   tree, because both lived inside the same `#lib-side` wrapper and only the tabs were checked
   for). Target the specific leaf element; never toggle a shared parent as a shortcut.
16. **Any resizable/breakpoint-driven UI needs a state-matrix test, not a default-state-only
   one.** Assert structure (Playwright ARIA snapshot, `toMatchAriaSnapshot()`) at min, threshold,
   and max — scoped to the actual parent container that could leak, not just the child you're
   adding. Hand-author the expected snapshot from the spec/wireframe; never auto-generate it
   from the current implementation, or you just codify whatever bug is already there.
17. **Never act on an existing writeup of a flaky/intermittent bug — including a prior session's
   own "root cause" note or a comment in the code — without reproducing it live first, no matter
   how detailed or confident it reads.** E7 (editor_ux_spec.json, 2026-09-10) cost real time
   this way: an earlier session's note blamed a boot-watchdog race, a fix was built and shipped
   for it, and it turned out to target the wrong mechanism entirely — `body.lib-full` was
   confirmed FALSE in every reproduced failure, the thing the theory depended on. The actual
   cause (an in-flight CSS transition surviving `transition-duration:0`) was found by adding one
   line of live instrumentation to a real failing run and reading what it said, not by reasoning
   about the existing writeup further. A theory that "sounds right" and is written down
   somewhere is still just a theory. For any bug described as intermittent/flaky: spend one round
   confirming it live (a console.log, a live property read, a screenshot at the failure moment)
   BEFORE building a fix, and don't call it fixed off one clean run — rerun it enough times to
   actually see the failure rate move.

18. **Completeness has to be measured from the running app, never from a hand-written list — and a
   check only counts once it has failed on the defect it claims to prevent.** 2026-09-11: the
   narrowed tool rail shipped with every icon half off-screen (`#fx-toolrail` kept a hardcoded
   `width:72px` while its grid track went to 44px). Four things let it through, each "covered" on
   paper: (a) the surface inventory (S5) and the capture pass (S6) were driven by a list of what to
   include, and the list left out all app chrome (top bars, rail, filmstrip, status bars); (b) the
   `panel-fx` page entry CONTAINED the rail, so anything asking "is this inside a listed surface?"
   said yes; (c) `editor_responsive_qa.mjs` swept 8 window widths but only ever ran the rail at its
   default width, and checked overlap/wrap but not clipping, so nothing could fail; (d) the gate was
   advisory at commit. Lesson #16 (state matrix, not default state) was already written down —
   unenforced. Now enforced mechanically: `checkClipping` (partial cut-off by a container or the
   window), `checkResizerCoverage` (every drag handle in the DOM must be an axis of the test's layout
   matrix at min/default/max, crossed with every viewport), `test/surface_coverage_check.mjs` (every
   layout region needs its OWN surfaces.json entry — containment doesn't count), and
   `editor:responsive` is a blocking gate. Rule: **every width** = every viewport × every resizable
   region at its min, default and max × every mode (e.g. rail labels/icons) — and prove a new check
   by running it on the broken build first.
