// ── CHR-303: Finder drop -> library drive, with an offline staging queue ─────────────────────
//
// Dropped photos/folders are COPIED (originals are only read) into the library folder the UI
// names. If that folder's volume is mounted the copy goes straight there (collision-safe unique
// names, size+blake3 verified, XMP/rrdata sidecars ride along). If it is not mounted the file is
// copied into a flat local staging folder (`<data_root>/drop_staging`) and recorded in a durable
// queue (`<data_root>/drop_queue.json`, survives relaunch). `drop_sync` — called from the
// Library's existing 4s volume poll and at startup — copies waiting entries to their destination
// once it is mounted, verifies, removes the staging copy, and re-points every path-keyed record
// (catalog row, registries, albums). Edits made while waiting live in the staged file's sidecar,
// which is copied with it, so they survive the move.
//
// Concurrency: one RUN_LOCK, so at most one drop/sync copies at a time (no new worker pool).
//
// Test seam: if `<data_root>/drop_force_offline` exists, destinations are treated as unmounted.
// Empty file = everything; otherwise each line is a path prefix that is treated as unmounted.

use crate::catalog::CatalogState;
use crate::ingest::{copy_sidecars_to, copy_verified, media_hash, media_kind, planned_unique_dest, sidecars_for};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Emitter;

static RUN_LOCK: Mutex<()> = Mutex::new(());
static QUEUE_LOCK: Mutex<()> = Mutex::new(());
const MAX_AUTO_ATTEMPTS: u32 = 3;

#[derive(Serialize, Deserialize, Clone)]
pub struct DropEntry {
    pub id: String,
    pub src: String,
    /// Desired file name at the destination (staged file may carry a uniquified name).
    pub name: String,
    /// Absolute destination FOLDER (library folder + any dropped-folder subpath).
    pub dest_dir: String,
    pub staged: String,
    /// "waiting" (needs drive / will auto-retry) or "failed" (gave up; manual retry).
    pub status: String,
    pub attempts: u32,
    pub error: String,
    pub size: u64,
}

#[derive(Serialize, Default)]
pub struct DropImportResult {
    pub copied: Vec<(String, String)>,
    pub staged: Vec<(String, String)>,
    pub failed: Vec<String>,
    pub skipped: u32,
    pub online: bool,
}

#[derive(Serialize, Default)]
pub struct DropSyncResult {
    pub busy: bool,
    pub moved: Vec<(String, String)>,
    pub failed: Vec<String>,
    pub pending: usize,
    pub failed_total: usize,
}

#[derive(Serialize)]
pub struct DropQueueInfo {
    pub staging_dir: String,
    pub entries: Vec<DropEntry>,
}

fn staging_dir() -> PathBuf {
    let d = crate::platform::data_root().join("drop_staging");
    let _ = std::fs::create_dir_all(&d);
    d
}

fn queue_path() -> PathBuf {
    crate::platform::data_root().join("drop_queue.json")
}

