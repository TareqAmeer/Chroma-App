# Windows titlebar menus

Windows places File, Edit, Photo, View, and Help in one 32px titlebar with minimize, maximize/restore, and close. Window-state restoration excludes decorations so an older saved native frame cannot create a second titlebar. macOS keeps its system menu.

The inventory follows task groupings documented by [Affinity Photo](https://affinity.help/photo2/English.lproj/pages/Workspace/interface.html) and the editing and viewing commands documented by [Lightroom Classic](https://helpx.adobe.com/lightroom-classic/desktop/viewing-photos/view-photos.html). Commands reuse Chromasmith's existing operations.

| Menu | Available operations |
| --- | --- |
| File | Open Photo, Open Folder, Open Recent, Library, Save/Load Session, Export, Exit |
| Edit | Undo/Redo, Copy/Paste Edit, Reset Edit, Settings |
| Photo | Reject/Pick/Clear Flag, Rotate Left/Right, Flip Horizontal/Vertical, Crop/Straighten, Auto Enhance, White Balance Eyedropper, Reshuffle Film Artifacts |
| View | Zoom In/Out/Fit/100%, Before/After Split, Histogram, 1:1 Loupe, Full Library, Full Screen |
| Help | Search Commands, Keyboard Shortcuts, Guide, What's New, Welcome Tour, About |

Export, edit clipboard, and flags use Gallery selection or the open Studio photo. Geometry, adjustments, sessions, and photo viewing tools require an open Studio photo. Paste also requires a copied recipe. Disabled items explain their requirements. Settings opens the real preferences menu; About opens build information.

Keyboard access supports Tab to the menubar, arrows between menus and items, Home/End, Enter, and Escape with focus restoration. Clicking outside, resizing, or losing focus dismisses dropdowns.

Verification: `CS_BROWSER_CHANNEL=msedge node test/header_menus.mjs` tests all 40 routes, handler coverage, context disabling, keyboard focus, dismissal, and both themes at 900/1100/1440px. Native Windows checks cover the single titlebar, Settings, Help dialogs, minimize, maximize/restore, full-screen toggling, and File > Exit. Photo-edit routes are checked against existing handlers; this does not constitute end-to-end validation of every image operation. Full editor gates require unavailable Chromium/test dependencies on this host.
