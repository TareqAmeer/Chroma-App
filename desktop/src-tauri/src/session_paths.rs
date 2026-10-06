//! Portable Session paths are slash-separated, relative to the Session root, and never
//! allowed to escape through `..`, platform-specific separators, or existing symlinks.
use std::fs;
use std::path::{Component, Path, PathBuf};

pub(crate) fn validate_relative_path(value: &str) -> Result<PathBuf, String> {
    if value.is_empty() || value.contains('\\') || value.contains(':') || value.contains('\0') {
        return Err("Session paths must be non-empty, portable relative paths".into());
    }
    let segments: Vec<_> = value.split('/').collect();
    if segments
        .iter()
        .any(|part| part.is_empty() || *part == "." || *part == "..")
    {
        return Err("Session paths cannot contain empty, current, or parent components".into());
    }
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("Session paths must stay relative to the Session root".into());
    }
    Ok(path.to_path_buf())
}

/// Resolve a manifest path for future file operations, rejecting existing symlink components
/// that leave the Session root. Missing final paths are allowed for safe creation workflows.
pub(crate) fn resolve_session_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative = validate_relative_path(relative)?;
    let root = fs::canonicalize(root).map_err(|e| format!("open Session root: {e}"))?;
    if !root.is_dir() {
        return Err("Session root is not a directory".into());
    }
    let mut candidate = root.clone();
    let components: Vec<_> = relative.components().collect();
    for (index, component) in components.iter().enumerate() {
        candidate.push(component.as_os_str());
        match fs::symlink_metadata(&candidate) {
            Ok(_) => {
                candidate = fs::canonicalize(&candidate)
                    .map_err(|e| format!("resolve Session path: {e}"))?;
                if !candidate.starts_with(&root) {
                    return Err("Session path resolves outside its root".into());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                for rest in &components[index + 1..] {
                    candidate.push(rest.as_os_str());
                }
                return Ok(candidate);
            }
            Err(error) => return Err(format!("inspect Session path: {error}")),
        }
    }
    Ok(candidate)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portable_relatives_allow_nested_files_and_reject_traversal_forms() {
        assert_eq!(
            validate_relative_path("Capture/2026/IMG_001.CR3").unwrap(),
            PathBuf::from("Capture/2026/IMG_001.CR3")
        );
        for bad in [
            "",
            "../outside.raw",
            "Capture/../../outside.raw",
            "/absolute.raw",
            "C:/outside.raw",
            "Capture\\outside.raw",
            "Capture//image.raw",
            "Capture/./image.raw",
        ] {
            assert!(
                validate_relative_path(bad).is_err(),
                "accepted unsafe path {bad:?}"
            );
        }
    }

    #[test]
    fn resolves_existing_and_missing_paths_under_a_movable_root() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "chromasmith-session-path-test-{}-{nonce:x}",
            std::process::id()
        ));
        fs::create_dir_all(root.join("Capture")).unwrap();
        fs::write(root.join("Capture/image.raw"), b"fixture").unwrap();
        assert_eq!(
            resolve_session_path(&root, "Capture/image.raw").unwrap(),
            fs::canonicalize(root.join("Capture/image.raw")).unwrap()
        );
        assert_eq!(
            resolve_session_path(&root, "Output/result.jpg").unwrap(),
            fs::canonicalize(&root).unwrap().join("Output/result.jpg")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape_from_the_session_root() {
        use std::os::unix::fs::symlink;
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "chromasmith-session-symlink-test-{}-{nonce:x}",
            std::process::id()
        ));
        let root = base.join("Session");
        let outside = base.join("outside");
        fs::create_dir_all(root.join("Capture")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside, root.join("Capture/escape")).unwrap();
        assert!(resolve_session_path(&root, "Capture/escape/file.raw").is_err());
        fs::remove_dir_all(base).unwrap();
    }
}