fn queue_read() -> Vec<DropEntry> {
    std::fs::read_to_string(queue_path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn queue_write(q: &[DropEntry]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(q).map_err(|e| e.to_string())?;
    let path = queue_path();
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("write queue: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("commit queue: {e}"))
}

fn forced_offline(dest_dir: &str) -> bool {
    let Ok(text) = std::fs::read_to_string(crate::platform::data_root().join("drop_force_offline")) else { return false };
    let lines: Vec<&str> = text.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
    lines.is_empty() || lines.iter().any(|p| dest_dir.starts_with(p))
}

/// True when the destination's volume is mounted. Never creates anything: on macOS an unmounted
/// `/Volumes/X/...` must not be mistaken for a creatable local path.
fn dest_available(dest_dir: &str) -> bool {
    if forced_offline(dest_dir) {
        return false;
    }
    let p = Path::new(dest_dir);
    if let Ok(rest) = p.strip_prefix("/Volumes") {
        return match rest.components().next() {
            Some(first) => Path::new("/Volumes").join(first).is_dir(),
            None => false,
        };
    }
    #[cfg(windows)]
    {
        if let Some(std::path::Component::Prefix(pre)) = p.components().next() {
            return Path::new(&format!("{}\\", pre.as_os_str().to_string_lossy())).is_dir();
        }
    }
    true
}

fn new_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{t:x}-{}", N.fetch_add(1, Ordering::Relaxed))
}

/// (file, relative sub-directory under the destination) for every importable media file.
fn expand(paths: &[String], skipped: &mut u32) -> Vec<(PathBuf, String)> {
    let mut out = Vec::new();
    for raw in paths {
        let p = PathBuf::from(raw);
        if p.is_dir() {
            let top = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let mut stack = vec![(p.clone(), top)];
            while let Some((dir, rel)) = stack.pop() {
                let Ok(rd) = std::fs::read_dir(&dir) else { continue };
                let mut items: Vec<_> = rd.flatten().collect();
                items.sort_by_key(|e| e.file_name());
                for e in items {
                    let name = e.file_name().to_string_lossy().into_owned();
                    if name.starts_with('.') {
                        continue;
                    }
                    let path = e.path();
                    if path.is_dir() {
                        stack.push((path, if rel.is_empty() { name } else { format!("{rel}/{name}") }));
                    } else if media_kind(&ext_of(&path)).is_some() {
                        out.push((path, rel.clone()));
                    } else if !is_sidecar(&path) {
                        *skipped += 1;
                    }
                }
            }
        } else if p.is_file() {
            if media_kind(&ext_of(&p)).is_some() {
                out.push((p, String::new()));
            } else if !is_sidecar(&p) {
                *skipped += 1;
            }
        } else {
            *skipped += 1;
        }
    }
    out
}

fn ext_of(p: &Path) -> String {
    p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase()
}
fn is_sidecar(p: &Path) -> bool {
    matches!(ext_of(p).as_str(), "xmp" | "rrdata")
}

fn hashes_match(a: &Path, b: &Path) -> bool {
    matches!((media_hash(a), media_hash(b)), (Some(x), Some(y)) if x == y)
}

/// Copy `src` into `dest_dir` as `name` (uniquified, never overwriting), verify size + hash, bring
/// sidecars along. Returns the final path.
fn copy_one(src: &Path, dest_dir: &Path, name: &str) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dest_dir).map_err(|e| format!("create {}: {e}", dest_dir.display()))?;
    let dest = planned_unique_dest(dest_dir, name, &mut std::collections::HashSet::new());
    copy_verified(src, &dest)?;
    if !hashes_match(src, &dest) {
        let _ = std::fs::remove_file(&dest);
        return Err("checksum mismatch after copy".into());
    }
    let fails = copy_sidecars_to(src, &dest);
    if let Some((n, e)) = fails.first() {
        let _ = std::fs::remove_file(&dest);
        return Err(format!("sidecar {n}: {e}"));
    }
    Ok(dest)
}

fn progress(app: Option<&tauri::AppHandle>, job: &str, label: &str, done: usize, total: usize, current: &str) {
    let Some(app) = app else { return };
    let _ = app.emit(
        "job-progress",
        serde_json::json!({ "job": job, "jobId": job, "label": label, "phase": "copy", "done": done, "total": total, "current": current }),
    );
}

#[tauri::command(async)]
pub fn drop_import(app: tauri::AppHandle, paths: Vec<String>, dest_dir: String, cat: tauri::State<CatalogState>) -> Result<DropImportResult, String> {
    let res = drop_import_run(Some(&app), paths, dest_dir)?;
    invalidate_walked(Some(&cat), res.copied.iter().filter_map(|(_, d)| Path::new(d).parent().map(|p| p.to_path_buf())));
    Ok(res)
}

