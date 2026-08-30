// Adobe camera-profile resolver (ROADMAP.md's F1) — reads locally-installed Adobe .dcp camera
// profiles IN PLACE from the system's real Adobe Camera Raw / DNG Converter install, never
// copying them (Adobe's own CameraProfiles tree runs to ~855MB and redistributing it isn't ours
// to do). Verified on this machine before writing this: 393 real camera folders exist under
// `/Library/Application Support/Adobe/CameraRaw/CameraProfiles/Camera/`, following exactly the
// naming convention `vendor/dcp/`'s own bundled files already use (`<Make> <Model>`), and a
// prior sample of 436 of 4352 real .dcp files found 99.8% carry ForwardMatrix1 with 0 missing
// LookTable — this is worth building, not exploratory.
//
// ⚠️ The two real trees have DIFFERENT shapes, confirmed by listing both directly rather than
// assumed from either one's naming convention alone:
//   Camera/<Make Model>/<Make Model> Camera <Style>.dcp   — a real per-camera SUBFOLDER, several
//                                                            style files inside.
//   Adobe Standard/<Make Model> Adobe Standard.dcp        — FLAT: one file per camera directly
//                                                            under the root, no subfolder, no
//                                                            per-style variants.
//
// ⚠️ Path traversal is the real risk here, and the reason this file exists as its own module
// rather than a one-line addition to main.rs: `prefix` derives from a photo's own EXIF Make/
// Model — untrusted bytes an attacker fully controls by crafting a malicious RAW file. Every
// candidate path is built from a small set of FIXED root directories plus a prefix that is
// validated character-by-character BEFORE it ever touches a `Path`, then re-checked by
// canonicalizing the final path and asserting it still lives under the root it was built from.
// Two independent checks, not one, because canonicalize() alone doesn't stop a component like
// `..` from being accepted structurally before resolution — reject the substring outright first.

use std::path::{Path, PathBuf};

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

const CAMERA_TREE: &str = "Library/Application Support/Adobe/CameraRaw/CameraProfiles/Camera";
const ADOBE_STANDARD_TREE: &str = "Library/Application Support/Adobe/CameraRaw/CameraProfiles/Adobe Standard";

/// Adobe's own fixed vocabulary for where camera profiles live — never derived from anything in
/// the photo, so these roots are trusted starting points for the traversal guard below.
/// `bool` marks whether this root uses the per-camera-subfolder shape (Camera/) or the flat
/// one-file-per-camera shape (Adobe Standard/).
fn candidate_roots() -> Vec<(PathBuf, &'static str, bool)> {
    let mut roots = Vec::new();
    if let Some(home) = dirs_home() {
        roots.push((home.join(CAMERA_TREE), "user-camera", true));
    }
    roots.push((PathBuf::from("/").join(CAMERA_TREE), "system-camera", true));
    roots.push((PathBuf::from("/").join(ADOBE_STANDARD_TREE), "adobe-standard", false));
    roots
}

fn root_for_source(source: &str) -> Option<(PathBuf, bool)> {
    match source {
        "user-camera" => Some((dirs_home()?.join(CAMERA_TREE), true)),
        "system-camera" => Some((PathBuf::from("/").join(CAMERA_TREE), true)),
        "adobe-standard" => Some((PathBuf::from("/").join(ADOBE_STANDARD_TREE), false)),
        _ => None,
    }
}

/// Rejects anything that could escape the intended root once joined onto a `Path`, checked on
/// the RAW STRING before any filesystem call — `/`, `\`, `..`, and NUL are the only components
/// a path-traversal payload needs, and a legitimate camera make/model never contains any of
/// them (Adobe's own folder names are plain ASCII words and spaces).
fn is_safe_path_component(s: &str) -> bool {
    !s.is_empty() && !s.contains('/') && !s.contains('\\') && !s.contains("..") && !s.contains('\0') && s.len() <= 128
}

/// Second, independent check: after joining, the resolved (symlink-following) path must still
/// live under the exact root it was built from. Catches anything the string check above might
/// have missed (e.g. a symlink planted inside a root pointing elsewhere) and is cheap insurance
/// given how much untrusted-input-to-filesystem-path code has historically gotten this wrong.
fn resolved_under(root: &Path, candidate: &Path) -> Option<PathBuf> {
    let root_canon = root.canonicalize().ok()?;
    let cand_canon = candidate.canonicalize().ok()?;
    cand_canon.starts_with(&root_canon).then_some(cand_canon)
}

#[derive(serde::Serialize)]
pub struct DcpProfileSet {
    /// The `<Make> <Model>` prefix this set was resolved for — echoed back so JS can build the
    /// same `dcp:<prefix>:<style>` LUT cache key the bundled path already uses.
    pub prefix: String,
    /// Which root this came from — surfaced to the log line so "Lightroom-matched" claims stay
    /// honest about whether this is Adobe's real per-camera fit or the generic Adobe Standard.
    pub source: &'static str,
    /// Style names available for this camera, stripped of the `<prefix> Camera ` / `.dcp`
    /// affixes — e.g. "Standard", "Vivid", "Landscape". `Adobe Standard/`'s flat shape has
    /// exactly one un-named profile per camera, reported as the single style "Standard".
    pub styles: Vec<String>,
}

