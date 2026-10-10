//! Native-issued, in-process receipts for items sent to the operating-system Trash.
//!
//! Frontend records contain only opaque IDs. Platform identities stay in this registry so a
//! forged IPC argument cannot restore an unrelated Recycle Bin/Trash item.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PlatformTrashIdentity {
    /// Exact path returned by macOS's Trash move, used only by the macOS adapter.
    TrashPath(String),
    /// Absolute Shell parsing name returned by IFileOperation on Windows.
    WindowsShell(String),
    /// A receipt item extracted to a collision-safe temporary name because its original target
    /// became occupied during restore. It remains retryable without searching the Trash.
    RestoredTemp(String),
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntryReceipt {
    pub original_path: String,
    pub receipt_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashReceipt {
    pub photo: TrashEntryReceipt,
    pub sidecar: Option<TrashEntryReceipt>,
    /// Nonfatal partial-delete detail. Present when the photo reached Trash but the sidecar
    /// could not be moved and the photo rollback also failed.
    pub warning: Option<String>,
}

struct IssuedEntry {
    original_path: String,
    identity: PlatformTrashIdentity,
}

static ISSUED: OnceLock<Mutex<HashMap<String, IssuedEntry>>> = OnceLock::new();
static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn registry() -> &'static Mutex<HashMap<String, IssuedEntry>> {
    ISSUED.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Save an exact native identity and return an opaque frontend handle.
pub fn issue(original_path: String, identity: PlatformTrashIdentity) -> TrashEntryReceipt {
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let serial = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let receipt_id = format!("{nonce:032x}-{}-{serial:016x}", std::process::id());
    registry().lock().unwrap().insert(receipt_id.clone(), IssuedEntry { original_path: original_path.clone(), identity });
    TrashEntryReceipt { original_path, receipt_id }
}

/// Build the retryable photo-only receipt used when the sidecar failed and photo rollback failed.
pub fn photo_only_partial(original_path: String, identity: PlatformTrashIdentity, warning: String) -> TrashReceipt {
    TrashReceipt { photo: issue(original_path, identity), sidecar: None, warning: Some(warning) }
}

/// Resolve only an ID issued by this process, restore its exact item, and retain it on failure.
pub fn restore(receipt: &TrashEntryReceipt) -> Result<(), String> {
    let mut issued = registry().lock().map_err(|_| "Trash receipt registry is unavailable".to_string())?;
    let entry = issued.get_mut(&receipt.receipt_id).ok_or_else(|| "Trash receipt is unknown or already restored".to_string())?;
    if entry.original_path != receipt.original_path {
        return Err("Trash receipt does not match its native original path".into());
    }
    crate::platform::restore_from_trash(&mut entry.identity, std::path::Path::new(&entry.original_path))?;
    issued.remove(&receipt.receipt_id);
    Ok(())
}

/// Forget receipts when their corresponding records age out of the bounded frontend Undo stack.
#[tauri::command]
pub fn release_trash_receipts(receipt_ids: Vec<String>) -> usize {
    let Ok(mut issued) = registry().lock() else { return 0; };
    let before = issued.len();
    for receipt_id in receipt_ids {
        // A failed no-overwrite placement can leave the exact restored file at a native temp
        // path. Keep its registry entry even after history eviction so later repair remains
        // possible; never turn history cleanup into loss of the only in-app handle.
        if issued.get(&receipt_id).is_some_and(|entry| !matches!(&entry.identity, PlatformTrashIdentity::RestoredTemp(_))) {
            issued.remove(&receipt_id);
        }
    }
    before - issued.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_ID: AtomicU64 = AtomicU64::new(0);
    fn scratch(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("chromasmith-trash-undo-{label}-{nonce}-{}", TEST_ID.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&path).unwrap(); path
    }

    fn test_identity(path: &std::path::Path) -> PlatformTrashIdentity {
        #[cfg(windows)]
        { PlatformTrashIdentity::RestoredTemp(path.to_string_lossy().into_owned()) }
        #[cfg(target_os = "macos")]
        { PlatformTrashIdentity::TrashPath(path.to_string_lossy().into_owned()) }
    }

    #[test]
    fn production_restore_path_restores_exact_item_and_consumes_only_issued_receipt() {
        let root = scratch("exact");
        let source = root.join("photo.jpg");
        let trash = root.join("trash-item-exact-id");
        fs::write(&trash, b"photo bytes").unwrap();
        let receipt = issue(source.to_string_lossy().into_owned(), test_identity(&trash));
        assert!(restore(&TrashEntryReceipt { original_path: source.to_string_lossy().into_owned(), receipt_id: "forged".into() }).is_err());
        restore(&receipt).unwrap();
        assert_eq!(fs::read(&source).unwrap(), b"photo bytes");
        assert!(restore(&receipt).unwrap_err().contains("unknown or already restored"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn production_restore_path_rejects_collision_and_retains_retry_receipt() {
        let root = scratch("collision");
        let source = root.join("photo.jpg");
        let trash = root.join("trash-item-exact-id");
        fs::write(&source, b"new occupant").unwrap();
        fs::write(&trash, b"trashed photo").unwrap();
        let receipt = issue(source.to_string_lossy().into_owned(), test_identity(&trash));
        assert!(restore(&receipt).unwrap_err().contains("occupied"));
        assert_eq!(fs::read(&source).unwrap(), b"new occupant");
        assert_eq!(fs::read(&trash).unwrap(), b"trashed photo");
        #[cfg(windows)]
        assert_eq!(release_trash_receipts(vec![receipt.receipt_id.clone()]), 0, "eviction must retain a temp-path retry handle");
        #[cfg(target_os = "macos")]
        assert_eq!(release_trash_receipts(vec![receipt.receipt_id.clone()]), 1, "a normal Trash-path receipt may be released when history is evicted");
        #[cfg(target_os = "macos")]
        let receipt = issue(source.to_string_lossy().into_owned(), test_identity(&trash));
        fs::remove_file(&source).unwrap();
        restore(&receipt).unwrap();
        assert_eq!(fs::read(&source).unwrap(), b"trashed photo");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn partial_photo_receipt_retains_the_exact_photo_for_retry() {
        let root = scratch("partial");
        let source = root.join("photo.jpg");
        let trash = root.join("photo-recycle-id");
        fs::write(&trash, b"photo bytes").unwrap();
        let partial = photo_only_partial(source.to_string_lossy().into_owned(), test_identity(&trash), "XMP move and photo rollback failed".into());
        assert!(partial.warning.as_deref().unwrap().contains("XMP move"));
        assert!(partial.sidecar.is_none());
        restore(&partial.photo).unwrap();
        assert_eq!(fs::read(source).unwrap(), b"photo bytes");
        let _ = fs::remove_dir_all(root);
    }
}
