// Whole-archive photo catalog: a SQLite index over every root the user has added, so the
// Library can show "All Photos" and a date browser instead of one folder at a time, and so
// browsing keeps working with the source volume unplugged.
//
// ⚠️ The XMP sidecar next to each photo is ALWAYS the source of truth. This catalog is a
// derived, rebuildable CACHE of it plus filesystem facts (size/mtime/kind) — never the reverse.
// A corrupt or deleted catalog.db is a rescan away from being exactly right again; a corrupt
// sidecar is real user work gone. Every write here follows that: file first, catalog second.
//
// This module covers the WALKABLE CORE — schema, migrations, volume identity, roots, and the
// scan that finds files and tracks which are still present. EXIF metadata (scan phase B),
// sidecar contents (phase C), offline thumbnails (phase D), stacking, keywords and delete
// integration are deliberately NOT here yet — they build on this foundation in later commits.
use rayon::prelude::*;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const SCHEMA_VERSION: i64 = 1;

/// Marker file written once at a volume's root when the user first adds a catalogued folder on
/// it. Its content (a generated id, not a filesystem UUID) is the volume's identity — stable
/// across a remount at a different `/Volumes/...` path, a volume rename, or moving the drive to
/// another Mac. A dotfile, so `list_dir` already hides it. See `volume_uuid_for`.
const VOLUME_MARKER: &str = ".chromasmith-volume-id";

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

// ── Storage location ─────────────────────────────────────────────────────────────────────────

/// Application Support (never Caches, never the SSD itself): the catalog is user work — stack
/// choices, keywords, and the id→offline-thumbnail mapping are not regenerable from a rescan
/// alone once a volume is gone — matching the existing `albums.json`/`subjects.json` split.
///
/// ⚠️ `CS_CATALOG_DIR` overrides this for tests. Without it, `library_perf.mjs`'s synthetic
/// 50,000-entry catalog runs (and any future Rust test) would scan/migrate/rebuild against the
/// REAL library. Only the shipped app relies on the default.
fn catalog_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("CS_CATALOG_DIR") {
        let p = PathBuf::from(dir);
        let _ = std::fs::create_dir_all(&p);
        return p;
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    let dir = PathBuf::from(home).join("Library/Application Support/com.tareq.chromasmith");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn catalog_db_path() -> PathBuf {
    catalog_dir().join("catalog.db")
}

// ── Connection + migrations ─────────────────────────────────────────────────────────────────

/// Shared across every command via `.manage(CatalogState::new())`. One connection behind a
/// mutex: scan workers compute into plain `Vec`s off-thread and a single thread commits, so the
/// mutex is held only for the (fast) transaction itself, never for a slow walk or EXIF read.
pub struct CatalogState {
    pub conn: Mutex<Connection>,
    pub cancel: AtomicBool,
}

impl CatalogState {
    pub fn new() -> Self {
        let conn = open_and_migrate(&catalog_db_path()).unwrap_or_else(|e| {
            // A catalog that fails to open must not fail the app. It is a rebuildable cache —
            // rename the bad file aside and start fresh rather than block startup or panic.
            eprintln!("catalog: open failed ({e}), starting fresh");
            let bad = catalog_db_path();
            let aside = bad.with_extension(format!("corrupt-{}.db", now_secs()));
            let _ = std::fs::rename(&bad, &aside);
            open_and_migrate(&catalog_db_path()).expect("fresh catalog.db must open")
        });
        CatalogState { conn: Mutex::new(conn), cancel: AtomicBool::new(false) }
    }
}

fn open_and_migrate(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&conn)?;
    Ok(conn)
}

/// Additive only: every step is `ALTER TABLE ADD COLUMN` or `CREATE TABLE IF NOT EXISTS`, never
/// a drop-and-recreate of `photos`. `photos.id` is the offline-thumbnail filename
/// (`thumbs/<id%256>/<id>.jpg`, added in a later commit) — any migration that reassigns ids
/// orphans that entire cache tier. Idempotent: running it again with nothing new to do changes
/// nothing, which is what `schema_migrates_and_is_idempotent` pins.
fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version >= SCHEMA_VERSION {
        return Ok(());
    }
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS volumes (
            id          INTEGER PRIMARY KEY,
            uuid        TEXT    NOT NULL UNIQUE,
            label       TEXT    NOT NULL,
            last_path   TEXT    NOT NULL,
            mntfrom     TEXT,
            total_bytes INTEGER NOT NULL DEFAULT 0,
            is_local    INTEGER NOT NULL DEFAULT 0,
            last_seen   INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS roots (
            id          INTEGER PRIMARY KEY,
            volume_id   INTEGER NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
            rel_path    TEXT    NOT NULL,
            kind        TEXT    NOT NULL DEFAULT 'originals',
            added       INTEGER NOT NULL,
            keep_thumbs INTEGER NOT NULL DEFAULT 1,
            UNIQUE(volume_id, rel_path)
        );

        CREATE TABLE IF NOT EXISTS photos (
            id          INTEGER PRIMARY KEY,
            volume_id   INTEGER NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
            rel_path    TEXT    NOT NULL,
            rel_dir     TEXT    NOT NULL,
            name        TEXT    NOT NULL,
            name_lc     TEXT    NOT NULL,
            ext         TEXT    NOT NULL,
            kind        TEXT    NOT NULL,
            size        INTEGER NOT NULL,
            mtime       INTEGER NOT NULL,

            captured    INTEGER,
            cap_y       INTEGER, cap_m INTEGER, cap_d INTEGER,

            camera TEXT, make TEXT, model TEXT, lens TEXT,
            iso         INTEGER,
            shutter TEXT, shutter_sec REAL,
            aperture TEXT, aperture_f REAL,
            focal TEXT, focal_mm REAL,
            meta_mtime  INTEGER,

            rating      INTEGER NOT NULL DEFAULT 0,
            label       TEXT    NOT NULL DEFAULT '',
            edited      INTEGER NOT NULL DEFAULT 0,
            favorite    INTEGER NOT NULL DEFAULT 0,
            sidecar_mtime        INTEGER NOT NULL DEFAULT 0,
            sidecar_parsed_mtime INTEGER NOT NULL DEFAULT 0,

            phash       TEXT,
            thumb       INTEGER NOT NULL DEFAULT 0,

            content_hash TEXT,
            hashed_at    INTEGER,
            verified_at  INTEGER,

            stack_id    INTEGER,
            stack_role  TEXT,
            export_of   INTEGER,

            present     INTEGER NOT NULL DEFAULT 1,
            scan_gen    INTEGER NOT NULL DEFAULT 0,
            added       INTEGER NOT NULL,
            UNIQUE(volume_id, rel_path)
        );
        CREATE INDEX IF NOT EXISTS ix_photos_captured ON photos(captured DESC);
        CREATE INDEX IF NOT EXISTS ix_photos_ymd      ON photos(cap_y, cap_m, cap_d);
        CREATE INDEX IF NOT EXISTS ix_photos_dir      ON photos(volume_id, rel_dir);
        CREATE INDEX IF NOT EXISTS ix_photos_camera   ON photos(camera);
        CREATE INDEX IF NOT EXISTS ix_photos_lens     ON photos(lens);
        CREATE INDEX IF NOT EXISTS ix_photos_iso      ON photos(iso);
        CREATE INDEX IF NOT EXISTS ix_photos_kind     ON photos(kind);
        CREATE INDEX IF NOT EXISTS ix_photos_name     ON photos(name_lc);
        CREATE INDEX IF NOT EXISTS ix_photos_present  ON photos(present, volume_id);
        CREATE INDEX IF NOT EXISTS ix_photos_phash    ON photos(phash);

        CREATE TABLE IF NOT EXISTS keywords (
            id        INTEGER PRIMARY KEY,
            path      TEXT NOT NULL UNIQUE,
            leaf      TEXT NOT NULL,
            parent_id INTEGER REFERENCES keywords(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS ix_kw_parent ON keywords(parent_id);
        CREATE INDEX IF NOT EXISTS ix_kw_leaf   ON keywords(leaf);

        CREATE TABLE IF NOT EXISTS photo_keywords (
            photo_id   INTEGER NOT NULL REFERENCES photos(id)   ON DELETE CASCADE,
            keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
            PRIMARY KEY (photo_id, keyword_id)
        );
        CREATE INDEX IF NOT EXISTS ix_pk_kw ON photo_keywords(keyword_id, photo_id);
        ",
    )?;
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}

// ── Volume identity ──────────────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct VolumeRow {
    pub id: i64,
    pub uuid: String,
    pub label: String,
    pub last_path: String,
    pub is_local: bool,
    pub total_bytes: u64,
    pub online: bool,
}