fn drop_import_run(app: Option<&tauri::AppHandle>, paths: Vec<String>, dest_dir: String) -> Result<DropImportResult, String> {
    let _run = RUN_LOCK.lock().map_err(|e| e.to_string())?;
    let mut res = DropImportResult::default();
    let files = expand(&paths, &mut res.skipped);
    let total = files.len();
    res.online = dest_available(&dest_dir);
    let mut queue_add: Vec<DropEntry> = Vec::new();
    for (i, (src, rel)) in files.iter().enumerate() {
        let name = src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        progress(app, "drop-import", "Importing dropped photos", i, total, &name);
        let final_dir = if rel.is_empty() { PathBuf::from(&dest_dir) } else { Path::new(&dest_dir).join(rel) };
        let mut direct_err = String::new();
        if res.online {
            match copy_one(src, &final_dir, &name) {
                Ok(d) => {
                    res.copied.push((src.to_string_lossy().into_owned(), d.to_string_lossy().into_owned()));
                    continue;
                }
                Err(e) => direct_err = e, // drive vanished / full / read-only: fall back to staging
            }
        }
        let size = std::fs::metadata(src).map(|m| m.len()).unwrap_or(0);
        match copy_one(src, &staging_dir(), &name) {
            Ok(staged) => {
                res.staged.push((src.to_string_lossy().into_owned(), staged.to_string_lossy().into_owned()));
                queue_add.push(DropEntry {
                    id: new_id(),
                    src: src.to_string_lossy().into_owned(),
                    name: name.clone(),
                    dest_dir: final_dir.to_string_lossy().into_owned(),
                    staged: staged.to_string_lossy().into_owned(),
                    status: "waiting".into(),
                    attempts: if direct_err.is_empty() { 0 } else { 1 },
                    error: direct_err,
                    size,
                });
            }
            Err(e) => res.failed.push(format!("{name}: {e}")),
        }
    }
    if !queue_add.is_empty() {
        let _q = QUEUE_LOCK.lock().map_err(|e| e.to_string())?;
        let mut q = queue_read();
        q.extend(queue_add);
        queue_write(&q)?;
    }
    progress(app, "drop-import", "Importing dropped photos", total, total, "");
    Ok(res)
}

/// The catalog's launch scan skips a root whose directories' mtimes look unchanged, and some
/// external filesystems (exFAT via fskit, observed on the library drive) do not bump a directory's
/// mtime when a file is added to it. Forget the stored baseline for the folders we just wrote so the
/// next scan re-walks them and indexes the new files.
fn invalidate_walked(cat: Option<&CatalogState>, dirs: impl Iterator<Item = PathBuf>) {
    let Some(cat) = cat else { return };
    let Ok(conn) = cat.conn.lock() else { return };
    let mut seen = std::collections::HashSet::new();
    for dir in dirs {
        if !seen.insert(dir.clone()) { continue; }
        let Ok(canon) = dunce::canonicalize(&dir) else { continue };
        let Ok((vol, mount)) = crate::catalog::upsert_volume(&conn, &canon) else { continue };
        let cs = canon.to_string_lossy().into_owned();
        let rel = cs.strip_prefix(&mount).unwrap_or(&cs).trim_start_matches(['/', '\\']).replace('\\', "/");
        let _ = conn.execute(
            "DELETE FROM walked_dirs WHERE root_id IN (SELECT id FROM roots WHERE volume_id = ?1) AND (rel_dir = ?2 OR rel_dir LIKE ?3)",
            rusqlite::params![vol, rel, format!("{rel}/%")],
        );
    }
}

fn repoint_catalog(cat: Option<&CatalogState>, old: &str, new: &str) {
    let Some(cat) = cat else { return };
    let Ok(conn) = cat.conn.lock() else { return };
    let Some(id) = crate::catalog::find_photo_by_abs_path(&conn, old) else { return };
    let Ok(canon) = dunce::canonicalize(Path::new(new)) else { return };
    let Some(parent) = canon.parent() else { return };
    let Ok((vol, mount)) = crate::catalog::upsert_volume(&conn, parent) else { return };
    let canon_str = canon.to_string_lossy().into_owned();
    let rel = canon_str.strip_prefix(&mount).unwrap_or(&canon_str).trim_start_matches(['/', '\\']).replace('\\', "/");
    let rel_dir = Path::new(&rel).parent().map(|d| d.to_string_lossy().replace('\\', "/")).unwrap_or_default();
    let name = canon.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let (size, mtime) = std::fs::metadata(&canon)
        .ok()
        .map(|m| (m.len() as i64, m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0)))
        .unwrap_or((0, 0));
    // UNIQUE(volume_id, rel_path) conflict (a scan already inserted the new path) is ignored: the
    // scan's own row then simply exists and the staged row goes missing with its folder.
    let _ = conn.execute(
        "UPDATE photos SET volume_id = ?1, rel_path = ?2, rel_dir = ?3, name = ?4, name_lc = ?5, size = ?6, mtime = ?7 WHERE id = ?8",
        rusqlite::params![vol, rel, rel_dir, name, name.to_lowercase(), size, mtime, id],
    );
}