/// Walks the candidate roots in priority order (user-installed, then system, then the generic
/// Adobe Standard singleton) and returns the FIRST one containing at least one real `.dcp` file
/// for this camera. Bundled `vendor/dcp/` profiles are NOT checked here — that lookup is
/// unconditional and always wins, resolved entirely in JS before this is ever called (see
/// `cameraDcpPrefix`'s doc comment in chromasmith-22.html), so this function only runs for a
/// camera the bundled 2-entry table doesn't already cover.
#[tauri::command]
pub fn list_dcp_profiles(make: String, model: String) -> Option<DcpProfileSet> {
    if !is_safe_path_component(&make) || !is_safe_path_component(&model) {
        return None; // malformed/hostile EXIF — decline rather than guess at a sanitized form
    }
    let prefix = format!("{make} {model}");
    if !is_safe_path_component(&prefix) {
        return None; // the joined form must ALSO pass (catches e.g. make="a" model=".." + "/")
    }
    for (root, source, has_subfolder) in candidate_roots() {
        if has_subfolder {
            let dir = root.join(&prefix);
            let Some(safe_dir) = resolved_under(&root, &dir) else { continue };
            let Ok(entries) = std::fs::read_dir(&safe_dir) else { continue };
            let file_prefix = format!("{prefix} Camera ");
            let mut styles: Vec<String> = entries
                .flatten()
                .filter_map(|e| e.file_name().to_str().map(str::to_string))
                .filter_map(|name| name.strip_prefix(&file_prefix).and_then(|s| s.strip_suffix(".dcp")).map(str::to_string))
                .collect();
            if !styles.is_empty() {
                styles.sort();
                styles.dedup();
                return Some(DcpProfileSet { prefix, source, styles });
            }
        } else {
            // Flat tree: check for the ONE expected filename directly, rather than scanning a
            // ~4,352-entry directory just to find one match by prefix.
            let candidate = root.join(format!("{prefix} Adobe Standard.dcp"));
            if resolved_under(&root, &candidate).is_some() {
                return Some(DcpProfileSet { prefix, source, styles: vec!["Standard".to_string()] });
            }
        }
    }
    None
}

/// Reads one resolved `.dcp` file's raw bytes. `source`/`prefix`/`style` are exactly what a
/// prior `list_dcp_profiles` call returned — re-validated here independently rather than
/// trusted, since this command is reachable on its own over IPC.
#[tauri::command]
pub fn read_dcp_file(source: String, prefix: String, style: String) -> Result<Vec<u8>, String> {
    if !is_safe_path_component(&prefix) || !is_safe_path_component(&style) {
        return Err("invalid camera profile identifier".to_string());
    }
    let (root, has_subfolder) = root_for_source(&source).ok_or_else(|| format!("unknown DCP source: {source}"))?;
    let candidate = if has_subfolder {
        root.join(&prefix).join(format!("{prefix} Camera {style}.dcp"))
    } else {
        root.join(format!("{prefix} Adobe Standard.dcp"))
    };
    let safe_path = resolved_under(&root, &candidate).ok_or("profile path failed the traversal check")?;
    std::fs::read(&safe_path).map_err(|e| format!("read {}: {e}", safe_path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_traversal_in_make_and_model() {
        assert!(list_dcp_profiles("../../../../etc".to_string(), "passwd".to_string()).is_none());
        assert!(list_dcp_profiles("Sony".to_string(), "../../../../etc/passwd".to_string()).is_none());
        assert!(list_dcp_profiles("Sony/../../etc".to_string(), "passwd".to_string()).is_none());
        assert!(list_dcp_profiles("Sony\0".to_string(), "X".to_string()).is_none());
        assert!(read_dcp_file("system-camera".to_string(), "../../../../etc".to_string(), "Standard".to_string()).is_err());
        assert!(read_dcp_file("system-camera".to_string(), "Sony DSC-RX100M5".to_string(), "../../../etc/passwd".to_string()).is_err());
    }

    #[test]
    fn rejects_unknown_source() {
        assert!(read_dcp_file("../evil".to_string(), "Sony DSC-RX100M5".to_string(), "Standard".to_string()).is_err());
    }

    /// Real-machine coverage — skips gracefully if Adobe Camera Raw isn't installed here, same
    /// `_if_present` pattern the rest of this codebase's real-file tests use.
    #[test]
    fn finds_real_installed_profiles_if_present() {
        let Some(set) = list_dcp_profiles("Sony".to_string(), "DSC-RX100M5".to_string()) else {
            eprintln!("skipping: no Adobe Camera Raw camera profiles installed on this machine");
            return;
        };
        assert_eq!(set.prefix, "Sony DSC-RX100M5");
        assert!(set.styles.contains(&"Standard".to_string()), "styles: {:?}", set.styles);
        let bytes = read_dcp_file(set.source.to_string(), set.prefix.clone(), "Standard".to_string()).expect("read the resolved Standard profile");
        assert!(bytes.len() > 1000, "a real .dcp should be well over 1KB, got {}", bytes.len());
    }

    #[test]
    fn finds_adobe_standard_flat_tree_if_present() {
        // Apple iPad/iPhone Adobe Standard profiles are near-universally present on a machine
        // with Adobe Camera Raw installed (Apple ships no per-model bundled profile of its own).
        let Some(set) = list_dcp_profiles("Apple".to_string(), "iPad13,1 back camera".to_string()) else {
            eprintln!("skipping: no Adobe Standard profiles installed on this machine");
            return;
        };
        assert_eq!(set.source, "adobe-standard");
        assert_eq!(set.styles, vec!["Standard".to_string()]);
        let bytes = read_dcp_file(set.source.to_string(), set.prefix.clone(), "Standard".to_string()).expect("read the flat-tree profile");
        assert!(bytes.len() > 1000);
    }
}