fn statfs_mount_point(path: &Path) -> Option<(String, String)> {
    use std::ffi::{CStr, CString};
    let cstr = CString::new(path.to_str()?).ok()?;
    // SAFETY: statfs writes into a zeroed, correctly-sized struct; only scalar/C-string fields
    // are read back, and f_mntonname/f_mntfromname are fixed-size NUL-terminated char arrays.
    unsafe {
        let mut st: libc::statfs = std::mem::zeroed();
        if libc::statfs(cstr.as_ptr(), &mut st) != 0 {
            return None;
        }
        let onname = CStr::from_ptr(st.f_mntonname.as_ptr()).to_string_lossy().into_owned();
        let fromname = CStr::from_ptr(st.f_mntfromname.as_ptr()).to_string_lossy().into_owned();
        Some((onname, fromname))
    }
}

/// macOS's split System/Data APFS volume group means a perfectly ordinary path under `/Users`
/// or a temp dir under `/var` (itself a symlink to `/private/var`) resolves via `statfs` to
/// `/System/Volumes/Data`, NOT `/` — every one of the OS's own internal volumes (Data, Preboot,
/// VM, Update, ...) lives under that prefix. A real external drive always shows up under
/// `/Volumes/...` instead, so this prefix check is what actually distinguishes "this Mac" from
/// "an attached drive" on modern macOS; checking only `mount_point == "/"` (the pre-APFS-
/// volume-group assumption) treats the user's own Documents folder as an unmounted external
/// disk, which silently walks nothing (see `volume_identity`'s canonicalize comment).
fn is_boot_volume(mount_point: &str) -> bool {
    mount_point == "/" || mount_point.starts_with("/System/Volumes/")
}

fn gen_id() -> String {
    // No adversary and no cross-user collision concern (this is a single local user's own
    // drives) — two SystemTime reads plus the process id give ample uniqueness without adding
    // a `uuid` dependency for one string.
    let a = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    std::thread::sleep(std::time::Duration::from_nanos(1));
    let b = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:016x}{:016x}{:08x}", a as u64, b as u64, std::process::id())
}

/// Resolves (mount point, uuid, is_local) for whatever volume `path` lives on. For the boot
/// disk, `uuid` is the reserved literal `"local"` and paths are stored as the absolute path
/// minus its leading `/` — one code path, no downstream special-casing between "external drive"
/// and "this Mac's own disk".
///
/// For an external volume, identity is a marker file written once at the volume's root
/// (`VOLUME_MARKER`) — NOT the filesystem UUID (digiKam's own docs describe that changing on a
/// system update, disk reconfiguration, or plain reconnect) and NOT `f_mntfromname` alone (that
/// tracks the USB port / attach order, not the drive). Falls back to a `fp:`-prefixed
/// fingerprint of (mount point basename, volume capacity) when the marker can't be written
/// (read-only media) — degraded but functional, and the caller can tell it apart by the prefix.
fn volume_identity(path: &Path) -> (String, String, bool) {
    // ⚠️ Canonicalize FIRST. `/tmp` -> `/private/tmp` and `/var` -> `/private/var` are ordinary
    // symlinks, and `statfs` reports the REAL mount point of wherever a path actually resolves
    // to — so calling it on the symlinked form and then string-prefix-stripping the ORIGINAL
    // (non-canonical) path against that mount point silently fails to match, and every file
    // under it goes unwalked. Canonicalizing both sides once, here, is what keeps
    // `add_root_run`'s rel_path computation and `walk_root`'s reconstruction consistent.
    let canon = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let Some((mount_point, _fromname)) = statfs_mount_point(&canon) else {
        return ("fp:unknown".into(), "/".into(), true);
    };
    if is_boot_volume(&mount_point) {
        return ("local".into(), mount_point, true);
    }
    let marker = PathBuf::from(&mount_point).join(VOLUME_MARKER);
    if let Ok(existing) = std::fs::read_to_string(&marker) {
        let id = existing.trim().to_string();
        if !id.is_empty() {
            return (id, mount_point, false);
        }
    }
    let id = gen_id();
    if std::fs::write(&marker, &id).is_ok() {
        return (id, mount_point, false);
    }
    // Read-only or unwritable volume: fingerprint instead of failing identity entirely.
    let (total, _free) = {
        let cstr = std::ffi::CString::new(mount_point.as_str()).ok();
        cstr.and_then(|c| unsafe {
            let mut st: libc::statfs = std::mem::zeroed();
            if libc::statfs(c.as_ptr(), &mut st) == 0 {
                Some((st.f_blocks as u64 * st.f_bsize as u64, st.f_bavail as u64 * st.f_bsize as u64))
            } else {
                None
            }
        })
    }
    .unwrap_or((0, 0));
    let basename = Path::new(&mount_point).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    (format!("fp:{basename}:{total}"), mount_point, false)
}