fn run_sync(app: Option<&tauri::AppHandle>, cat: Option<&CatalogState>, force_failed: bool) -> Result<DropSyncResult, String> {
    let Ok(_run) = RUN_LOCK.try_lock() else { return Ok(DropSyncResult { busy: true, ..Default::default() }) };
    let mut res = DropSyncResult::default();
    let snapshot = { let _q = QUEUE_LOCK.lock().map_err(|e| e.to_string())?; queue_read() };
    let todo: Vec<DropEntry> = snapshot
        .iter()
        .filter(|e| (e.status == "waiting" || force_failed) && dest_available(&e.dest_dir))
        .cloned()
        .collect();
    let total = todo.len();
    for (i, e) in todo.iter().enumerate() {
        progress(app, "drop-sync", "Copying waiting photos to the library drive", i, total, &e.name);
        let staged = PathBuf::from(&e.staged);
        let outcome: Result<PathBuf, String> = if !staged.is_file() {
            Err("staged copy is missing".into())
        } else {
            copy_one(&staged, Path::new(&e.dest_dir), &e.name)
        };
        let _q = QUEUE_LOCK.lock().map_err(|e| e.to_string())?;
        let mut q = queue_read();
        match outcome {
            Ok(dest) => {
                let dest_s = dest.to_string_lossy().into_owned();
                repoint_catalog(cat, &e.staged, &dest_s);
                crate::library::repoint_path_keyed(&e.staged, &dest_s);
                for side in sidecars_for(&staged) {
                    let _ = std::fs::remove_file(side);
                }
                let _ = std::fs::remove_file(&staged);
                q.retain(|x| x.id != e.id);
                res.moved.push((e.staged.clone(), dest_s));
            }
            Err(err) => {
                if let Some(x) = q.iter_mut().find(|x| x.id == e.id) {
                    x.attempts += 1;
                    x.error = err.clone();
                    x.status = if x.attempts >= MAX_AUTO_ATTEMPTS { "failed".into() } else { "waiting".into() };
                }
                res.failed.push(format!("{}: {err}", e.name));
            }
        }
        queue_write(&q)?;
    }
    invalidate_walked(cat, res.moved.iter().filter_map(|(_, d)| Path::new(d).parent().map(|p| p.to_path_buf())));
    if total > 0 {
        progress(app, "drop-sync", "Copying waiting photos to the library drive", total, total, "");
    }
    let q = queue_read();
    res.pending = q.iter().filter(|e| e.status == "waiting").count();
    res.failed_total = q.iter().filter(|e| e.status == "failed").count();
    Ok(res)
}

#[tauri::command(async)]
pub fn drop_sync(app: tauri::AppHandle, cat: tauri::State<CatalogState>) -> Result<DropSyncResult, String> {
    run_sync(Some(&app), Some(&cat), false)
}

/// Manual retry from the jobs panel: failed entries go back to "waiting" with a fresh attempt budget.
#[tauri::command(async)]
pub fn drop_retry(app: tauri::AppHandle, cat: tauri::State<CatalogState>) -> Result<DropSyncResult, String> {
    {
        let _q = QUEUE_LOCK.lock().map_err(|e| e.to_string())?;
        let mut q = queue_read();
        for e in q.iter_mut().filter(|e| e.status == "failed") {
            e.status = "waiting".into();
            e.attempts = 0;
        }
        queue_write(&q)?;
    }
    run_sync(Some(&app), Some(&cat), false)
}

