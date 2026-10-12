# Culling viewport space — 12 October 2026

Candidate `32b715c7fb42722b5e3f08a5bd0f815beada2015`, BUILD `1.1012H`, hides the Gallery's
grid-only folder heading during Compare/Survey/Cull and restores it in Gallery. The culling
toolbar has one range label and a separate focused-photo keyboard hint. Existing focused-pane,
78px filmstrip, fit/native and linked controls are retained.

The production browser regression passes computed visibility/restoration and range/hint checks,
plus existing grouping, actions/Undo and full-selection navigation. The actual Tauri WebView
passes Compare, Survey, Cull picker, Cull and Gallery restoration in dark/light at measured CSS
viewports 1366×768 and 1440×900, DPR approximately 1. The initial native viewport was 1366×672;
the report records requested and measured per-scenario viewports separately.

The catalog contains exactly the two task-owned chart/portrait PNG hardlinks. No RAW inference
or photographic quality claim belongs to this layout check. The helper clicks the actual photo
pane before testing Escape after asynchronous pane creation; an earlier transient exit timeout
was not attributed to a production cause, and this slice does not claim a shortcut fix.

[Native report](culling-title-native-2026-10-12.json),
[dark screenshot](culling-title-native-2026-10-12-dark.png),
[light screenshot](culling-title-native-2026-10-12-light.png).
The shared profile's exact prior Library values are restored and only the root-owned test app
is closed after validation.

The [full Editor audit](editor-gates-2026-10-12.json) retains 21 passes, the same 12 failures and
879 inventory findings as the CHR-193 baseline. This is not a full-suite pass. JS syntax,
Library content lint and whitespace checks pass. Original broader linked-pan/source/action and
advisory criteria remain separate from this visible-space slice.
