//! Portable, offline Session scaffold. This first slice creates metadata and empty folders only;
//! it never moves, renames, or deletes a photo.
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[path = "session_names.rs"]
mod names;
#[path = "session_paths.rs"]
mod paths;

const SESSION_FORMAT: &str = "chromasmith-session";
const SESSION_FORMAT_VERSION: u32 = 1;
const MANIFEST_FILE: &str = "session.json";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionFolders {
    pub capture: String,
    pub selects: String,
    pub output: String,
    pub trash: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionAsset {
    /// Stable opaque ID retained when a Session folder is moved to another machine.
    pub id: String,
    /// Slash-separated path relative to the Session root.
    pub path: String,
    pub rating: u8,
    pub selected: bool,
    pub trashed: bool,
    /// Optional relative recipe location; edit payloads remain out of the initial scaffold.
    pub recipe_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionManifest {
    pub format: String,
    pub format_version: u32,
    pub id: String,
    pub name: String,
    pub created_unix_secs: u64,
    pub folders: SessionFolders,
    pub assets: Vec<SessionAsset>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreatedSession {
    pub path: PathBuf,
    pub manifest: SessionManifest,
}

fn validate_manifest(manifest: &SessionManifest) -> Result<(), String> {
    if manifest.format != SESSION_FORMAT || manifest.format_version != SESSION_FORMAT_VERSION {
        return Err("Unsupported Chromasmith Session manifest format".into());
    }
    names::validate_name(&manifest.name)?;
    for relative in [
        manifest.folders.capture.as_str(),
        manifest.folders.selects.as_str(),
        manifest.folders.output.as_str(),
        manifest.folders.trash.as_str(),
    ] {
        paths::validate_relative_path(relative)?;
    }
    let mut ids = std::collections::HashSet::new();
    for asset in &manifest.assets {
        if asset.id.trim().is_empty() || !ids.insert(asset.id.as_str()) {
            return Err("Session asset IDs must be non-empty and unique".into());
        }
        if asset.rating > 5 {
            return Err("Session asset rating must be between 0 and 5".into());
        }
        paths::validate_relative_path(&asset.path)?;
        if let Some(recipe) = &asset.recipe_path {
            paths::validate_relative_path(recipe)?;
        }
        if asset.selected && asset.trashed {
            return Err("A Session asset cannot be selected and trashed at the same time".into());
        }
    }
    Ok(())
}

fn new_manifest(name: &str) -> SessionManifest {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    SessionManifest {
        format: SESSION_FORMAT.into(),
        format_version: SESSION_FORMAT_VERSION,
        id: format!("session-{:x}-{:x}", std::process::id(), now.as_nanos()),
        name: name.into(),
        created_unix_secs: now.as_secs(),
        folders: SessionFolders {
            capture: "Capture".into(),
            selects: "Selects".into(),
            output: "Output".into(),
            trash: "Trash".into(),
        },
        assets: Vec::new(),
    }
}

fn create_session_at(parent: &Path, name: &str) -> Result<CreatedSession, String> {
    let name = names::validate_name(name)?;
    let parent = fs::canonicalize(parent).map_err(|e| format!("Open destination folder: {e}"))?;
    if !parent.is_dir() {
        return Err("Session destination must be a folder".into());
    }
    let destination = parent.join(name);
    if destination.exists() {
        return Err("A file or folder with this Session name already exists".into());
    }

    let manifest = new_manifest(name);
    validate_manifest(&manifest)?;
    let stage = parent.join(format!(".{}.creating-{}", name, manifest.id));
    fs::create_dir(&stage).map_err(|e| format!("Create Session staging folder: {e}"))?;
    let result = (|| {
        for relative in [
            &manifest.folders.capture,
            &manifest.folders.selects,
            &manifest.folders.output,
            &manifest.folders.trash,
        ] {
            let folder = paths::resolve_session_path(&stage, relative)?;
            fs::create_dir(&folder)
                .map_err(|e| format!("Create Session folder '{}': {e}", relative))?;
        }
        let manifest_bytes = serde_json::to_vec_pretty(&manifest)
            .map_err(|e| format!("Encode Session manifest: {e}"))?;
        let manifest_path = paths::resolve_session_path(&stage, MANIFEST_FILE)?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&manifest_path)
            .map_err(|e| format!("Create Session manifest: {e}"))?;
        file.write_all(&manifest_bytes)
            .map_err(|e| format!("Write Session manifest: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("Flush Session manifest: {e}"))?;
        fs::rename(&stage, &destination).map_err(|e| format!("Publish Session folder: {e}"))?;
        Ok(CreatedSession {
            path: destination.clone(),
            manifest: manifest.clone(),
        })
    })();
    if result.is_err() {
        // The staging path is uniquely created by this operation and contains no user photos.
        let _ = fs::remove_dir_all(&stage);
    }
    result
}

#[tauri::command(async)]
pub(crate) fn session_create(parent_path: String, name: String) -> Result<CreatedSession, String> {
    create_session_at(Path::new(&parent_path), &name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_parent() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "chromasmith-session-test-{}-{nonce:x}",
            std::process::id()
        ))
    }

    #[test]
    fn creates_portable_empty_session_without_touching_neighbor_files() {
        let parent = temp_parent();
        fs::create_dir_all(&parent).unwrap();
        let photo = parent.join("existing.raw");
        fs::write(&photo, b"preserve me").unwrap();
        let created = create_session_at(&parent, "Studio Shoot").unwrap();
        assert_eq!(fs::read(&photo).unwrap(), b"preserve me");
        for folder in ["Capture", "Selects", "Output", "Trash"] {
            assert!(created.path.join(folder).is_dir());
        }
        let saved: SessionManifest =
            serde_json::from_slice(&fs::read(created.path.join(MANIFEST_FILE)).unwrap()).unwrap();
        validate_manifest(&saved).unwrap();
        assert_eq!(saved, created.manifest);
        let moved = parent.join("Moved Session");
        fs::rename(&created.path, &moved).unwrap();
        let reopened: SessionManifest =
            serde_json::from_slice(&fs::read(moved.join(MANIFEST_FILE)).unwrap()).unwrap();
        assert_eq!(reopened.id, saved.id);
        fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn rejects_unsafe_names_paths_and_manifest_entries() {
        let parent = temp_parent();
        fs::create_dir_all(&parent).unwrap();
        for name in [
            "",
            "..",
            "../escape",
            "C:",
            "CON",
            "bad/name",
            "trailing.",
            "trailing ",
        ] {
            assert!(
                create_session_at(&parent, name).is_err(),
                "accepted name {name:?}"
            );
        }
        let mut manifest = new_manifest("Safe session");
        manifest.assets.push(SessionAsset {
            id: "asset-1".into(),
            path: "../outside.raw".into(),
            rating: 0,
            selected: false,
            trashed: false,
            recipe_path: None,
        });
        assert!(validate_manifest(&manifest).is_err());
        fs::remove_dir_all(parent).unwrap();
    }
}