#[tauri::command(async)]
pub fn drop_queue_list() -> DropQueueInfo {
    let _q = QUEUE_LOCK.lock();
    DropQueueInfo { staging_dir: staging_dir().to_string_lossy().into_owned(), entries: queue_read() }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Drives the whole stage -> wait -> sync -> verify -> cleanup path against real directories.
    // CS_DROP_TEST_DEST (a folder on the real library drive) selects the "online" leg; without it
    // a temp folder stands in. HOME is redirected so the queue/staging never touch real app data.
    #[test]
    fn drop_stage_then_sync_roundtrip() {
        let tmp = std::env::temp_dir().join(format!("cs_drop_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join("home")).unwrap();
        std::env::set_var("HOME", tmp.join("home"));
        let src = tmp.join("src");
        std::fs::create_dir_all(src.join("Trip/sub")).unwrap();
        std::fs::write(src.join("a.jpg"), b"jpegdata-a").unwrap();
        std::fs::write(src.join("a.xmp"), b"<xmp edits=\"1\"/>").unwrap();
        std::fs::write(src.join("Trip/b.jpg"), b"jpegdata-b").unwrap();
        std::fs::write(src.join("Trip/sub/c.jpg"), b"jpegdata-c").unwrap();
        std::fs::write(src.join("Trip/notes.txt"), b"x").unwrap();
        let dest = match std::env::var("CS_DROP_TEST_DEST") {
            Ok(d) => PathBuf::from(d),
            Err(_) => tmp.join("drive/lib"),
        };
        let dest_s = dest.to_string_lossy().into_owned();
        let paths = vec![src.join("a.jpg").to_string_lossy().into_owned(), src.join("Trip").to_string_lossy().into_owned()];

        // online: direct copy, collision-safe on a second drop, original untouched
        let r = drop_import_run(None, paths.clone(), dest_s.clone()).unwrap();
        assert!(r.online && r.copied.len() == 3 && r.staged.is_empty() && r.skipped == 1, "online import");
        assert!(dest.join("a.jpg").is_file() && dest.join("a.xmp").is_file() && dest.join("Trip/sub/c.jpg").is_file());
        let r2 = drop_import_run(None, paths.clone(), dest_s.clone()).unwrap();
        assert_eq!(r2.copied.len(), 3);
        assert!(dest.join("a (2).jpg").is_file() && std::fs::read(dest.join("a.jpg")).unwrap() == b"jpegdata-a");
        assert!(src.join("a.jpg").is_file());

        // offline (seam): stages, queue persists, nothing written to dest
        let dest2 = dest.join("offline_part");
        std::fs::write(crate::platform::data_root().join("drop_force_offline"), "").unwrap();
        let r3 = drop_import_run(None, paths.clone(), dest2.to_string_lossy().into_owned()).unwrap();
        assert!(!r3.online && r3.staged.len() == 3 && r3.copied.is_empty());
        assert!(!dest2.exists());
        assert_eq!(queue_read().len(), 3);
        let staged_a = r3.staged.iter().find(|(s, _)| s.ends_with("a.jpg")).unwrap().1.clone();
        assert!(Path::new(&staged_a).with_extension("xmp").is_file());
        // still offline: sync is a no-op
        let s0 = run_sync(None, None, false).unwrap();
        assert!(s0.moved.is_empty() && s0.pending == 3);

        // "mount": remove the seam, sync copies, verifies, removes staging, empties queue
        std::fs::remove_file(crate::platform::data_root().join("drop_force_offline")).unwrap();
        let s1 = run_sync(None, None, false).unwrap();
        assert_eq!(s1.moved.len(), 3, "failed: {:?}", s1.failed);
        assert!(dest2.join("a.jpg").is_file() && dest2.join("a.xmp").is_file() && dest2.join("Trip/sub/c.jpg").is_file());
        assert_eq!(std::fs::read(dest2.join("a.jpg")).unwrap(), b"jpegdata-a");
        assert!(!Path::new(&staged_a).exists() && queue_read().is_empty());
        assert_eq!(std::fs::read_dir(staging_dir()).unwrap().count(), 0, "staging emptied");

        // failure path: staged copy vanished -> retried up to the cap, then "failed", manual retry resets
        std::fs::write(crate::platform::data_root().join("drop_force_offline"), "").unwrap();
        let r4 = drop_import_run(None, vec![src.join("a.jpg").to_string_lossy().into_owned()], dest2.to_string_lossy().into_owned()).unwrap();
        std::fs::remove_file(&r4.staged[0].1).unwrap();
        std::fs::remove_file(crate::platform::data_root().join("drop_force_offline")).unwrap();
        for _ in 0..MAX_AUTO_ATTEMPTS { run_sync(None, None, false).unwrap(); }
        assert_eq!(queue_read()[0].status, "failed");
        let s2 = run_sync(None, None, false).unwrap();
        assert!(s2.failed.is_empty() && s2.failed_total == 1);

        // cleanup (only what this test created)
        if std::env::var("CS_DROP_TEST_DEST").is_err() { let _ = std::fs::remove_dir_all(&tmp); } else {
            let _ = std::fs::remove_dir_all(tmp.join("home"));
            let _ = std::fs::remove_dir_all(&src);
        }
    }
}