/// Inserts or refreshes a volume row for whatever volume `path` lives on, returning its id and
/// the mount point (needed by the caller to compute `rel_path`). `last_path`/`last_seen`/
/// `total_bytes` are refreshed on every call — they're a CACHE of where the volume was last
/// seen, never its identity.
fn upsert_volume(conn: &Connection, path: &Path) -> rusqlite::Result<(i64, String)> {
    let (uuid, mount_point, is_local) = volume_identity(path);
    let label = if is_local {
        "This Mac".to_string()
    } else {
        Path::new(&mount_point).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| mount_point.clone())
    };
    let (total_bytes, _free) = {
        let cstr = std::ffi::CString::new(mount_point.as_str()).ok();
        cstr.and_then(|c| unsafe {
            let mut st: libc::statfs = std::mem::zeroed();
            if libc::statfs(c.as_ptr(), &mut st) == 0 { Some(st.f_blocks as u64 * st.f_bsize as u64) } else { None }
        })
    }
    .map(|t| (t, 0u64))
    .unwrap_or((0, 0));

    conn.execute(
        "INSERT INTO volumes (uuid, label, last_path, total_bytes, is_local, last_seen)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(uuid) DO UPDATE SET
            last_path = excluded.last_path,
            total_bytes = excluded.total_bytes,
            last_seen = excluded.last_seen",
        params![uuid, label, mount_point, total_bytes as i64, is_local as i64, now_secs() as i64],
    )?;
    let id: i64 = conn.query_row("SELECT id FROM volumes WHERE uuid = ?1", params![uuid], |r| r.get(0))?;
    Ok((id, mount_point))
}

/// The absolute path a catalog row currently resolves to, computed fresh from the volume's
/// LAST-SEEN mount point — never stored. This is what makes a remount at a different
/// `/Volumes/...` path transparent to every caller: `set_sidecar`, `get_thumbnail`, opening a
/// photo in the editor, none of them need to know a volume table exists.
fn abs_path(vol_last_path: &str, is_local: bool, rel_path: &str) -> String {
    if is_local {
        format!("/{rel_path}")
    } else {
        format!("{vol_last_path}/{rel_path}")
    }
}

#[tauri::command]
pub fn catalog_volumes(state: tauri::State<CatalogState>) -> Result<Vec<VolumeRow>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    volumes_run(&conn)
}

