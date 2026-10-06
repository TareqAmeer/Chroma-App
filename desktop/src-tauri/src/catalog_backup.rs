use rusqlite::{backup::Progress, Connection, DatabaseName};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const SNAPSHOT_FORMAT_VERSION: u32 = 1;

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
