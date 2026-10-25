# Lightroom CC masking — hands-on review (verified live, 2026-10-25)

Driven by hand in Adobe Lightroom CC on a RAW (TM6636). Everything below was seen on screen unless marked "unverified". Test masks/strokes were undone/deleted; the pre-existing "Mask 1" (Select Objects) was left alone.

## Verified observations
- **Create New Mask** is one button. With no masks it expands into tiles (Subject / Sky / Background) + list; once a mask exists it becomes a single button that opens a dropdown popover: tiles on top, then People…, Landscape, Objects (S), Brush (B), Linear (L), Radial (R), Color Range, Luminance Range, Depth Range (greyed when unavailable), each with its shortcut.
- **Mask list**: newest on top, each row = live selection thumbnail + name; selected row highlighted. Eye icon in the header hides all masks. Right-click row: Rename…, Invert <tool>, Duplicate and Invert, Intersect with Mask Using ▸, Duplicate, Hide, Delete "<name>", Copy, Paste, Delete Empty Masks From…, Delete All Empty Masks, Delete All Masks (an empty mask shows just Delete + Delete All).
- **Selected mask expands in place** to show its components as a sub-list ("↳ Object") with **Add** and **Subtract** buttons directly under the row.
- **Overlay** is one row under the list: switch "Show Overlay" + "…" menu. The menu = Mask Overlay Mode (Color Overlay, Color Overlay on B&W, Image on B&W, Image on Black, Image on White, White on Black — radio, checked item ticked), Show Overlay for New Masks, Show Pins and Tools (⌘O), Show Unselected Mask Pins, Overlay Settings… (floating "Mask Overlay" popover with a Mode dropdown + close). The overlay switch/mode persists across strokes, tool changes and new masks.
- **"Image on B&W" mode** (what this user's Lightroom is set to): the whole photo goes B&W and the *selected area shows in full colour with feathered falloff* — painting literally brings colour back. An empty mask leaves the photo in colour until the first stroke.
- **Tool section** shows only the selected tool: header (Brush ↔ Eraser) with **Invert** at the right, a 2-icon Paint/Erase pair (exactly one boxed; Density greys out in Erase), Size (with a dropdown arrow for presets), Feather, Flow, Density, Auto Mask. Objects tool: brush/rectangle mode icons + Size/Feather/Edge + "Provide feedback". Defaults on a fresh brush: Size 47, Feather 100, Flow 67, Density 100.
- **Contextual how-to** at the bottom of the sidebar: a small looping animation + one line ("Click and drag to paint over areas to include. Hold Option to erase."). Changes per tool.
- **Per-mask adjustments** below the tool: "<Mask name>" + Preset dropdown + Amount (disabled until something is adjusted), then collapsed groups Light / Color / Effects / Detail / …; Light = Exposure, Contrast, Highlights, Shadows, Whites, Blacks + a collapsed "Point Curve" row. A group header shows an **eye icon only when it contains non-default values** (toggles that group on/off). Slider label+value turn bright when modified; **double-click a slider label resets it to 0**. The whole sidebar scrolls as one column.
- **Undo is labelled and per action**: "Undo Brush", "Undo Update Exposure Adjustment", "Undo Select Objects" — one step per stroke / slider change / mask creation.
- **Cursor**: while the brush is active the pointer is a small brush icon (ring not captured in screenshots — unverified).
- Unverified: Option-hold erase feel, [ ] / Shift+[ ] / number-key behaviour, Range mask refine UI, gradient handles, overlay colour picker (Overlay Settings), drag-reorder.

## 20 improvements for Chromasmith (ranked; H/M/L impact, S/M/L effort) — most are from verified behaviour above
1. **Overlay modes menu = the user's "bring colour back" view** (H/S): ensure "Image on B&W" (selection in colour, rest B&W, feathered) is a first-class radio in a "…" overlay menu with all six modes; persists across every action; empty mask leaves the photo in colour. Probe it in the native app.
2. **Create New Mask collapses to one button + dropdown popover** after the first mask (H/S) — in progress with the sidebar redesign; keep tiles at top, People…, shortcuts shown, unavailable types greyed with reason.
3. **Add / Subtract buttons directly under the selected mask's component row** (H/M): a "↳ Brush / Subject / Radial…" component list with Add and Subtract (and Intersect via the row menu), replacing scattered chips.
4. **Row context menu parity** (H/S): Rename…, Invert, Duplicate and Invert, Intersect with…, Duplicate, Hide, Delete, Copy, Paste (mask settings), Delete Empty Masks, Delete All Masks.
5. **Group header eye + modified state** (H/S): per-group eye shown only when the group has non-default values; toggles that group; modified labels/values brighten.
6. **Double-click slider label resets to default** everywhere in the mask panel (H/S).
7. **Labelled, per-action undo** ("Undo Brush", "Undo Exposure") visible in the Edit menu and history list (M/M).
8. **Contextual how-to strip** at the bottom of the mask panel: one line per tool (+ optional short looping animation) (M/S).
9. **Section header renames Brush ↔ Eraser; Density greys in Erase** (done except grey; Chromasmith keeps Density active as an erase floor — keep, label it).
10. **Amount slider disabled until the mask has an adjustment** (M/S) to avoid dead controls.
11. **Preset dropdown per mask** (M/M): save/apply per-mask adjustment presets.
12. **Show Overlay for New Masks** pref + Show Pins and Tools (⌘O) + Show Unselected Mask Pins options in the overlay menu (M/S).
13. **Overlay Settings popover** (mode + colour/opacity) as a floating card over the canvas (M/S).
14. **Brush size dropdown presets** next to Size (small/medium/large) (L/S).
15. **Objects tool with brush or rectangle mode icons + Edge slider** (M/L).
16. **Empty masks housekeeping**: Delete Empty Masks / auto-drop empty masks on tool change (M/S).
17. **Tool section shows only the selected tool's options** (H/M) — covered by the sidebar redesign; verify every type.
18. **One collapsed 'Point Curve' row under Light** instead of a separate curve editor block (L/S).
19. **Hidden/greyed unavailable mask types with a hint** (e.g. Depth Range needs a depth map) instead of removing them (L/S).
20. **Feedback link** in the mask panel (L/S).
