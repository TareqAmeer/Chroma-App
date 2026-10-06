# Native desktop file drag-out (CHR-188)

## Feasibility result

Tauri's built-in `start_dragging` command is for moving the application window; its permission is
not a file-export drag API. CrabNebula's maintained Tauri v2 `tauri-plugin-drag` provides a native
OS file drag from a supplied local path and preview icon. Its documented JavaScript API is
`startDrag({ item: [path], icon })`; the plugin's Rust setup and Tauri capability are now wired in
the desktop shell. The npm bindings are pinned by `desktop/package-lock.json` and the Rust crate
by `desktop/src-tauri/Cargo.lock`.

The implementation contract is therefore: produce a unique export at a local path, finish and
close it, then pass that path to `startDrag`. Do not pass the original source photo, a partial
write, or a path that can be removed while another app is still reading it. The native plugin
starts the OS drag; it does not render the graded export, snapshot last-used export settings, or
define temporary-file cleanup. Those responsibilities need to reuse the export workflow and
result reporting from CHR-201. This slice intentionally does not add a Library/editor gesture or
create export files.

## Platform and verification limits

CrabNebula documents macOS and Windows support; its lower-level Linux implementation uses GTK,
with a documented winit limitation. The project’s user-facing acceptance targets are Finder,
Mail, and Messages, so macOS still needs to verify receiver behavior, drag cancellation, multiple
drags, and file lifetime. This implementation environment is Windows; no native macOS drag was
run here. The plugin's Rust and JavaScript setup was checked structurally, but the full desktop
crate was not compiled in this slice.

An alternative, `tauri-plugin-dragout`, uses macOS `NSFilePromiseProvider` and can create a file
on drop, but its upstream README says macOS 11+ only and that it deliberately fails to compile on
other platforms. Its archive-oriented promise API is not needed for the existing export path, so
this slice chooses the cross-platform drag plugin and requires the export to exist before drag.

## Upstream references

- [CrabNebula drag-rs / Tauri plugin setup](https://github.com/crabnebula-dev/drag-rs)
- [CrabNebula drag-rs release history](https://github.com/crabnebula-dev/drag-rs/releases)
- [macOS-only tauri-plugin-dragout README](https://github.com/alexqqqqqq777/tauri-plugin-dragout)
- [Tauri window dragging permission](https://v2.tauri.app/reference/acl/core-permissions/#allow-start-dragging)
