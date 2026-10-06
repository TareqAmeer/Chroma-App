//! Offline hard-drive publish-service foundation.
//!
//! Collections keep stable catalog photo IDs and compare a BLAKE3 fingerprint of the current
//! recipe + metadata with the last successfully published fingerprint. Outputs and registry
//! updates are staged in the destination/data directory and atomically renamed into place.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const REGISTRY_FILE: &str = "publish-services.json";
static REGISTRY_LOCK: Mutex<()> = Mutex::new(());
static COLLECTION_COUNTER: AtomicU64 = AtomicU64::new(0);
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PublishPhotoStatus {
    New,
    Modified,
    Published,
    DeletedPending,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct PublishPhoto {
    pub photo_id: i64,
    pub filename: String,
    pub current_fingerprint: String,
    pub published_fingerprint: Option<String>,
    #[serde(default)]
    pub published_output_hash: Option<String>,
    pub status: PublishPhotoStatus,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct PublishCollection {
    pub id: String,
    pub name: String,
    pub destination: String,
    pub export_settings: Value,
    pub photos: BTreeMap<i64, PublishPhoto>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct Registry {
    version: u32,
    collections: BTreeMap<String, PublishCollection>,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct PublishPhotoInput {
    pub photo_id: i64,
    pub filename: String,
    /// Serialized current render recipe. Kept opaque so this module does not invent a recipe schema.
    pub recipe: String,
    /// Current sidecar/catalog metadata projection to include in dirty-state tracking.
    pub metadata: Value,
}

fn registry_path() -> PathBuf {
    crate::catalog::catalog_dir().join(REGISTRY_FILE)
}

fn read_registry(path: &Path) -> Result<Registry, String> {
    match fs::read(path) {
        Ok(bytes) => {
            let registry: Registry = serde_json::from_slice(&bytes)
                .map_err(|e| format!("read publish registry: {e}"))?;
            if registry.version != 1 {
                return Err("unsupported publish registry version".into());
            }
            Ok(registry)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Registry {
            version: 1,
            ..Registry::default()
        }),
        Err(e) => Err(format!("read {}: {e}", path.display())),
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("publish path has no parent")?;
    fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let part = parent.join(format!(
        ".chromasmith-publish-{nonce:x}-{:x}.part",
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let mut created = false;
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&part)
            .map_err(|e| format!("create staged publish file {}: {e}", part.display()))?;
        created = true;
        file.write_all(bytes)
            .map_err(|e| format!("write staged publish file: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("flush staged publish file: {e}"))?;
        drop(file);
        replace_staged_file(&part, path)
            .map_err(|e| format!("atomically replace {}: {e}", path.display()))
    })();
    if result.is_err() && created {
        let _ = fs::remove_file(&part);
    }
    result
}

#[cfg(not(windows))]
fn replace_staged_file(part: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(part, destination)
}

#[cfg(windows)]
fn replace_staged_file(part: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let from: Vec<u16> = part.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // Match library.rs's established Windows atomic replacement: preserve the prior file if
    // replacement fails, rather than removing it first and opening a missing-file window.
    unsafe {
        MoveFileExW(
            windows::core::PCWSTR(from.as_ptr()),
            windows::core::PCWSTR(to.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
    }
}

fn write_registry(path: &Path, registry: &Registry) -> Result<(), String> {
    let bytes =
        serde_json::to_vec_pretty(registry).map_err(|e| format!("encode publish registry: {e}"))?;
    write_atomic(path, &bytes)
}

fn fingerprint(recipe: &str, metadata: &Value, export_settings: &Value) -> Result<String, String> {
    let metadata =
        serde_json::to_vec(metadata).map_err(|e| format!("encode publish metadata: {e}"))?;
    let export_settings = serde_json::to_vec(export_settings)
        .map_err(|e| format!("encode publish export settings: {e}"))?;
    let mut hash = blake3::Hasher::new();
    hash.update(b"chromasmith-publish-v1\0");
    hash.update(&(recipe.len() as u64).to_le_bytes());
    hash.update(recipe.as_bytes());
    hash.update(&(metadata.len() as u64).to_le_bytes());
    hash.update(&metadata);
    hash.update(&(export_settings.len() as u64).to_le_bytes());
    hash.update(&export_settings);
    Ok(hash.finalize().to_hex().to_string())
}

fn bytes_hash(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

fn clean_filename(filename: &str) -> Result<String, String> {
    let path = Path::new(filename);
    let name = path
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or("publish filename is empty")?;
    if name != filename || name == "." || name == ".." || name.contains(':') {
        return Err("publish filename must be a plain filename without path components".into());
    }
    Ok(name.to_string())
}

fn collection_mut<'a>(
    registry: &'a mut Registry,
    id: &str,
) -> Result<&'a mut PublishCollection, String> {
    registry
        .collections
        .get_mut(id)
        .ok_or_else(|| "published collection not found".into())
}

#[tauri::command(async)]
pub(crate) fn publish_collection_list() -> Result<Vec<PublishCollection>, String> {
    let _guard = REGISTRY_LOCK
        .lock()
        .map_err(|_| "publish registry lock poisoned")?;
    Ok(read_registry(&registry_path())?
        .collections
        .into_values()
        .collect())
}

#[tauri::command(async)]
pub(crate) fn publish_collection_create(
    name: String,
    destination: String,
    export_settings: Value,
) -> Result<PublishCollection, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("collection name is required".into());
    }
    let dest =
        dunce::canonicalize(&destination).map_err(|e| format!("resolve publish folder: {e}"))?;
    if !dest.is_dir() {
        return Err("publish destination must be an existing folder".into());
    }
    let _guard = REGISTRY_LOCK
        .lock()
        .map_err(|_| "publish registry lock poisoned")?;
    let path = registry_path();
    let mut registry = read_registry(&path)?;
    let seed = format!(
        "{}:{}:{}:{}",
        dest.display(),
        name,
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        COLLECTION_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let id_hex = blake3::hash(seed.as_bytes()).to_hex().to_string();
    let id = id_hex[..24].to_string();
    let collection = PublishCollection {
        id: id.clone(),
        name: name.to_string(),
        destination: dest.to_string_lossy().into_owned(),
        export_settings,
        photos: BTreeMap::new(),
    };
    registry.collections.insert(id, collection.clone());
    write_registry(&path, &registry)?;
    Ok(collection)
}

#[tauri::command(async)]
pub(crate) fn publish_collection_sync_photos(
    collection_id: String,
    photos: Vec<PublishPhotoInput>,
) -> Result<Vec<PublishPhoto>, String> {
    let _guard = REGISTRY_LOCK
        .lock()
        .map_err(|_| "publish registry lock poisoned")?;
    let path = registry_path();
    let mut registry = read_registry(&path)?;
    let collection = collection_mut(&mut registry, &collection_id)?;
    let result = sync_photos(collection, photos)?;
    write_registry(&path, &registry)?;
    Ok(result)
}

fn sync_photos(
    collection: &mut PublishCollection,
    photos: Vec<PublishPhotoInput>,
) -> Result<Vec<PublishPhoto>, String> {
    let mut seen_ids = HashSet::new();
    let mut seen_names = HashSet::new();
    let export_settings = collection.export_settings.clone();
    for input in photos {
        let filename = clean_filename(&input.filename)?;
        if !seen_ids.insert(input.photo_id) {
            return Err(format!("duplicate catalog photo ID {}", input.photo_id));
        }
        if !seen_names.insert(filename.to_lowercase()) {
            return Err(format!("publish filename collision: {filename}"));
        }
        let current_fingerprint = fingerprint(&input.recipe, &input.metadata, &export_settings)?;
        let previous = collection.photos.get(&input.photo_id);
        let published_fingerprint = previous.and_then(|p| p.published_fingerprint.clone());
        let status = match &published_fingerprint {
            None => PublishPhotoStatus::New,
            Some(fp) if fp == &current_fingerprint => PublishPhotoStatus::Published,
            Some(_) => PublishPhotoStatus::Modified,
        };
        collection.photos.insert(
            input.photo_id,
            PublishPhoto {
                photo_id: input.photo_id,
                filename,
                current_fingerprint,
                published_fingerprint,
                published_output_hash: previous.and_then(|p| p.published_output_hash.clone()),
                status,
            },
        );
    }
    let missing: Vec<i64> = collection
        .photos
        .keys()
        .filter(|id| !seen_ids.contains(*id))
        .copied()
        .collect();
    for id in missing {
        if collection.photos[&id].published_fingerprint.is_some() {
            collection.photos.get_mut(&id).unwrap().status = PublishPhotoStatus::DeletedPending;
        } else {
            // Lightroom drops never-published items directly; only files that were written to
            // the destination need a delayed-removal queue.
            collection.photos.remove(&id);
        }
    }
    let result = collection.photos.values().cloned().collect();
    Ok(result)
}

fn write_published_output(
    collection: &mut PublishCollection,
    photo_id: i64,
    expected: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    let dest_root = dunce::canonicalize(&collection.destination)
        .map_err(|e| format!("resolve publish folder: {e}"))?;
    let photo = collection
        .photos
        .get_mut(&photo_id)
        .ok_or("photo is not in this published collection")?;
    if photo.status == PublishPhotoStatus::DeletedPending {
        return Err("deleted-pending photo cannot be published".into());
    }
    if photo.current_fingerprint != expected {
        return Err("photo changed after this publish render; refresh and retry".into());
    }
    let filename = clean_filename(&photo.filename)?;
    let output = dest_root.join(filename);
    match fs::symlink_metadata(&output) {
        Ok(meta) => {
            if meta.file_type().is_symlink() {
                return Err(format!(
                    "refusing to replace symlink at publish destination: {}",
                    output.display()
                ));
            }
            let existing_hash =
                bytes_hash(&fs::read(&output).map_err(|e| {
                    format!("read existing publish output {}: {e}", output.display())
                })?);
            let previous_hash = photo.published_output_hash.as_deref().ok_or_else(|| {
                format!(
                    "destination already contains an unowned file: {}",
                    output.display()
                )
            })?;
            if existing_hash != previous_hash {
                return Err(format!(
                    "published output was changed outside this collection: {}",
                    output.display()
                ));
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
            return Err(format!(
                "inspect publish destination {}: {e}",
                output.display()
            ))
        }
    }
    write_atomic(&output, bytes)?;
    photo.published_fingerprint = Some(photo.current_fingerprint.clone());
    photo.published_output_hash = Some(bytes_hash(bytes));
    photo.status = PublishPhotoStatus::Published;
    Ok(output)
}

/// Saves rendered bytes to the bound destination. The expected fingerprint prevents a late render
/// from publishing pixels for an older edit; registry state advances only after the atomic write.
#[tauri::command]
pub(crate) fn publish_collection_write_output(
    request: tauri::ipc::Request<'_>,
) -> Result<serde_json::Value, String> {
    use base64::Engine;
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
            .ok_or_else(|| format!("missing {name} header"))
    };
    let collection_id = header("x-publish-collection")?;
    let photo_id: i64 = header("x-publish-photo")?
        .parse()
        .map_err(|_| "invalid x-publish-photo")?;
    let filename_bytes = base64::engine::general_purpose::STANDARD
        .decode(header("x-publish-filename")?)
        .map_err(|e| format!("decode publish filename: {e}"))?;
    let filename = String::from_utf8(filename_bytes)
        .map_err(|e| format!("publish filename is not UTF-8: {e}"))?;
    let expected = header("x-publish-fingerprint")?;
    let filename = clean_filename(&filename)?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(body) => body,
        _ => return Err("expected raw publish output body".into()),
    };
    let _guard = REGISTRY_LOCK
        .lock()
        .map_err(|_| "publish registry lock poisoned")?;
    let path = registry_path();
    let mut registry = read_registry(&path)?;
    let collection = collection_mut(&mut registry, &collection_id)?;
    if collection
        .photos
        .get(&photo_id)
        .map(|photo| photo.filename.as_str())
        != Some(filename.as_str())
    {
        return Err("publish filename no longer matches the collection item".into());
    }
    if collection
        .photos
        .get(&photo_id)
        .map(|photo| photo.current_fingerprint.as_str())
        != Some(expected.as_str())
    {
        return Err("photo changed after this publish render; refresh and retry".into());
    }
    let output = write_published_output(collection, photo_id, &expected, bytes)?;
    let result = serde_json::json!({"path": output.to_string_lossy(), "bytes": bytes.len()});
    write_registry(&path, &registry)?;
    Ok(result)
}

#[tauri::command(async)]
pub(crate) fn publish_collection_apply_deletions(
    collection_id: String,
    photo_ids: Vec<i64>,
    confirmed: bool,
) -> Result<usize, String> {
    if !confirmed {
        return Err("confirm removal of published files before applying deletions".into());
    }
    let _guard = REGISTRY_LOCK
        .lock()
        .map_err(|_| "publish registry lock poisoned")?;
    let path = registry_path();
    let mut registry = read_registry(&path)?;
    let count = apply_deletions(&mut registry, &collection_id, &photo_ids, true)?;
    write_registry(&path, &registry)?;
    Ok(count)
}

fn apply_deletions(
    registry: &mut Registry,
    collection_id: &str,
    photo_ids: &[i64],
    confirmed: bool,
) -> Result<usize, String> {
    if !confirmed {
        return Err("confirm removal of published files before applying deletions".into());
    }
    let collection = collection_mut(registry, collection_id)?;
    let dest_root = dunce::canonicalize(&collection.destination)
        .map_err(|e| format!("resolve publish folder: {e}"))?;
    if photo_ids.iter().copied().collect::<HashSet<_>>().len() != photo_ids.len() {
        return Err("duplicate photo ID in deletion confirmation".into());
    }
    for id in photo_ids {
        let photo = collection
            .photos
            .get(id)
            .ok_or_else(|| format!("photo {id} is not in this published collection"))?;
        if photo.status != PublishPhotoStatus::DeletedPending {
            return Err(format!("photo {id} is not marked deleted-pending"));
        }
    }
    // Validate every path before deleting any file, so one malformed entry cannot partially apply a queue.
    let mut output_paths = Vec::new();
    for id in photo_ids {
        let filename = clean_filename(&collection.photos[id].filename)?;
        let output = dest_root.join(filename);
        match fs::symlink_metadata(&output) {
            Ok(meta) => {
                if meta.file_type().is_symlink() {
                    return Err(format!(
                        "refusing to remove symlink at publish destination: {}",
                        output.display()
                    ));
                }
                let resolved = dunce::canonicalize(&output)
                    .map_err(|e| format!("resolve published file {}: {e}", output.display()))?;
                if resolved.parent() != Some(dest_root.as_path()) {
                    return Err(format!(
                        "published path escapes destination: {}",
                        output.display()
                    ));
                }
                let expected = collection.photos[id]
                    .published_output_hash
                    .as_deref()
                    .ok_or_else(|| {
                        format!("no ownership hash is recorded for {}", output.display())
                    })?;
                let current = bytes_hash(
                    &fs::read(&output)
                        .map_err(|e| format!("read published file {}: {e}", output.display()))?,
                );
                if current != expected {
                    return Err(format!(
                        "published output was changed outside this collection: {}",
                        output.display()
                    ));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("inspect published file {}: {e}", output.display())),
        }
        output_paths.push((*id, output));
    }
    for (id, output) in &output_paths {
        match fs::remove_file(output) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("remove {}: {e}", output.display())),
        }
        collection.photos.remove(id);
    }
    Ok(output_paths.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static TEST_ID: AtomicU64 = AtomicU64::new(0);

    fn temp_dir() -> PathBuf {
        let n = TEST_ID.fetch_add(1, Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("chromasmith-publish-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }
    fn registry_with_collection(root: &Path) -> Registry {
        let mut registry = Registry {
            version: 1,
            ..Registry::default()
        };
        registry.collections.insert(
            "c1".into(),
            PublishCollection {
                id: "c1".into(),
                name: "Test".into(),
                destination: root.to_string_lossy().into_owned(),
                export_settings: Value::Null,
                photos: BTreeMap::new(),
            },
        );
        registry
    }
    fn set_one(registry: &mut Registry, recipe: &str, metadata: Value) -> PublishPhoto {
        let collection = registry.collections.get_mut("c1").unwrap();
        let fp = fingerprint(recipe, &metadata, &Value::Null).unwrap();
        let previous = collection.photos.get(&17);
        let published_fingerprint = previous.and_then(|photo| photo.published_fingerprint.clone());
        let status = match &published_fingerprint {
            None => PublishPhotoStatus::New,
            Some(old) if old == &fp => PublishPhotoStatus::Published,
            Some(_) => PublishPhotoStatus::Modified,
        };
        let item = PublishPhoto {
            photo_id: 17,
            filename: "photo.jpg".into(),
            current_fingerprint: fp,
            published_fingerprint,
            published_output_hash: previous.and_then(|photo| photo.published_output_hash.clone()),
            status,
        };
        collection.photos.insert(17, item.clone());
        item
    }

    #[test]
    fn recipe_and_metadata_fingerprints_drive_state_and_atomic_publish() {
        let root = temp_dir();
        let registry_path = root.join(REGISTRY_FILE);
        let mut registry = registry_with_collection(&root);
        let first = set_one(
            &mut registry,
            "{\"exposure\":1}",
            serde_json::json!({"rating": 3}),
        );
        assert_eq!(first.status, PublishPhotoStatus::New);
        let published = write_published_output(
            registry.collections.get_mut("c1").unwrap(),
            17,
            &first.current_fingerprint,
            b"first pixels",
        )
        .unwrap();
        assert_eq!(fs::read(&published).unwrap(), b"first pixels");
        write_registry(&registry_path, &registry).unwrap();
        assert_eq!(
            read_registry(&registry_path).unwrap().collections["c1"].photos[&17].status,
            PublishPhotoStatus::Published
        );
        let changed_recipe = set_one(
            &mut registry,
            "{\"exposure\":2}",
            serde_json::json!({"rating": 3}),
        );
        assert_eq!(changed_recipe.status, PublishPhotoStatus::Modified);
        let changed_metadata = set_one(
            &mut registry,
            "{\"exposure\":1}",
            serde_json::json!({"rating": 4}),
        );
        assert_eq!(changed_metadata.status, PublishPhotoStatus::Modified);
        let unchanged = set_one(
            &mut registry,
            "{\"exposure\":1}",
            serde_json::json!({"rating": 3}),
        );
        assert_eq!(unchanged.status, PublishPhotoStatus::Published);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn removal_is_pending_until_confirmed_and_only_removes_known_file() {
        let root = temp_dir();
        let dest = root.join("dest");
        fs::create_dir_all(&dest).unwrap();
        let mut registry = registry_with_collection(&dest);
        let item = set_one(&mut registry, "{}", Value::Null);
        assert_eq!(item.status, PublishPhotoStatus::New);
        let collection = registry.collections.get_mut("c1").unwrap();
        let photo = collection.photos.get_mut(&17).unwrap();
        photo.published_fingerprint = Some(photo.current_fingerprint.clone());
        photo.published_output_hash = Some(bytes_hash(b"published"));
        photo.status = PublishPhotoStatus::DeletedPending;
        fs::write(dest.join("photo.jpg"), b"published").unwrap();
        assert!(apply_deletions(&mut registry, "c1", &[17], false).is_err());
        assert!(
            dest.join("photo.jpg").exists(),
            "unconfirmed removal keeps destination file"
        );
        let item = registry.collections["c1"].photos.get(&17).unwrap();
        assert_eq!(item.status, PublishPhotoStatus::DeletedPending);
        fs::write(dest.join("photo.jpg"), b"changed elsewhere").unwrap();
        assert!(apply_deletions(&mut registry, "c1", &[17], true).is_err());
        assert!(
            dest.join("photo.jpg").exists(),
            "externally modified output is not removed"
        );
        fs::write(dest.join("photo.jpg"), b"published").unwrap();
        assert_eq!(
            apply_deletions(&mut registry, "c1", &[17], true).unwrap(),
            1
        );
        assert!(
            !dest.join("photo.jpg").exists(),
            "confirmed removal deletes the published destination file"
        );
        assert!(!registry.collections["c1"].photos.contains_key(&17));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn publish_refuses_unowned_or_externally_changed_destination_files() {
        let root = temp_dir();
        let mut registry = registry_with_collection(&root);
        let new = set_one(&mut registry, "{}", Value::Null);
        fs::write(root.join("photo.jpg"), b"user file").unwrap();
        assert!(write_published_output(
            registry.collections.get_mut("c1").unwrap(),
            17,
            &new.current_fingerprint,
            b"our export"
        )
        .is_err());
        assert_eq!(fs::read(root.join("photo.jpg")).unwrap(), b"user file");

        let collection = registry.collections.get_mut("c1").unwrap();
        let photo = collection.photos.get_mut(&17).unwrap();
        photo.published_fingerprint = Some(photo.current_fingerprint.clone());
        photo.published_output_hash = Some(bytes_hash(b"last published"));
        photo.status = PublishPhotoStatus::Modified;
        fs::write(root.join("photo.jpg"), b"externally changed").unwrap();
        assert!(
            write_published_output(collection, 17, &new.current_fingerprint, b"replacement")
                .is_err()
        );
        assert_eq!(
            fs::read(root.join("photo.jpg")).unwrap(),
            b"externally changed"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn export_setting_changes_mark_published_photos_modified() {
        let root = temp_dir();
        let mut registry = registry_with_collection(&root);
        let collection = registry.collections.get_mut("c1").unwrap();
        collection.export_settings = serde_json::json!({"format":"jpeg","quality":80});
        let input = PublishPhotoInput {
            photo_id: 42,
            filename: "settings.jpg".into(),
            recipe: "{}".into(),
            metadata: Value::Null,
        };
        let initial = sync_photos(collection, vec![input.clone()]).unwrap();
        assert_eq!(initial[0].status, PublishPhotoStatus::New);
        let item = collection.photos.get_mut(&42).unwrap();
        item.published_fingerprint = Some(item.current_fingerprint.clone());
        item.published_output_hash = Some(bytes_hash(b"old output"));
        item.status = PublishPhotoStatus::Published;
        collection.export_settings = serde_json::json!({"format":"jpeg","quality":100});
        let changed = sync_photos(collection, vec![input]).unwrap();
        assert_eq!(changed[0].status, PublishPhotoStatus::Modified);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sync_distinguishes_new_modified_published_and_deleted_pending() {
        let root = temp_dir();
        let mut registry = registry_with_collection(&root);
        let collection = registry.collections.get_mut("c1").unwrap();
        let one = PublishPhotoInput {
            photo_id: 10,
            filename: "one.jpg".into(),
            recipe: "{}".into(),
            metadata: serde_json::json!({"rating":1}),
        };
        let two = PublishPhotoInput {
            photo_id: 11,
            filename: "two.jpg".into(),
            recipe: "{}".into(),
            metadata: Value::Null,
        };
        let initial = sync_photos(collection, vec![one.clone(), two.clone()]).unwrap();
        assert_eq!(
            initial.iter().find(|p| p.photo_id == 10).unwrap().status,
            PublishPhotoStatus::New
        );
        assert_eq!(
            initial.iter().find(|p| p.photo_id == 11).unwrap().status,
            PublishPhotoStatus::New
        );
        let photo = collection.photos.get_mut(&10).unwrap();
        photo.published_fingerprint = Some(photo.current_fingerprint.clone());
        photo.status = PublishPhotoStatus::Published;
        let updated = PublishPhotoInput {
            metadata: serde_json::json!({"rating":2}),
            ..one.clone()
        };
        let states = sync_photos(collection, vec![updated]).unwrap();
        assert_eq!(
            states.iter().find(|p| p.photo_id == 10).unwrap().status,
            PublishPhotoStatus::Modified
        );
        assert_eq!(
            states.iter().find(|p| p.photo_id == 11).unwrap().status,
            PublishPhotoStatus::New
        );
        let states = sync_photos(collection, vec![]).unwrap();
        assert_eq!(
            states.len(),
            1,
            "unpublished removed item is dropped from membership"
        );
        assert_eq!(states[0].status, PublishPhotoStatus::DeletedPending);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn filename_validation_rejects_parent_paths_and_registry_write_is_atomic() {
        assert!(clean_filename("../escape.jpg").is_err());
        assert!(clean_filename("C:\\escape.jpg").is_err());
        assert_eq!(clean_filename("photo.jpg").unwrap(), "photo.jpg");
        let root = temp_dir();
        let path = root.join(REGISTRY_FILE);
        write_atomic(&path, b"old").unwrap();
        write_atomic(&path, b"new complete registry").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new complete registry");
        assert!(!fs::read_dir(&root).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".part")));
        fs::remove_dir_all(root).unwrap();
    }
}
