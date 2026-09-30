# Mobile web UX review — 20 improvements

Reviewed the 375×812 web view (Looks sheet, Tools list, Adjust sheet, Export sheet, top bar) and
compared against Snapseed, Lightroom mobile, VSCO and Darkroom patterns plus general one-handed
mobile guidance (thumb zones, 44px targets, selection haptics on sliders).

## What I saw
- Looks sheet opens **folded** (an empty sheet with one "Presets" row) until tapped; once open it stacks
  search, category chips, a ~100px-tall tile strip and then Input / Highlight response / Print settings.
- Tools is a long text list (name + sentence per tool); the six-icon quick strip repeats part of it.
- Tool sheets show ~3 sliders at a time under a large photo gap; header has a collapse chevron *and* a
  master on/off switch; no way to hop to the next tool without going back to the list.
- Export is a separate bottom sheet that dims a half-visible tool sheet behind it.
- Top bar: logo, +, undo, redo, info glyph, "…" — the glyphs are unlabelled and the info glyph is easy to misread.

## The 20

### Looks
1. **Open Looks already expanded.** Never show an empty sheet; the sheet exists to show looks.
2. **Two-row, larger tile grid (or full-height list) with a visible current-look ring.** The 100px strip shows ~2.5 looks.
3. **Split Input / Highlight response / Print into their own "Input & Prints" sub-tab** (same split as desktop) so the preset sheet is only presets.
4. **Tap the selected look again to open strength** (VSCO pattern) instead of a permanent Strength bar eating space.
5. **Category chips as a single scrolling row, all visible** — replace "More" with horizontal scroll; keep the active chip centred.
6. **Favourites + recents row** at the top of Looks; most people reuse 3–5 looks.

### Editing flow
7. **Press-and-hold the photo to compare with the original** (Lightroom/Snapseed convention); show a small "Original" label while held.
8. **One-line tool strip under the photo** (Darkroom/Lightroom): tapping a tool opens just its sliders, swiping the strip moves to the next tool — no round-trip to the Tools list.
9. **Single-slider focus mode:** show one slider at a time with a large track; swipe the photo left/right to change it (Snapseed), swipe up/down to pick the next slider.
10. **Bigger slider thumbs (≥44px hit area) with a selection haptic on each step and a detent at the default value.**
11. **Double-tap a slider label to reset it**, and show a small reset dot on any changed slider.
12. **Drop the per-tool on/off switch from the sheet header on phones**; use the "eye" (hide effect) action instead. One control, one meaning.
13. **Sheet height snap points** (peek / half / full) so the photo stays large while dragging a slider; the sheet should peek to a single slider row.
14. **Tappable photo-edge zoom:** pinch-to-zoom with a 1:1 "check sharpness" shortcut, and keep the histogram as a pull-down from the top.

### Navigation and chrome
15. **Label or group the top bar:** back, undo, redo with a long-press history list, and a single "More" menu; replace the lone info glyph with "Info" inside More.
16. **Bottom bar = Looks · Tools · Crop · Export**, with Export as a normal button rather than a full-height red block; keeps the thumb zone for tools.
17. **Tools list: icon grid with one-line labels** (description on long-press); show an "edited" marker using the new desktop bar language (grey bar), not dots.
18. **Export as a full sheet with presets (Web / Print / Original) and an estimated file size**, remembering the last choice.

### Polish
19. **Consistent empty and loading states:** skeleton tiles while looks render, a "Checking…" state for auto-tags, and never a blank sheet.
20. **Safe-area and keyboard care:** respect the home-indicator inset, keep the sheet above the on-screen keyboard while typing a value, and fix the two audit misses (tiny labels, low-contrast Export) permanently by adding the UI audit to the mobile build gate.

## Suggested order
Quick wins: 1, 3, 5, 7, 10, 11, 12, 17. Medium: 2, 4, 6, 8, 13, 15, 16, 18. Larger: 9, 14, 19, 20.
