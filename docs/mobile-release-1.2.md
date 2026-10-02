# Mobile release 1.2.1 (CHR-169)

This release implements the 20 approved iOS and Android improvements. The mobile
shell still uses the shared image renderer; originals remain separate from recipes.

| # | Improvement | Delivered behaviour |
|---|---|---|
| 1 | Gallery layout | Header wraps on narrow phones; search, collection filters, scrolling grid and selection actions fit the screen. |
| 2 | Touch targets | Primary mobile controls, sliders, switches, numeric values, gallery actions and navigation use a 48 CSS-pixel target. |
| 3 | Accessibility and text | Labelled ranges/switches/navigation, keyboard-operable values, focused modal dialogs, background inertness, reduced-motion support and three remembered text sizes. |
| 4 | Navigation | Labelled Gallery button and Android App back handler dismiss dialogs, tool browser, adjustment sheet and selection before minimizing at Gallery. Predictive back is enabled in Android. |
| 5 | Adjustment sheets | Compact labelled control blocks with direct resets; expand/reduce and existing drag snap points remember the chosen sheet size. |
| 6 | Tool discovery | Search plus All, Light, Colour, Film, Local, Geometry, Detail and Saved categories; explicit no-results state and remembered category. |
| 7 | Look browsing | Quick rail or expanded two-column grid with readable wrapping names and full-width group headings. |
| 8 | Look actions | Visible Strength and Favourite controls with selected-state feedback. |
| 9 | Compare and gestures | Explicit Compare/Show edit with an Original label; photo swipe adjustment is opt-in. Comparison does not arm while painting. |
| 10 | Precise controls | Numeric entry sheet, step controls and direct reset; straighten is entered in degrees; haptics can be disabled. |
| 11 | Device layouts | Portrait, landscape and coarse-pointer tablet/foldable layouts; no portrait lock or rotation blocker. |
| 12 | Mask workflow | Choose area, Brush/Ellipse/Gradient, Add paint and Erase, active-mask status, and a magnifier above the painting finger. |
| 13 | Gallery organization | Filename search, visible sort, collection names, favourites and rejection filters. |
| 14 | Import | File progress, exact-byte duplicate checks, recoverable import/decode errors and retry. Original and metadata writes are atomic. |
| 15 | Saves | Per-photo Saving/Saved/Retry state; flush before navigation/export, foreground/background handling and a best-effort pending-edit journal. Binary storage reads both old Blob records and new portable byte records. |
| 16 | Batch scope | Multi-selection opens a per-photo editing queue. Explicit Sync chooses setting categories while preserving each photo's geometry, masks and retouch; batch export loads each saved recipe. |
| 17 | Versions | User-named snapshots, thumbnail comparison and version/original forks that preserve the prior working edit. Older versions without previews can be opened as a new version. |
| 18 | Trash | Persistent recoverable Trash, explicit restore and confirmed permanent deletion; no timed purge. |
| 19 | Export | Explicit Photos, Files or Share destination; per-file receipts, permission/cancellation failures, retry and Files fallback. Share reports handoff rather than confirmed saving. Batch results include decode/render failures. |
| 20 | Portable projects | ZIP containing exact original bytes, recipes, named versions, export history, collection/flag/Trash metadata. Validated restore adds new IDs; desktop More opens projects and their saved versions. |

## Storage and compatibility

The existing `chromasmith-mlib` database is retained. Its originals and edited
recipes do not require deletion or reimport. New originals and thumbnails use
binary buffers to avoid WebKit's IndexedDB Blob-cloning failures. Project backups
are limited to 1 GB and exclude derived thumbnail blobs; restored previews are
rebuilt. Named recipes, including raster masks, are retained. Desktop handoff
requires this release or a later build. Keep the project ZIP to reopen other photos.

Files exports are written to `Documents/Chromasmith`. iOS exposes Documents in
Files with file sharing enabled. Photos exports use the Chromasmith album. Android
APK updates retain the existing debug signing-key cache and increase versionCode
to 4; iOS uses marketing version 1.2.1 and build 4. The IPA is unsigned and needs
the same signing/sideloading service as previous releases.

## Automated verification

`npm run mobile:test:all` runs Chromium and WebKit against the shipped assets,
with native bridges substituted for repeatable permission/cancellation tests.
It checks responsive bounds, targets, numeric entry, compare, queue isolation
before debounce, gallery search/collections/text, cancelled paste, version forks,
Trash across reload, original-byte project round-trip and invalid archive safety,
export retry/cancellation, tool categories, look actions, masking controls, real
export rendering, per-photo batch receipts, Android back and landscape/tablets.
The Mobile UX and data-safety GitHub workflow runs both engines and saves screenshots.
Native platform builds are independently produced by the Android and iOS workflows.

The broad Editor gate set has existing failures on unmodified main (including
snapshot-list gaps, wireframe drift and missing surface inventory). These are
not treated as a mobile acceptance pass. The shared UI audit is required to pass.

## Validation follow-up: 1.2.1

Additional checks found and fixed recovery and export gaps: a corrupt image now
restores the outgoing pixels, recipe and undo history; storage failures retain a
clickable Retry state; Files exports choose an unused filename; single-file and
Blob exports report the actual save result and preserve their bytes. Dialogs
keep keyboard shortcuts inside the modal and focus numeric/name fields correctly.
Photo/project opening waits for the saved look to load. Selective sync normalizes
older exposure recipes and includes NR/Deconvolution enable states.

`test/mobile_edge_cases.mjs` adds checks for failed decode and storage recovery,
Tone sync preserving crop/masks/retouch/grain, older recipes, same-name outputs,
partial retries belonging to the correct photo, single-file failures and Blob
bytes, real brush/erase/magnifier interaction, deletion confirmation and keyboard
focus on a 320px phone. The complete mobile command runs both suites in Chromium
and WebKit. Native 1.2.1 uses build/versionCode 4; release notes remain intact when
the companion desktop workflow attaches its assets.

The machine has no iOS simulator toolchain or Android SDK. Automated native bridge
failures are substituted; signed installation, real Photos/Files permissions and
VoiceOver/TalkBack still require physical-device testing.

## Device testing

1. Install over the previous version. Check that old photos, edits and saved versions still open.
2. Import two different photos plus a duplicate. Edit each differently and switch quickly; reopen after closing the app.
3. Select both photos, sync only Tone, and check that crops, masks and retouch remain individual. Export the queue and inspect both outputs.
4. Save a named version, change the edit, compare and fork it; check that the prior edit is available.
5. Trash a photo, restart, restore it, back up the gallery and restore the ZIP. Open the ZIP on desktop.
6. Deny Photos permission, export and retry to Files. Cancel Share and check that it does not claim a save.
7. Test Android system/predictive back, iOS VoiceOver, Android TalkBack, larger text, landscape, tablet and foldable layouts; paint with the magnifier.
