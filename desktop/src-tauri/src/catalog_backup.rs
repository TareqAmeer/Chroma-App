use crate::catalog::{self, CatalogState};
use crate::{library, platform};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rusqlite::{backup::Progress, Connection, DatabaseName};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::State;

const SNAPSHOT_FORMAT_VERSION: u32 = 1;
const LIBRARY_BACKUP_VERSION: u32 = 1;
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UserAssets {
    format_version: u32,
    luts: Vec<UserLut>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UserLut {
    name: String,
    bytes_base64: String,
}
fn validate_user_assets(assets: &UserAssets) -> Result<(), String> {
    if assets.format_version != 1 {
        return Err("Unsupported user asset format".into());
    }
    let mut names = std::collections::HashSet::new();
    for lut in &assets.luts {
        if lut.name.is_empty() || !names.insert(&lut.name) {
            return Err("User LUT names must be nonempty and unique".into());
        }
        let bytes = STANDARD
            .decode(&lut.bytes_base64)
            .map_err(|e| format!("Invalid user LUT {}: {e}", lut.name))?;
        if bytes.len() != 33 * 33 * 33 * 3 {
            return Err(format!("Invalid user LUT byte count: {}", lut.name));
        }
    }
    Ok(())
}
const REGISTRY_FILES: &[&str] = &[
    "edited_registry.json",
    "favorites_registry.json",
    "flagged_registry.json",
    "rejected_registry.json",
    "duplicates_registry.json",
    "gphotos_registry.json",
    "export_history.json",
];

/// Metadata for a standalone catalog snapshot. This deliberately does not imply that
/// originals, sidecars, preferences, or other application stores are in the snapshot.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct SnapshotManifest {
    pub format_version: u32,
    pub app_version: String,
    pub catalog_schema_version: i64,
    pub created_unix_secs: u64,
    pub photo_count: u64,
    pub catalog_blake3: String,
    pub originals_included: bool,
    pub regenerated_caches_included: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct SnapshotReport {
    pub path: PathBuf,
    pub manifest: SnapshotManifest,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryBackupManifest {
    pub format: String,
    pub format_version: u32,
    pub app_version: String,
    pub created_unix_secs: u64,
    pub photo_count: u64,
    pub sidecars_included: u64,
    pub sidecars_missing: u64,
    pub originals_included: bool,
    pub regenerated_caches_included: bool,
    pub roots: Vec<BackupRoot>,
    pub files: Vec<BackupFile>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupRoot {
    pub volume_id: i64,
    pub volume_uuid: String,
    pub source_path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupFile {
    pub path: String,
    pub bytes: u64,
    pub blake3: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupResult {
    pub path: String,
    pub created_unix_secs: u64,
    pub photo_count: u64,
    pub sidecars_included: u64,
    pub sidecars_missing: u64,
    pub verified: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LastBackup {
    pub path: String,
    pub created_unix_secs: u64,
    pub verified: bool,
}

#[tauri::command(async)]
pub(crate) fn library_backup_create(
    state: State<'_, CatalogState>,
    destination: String,
    preferences_json: String,
    user_assets_json: Option<String>,
) -> Result<BackupResult, String> {
    let destination = PathBuf::from(destination);
    let preferences: serde_json::Value = serde_json::from_str(&preferences_json)
        .map_err(|e| format!("Read exported preferences: {e}"))?;
    let assets = user_assets_json
        .map(|text| {
            serde_json::from_str::<UserAssets>(&text)
                .map_err(|e| format!("Read exported user assets: {e}"))
        })
        .transpose()?;
    if let Some(assets) = &assets {
        validate_user_assets(assets)?;
    }
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Catalog is busy".to_string())?;
    let report = create_library_backup(
        &conn,
        &destination,
        &catalog::catalog_dir(),
        &library::cache_dir(),
        &preferences,
        assets.as_ref(),
    )?;
    let last = LastBackup {
        path: report.path.clone(),
        created_unix_secs: report.created_unix_secs,
        verified: true,
    };
    let last_path = platform::data_root().join("library-backup-last.json");
    write_json_atomic(&last_path, &last)?;
    Ok(report)
}

#[tauri::command(async)]
pub(crate) fn library_backup_last() -> Option<LastBackup> {
    let path = platform::data_root().join("library-backup-last.json");
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

#[tauri::command(async)]
pub(crate) fn library_backup_verify(path: String) -> Result<LibraryBackupManifest, String> {
    verify_library_backup(Path::new(&path))
}

#[tauri::command(async)]
pub(crate) fn library_backup_restore(
    path: String,
    destination: String,
) -> Result<BackupResult, String> {
    restore_library_backup(Path::new(&path), Path::new(&destination))
}

fn create_library_backup(
    source: &Connection,
    destination: &Path,
    data_dir: &Path,
    cache_dir: &Path,
    preferences: &serde_json::Value,
    user_assets: Option<&UserAssets>,
) -> Result<BackupResult, String> {
    if destination.exists() {
        return Err("Backup destination already exists".into());
    }
    let parent = destination
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent).map_err(|e| format!("Create backup parent: {e}"))?;
    let staging = unique_staging_path(destination);
    fs::create_dir(&staging).map_err(|e| format!("Create backup staging directory: {e}"))?;
    let result = (|| {
        let catalog_report = create_catalog_snapshot(source, &staging.join("catalog"))
            .map_err(|e| format!("Snapshot catalog: {e}"))?;
        let copy_file = |source: &Path, relative: &Path| -> Result<(), String> {
            let target = safe_join(&staging, relative)?;
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Create backup path: {e}"))?;
            }
            fs::copy(source, &target).map_err(|e| format!("Copy {}: {e}", source.display()))?;
            Ok(())
        };
        for file in ["albums.json", "subjects.json"] {
            let source_path = data_dir.join(file);
            if source_path.is_file() {
                copy_file(&source_path, Path::new("app-data").join(file).as_path())?;
            }
        }
        let dcp = data_dir.join("dcp_luts");
        if dcp.is_dir() {
            copy_tree(&dcp, &staging.join("app-data/dcp_luts"))?;
        }
        for file in REGISTRY_FILES {
            let source_path = cache_dir.join(file);
            if source_path.is_file() {
                copy_file(&source_path, Path::new("cache-data").join(file).as_path())?;
            }
        }
        write_json_atomic(&staging.join("preferences.json"), preferences)?;
        if let Some(assets) = user_assets {
            validate_user_assets(assets)?;
            write_json_atomic(&staging.join("user-assets.json"), assets)?;
        }

        let roots = backup_roots(source)?;
        let photos = photo_sidecar_sources(source)?;
        let mut sidecars_included = 0u64;
        let mut sidecars_missing = 0u64;
        for (volume_id, rel_path, source_photo) in photos {
            let source_sidecar = crate::canon::sidecar_path_for(&source_photo);
            if !source_sidecar.is_file() {
                sidecars_missing += 1;
                continue;
            }
            let rel = safe_relative(Path::new(&rel_path))?;
            let sidecar_name = rel.with_extension(source_sidecar.extension().unwrap_or_default());
            let target_rel = Path::new("sidecars")
                .join(format!("volume-{volume_id}"))
                .join(sidecar_name);
            copy_file(&source_sidecar, &target_rel)?;
            sidecars_included += 1;
        }
        let file_list = list_files(&staging)?;
        let manifest = LibraryBackupManifest {
            format: "chromasmith-library-backup".into(),
            format_version: LIBRARY_BACKUP_VERSION,
            app_version: env!("CARGO_PKG_VERSION").into(),
            created_unix_secs: now_secs(),
            photo_count: catalog_report.manifest.photo_count,
            sidecars_included,
            sidecars_missing,
            originals_included: false,
            regenerated_caches_included: false,
            roots,
            files: file_list,
        };
        write_json_atomic(&staging.join("library-backup.json"), &manifest)?;
        verify_library_backup(&staging)?;
        fs::rename(&staging, destination).map_err(|e| format!("Publish backup: {e}"))?;
        Ok(BackupResult {
            path: destination.to_string_lossy().into_owned(),
            created_unix_secs: manifest.created_unix_secs,
            photo_count: manifest.photo_count,
            sidecars_included,
            sidecars_missing,
            verified: true,
        })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn restore_library_backup(source: &Path, destination: &Path) -> Result<BackupResult, String> {
    let manifest = verify_library_backup(source)?;
    if destination.exists() {
        return Err("Restore destination already exists; choose an empty new location".into());
    }
    let parent = destination
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent).map_err(|e| format!("Create restore parent: {e}"))?;
    let staging = unique_staging_path(destination);
    fs::create_dir(&staging).map_err(|e| format!("Create restore staging directory: {e}"))?;
    let result = (|| {
        for file in &manifest.files {
            let relative = safe_relative(Path::new(&file.path))?;
            let from = safe_join(source, &relative)?;
            let to = safe_join(&staging, &relative)?;
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Create restore path: {e}"))?;
            }
            fs::copy(from, to).map_err(|e| format!("Restore {}: {e}", file.path))?;
        }
        let manifest_bytes = fs::read(source.join("library-backup.json"))
            .map_err(|e| format!("Read backup manifest: {e}"))?;
        fs::write(staging.join("library-backup.json"), manifest_bytes)
            .map_err(|e| format!("Write restore manifest: {e}"))?;
        verify_library_backup(&staging)?;
        fs::rename(&staging, destination).map_err(|e| format!("Publish verified restore: {e}"))?;
        Ok(BackupResult {
            path: destination.to_string_lossy().into_owned(),
            created_unix_secs: manifest.created_unix_secs,
            photo_count: manifest.photo_count,
            sidecars_included: manifest.sidecars_included,
            sidecars_missing: manifest.sidecars_missing,
            verified: true,
        })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn verify_library_backup(directory: &Path) -> Result<LibraryBackupManifest, String> {
    let manifest: LibraryBackupManifest = serde_json::from_slice(
        &fs::read(directory.join("library-backup.json"))
            .map_err(|e| format!("Read backup manifest: {e}"))?,
    )
    .map_err(|e| format!("Parse backup manifest: {e}"))?;
    if manifest.format != "chromasmith-library-backup"
        || manifest.format_version != LIBRARY_BACKUP_VERSION
    {
        return Err("Unsupported Chromasmith backup format".into());
    }
    if manifest.originals_included || manifest.regenerated_caches_included {
        return Err("Backup manifest has unsupported source/cache policy".into());
    }
    let catalog_manifest = verify_catalog_snapshot(&directory.join("catalog"))
        .map_err(|e| format!("Verify catalog: {e}"))?;
    if catalog_manifest.photo_count != manifest.photo_count {
        return Err("Backup photo count does not match catalog snapshot".into());
    }
    let listed: std::collections::HashSet<_> =
        manifest.files.iter().map(|f| f.path.as_str()).collect();
    if listed.len() != manifest.files.len() {
        return Err("Backup manifest contains duplicate file paths".into());
    }
    let actual = list_files(directory)?;
    if actual.len() != manifest.files.len()
        || actual.iter().any(|f| !listed.contains(f.path.as_str()))
    {
        return Err("Backup contains files that are not recorded in its manifest".into());
    }
    for file in &manifest.files {
        let relative = safe_relative(Path::new(&file.path))?;
        let path = safe_join(directory, &relative)?;
        let metadata =
            fs::metadata(&path).map_err(|e| format!("Missing backup file {}: {e}", file.path))?;
        if !metadata.is_file()
            || metadata.len() != file.bytes
            || checksum_file_string(&path)? != file.blake3
        {
            return Err(format!("Backup file failed verification: {}", file.path));
        }
    }
    let assets_path = directory.join("user-assets.json");
    if assets_path.is_file() {
        let assets: UserAssets = serde_json::from_slice(
            &fs::read(&assets_path).map_err(|e| format!("Read user assets: {e}"))?,
        )
        .map_err(|e| format!("Parse user assets: {e}"))?;
        validate_user_assets(&assets)?;
    }
    Ok(manifest)
}

fn backup_roots(conn: &Connection) -> Result<Vec<BackupRoot>, String> {
    let mut statement = conn
        .prepare("SELECT id, uuid, last_path FROM volumes ORDER BY id")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(BackupRoot {
                volume_id: row.get(0)?,
                volume_uuid: row.get(1)?,
                source_path: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn photo_sidecar_sources(conn: &Connection) -> Result<Vec<(i64, String, PathBuf)>, String> {
    let mut statement = conn.prepare("SELECT p.volume_id, p.rel_path, v.last_path FROM photos p JOIN volumes v ON v.id=p.volume_id ORDER BY p.volume_id, p.rel_path").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let (volume_id, rel, root) = row.map_err(|e| e.to_string())?;
        let rel = safe_relative(Path::new(&rel))?;
        out.push((
            volume_id,
            rel.to_string_lossy().replace('\\', "/"),
            PathBuf::from(root).join(rel),
        ));
    }
    Ok(out)
}

fn safe_relative(path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() {
        return Err("Empty archive path".into());
    }
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            Component::Normal(value) => out.push(value),
            _ => {
                return Err(
                    "Archive path must be relative and cannot contain traversal components".into(),
                )
            }
        }
    }
    Ok(out)
}

fn safe_join(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    Ok(root.join(safe_relative(relative)?))
}

fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| format!("Create {}: {e}", to.display()))?;
    for entry in fs::read_dir(from).map_err(|e| format!("Read {}: {e}", from.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let source = entry.path();
        let destination = to.join(entry.file_name());
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        if ty.is_dir() {
            copy_tree(&source, &destination)?;
        } else if ty.is_file() {
            fs::copy(source, destination).map_err(|e| e.to_string())?;
        } else {
            return Err(format!(
                "Unsupported file type in user data: {}",
                source.display()
            ));
        }
    }
    Ok(())
}

fn list_files(root: &Path) -> Result<Vec<BackupFile>, String> {
    fn walk(root: &Path, current: &Path, out: &mut Vec<BackupFile>) -> Result<(), String> {
        for entry in fs::read_dir(current).map_err(|e| format!("List backup files: {e}"))? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
                walk(root, &path, out)?;
                continue;
            }
            if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
                return Err("Backup contains unsupported file type".into());
            }
            let relative = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            if relative == "library-backup.json" {
                continue;
            }
            out.push(BackupFile {
                path: relative,
                bytes: fs::metadata(&path).map_err(|e| e.to_string())?.len(),
                blake3: checksum_file_string(&path)?,
            });
        }
        Ok(())
    }
    let mut out = Vec::new();
    walk(root, root, &mut out)?;
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

fn checksum_file_string(path: &Path) -> Result<String, String> {
    checksum_file(path).map_err(|e| e.to_string())
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Create {}: {e}", parent.display()))?;
    }
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| format!("Serialise JSON: {e}"))?;
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&tmp, bytes).map_err(|e| format!("Write {}: {e}", tmp.display()))?;
    replace_file_atomic(&tmp, path).map_err(|e| format!("Publish {}: {e}", path.display()))
}

#[cfg(not(windows))]
fn replace_file_atomic(tmp: &Path, path: &Path) -> std::io::Result<()> {
    fs::rename(tmp, path)
}

#[cfg(windows)]
fn replace_file_atomic(tmp: &Path, path: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let from: Vec<u16> = tmp.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        MoveFileExW(
            PCWSTR(from.as_ptr()),
            PCWSTR(to.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(|e| std::io::Error::other(e.to_string()))
}

/// Copy a live SQLite catalog using SQLite's online backup API, then verify and publish
/// the snapshot directory by a same-parent rename. `destination` must not already exist.
/// The caller owns the catalog lock / write boundary and must avoid concurrent non-SQLite
/// stores changing during a larger future backup operation.
pub(crate) fn create_catalog_snapshot(
    source: &Connection,
    destination: &Path,
) -> rusqlite::Result<SnapshotReport> {
    if destination.exists() {
        return Err(rusqlite::Error::InvalidPath(destination.to_path_buf()));
    }
    let parent = destination
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let staging = unique_staging_path(destination);
    fs::create_dir(&staging).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let staged_catalog = staging.join("catalog.db");

    let result = (|| {
        let mut target = Connection::open(&staged_catalog)?;
        let backup = rusqlite::backup::Backup::new_with_names(
            source,
            DatabaseName::Main,
            &mut target,
            DatabaseName::Main,
        )?;
        backup.run_to_completion(128, Duration::from_millis(25), None::<fn(Progress)>)?;
        drop(backup);
        drop(target);

        verify_database(&staged_catalog)?;
        let catalog_blake3 = checksum_file(&staged_catalog)?;
        let photo_count = Connection::open(&staged_catalog)?.query_row(
            "SELECT COUNT(*) FROM photos",
            [],
            |row| row.get::<_, u64>(0),
        )?;
        let catalog_schema_version =
            Connection::open(&staged_catalog)?
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))?;
        let created_unix_secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let manifest = SnapshotManifest {
            format_version: SNAPSHOT_FORMAT_VERSION,
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            catalog_schema_version,
            created_unix_secs,
            photo_count,
            catalog_blake3,
            originals_included: false,
            regenerated_caches_included: false,
        };
        let manifest_bytes = serde_json::to_vec_pretty(&manifest)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        fs::write(staging.join("manifest.json"), manifest_bytes)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        verify_catalog_snapshot(&staging)?;
        fs::rename(&staging, destination)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        Ok(SnapshotReport {
            path: destination.to_path_buf(),
            manifest,
        })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

/// Validate a snapshot's versioned manifest, catalog checksum, SQLite integrity,
/// foreign-key consistency, and recorded photo count without replacing any live data.
pub(crate) fn verify_catalog_snapshot(directory: &Path) -> rusqlite::Result<SnapshotManifest> {
    let manifest_path = directory.join("manifest.json");
    let manifest_bytes = fs::read(&manifest_path)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let manifest: SnapshotManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    if manifest.format_version != SNAPSHOT_FORMAT_VERSION {
        return Err(rusqlite::Error::InvalidQuery);
    }
    let catalog_path = directory.join("catalog.db");
    if checksum_file(&catalog_path)? != manifest.catalog_blake3 {
        return Err(rusqlite::Error::InvalidQuery);
    }
    verify_database(&catalog_path)?;
    let conn = Connection::open(catalog_path)?;
    let photos = conn.query_row("SELECT COUNT(*) FROM photos", [], |row| {
        row.get::<_, u64>(0)
    })?;
    let schema = conn.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))?;
    if photos != manifest.photo_count || schema != manifest.catalog_schema_version {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(manifest)
}

fn checksum_file(path: &Path) -> rusqlite::Result<String> {
    let file =
        fs::File::open(path).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let mut reader = std::io::BufReader::with_capacity(1024 * 1024, file);
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

fn verify_database(path: &Path) -> rusqlite::Result<()> {
    let conn = Connection::open(path)?;
    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(rusqlite::Error::InvalidQuery);
    }
    let mut foreign_keys = conn.prepare("PRAGMA foreign_key_check")?;
    if foreign_keys.exists([])? {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(())
}

fn unique_staging_path(destination: &Path) -> PathBuf {
    let parent = destination
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let name = destination
        .file_name()
        .unwrap_or_default()
        .to_string_lossy();
    parent.join(format!(
        ".{name}.staging-{}-{}",
        std::process::id(),
        now_millis()
    ))
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "chromasmith-{name}-{}-{}",
            std::process::id(),
            now_millis()
        ))
    }

    #[test]
    fn library_bundle_captures_user_data_and_sidecars_and_restores_to_new_location() {
        let root = temp_path("library-bundle");
        let source_root = root.join("source-photos");
        let data = root.join("app-data");
        let cache = root.join("cache");
        fs::create_dir_all(&source_root).unwrap();
        fs::create_dir_all(data.join("dcp_luts")).unwrap();
        fs::create_dir_all(&cache).unwrap();
        fs::write(source_root.join("one.jpg"), b"original must stay out").unwrap();
        fs::write(source_root.join("one.xmp"), b"<xmp recipe='saved'/>").unwrap();
        fs::write(data.join("albums.json"), b"[]").unwrap();
        fs::write(data.join("subjects.json"), b"[]").unwrap();
        fs::write(data.join("dcp_luts/user.bin"), b"lut bytes").unwrap();
        fs::write(cache.join("favorites_registry.json"), b"[]").unwrap();
        let source = Connection::open(root.join("source.db")).unwrap();
        source
            .execute_batch(
                "CREATE TABLE volumes(id INTEGER PRIMARY KEY, uuid TEXT, last_path TEXT);
             CREATE TABLE photos(id INTEGER PRIMARY KEY, volume_id INTEGER, rel_path TEXT);
             INSERT INTO volumes VALUES (1, 'volume-a', 'PLACEHOLDER');
             INSERT INTO photos VALUES (1, 1, 'one.jpg');
             INSERT INTO photos VALUES (2, 1, 'missing.jpg');",
            )
            .unwrap();
        source
            .execute(
                "UPDATE volumes SET last_path=?1 WHERE id=1",
                [source_root.to_string_lossy().as_ref()],
            )
            .unwrap();
        let backup = root.join("portable-backup");
        let assets = UserAssets {
            format_version: 1,
            luts: vec![UserLut {
                name: "Fixture user look".into(),
                bytes_base64: STANDARD.encode(vec![123u8; 33 * 33 * 33 * 3]),
            }],
        };
        let report = create_library_backup(
            &source,
            &backup,
            &data,
            &cache,
            &serde_json::json!({"csTheme":"dark"}),
            Some(&assets),
        )
        .unwrap();
        assert!(report.verified);
        assert_eq!(report.photo_count, 2);
        assert_eq!(report.sidecars_included, 1);
        assert_eq!(report.sidecars_missing, 1);
        let manifest = verify_library_backup(&backup).unwrap();
        assert!(!manifest.originals_included);
        assert!(!manifest.regenerated_caches_included);
        assert!(backup.join("app-data/albums.json").is_file());
        assert!(backup.join("app-data/subjects.json").is_file());
        assert!(backup.join("app-data/dcp_luts/user.bin").is_file());
        assert!(backup.join("cache-data/favorites_registry.json").is_file());
        assert!(backup.join("sidecars/volume-1/one.xmp").is_file());
        assert!(!backup.join("sidecars/volume-1/one.jpg").exists());
        assert!(manifest.roots.iter().any(|r| r.volume_uuid == "volume-a"));
        assert!(manifest.files.iter().any(|f| f.path == "user-assets.json"));

        let restored = root.join("restored-library");
        let restored_report = restore_library_backup(&backup, &restored).unwrap();
        assert!(restored_report.verified);
        assert_eq!(verify_library_backup(&restored).unwrap().photo_count, 2);
        assert_eq!(
            fs::read(restored.join("user-assets.json")).unwrap(),
            fs::read(backup.join("user-assets.json")).unwrap()
        );
        assert_eq!(
            fs::read(restored.join("sidecars/volume-1/one.xmp")).unwrap(),
            b"<xmp recipe='saved'/>"
        );
        assert!(
            restore_library_backup(&backup, &restored).is_err(),
            "restore must never overwrite a chosen destination"
        );
        drop(source);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn library_bundle_rejects_tampering_and_archive_path_traversal() {
        let root = temp_path("library-tamper");
        let source_root = root.join("photos");
        fs::create_dir_all(&source_root).unwrap();
        let source = Connection::open(root.join("source.db")).unwrap();
        source.execute_batch("CREATE TABLE volumes(id INTEGER PRIMARY KEY, uuid TEXT, last_path TEXT); CREATE TABLE photos(id INTEGER PRIMARY KEY, volume_id INTEGER, rel_path TEXT);
            INSERT INTO volumes VALUES (1, 'v', 'PLACEHOLDER');").unwrap();
        source
            .execute(
                "UPDATE volumes SET last_path=?1 WHERE id=1",
                [source_root.to_string_lossy().as_ref()],
            )
            .unwrap();
        let backup = root.join("backup");
        create_library_backup(
            &source,
            &backup,
            &root.join("data"),
            &root.join("cache"),
            &serde_json::json!({}),
            None,
        )
        .unwrap();
        fs::write(backup.join("preferences.json"), b"tampered").unwrap();
        assert!(verify_library_backup(&backup)
            .unwrap_err()
            .contains("failed verification"));
        assert!(safe_relative(Path::new("../escape.json")).is_err());
        drop(source);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn user_assets_reject_corrupt_future_and_duplicate_records() {
        let mut assets = UserAssets {
            format_version: 1,
            luts: vec![UserLut {
                name: "Test".into(),
                bytes_base64: STANDARD.encode(vec![31u8; 33 * 33 * 33 * 3]),
            }],
        };
        assert!(validate_user_assets(&assets).is_ok());
        assets.format_version = 2;
        assert!(validate_user_assets(&assets).is_err());
        assets.format_version = 1;
        assets.luts.push(UserLut {
            name: "Test".into(),
            bytes_base64: assets.luts[0].bytes_base64.clone(),
        });
        assert!(validate_user_assets(&assets).is_err());
        assets.luts.pop();
        assets.luts[0].bytes_base64 = "not base64".into();
        assert!(validate_user_assets(&assets).is_err());
        assets.luts[0].bytes_base64 = STANDARD.encode([1, 2, 3]);
        assert!(validate_user_assets(&assets).is_err());
    }

    #[test]
    fn snapshots_live_wal_catalog_and_verifies_manifest() {
        let root = temp_path("snapshot");
        fs::create_dir_all(&root).unwrap();
        let source_path = root.join("source.db");
        let source = Connection::open(&source_path).unwrap();
        source.pragma_update(None, "journal_mode", "WAL").unwrap();
        source.execute_batch("CREATE TABLE photos(id INTEGER PRIMARY KEY, filename TEXT); INSERT INTO photos VALUES (1, 'one.dng'); INSERT INTO photos VALUES (2, 'two.jpg'); PRAGMA user_version=7;").unwrap();
        let dest = root.join("snapshot");
        let report = create_catalog_snapshot(&source, &dest).unwrap();
        assert_eq!(report.manifest.photo_count, 2);
        assert_eq!(report.manifest.catalog_schema_version, 7);
        assert!(!report.manifest.originals_included);
        assert!(!report.manifest.regenerated_caches_included);
        assert_eq!(
            verify_catalog_snapshot(&dest).unwrap().catalog_blake3,
            report.manifest.catalog_blake3
        );
        drop(source);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_modified_catalog_bytes_and_existing_destination() {
        let root = temp_path("tamper");
        fs::create_dir_all(&root).unwrap();
        let source = Connection::open(root.join("source.db")).unwrap();
        source
            .execute_batch(
                "CREATE TABLE photos(id INTEGER PRIMARY KEY); INSERT INTO photos VALUES (1);",
            )
            .unwrap();
        let dest = root.join("snapshot");
        create_catalog_snapshot(&source, &dest).unwrap();
        assert!(create_catalog_snapshot(&source, &dest).is_err());
        fs::write(dest.join("catalog.db"), b"tampered").unwrap();
        assert!(verify_catalog_snapshot(&dest).is_err());
        drop(source);
        fs::remove_dir_all(root).unwrap();
    }
}