pub fn volumes_run(conn: &Connection) -> Result<Vec<VolumeRow>, String> {
    let mut stmt = conn
        .prepare("SELECT id, uuid, label, last_path, is_local, total_bytes FROM volumes ORDER BY is_local DESC, label")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let is_local: i64 = r.get(4)?;
            let last_path: String = r.get(3)?;
            Ok(VolumeRow {
                id: r.get(0)?,
                uuid: r.get(1)?,
                label: r.get(2)?,
                last_path: last_path.clone(),
                is_local: is_local != 0,
                total_bytes: r.get::<_, i64>(5)? as u64,
                online: is_local != 0 || Path::new(&last_path).is_dir(),
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// ── Roots ────────────────────────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct CatalogRoot {
    pub id: i64,
    pub volume_id: i64,
    pub rel_path: String,
    pub kind: String,
    pub abs_path: String,
}

/// Registers a folder to be catalogued. Scanning is opt-in per root, never "the whole disk" —
/// mirrors the existing Library's folder-tree model, just with an index behind it now.
pub fn add_root_run(conn: &Connection, path: &str, kind: Option<String>) -> Result<CatalogRoot, String> {
    let p = PathBuf::from(path);
    if !p.is_dir() {
        return Err(format!("not a folder: {path}"));
    }
    // Canonicalize once, here, and use that form for everything downstream — `upsert_volume`
    // (via `volume_identity`) resolves the MOUNT POINT from the canonical path, so the prefix
    // strip below has to run against the same canonical form or it silently fails to match
    // (see `volume_identity`'s doc comment on `/var` -> `/private/var`).
    let canon = std::fs::canonicalize(&p).map_err(|e| format!("resolve {path}: {e}"))?;
    let (volume_id, mount_point) = upsert_volume(conn, &canon).map_err(|e| e.to_string())?;
    let canon_str = canon.to_string_lossy().into_owned();
    let rel_path = canon_str
        .strip_prefix(&mount_point)
        .unwrap_or(&canon_str)
        .trim_start_matches('/')
        .to_string();
    let kind = kind.unwrap_or_else(|| "originals".to_string());
    conn.execute(
        "INSERT INTO roots (volume_id, rel_path, kind, added) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(volume_id, rel_path) DO UPDATE SET kind = excluded.kind",
        params![volume_id, rel_path, kind, now_secs() as i64],
    )
    .map_err(|e| e.to_string())?;
    let id: i64 = conn
        .query_row(
            "SELECT id FROM roots WHERE volume_id = ?1 AND rel_path = ?2",
            params![volume_id, rel_path],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(CatalogRoot { id, volume_id, rel_path, kind, abs_path: canon_str })
}

#[tauri::command]
pub fn catalog_add_root(path: String, kind: Option<String>, state: tauri::State<CatalogState>) -> Result<CatalogRoot, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    add_root_run(&conn, &path, kind)
}

#[tauri::command]
pub fn catalog_remove_root(id: i64, state: tauri::State<CatalogState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM roots WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn catalog_roots(state: tauri::State<CatalogState>) -> Result<Vec<CatalogRoot>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT r.id, r.volume_id, r.rel_path, r.kind, v.last_path, v.is_local
             FROM roots r JOIN volumes v ON v.id = r.volume_id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let volume_id: i64 = r.get(1)?;
            let rel_path: String = r.get(2)?;
            let last_path: String = r.get(4)?;
            let is_local: i64 = r.get(5)?;
            Ok(CatalogRoot {
                id: r.get(0)?,
                volume_id,
                rel_path: rel_path.clone(),
                kind: r.get(3)?,
                abs_path: abs_path(&last_path, is_local != 0, &rel_path),
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

// ── Scan phase A: walk + stat + upsert, deletion tracking ──────────────────────────────────────

/// Mirrors `library.rs`'s own extension lists (kept independent rather than imported — this
/// module is designed to eventually run scans off the main thread without pulling in
/// `library.rs`'s RAW-decode-heavy dependency surface).
fn media_kind(ext: &str) -> Option<&'static str> {
    match ext {
        "rw2" | "raw" | "dng" | "cr2" | "cr3" | "nef" | "arw" | "orf" => Some("raw"),
        "jpg" | "jpeg" => Some("jpeg"),
        "heic" | "heif" => Some("heic"),
        "png" => Some("png"),
        "tif" | "tiff" => Some("tiff"),
        "mp4" | "mov" | "m4v" => Some("video"),
        _ => None,
    }
}

fn ext_lower(p: &Path) -> String {
    p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase()
}

fn sidecar_mtime_of(photo_path: &Path) -> u64 {
    std::fs::metadata(photo_path.with_extension("xmp"))
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

struct WalkedFile {
    rel_path: String,
    rel_dir: String,
    name: String,
    ext: String,
    kind: &'static str,
    size: u64,
    mtime: u64,
    sidecar_mtime: u64,
}

/// Stack-based walk (no `walkdir` dependency), mirroring `ingest.rs`'s `scan_card`/
/// `index_destination` shape. `root_rel` is the root's own rel_path, used to compute each
/// file's path relative to the VOLUME (stored in the DB) rather than relative to the root
/// (which would break if two roots on the same volume overlapped).
fn walk_root(volume_mount: &Path, root_rel: &str) -> Vec<WalkedFile> {
    let root_abs = volume_mount.join(root_rel);
    let mut out = Vec::new();
    let mut stack = vec![root_abs];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for entry in rd.flatten() {
            let p = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            if p.is_dir() {
                stack.push(p);
                continue;
            }
            let ext = ext_lower(&p);
            let Some(kind) = media_kind(&ext) else { continue };
            let Ok(rel) = p.strip_prefix(volume_mount) else { continue };
            let rel_path = rel.to_string_lossy().into_owned();
            let rel_dir = rel.parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
            let meta = entry.metadata().ok();
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let mtime = meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            out.push(WalkedFile {
                rel_path,
                rel_dir,
                name,
                ext,
                kind,
                size,
                mtime,
                sidecar_mtime: sidecar_mtime_of(&p),
            });
        }
    }
    out
}

#[derive(Serialize, Clone, Default)]
pub struct ScanProgress {
    pub phase: String,
    pub done: usize,
    pub total: usize,
    pub current: String,
}

#[derive(Serialize, Default)]
pub struct ScanResult {
    pub scanned: usize,
    pub added: usize,
    pub marked_absent: usize,
}

/// Walks every root on `volume_id` (or every root, if `None`), upserts what it finds, then
/// marks anything not touched by this pass `present = 0` — UPDATE, never DELETE, so ratings and
/// keywords on a temporarily-moved file survive. Returns quickly for an unchanged tree: the
/// upsert is a no-op write for every row whose stat facts didn't change (SQLite doesn't
/// short-circuit an identical UPDATE, but no ADDITIONAL work — no metadata re-read, no
/// thumbnail regen — is triggered by scan phase A alone).
pub fn scan_run(
    conn: &Connection,
    only_volume_id: Option<i64>,
    progress: &mut dyn FnMut(ScanProgress),
    cancel: &AtomicBool,
) -> Result<ScanResult, String> {
    // ⚠️ A monotonic counter, NOT a timestamp. `now_secs()` is second-resolution, so two scans
    // triggered within the same second (a real possibility: app launch + an immediate
    // `catalog_note_folder` call, or simply a fast test) would get the IDENTICAL scan_gen —
    // and since "mark absent" is `WHERE scan_gen != <this run's value>`, a collision means the
    // previous run's rows compare EQUAL and the deletion sweep silently marks nothing absent.
    // `MAX(scan_gen)+1` is strictly increasing regardless of wall-clock granularity.
    let scan_gen: i64 = conn
        .query_row("SELECT COALESCE(MAX(scan_gen), 0) + 1 FROM photos", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let mut roots_stmt = conn
        .prepare(
            "SELECT r.id, r.volume_id, r.rel_path, v.last_path
             FROM roots r JOIN volumes v ON v.id = r.volume_id
             WHERE (?1 IS NULL OR r.volume_id = ?1)",
        )
        .map_err(|e| e.to_string())?;
    let roots: Vec<(i64, i64, String, String)> = roots_stmt
        .query_map(params![only_volume_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(roots_stmt);

    let mut result = ScanResult::default();
    for (_root_id, volume_id, root_rel, mount_point) in &roots {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let mount = PathBuf::from(mount_point);
        if !mount.is_dir() {
            continue; // volume not mounted — nothing to scan, not an error
        }
        let files = walk_root(&mount, root_rel);
        let total = files.len();
        progress(ScanProgress { phase: "walk".into(), done: 0, total, current: root_rel.clone() });

        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for (i, f) in files.iter().enumerate() {
            if i % 500 == 0 {
                progress(ScanProgress { phase: "walk".into(), done: i, total, current: f.name.clone() });
            }
            let existed: bool = tx
                .query_row(
                    "SELECT 1 FROM photos WHERE volume_id = ?1 AND rel_path = ?2",
                    params![volume_id, f.rel_path],
                    |_| Ok(true),
                )
                .unwrap_or(false);
            tx.execute(
                "INSERT INTO photos
                    (volume_id, rel_path, rel_dir, name, name_lc, ext, kind, size, mtime,
                     sidecar_mtime, scan_gen, added, present)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,1)
                 ON CONFLICT(volume_id, rel_path) DO UPDATE SET
                    size = excluded.size, mtime = excluded.mtime,
                    sidecar_mtime = excluded.sidecar_mtime,
                    scan_gen = excluded.scan_gen, present = 1",
                params![
                    volume_id,
                    f.rel_path,
                    f.rel_dir,
                    f.name,
                    f.name.to_lowercase(),
                    f.ext,
                    f.kind,
                    f.size as i64,
                    f.mtime as i64,
                    f.sidecar_mtime as i64,
                    scan_gen,
                    now_secs() as i64,
                ],
            )
            .map_err(|e| e.to_string())?;
            if !existed {
                result.added += 1;
            }
        }
        result.scanned += files.len();

        // Anything under this root NOT touched by this scan_gen is gone.
        let dir_prefix = format!("{root_rel}/%");
        let changed = tx
            .execute(
                "UPDATE photos SET present = 0
                 WHERE volume_id = ?1 AND (rel_dir = ?2 OR rel_dir LIKE ?3) AND scan_gen != ?4 AND present = 1",
                params![volume_id, root_rel, dir_prefix, scan_gen],
            )
            .map_err(|e| e.to_string())?;
        result.marked_absent += changed;
        tx.commit().map_err(|e| e.to_string())?;
    }
    progress(ScanProgress { phase: "done".into(), done: result.scanned, total: result.scanned, current: String::new() });
    Ok(result)
}

// ── Scan phase B: EXIF metadata ─────────────────────────────────────────────────────────────
//
// Deliberately calls `library::read_meta_public`, NOT `library::get_meta` — `get_meta` writes a
// `.meta4.json` per photo into the THUMBNAIL cache directory, which `prune_caches()` walks and
// evicts against its 500MB cap. At 100k photos that would fill the thumbnail cache's eviction
// pool with metadata JSON files that have nothing to do with thumbnails. The catalog's own
// `meta_mtime` column IS the cache for catalogued photos — no second on-disk cache needed.

/// "YYYY:MM:DD HH:MM:SS" (EXIF's own format, as `PhotoMeta::date` carries it) → (unix_secs,
/// year, month, day). Days-since-epoch via Howard Hinnant's `days_from_civil` — the exact
/// inverse of `ingest.rs`'s own `civil_from_days`, written out for the same reason that one was:
/// exact for every date this will ever see, no `chrono` dependency for one conversion.
fn parse_exif_datetime(raw: &str) -> Option<(i64, i32, i32, i32)> {
    let bytes = raw.as_bytes();
    if bytes.len() < 19 {
        return None;
    }
    let y: i64 = raw.get(0..4)?.parse().ok()?;
    let mo: i64 = raw.get(5..7)?.parse().ok()?;
    let d: i64 = raw.get(8..10)?.parse().ok()?;
    let h: i64 = raw.get(11..13)?.parse().ok()?;
    let mi: i64 = raw.get(14..16)?.parse().ok()?;
    let s: i64 = raw.get(17..19)?.parse().ok()?;
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) {
        return None;
    }
    let y_adj = if mo <= 2 { y - 1 } else { y };
    let era = if y_adj >= 0 { y_adj } else { y_adj - 399 } / 400;
    let yoe = (y_adj - era * 400) as u64;
    let mp = if mo > 2 { mo - 3 } else { mo + 9 } as u64;
    let doy = (153 * mp + 2) / 5 + (d as u64) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe as i64 - 719_468;
    let secs = days * 86_400 + h * 3600 + mi * 60 + s;
    Some((secs, y as i32, mo as i32, d as i32))
}

/// Mirrors `sortKeyOf`'s exact JS transform (`library-ui.js`) so a future SQL `ORDER BY` on
/// `shutter_sec` reproduces the same order the grid already sorts by — including the `1/250`
/// → `-1/250` negation, which is what makes "1/8000" sort faster than "1/60" instead of the
/// other way around under a naive numeric parse.
fn shutter_to_sec(s: &str) -> Option<f64> {
    if s.is_empty() {
        return None;
    }
    if let Some(rest) = s.strip_prefix("1/") {
        let denom: f64 = rest.parse().ok()?;
        if denom == 0.0 {
            return Some(0.0);
        }
        return Some(-1.0 / denom);
    }
    // JS parseFloat stops at the first non-numeric character ("2.5s" -> 2.5); Rust's f64::parse
    // does not, so trim any trailing non-numeric suffix first.
    let numeric: String = s.chars().take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-').collect();
    numeric.parse().ok()
}

fn leading_float(s: &str) -> Option<f64> {
    let numeric: String = s.chars().filter(|c| c.is_ascii_digit() || *c == '.').collect();
    if numeric.is_empty() {
        None
    } else {
        numeric.parse().ok()
    }
}

#[derive(Default)]
pub struct MetadataResult {
    pub read: usize,
}

/// Chunks of 512, resumable via `meta_mtime`: a photo whose `meta_mtime` already equals its
/// current `mtime` is skipped, so a cancelled or crashed pass picks up exactly where it left
/// off, and re-running this after nothing has changed does zero EXIF reads.
pub fn metadata_run(
    conn: &Connection,
    progress: &mut dyn FnMut(ScanProgress),
    cancel: &AtomicBool,
) -> Result<MetadataResult, String> {
    let mut result = MetadataResult::default();
    loop {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let mut stmt = conn
            .prepare(
                "SELECT p.id, p.rel_path, p.mtime, v.last_path, v.is_local
                 FROM photos p JOIN volumes v ON v.id = p.volume_id
                 WHERE p.present = 1 AND (p.meta_mtime IS NULL OR p.meta_mtime != p.mtime)
                 LIMIT 512",
            )
            .map_err(|e| e.to_string())?;
        // ⚠️ Volumes not currently mounted are filtered out HERE, in Rust — not in the SQL
        // above — because "is this path currently a real directory" is a filesystem fact SQL
        // can't express. Without this, a photo on an offline volume would never get its
        // meta_mtime set (read_meta_public on a missing path just returns an empty PhotoMeta,
        // and writing that as "done" would wrongly cache "no metadata" forever), so the SAME
        // 512-row batch would be re-selected every loop iteration — an infinite loop the moment
        // an offline volume's rows are the only ones left needing metadata.
        let batch: Vec<(i64, Option<String>, i64)> = stmt
            .query_map([], |r| {
                let id: i64 = r.get(0)?;
                let rel_path: String = r.get(1)?;
                let mtime: i64 = r.get(2)?;
                let last_path: String = r.get(3)?;
                let is_local: i64 = r.get(4)?;
                let online = is_local != 0 || Path::new(&last_path).is_dir();
                Ok((id, if online { Some(abs_path(&last_path, is_local != 0, &rel_path)) } else { None }, mtime))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        drop(stmt);
        let batch: Vec<(i64, String, i64)> = batch.into_iter().filter_map(|(id, abs, mtime)| abs.map(|a| (id, a, mtime))).collect();
        if batch.is_empty() {
            // Either truly nothing left, or everything remaining is on an offline volume —
            // either way, spinning on the same unprocessable rows forever is wrong. The next
            // explicit scan (e.g. triggered by a volume remounting) picks these back up.
            break;
        }

        progress(ScanProgress { phase: "metadata".into(), done: result.read, total: result.read + batch.len(), current: String::new() });

        // The EXIF reads themselves are the expensive part (a RAW's metadata read is real I/O)
        // — parallelize those, then commit as one transaction so the DB is never touched from
        // more than one thread at a time.
        let read: Vec<(i64, i64, crate::library::PhotoMeta)> = batch
            .par_iter()
            .map(|(id, abs, mtime)| (*id, *mtime, crate::library::read_meta_public(abs)))
            .collect();

        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for (id, mtime, meta) in &read {
            let (captured, cap_y, cap_m, cap_d) = meta
                .date
                .as_deref()
                .and_then(parse_exif_datetime)
                .map(|(s, y, mo, d)| (Some(s), Some(y), Some(mo), Some(d)))
                .unwrap_or((None, None, None, None));
            let shutter_sec = meta.shutter.as_deref().and_then(shutter_to_sec);
            let aperture_f = meta.aperture.as_deref().and_then(leading_float);
            let focal_mm = meta.focal_len.as_deref().and_then(leading_float);
            tx.execute(
                "UPDATE photos SET
                    camera = ?1, make = ?2, model = ?3, lens = ?4, iso = ?5,
                    shutter = ?6, shutter_sec = ?7, aperture = ?8, aperture_f = ?9,
                    focal = ?10, focal_mm = ?11,
                    captured = ?12, cap_y = ?13, cap_m = ?14, cap_d = ?15,
                    meta_mtime = ?16
                 WHERE id = ?17",
                params![
                    meta.camera, meta.make, meta.model, meta.lens, meta.iso,
                    meta.shutter, shutter_sec, meta.aperture, aperture_f,
                    meta.focal_len, focal_mm,
                    captured, cap_y, cap_m, cap_d,
                    mtime, id,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        result.read += read.len();
    }
    progress(ScanProgress { phase: "done".into(), done: result.read, total: result.read, current: String::new() });
    Ok(result)
}

#[tauri::command]
pub fn catalog_scan(app: tauri::AppHandle, volume_id: Option<i64>, state: tauri::State<CatalogState>) -> Result<ScanResult, String> {
    use tauri::Emitter;
    state.cancel.store(false, Ordering::Relaxed);
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut emit = |p: ScanProgress| { let _ = app.emit("catalog-scan", p); };
    let result = scan_run(&conn, volume_id, &mut emit, &state.cancel)?;
    // Phase B chained automatically: one catalog_scan call from the frontend (fired from
    // openFolder's catalogRegisterFolder) gets a walked AND metadata-read catalog, with no
    // second round trip needed from JS.
    metadata_run(&conn, &mut emit, &state.cancel)?;
    Ok(result)
}

#[tauri::command]
pub fn catalog_scan_cancel(state: tauri::State<CatalogState>) {
    state.cancel.store(true, Ordering::Relaxed);
}

// ── Query ────────────────────────────────────────────────────────────────────────────────────

/// A superset of `library::DirEntry` — every field that struct has, plus catalog additions.
/// `catalog_query` is designed to drop straight into the frontend's `state.entries`, which is
/// what lets the existing grid (virtualization, selection, drag, sort) work completely
/// unchanged for a catalog view. See `catalog_entry_is_a_direntry_superset`.
#[derive(Serialize, Clone, Default)]
pub struct CatalogEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_image: bool,
    pub is_video: bool,
    pub kind: String,
    pub mtime: u64,
    pub size: u64,
    pub missing: bool,
    pub edited_ts: u64,
    // catalog additions
    pub id: i64,
    pub offline: bool,
    pub volume: String,
}

#[derive(Serialize, Default)]
pub struct CatalogPage {
    pub total: u64,
    pub capped: bool,
    pub entries: Vec<CatalogEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogQuery {
    pub kind: Option<String>,
    pub text: Option<String>,
    #[serde(default = "default_true")]
    pub include_offline: bool,
    pub limit: Option<u32>,
}
fn default_true() -> bool {
    true
}

// ⚠️ Hand-written, not `#[derive(Default)]`: a derived Default gives `include_offline: false`
// (bool's own default), which SILENTLY DISAGREES with `#[serde(default = "default_true")]` —
// that attribute only fires when a JSON field is missing during deserialize, never for
// `CatalogQuery::default()`. Two defaulting mechanisms that disagree is exactly the kind of
// thing that reads correct at a glance; caught here by a test using `::default()` and getting
// every entry silently filtered as if it were offline.
impl Default for CatalogQuery {
    fn default() -> Self {
        CatalogQuery { kind: None, text: None, include_offline: true, limit: None }
    }
}

const QUERY_LIMIT_CAP: u32 = 50_000;

#[tauri::command]
pub fn catalog_query(q: CatalogQuery, state: tauri::State<CatalogState>) -> Result<CatalogPage, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    query_run(&conn, q)
}

pub fn query_run(conn: &Connection, q: CatalogQuery) -> Result<CatalogPage, String> {
    let limit = q.limit.unwrap_or(QUERY_LIMIT_CAP).min(QUERY_LIMIT_CAP);

    // Bound parameters throughout — `kind`/`text` are frontend-supplied strings and string-
    // interpolating them into SQL would be a real injection surface even though today's only
    // caller is this app's own UI (CLAUDE.md's "avoid OWASP top 10" applies regardless of who
    // the current caller happens to be).
    // ⚠️ "offline" is NOT a SQL-expressible predicate — `v.last_path` is a `NOT NULL` column
    // that always holds SOME path; whether that path currently exists is a filesystem fact, not
    // a stored one. `include_offline: false` is therefore applied AFTER the row is built, below
    // (where `offline` is computed via `Path::is_dir()`), not in this WHERE clause.
    let mut where_parts = vec!["p.present = 1".to_string()];
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(k) = &q.kind {
        if k != "all" {
            where_parts.push(format!("p.kind = ?{}", values.len() + 1));
            values.push(Box::new(k.clone()));
        }
    }
    if let Some(t) = &q.text {
        if !t.is_empty() {
            where_parts.push(format!("p.name_lc LIKE ?{}", values.len() + 1));
            values.push(Box::new(format!("%{}%", t.to_lowercase())));
        }
    }
    let where_clause = where_parts.join(" AND ");
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();

    let total: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM photos p JOIN volumes v ON v.id = p.volume_id WHERE {where_clause}"),
            param_refs.as_slice(),
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    // `edited_ts` isn't tracked by the catalog yet (it's derived from the sidecar's own mtime,
    // same as library.rs's `edited_ts_of`, and lands with scan phase C) — select a literal 0
    // rather than a nonexistent column.
    let sql = format!(
        "SELECT p.id, p.name, p.rel_path, p.kind, p.mtime, p.size, 0,
                v.last_path, v.is_local, v.label
         FROM photos p JOIN volumes v ON v.id = p.volume_id
         WHERE {where_clause}
         ORDER BY p.captured DESC, p.mtime DESC
         LIMIT {limit}"
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut entries = stmt
        .query_map(param_refs.as_slice(), |r| {
            let id: i64 = r.get(0)?;
            let name: String = r.get(1)?;
            let rel_path: String = r.get(2)?;
            let kind: String = r.get(3)?;
            let mtime: i64 = r.get(4)?;
            let size: i64 = r.get(5)?;
            let last_path: String = r.get(7)?;
            let is_local: i64 = r.get(8)?;
            let label: String = r.get(9)?;
            let online = is_local != 0 || Path::new(&last_path).is_dir();
            Ok(CatalogEntry {
                name,
                path: abs_path(&last_path, is_local != 0, &rel_path),
                is_dir: false,
                is_image: kind != "video",
                is_video: kind == "video",
                kind,
                mtime: mtime as u64,
                size: size as u64,
                missing: false,
                edited_ts: 0,
                id,
                offline: !online,
                volume: label,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    if !q.include_offline {
        // A page-level filter, not a query-level one: `total`/`capped` still describe the SQL
        // result before this, which slightly overstates the true count when offline entries
        // exist. Acceptable at this stage — this module doesn't yet track a volume's online
        // state IN the database (that lands with the mount-poll work), so there is no cheap
        // SQL-side way to exclude it up front without a per-row filesystem stat inside COUNT(*).
        entries.retain(|e| !e.offline);
    }
    Ok(CatalogPage { total: total as u64, capped: total as u64 > limit as u64, entries })
}

#[tauri::command]
pub fn catalog_counts(state: tauri::State<CatalogState>) -> Result<std::collections::HashMap<String, u64>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut m = std::collections::HashMap::new();
    let all: i64 = conn.query_row("SELECT COUNT(*) FROM photos WHERE present = 1", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    m.insert("all".to_string(), all as u64);
    Ok(m)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db() -> Connection {
        let dir = std::env::temp_dir().join(format!("cs_catalog_{}_{}", std::process::id(), gen_id()));
        std::fs::create_dir_all(&dir).unwrap();
        open_and_migrate(&dir.join("catalog.db")).expect("open_and_migrate")
    }

    fn scratch_photos_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cs_catalog_photos_{}_{}", std::process::id(), tag));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The frontend contract, mechanically enforced: every field `library::DirEntry` has, a
    /// `CatalogEntry` must also have (by JSON key), so catalog rows drop straight into
    /// `state.entries` and the existing grid — virtualization, selection, drag, sort — works
    /// completely unchanged for a catalog view.
    #[test]
    fn catalog_entry_is_a_direntry_superset() {
        let dir_entry = crate::library::DirEntry {
            name: "x".into(), path: "/x".into(), is_dir: false, is_image: true, is_video: false,
            kind: "jpeg", mtime: 0, size: 0, missing: false, edited_ts: 0,
        };
        let dir_json = serde_json::to_value(&dir_entry).unwrap();
        let dir_keys: Vec<&String> = dir_json.as_object().unwrap().keys().collect();

        let cat_json = serde_json::to_value(CatalogEntry::default()).unwrap();
        let cat_obj = cat_json.as_object().unwrap();
        for k in dir_keys {
            assert!(cat_obj.contains_key(k), "CatalogEntry is missing DirEntry field '{k}' — the frontend grid reads it");
        }
    }

    #[test]
    fn schema_migrates_and_is_idempotent() {
        let conn = temp_db();
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, SCHEMA_VERSION);

        conn.execute(
            "INSERT INTO volumes (uuid, label, last_path, is_local, last_seen) VALUES ('local','This Mac','/', 1, 0)",
            [],
        )
        .unwrap();

        // Running migrate() again must be a no-op: same version, row untouched.
        migrate(&conn).unwrap();
        let version2: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version2, SCHEMA_VERSION);
        let label: String = conn.query_row("SELECT label FROM volumes WHERE uuid='local'", [], |r| r.get(0)).unwrap();
        assert_eq!(label, "This Mac", "a second migrate() must not disturb existing data");
    }

    /// A remount at a different mount path (macOS appending " 1" to a stale mount point is the
    /// real-world trigger) must not change a photo's `id`, only the absolute path it resolves
    /// to — this is what lets `set_sidecar`/`get_thumbnail`/etc. keep working with zero
    /// knowledge that a volume table exists. Exercises the same `ON CONFLICT(uuid) DO UPDATE`
    /// upsert `upsert_volume` uses, without needing a real second mount to test against.
    #[test]
    fn paths_survive_a_remount_at_a_different_mount_point() {
        let conn = temp_db();
        let upsert = |last_path: &str| {
            conn.execute(
                "INSERT INTO volumes (uuid, label, last_path, is_local, last_seen) VALUES ('ext-1','Archive', ?1, 0, 0)
                 ON CONFLICT(uuid) DO UPDATE SET last_path = excluded.last_path",
                params![last_path],
            )
            .unwrap();
        };
        upsert("/Volumes/Archive");
        let id1: i64 = conn.query_row("SELECT id FROM volumes WHERE uuid='ext-1'", [], |r| r.get(0)).unwrap();
        conn.execute(
            "INSERT INTO photos (volume_id, rel_path, rel_dir, name, name_lc, ext, kind, size, mtime, added)
             VALUES (?1, 'a.jpg', '', 'a.jpg', 'a.jpg', 'jpg', 'jpeg', 10, 0, 0)",
            params![id1],
        )
        .unwrap();

        let page1 = query_run(&conn, CatalogQuery::default()).unwrap();
        assert_eq!(page1.entries[0].path, "/Volumes/Archive/a.jpg");

        // The remount: same uuid, new mount path.
        upsert("/Volumes/Archive 1");
        let id2: i64 = conn.query_row("SELECT id FROM volumes WHERE uuid='ext-1'", [], |r| r.get(0)).unwrap();
        assert_eq!(id1, id2, "remounting must not create a second volume row");

        let page2 = query_run(&conn, CatalogQuery::default()).unwrap();
        assert_eq!(page2.entries[0].path, "/Volumes/Archive 1/a.jpg", "path must reflect the NEW mount point");
        assert_eq!(page2.entries[0].id, page1.entries[0].id, "the photo's own id must be unchanged by a remount");
    }

    /// UPDATE, never DELETE: a file that vanishes from disk is marked `present = 0` so it drops
    /// out of query results, but the row (and anything rated/tagged on it in later commits)
    /// survives for when it reappears — a temporarily moved or ejected-mid-copy file must not
    /// look like it never existed.
    #[test]
    fn a_deleted_file_is_marked_absent_not_dropped() {
        let conn = temp_db();
        let dir = scratch_photos_dir("del");
        std::fs::write(dir.join("a.jpg"), b"x").unwrap();
        std::fs::write(dir.join("b.jpg"), b"y").unwrap();

        let root = add_root_run(&conn, &dir.to_string_lossy(), None).unwrap();
        let cancel = AtomicBool::new(false);
        let r1 = scan_run(&conn, Some(root.volume_id), &mut |_| {}, &cancel).unwrap();
        assert_eq!(r1.added, 2);

        // Simulate a pre-existing rating surviving the delete (ratings land in a later commit —
        // this proves the ROW survives, which is the precondition that makes that possible).
        conn.execute("UPDATE photos SET rating = 4 WHERE name = 'a.jpg'", []).unwrap();

        std::fs::remove_file(dir.join("a.jpg")).unwrap();
        let r2 = scan_run(&conn, Some(root.volume_id), &mut |_| {}, &cancel).unwrap();
        assert_eq!(r2.marked_absent, 1);

        let (present, rating): (i64, i64) = conn
            .query_row("SELECT present, rating FROM photos WHERE name = 'a.jpg'", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(present, 0, "a deleted file must be marked absent");
        assert_eq!(rating, 4, "and its rating must survive the deletion — the row is never dropped");

        let page = query_run(&conn, CatalogQuery::default()).unwrap();
        assert_eq!(page.entries.len(), 1, "an absent file must not appear in query results");
        assert_eq!(page.entries[0].name, "b.jpg");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// The distinction the offline-browsing feature depends on: `present = 1` rows on a volume
    /// whose last-known mount path no longer exists must still be RETURNED (not silently
    /// dropped, the way `missing` is), just flagged `offline: true`. This is the exact one-line
    /// guard the frontend needs: `if (entry.missing && !entry.offline) return false`.
    #[test]
    fn an_unplugged_volume_yields_offline_not_missing() {
        let conn = temp_db();
        conn.execute(
            "INSERT INTO volumes (uuid, label, last_path, is_local, last_seen)
             VALUES ('ext-gone', 'Old LaCie', '/Volumes/DoesNotExist12345', 0, 0)",
            [],
        )
        .unwrap();
        let vid: i64 = conn.query_row("SELECT id FROM volumes WHERE uuid='ext-gone'", [], |r| r.get(0)).unwrap();
        conn.execute(
            "INSERT INTO photos (volume_id, rel_path, rel_dir, name, name_lc, ext, kind, size, mtime, added, present)
             VALUES (?1, 'p.jpg', '', 'p.jpg', 'p.jpg', 'jpg', 'jpeg', 10, 0, 0, 1)",
            params![vid],
        )
        .unwrap();

        let page = query_run(&conn, CatalogQuery { include_offline: true, ..Default::default() }).unwrap();
        assert_eq!(page.entries.len(), 1, "a present photo on an unplugged volume must still be returned");
        assert!(page.entries[0].offline, "it must be flagged offline");

        let page_excl = query_run(&conn, CatalogQuery { include_offline: false, ..Default::default() }).unwrap();
        assert!(page_excl.entries.is_empty(), "include_offline:false must exclude it");
    }

    /// A re-scan of an unchanged tree must report zero adds and zero deletions — the case that
    /// matters for a large archive, where "did anything change" has to be cheap to answer
    /// repeatedly (app launch, volume remount, folder open).
    #[test]
    fn a_second_scan_of_an_unchanged_tree_reports_zero_changes() {
        let conn = temp_db();
        let dir = scratch_photos_dir("unchanged");
        std::fs::write(dir.join("a.jpg"), b"x").unwrap();
        std::fs::write(dir.join("b.RW2"), b"y").unwrap();

        let root = add_root_run(&conn, &dir.to_string_lossy(), None).unwrap();
        let cancel = AtomicBool::new(false);
        let r1 = scan_run(&conn, Some(root.volume_id), &mut |_| {}, &cancel).unwrap();
        assert_eq!(r1.added, 2);
        assert_eq!(r1.marked_absent, 0);

        let r2 = scan_run(&conn, Some(root.volume_id), &mut |_| {}, &cancel).unwrap();
        assert_eq!(r2.added, 0, "nothing new — a re-scan must not re-add existing rows");
        assert_eq!(r2.marked_absent, 0, "nothing deleted — an unchanged tree must not lose any file");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// `catalog_add_root` records where the root lives relative to its volume, and rejects a
    /// path that isn't a real directory rather than silently accepting garbage that would just
    /// scan nothing forever.
    #[test]
    fn add_root_rejects_a_nonexistent_path() {
        let conn = temp_db();
        let res = add_root_run(&conn, "/definitely/not/a/real/path/xyz", None);
        assert!(res.is_err());
    }

    /// `days_from_civil` (embedded in `parse_exif_datetime`) is the exact inverse of ingest.rs's
    /// `civil_from_days` — cross-checked against the same known dates that test pins, including
    /// the leap-day case an off-by-one in the era math lands on.
    #[test]
    fn parse_exif_datetime_is_exact() {
        assert_eq!(parse_exif_datetime("1970:01:01 00:00:00").unwrap(), (0, 1970, 1, 1));
        assert_eq!(parse_exif_datetime("2024:08:15 00:00:00").unwrap().0, 19_950 * 86_400);
        assert_eq!(parse_exif_datetime("2026:08:15 00:00:00").unwrap().0, 20_680 * 86_400);
        // A leap day, cross-checked the same way ingest.rs's own test is.
        let (secs, y, m, d) = parse_exif_datetime("2024:02:29 12:30:45").unwrap();
        assert_eq!((y, m, d), (2024, 2, 29));
        assert_eq!(secs, 19_782 * 86_400 + 12 * 3600 + 30 * 60 + 45);
        assert!(parse_exif_datetime("garbage").is_none());
        assert!(parse_exif_datetime("2024:13:01 00:00:00").is_none(), "month 13 must be rejected, not silently wrapped");
    }

    /// Pins the exact transform `sortKeyOf` (library-ui.js) applies to a shutter string, so a
    /// future SQL `ORDER BY shutter_sec` reproduces the same order the grid already sorts by —
    /// whatever that order is, this only has to MATCH it, not judge it. Verified against the
    /// formula directly: negating 1/N means a smaller N (a slower shutter, "1/60") produces a
    /// more negative value than a larger N ("1/8000"), so slower shutters sort first ascending.
    #[test]
    fn shutter_to_sec_matches_the_frontend_sort_key() {
        assert_eq!(shutter_to_sec("1/250"), Some(-1.0 / 250.0));
        assert_eq!(shutter_to_sec("1/8000"), Some(-1.0 / 8000.0));
        assert!(shutter_to_sec("1/60").unwrap() < shutter_to_sec("1/8000").unwrap(), "matches sortKeyOf's -1/N: a slower shutter (smaller N) is more negative, so it sorts first ascending");
        assert_eq!(shutter_to_sec("2.5s"), Some(2.5));
        assert_eq!(shutter_to_sec(""), None);
    }

    /// The end-to-end path against a REAL photo, if one exists in the checkout (skipped
    /// cleanly otherwise) — the unit tests above each cover one helper; this is the one that
    /// catches them composing wrongly. Also proves resumability: a second call with nothing
    /// changed must read zero additional files.
    #[test]
    fn metadata_run_reads_real_exif_and_is_resumable() {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../geneva");
        let Some(sample) = std::fs::read_dir(&repo).ok().and_then(|rd| {
            rd.flatten().map(|e| e.path()).find(|p| matches!(p.extension().and_then(|e| e.to_str()), Some("jpg") | Some("JPG")))
        }) else {
            eprintln!("skipping: no geneva/ jpg present in this checkout");
            return;
        };

        let conn = temp_db();
        let dir = scratch_photos_dir("meta");
        let dest = dir.join(sample.file_name().unwrap());
        std::fs::copy(&sample, &dest).unwrap();

        let root = add_root_run(&conn, &dir.to_string_lossy(), None).unwrap();
        let cancel = AtomicBool::new(false);
        scan_run(&conn, Some(root.volume_id), &mut |_| {}, &cancel).unwrap();

        let r1 = metadata_run(&conn, &mut |_| {}, &cancel).unwrap();
        assert_eq!(r1.read, 1);

        let (camera, captured): (Option<String>, Option<i64>) = conn
            .query_row("SELECT camera, captured FROM photos WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert!(camera.is_some(), "a real photo's EXIF camera must be read");
        assert!(captured.is_some(), "a real photo's capture date must be parsed into `captured`");

        let r2 = metadata_run(&conn, &mut |_| {}, &cancel).unwrap();
        assert_eq!(r2.read, 0, "nothing changed — a second pass must not re-read anything");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// The infinite-loop guard, proven directly: a photo whose volume is offline must not send
    /// `metadata_run` into a spin re-selecting the same unprocessable row forever. If the guard
    /// regressed, this test would hang rather than fail — which is exactly why it exists.
    #[test]
    fn metadata_run_terminates_when_only_offline_rows_remain() {
        let conn = temp_db();
        conn.execute(
            "INSERT INTO volumes (uuid, label, last_path, is_local, last_seen)
             VALUES ('ext-gone-meta', 'Old LaCie', '/Volumes/DoesNotExist98765', 0, 0)",
            [],
        )
        .unwrap();
        let vid: i64 = conn.query_row("SELECT id FROM volumes WHERE uuid='ext-gone-meta'", [], |r| r.get(0)).unwrap();
        conn.execute(
            "INSERT INTO photos (volume_id, rel_path, rel_dir, name, name_lc, ext, kind, size, mtime, added, present)
             VALUES (?1, 'p.jpg', '', 'p.jpg', 'p.jpg', 'jpg', 'jpeg', 10, 5, 0, 1)",
            params![vid],
        )
        .unwrap();

        let cancel = AtomicBool::new(false);
        let result = metadata_run(&conn, &mut |_| {}, &cancel).unwrap();
        assert_eq!(result.read, 0, "an offline volume's photo must be skipped, not processed with empty metadata");

        let meta_mtime: Option<i64> = conn.query_row("SELECT meta_mtime FROM photos WHERE id = 1", [], |r| r.get(0)).unwrap();
        assert!(meta_mtime.is_none(), "meta_mtime must stay unset so the row is retried once the volume returns");
    }
}
