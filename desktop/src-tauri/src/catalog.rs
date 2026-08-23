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
    /// ⚠️ Never panics, by construction — a catalog that fails to open must not fail the app.
    /// Three-step fallback, each strictly less likely than the last: open the real file; if
    /// that fails (corrupt), rename it aside and open a fresh one at the same path; if even
    /// THAT fails (Application Support unwritable, disk full — the disk-backed path is
    /// unusable for reasons a rename can't fix), fall back to an in-memory database, which
    /// gives the app a working catalog for this session — All Photos, ratings, everything —
    /// it just won't persist to the next launch. The original version's last resort was
    /// `.expect(...)`, which is exactly the "never a startup failure" invariant this exists to
    /// guarantee, undone in the one case actually worth guarding against.
    pub fn new() -> Self {
        let conn = open_and_migrate(&catalog_db_path())
            .or_else(|e| {
                eprintln!("catalog: open failed ({e}), starting fresh");
                let bad = catalog_db_path();
                let aside = bad.with_extension(format!("corrupt-{}.db", now_secs()));
                let _ = std::fs::rename(&bad, &aside);
                open_and_migrate(&catalog_db_path())
            })
            .unwrap_or_else(|e| {
                eprintln!("catalog: fresh file open also failed ({e}), falling back to an in-memory catalog for this session");
                let conn = Connection::open_in_memory().expect("in-memory sqlite must open");
                migrate(&conn).expect("migrate an in-memory sqlite must succeed");
                conn
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
/// Howard Hinnant's `days_from_civil` — days since the Unix epoch for a given calendar date.
/// Shared by the EXIF parser below and the video capture-date parser (`video_capture_date`),
/// which is exactly why it's its own function rather than staying inlined in one caller: the
/// same exact-for-every-date math both need, written once.
fn days_from_civil(y: i64, mo: i64, d: i64) -> i64 {
    let y_adj = if mo <= 2 { y - 1 } else { y };
    let era = if y_adj >= 0 { y_adj } else { y_adj - 399 } / 400;
    let yoe = (y_adj - era * 400) as u64;
    let mp = if mo > 2 { mo - 3 } else { mo + 9 } as u64;
    let doy = (153 * mp + 2) / 5 + (d as u64) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe as i64 - 719_468
}

/// The inverse — civil date for a given days-since-epoch. Also Hinnant's algorithm, matching
/// ingest.rs's own `civil_from_days` (which returns a formatted string; this returns ints,
/// which is what a caller doing further date arithmetic — or writing to `cap_y`/`cap_m`/`cap_d`
/// — actually needs).
fn civil_from_days_ints(z: i64) -> (i32, i32, i32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as i32, d as i32)
}

fn parse_exif_datetime(raw: &str) -> Option<(i64, i32, i32, i32)> {
    if raw.len() < 19 {
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
    let days = days_from_civil(y, mo, d);
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

// ── Video capture date ──────────────────────────────────────────────────────────────────────
//
// `read_meta`/`PhotoMeta` (library.rs) has no video branch — clips get no capture date at all
// today, so scan_card falls back to filesystem mtime, which ingest.rs's own header warns
// against ("a card's mtimes are whatever the camera's clock and the copy program felt like").
// In a date-organised catalog that means every clip lands under "No date" or a wrong day right
// next to the photos from the same shoot, which sort correctly — the single most visible
// failure a date browser can have. Fixed by reading two ISOBMFF (MP4/MOV) sources, in priority
// order: `com.apple.quicktime.creationdate` (local time WITH UTC offset — correct), falling
// back to `mvhd.creation_time` (UTC only, and frequently absent/zero, hence second choice).
//
// ⚠️ Reads ONLY the `moov` box, via seek — never the whole file. `moov` is metadata (sample
// tables, not pixel data) and is typically KBs to a few MB even for a large video; loading a
// multi-GB clip into memory to read one timestamp would be exactly the kind of "works on my
// test file, OOMs on a real one" bug this avoids by construction.

use std::io::{Read, Seek, SeekFrom};

/// Reads one box header at the current file position. Returns (body_size, type, header_len).
/// `body_size == u64::MAX` means "extends to EOF" (a top-level size-0 box, rare but legal).
fn read_box_header(f: &mut std::fs::File) -> Option<(u64, [u8; 4], u64)> {
    let mut hdr = [0u8; 8];
    f.read_exact(&mut hdr).ok()?;
    let size32 = u32::from_be_bytes(hdr[0..4].try_into().ok()?);
    let typ: [u8; 4] = hdr[4..8].try_into().ok()?;
    if size32 == 1 {
        let mut ext = [0u8; 8];
        f.read_exact(&mut ext).ok()?;
        Some((u64::from_be_bytes(ext).saturating_sub(16), typ, 16))
    } else if size32 == 0 {
        Some((u64::MAX, typ, 8))
    } else {
        Some(((size32 as u64).saturating_sub(8), typ, 8))
    }
}

/// Walks top-level boxes looking for `moov`, reading only its body into memory. Bounded to
/// 10,000 top-level boxes (a real MP4 has a handful — ftyp/moov/mdat/free/...) so a malformed
/// or adversarial file can't hang this in a loop, and caps the body read at 64MB — a `moov`
/// that large isn't ordinary metadata and isn't worth trusting.
fn find_moov_bytes(path: &str) -> Option<Vec<u8>> {
    let mut f = std::fs::File::open(path).ok()?;
    let file_len = f.metadata().ok()?.len();
    let mut pos: u64 = 0;
    for _ in 0..10_000 {
        if pos + 8 > file_len {
            break;
        }
        f.seek(SeekFrom::Start(pos)).ok()?;
        let (body_size, typ, hdr_len) = read_box_header(&mut f)?;
        let body_size = if body_size == u64::MAX { file_len.saturating_sub(pos + hdr_len) } else { body_size };
        if &typ == b"moov" {
            if body_size == 0 || body_size > 64 * 1024 * 1024 {
                return None;
            }
            let mut buf = vec![0u8; body_size as usize];
            f.seek(SeekFrom::Start(pos + hdr_len)).ok()?;
            f.read_exact(&mut buf).ok()?;
            return Some(buf);
        }
        // ⚠️ NOT a `break` on body_size == 0. A zero-body top-level box is real and common —
        // QuickTime's own `wide` placeholder (an 8-byte "reserve room for a 64-bit mdat size
        // later" box, written by real Apple encoders right after `ftyp`) is exactly this, and
        // the first version of this function bailed out on it before ever reaching `moov`,
        // which sits AFTER `mdat` in this shape of file — found by testing against a real
        // clip, not a synthetic one. `pos` always advances by at least `hdr_len` (8 or 16)
        // regardless of body_size, so there is no infinite-loop risk here to guard against;
        // the `for _ in 0..10_000` bound above is what actually protects against a malformed
        // file, by capping total iterations rather than by special-casing this.
        pos += hdr_len + body_size;
    }
    None
}

/// Finds the first direct child box of type `want` within `data[start..end]`, returning its
/// body's (start, end) as absolute offsets into `data`. Bounded by `end` so a corrupt size
/// can't walk past the slice this was given.
fn find_child(data: &[u8], start: usize, end: usize, want: &[u8; 4]) -> Option<(usize, usize)> {
    let mut pos = start;
    while pos + 8 <= end {
        let size32 = u32::from_be_bytes(data.get(pos..pos + 4)?.try_into().ok()?);
        let typ: [u8; 4] = data.get(pos + 4..pos + 8)?.try_into().ok()?;
        let (body_start, box_end) = if size32 == 1 {
            let size64 = u64::from_be_bytes(data.get(pos + 8..pos + 16)?.try_into().ok()?);
            (pos + 16, pos + size64 as usize)
        } else if size32 == 0 {
            (pos + 8, end)
        } else {
            (pos + 8, pos + size32 as usize)
        };
        if box_end > end || box_end <= pos {
            break; // malformed size — stop rather than trust it
        }
        if &typ == want {
            return Some((body_start, box_end));
        }
        pos = box_end;
    }
    None
}

/// `moov/meta/keys` + `moov/meta/ilst` — QuickTime's "keyed" metadata scheme. `keys` maps a
/// namespaced string (here "com.apple.quicktime.creationdate") to a 1-based index; `ilst`
/// holds one child box PER index whose 4-byte "type" is that index encoded as a big-endian u32
/// (not ASCII) containing a `data` sub-box with the actual value.
///
/// ⚠️ Whether `meta`'s body starts with 4 bytes of version+flags before its children depends on
/// which convention wrote it, and this is NOT a detail to get from the spec alone — verified
/// against a real Apple-camera-written file (this project's own geneva/IMG_8015.MOV): its
/// `meta` box has NO leading version+flags, contrary to the ISO base media "FullBox" convention
/// video tooling elsewhere in this codebase might suggest. Some non-Apple encoders DO write the
/// ISO-standard form. Rather than assume either, try both offsets and use whichever actually
/// contains a `keys` box.
fn find_quicktime_creationdate(moov: &[u8]) -> Option<String> {
    let (meta_s, meta_e) = find_child(moov, 0, moov.len(), b"meta")?;
    let children_start = [meta_s, meta_s + 4]
        .into_iter()
        .find(|&c| c <= meta_e && find_child(moov, c, meta_e, b"keys").is_some())?;
    let (keys_s, keys_e) = find_child(moov, children_start, meta_e, b"keys")?;
    let (ilst_s, ilst_e) = find_child(moov, children_start, meta_e, b"ilst")?;

    if keys_e.saturating_sub(keys_s) < 8 {
        return None;
    }
    let entry_count = u32::from_be_bytes(moov.get(keys_s + 4..keys_s + 8)?.try_into().ok()?);
    let mut pos = keys_s + 8;
    let mut target_index = None;
    for i in 1..=entry_count {
        if pos + 8 > keys_e {
            break;
        }
        let key_size = u32::from_be_bytes(moov.get(pos..pos + 4)?.try_into().ok()?) as usize;
        if key_size < 8 || pos + key_size > keys_e {
            break;
        }
        let value = moov.get(pos + 8..pos + key_size)?;
        if value == b"com.apple.quicktime.creationdate" {
            target_index = Some(i);
            break;
        }
        pos += key_size;
    }
    let idx = target_index?;

    let item_type = idx.to_be_bytes();
    let (item_s, item_e) = find_child(moov, ilst_s, ilst_e, &item_type)?;
    let (data_s, data_e) = find_child(moov, item_s, item_e, b"data")?;
    if data_e.saturating_sub(data_s) < 8 {
        return None;
    }
    let payload = moov.get(data_s + 8..data_e)?;
    std::str::from_utf8(payload).ok().map(|s| s.trim_end_matches('\0').to_string())
}

/// "YYYY-MM-DDTHH:MM:SS±HH:MM" or "...Z" — QuickTime's creationdate format. The offset is what
/// makes this the PREFERRED source over `mvhd` below: it gives real local capture time, not UTC.
fn parse_iso8601_with_offset(s: &str) -> Option<(i64, i32, i32, i32)> {
    if s.len() < 19 {
        return None;
    }
    let y: i64 = s.get(0..4)?.parse().ok()?;
    let mo: i64 = s.get(5..7)?.parse().ok()?;
    let d: i64 = s.get(8..10)?.parse().ok()?;
    let h: i64 = s.get(11..13)?.parse().ok()?;
    let mi: i64 = s.get(14..16)?.parse().ok()?;
    let se: i64 = s.get(17..19)?.parse().ok()?;
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) {
        return None;
    }
    let offset_secs: i64 = if s.len() == 19 || s.as_bytes().get(19) == Some(&b'Z') {
        0
    } else if s.len() >= 25 {
        let sign = if s.as_bytes()[19] == b'-' { -1 } else { 1 };
        let oh: i64 = s.get(20..22)?.parse().ok()?;
        let om: i64 = s.get(23..25)?.parse().ok()?;
        sign * (oh * 3600 + om * 60)
    } else {
        0
    };
    let local_days = days_from_civil(y, mo, d);
    let utc_secs = local_days * 86_400 + h * 3600 + mi * 60 + se - offset_secs;
    // Report the LOCAL calendar date (what the camera's clock actually showed), matching
    // capture_date's own convention of reading wall-clock fields as-is — a video shot at
    // 11pm local time must not roll onto the next UTC day in the date browser.
    Some((utc_secs, y as i32, mo as i32, d as i32))
}

pub struct VideoDate {
    pub captured: i64,
    pub y: i32,
    pub m: i32,
    pub d: i32,
    /// "quicktime" | "mvhd" — which source answered, kept distinguishable rather than folded
    /// away, the same way a fallback-to-mtime date is worth knowing apart from a real EXIF one.
    pub source: &'static str,
}

pub fn video_capture_date(path: &str) -> Option<VideoDate> {
    let moov = find_moov_bytes(path)?;
    if let Some(iso) = find_quicktime_creationdate(&moov) {
        if let Some((secs, y, m, d)) = parse_iso8601_with_offset(&iso) {
            return Some(VideoDate { captured: secs, y, m, d, source: "quicktime" });
        }
    }
    let (mvhd_s, mvhd_e) = find_child(&moov, 0, moov.len(), b"mvhd")?;
    if mvhd_e.saturating_sub(mvhd_s) < 8 {
        return None;
    }
    let version = moov[mvhd_s];
    let mac_secs: i64 = if version == 1 {
        if mvhd_e - mvhd_s < 12 {
            return None;
        }
        i64::from_be_bytes(moov.get(mvhd_s + 4..mvhd_s + 12)?.try_into().ok()?)
    } else {
        u32::from_be_bytes(moov.get(mvhd_s + 4..mvhd_s + 8)?.try_into().ok()?) as i64
    };
    // QuickTime's mvhd epoch is 1904-01-01 UTC, not the Unix epoch — the classic bug in this
    // exact parser. Frequently written as 0 (absent) or garbage; both are worth rejecting
    // rather than reporting a bogus 1904-adjacent date.
    const MAC_TO_UNIX_EPOCH_OFFSET: i64 = 2_082_844_800;
    let unix_secs = mac_secs - MAC_TO_UNIX_EPOCH_OFFSET;
    if unix_secs <= 0 {
        return None;
    }
    let (y, m, d) = civil_from_days_ints(unix_secs.div_euclid(86_400));
    Some(VideoDate { captured: unix_secs, y, m, d, source: "mvhd" })
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
        // library::read_meta has no video branch — a video path gets PhotoMeta::default() back,
        // date included. video_capture_date is the video-specific fallback, gated by extension
        // so a photo never pays for the (harmless but pointless) attempt to box-walk a JPEG.
        let read: Vec<(i64, i64, crate::library::PhotoMeta, Option<VideoDate>)> = batch
            .par_iter()
            .map(|(id, abs, mtime)| {
                let ext = Path::new(abs).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                let video_date = if matches!(ext.as_str(), "mp4" | "mov" | "m4v") { video_capture_date(abs) } else { None };
                (*id, *mtime, crate::library::read_meta_public(abs), video_date)
            })
            .collect();

        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for (id, mtime, meta, video_date) in &read {
            let (captured, cap_y, cap_m, cap_d) = if let Some(vd) = video_date {
                (Some(vd.captured), Some(vd.y), Some(vd.m), Some(vd.d))
            } else {
                meta.date
                    .as_deref()
                    .and_then(parse_exif_datetime)
                    .map(|(s, y, mo, d)| (Some(s), Some(y), Some(mo), Some(d)))
                    .unwrap_or((None, None, None, None))
            };
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

// ── Scan phase C: sidecar contents ──────────────────────────────────────────────────────────
//
// ⚠️ The .xmp is the source of truth (this whole module's own top-of-file comment). This phase
// exists purely to make what's already in the sidecar QUERYABLE — it reads FROM the file into
// the catalog, never the other way. `set_sidecar` (library.rs) stays the only writer of XMP.

#[derive(Default)]
pub struct SidecarResult {
    pub read: usize,
}

/// Same shape as `metadata_run`: chunked, resumable (via `sidecar_mtime != sidecar_parsed_mtime`
/// — a photo whose sidecar hasn't changed since it was last parsed is skipped for free, and a
/// sidecar that was deleted naturally resets rating/label/edited/favorite to their defaults,
/// since `get_sidecar` on a missing file returns `Sidecar::default()`), and offline-safe for the
/// same reason phase B is: a row on an unmounted volume must not be marked "parsed" with
/// defaults it never actually read, or it would never be retried once the volume returns.
pub fn sidecar_run(
    conn: &Connection,
    progress: &mut dyn FnMut(ScanProgress),
    cancel: &AtomicBool,
) -> Result<SidecarResult, String> {
    let mut result = SidecarResult::default();
    loop {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let mut stmt = conn
            .prepare(
                "SELECT p.id, p.rel_path, p.sidecar_mtime, v.last_path, v.is_local
                 FROM photos p JOIN volumes v ON v.id = p.volume_id
                 WHERE p.present = 1 AND p.sidecar_mtime != p.sidecar_parsed_mtime
                 LIMIT 512",
            )
            .map_err(|e| e.to_string())?;
        let batch: Vec<(i64, Option<String>, i64)> = stmt
            .query_map([], |r| {
                let id: i64 = r.get(0)?;
                let rel_path: String = r.get(1)?;
                let sidecar_mtime: i64 = r.get(2)?;
                let last_path: String = r.get(3)?;
                let is_local: i64 = r.get(4)?;
                let online = is_local != 0 || Path::new(&last_path).is_dir();
                Ok((id, if online { Some(abs_path(&last_path, is_local != 0, &rel_path)) } else { None }, sidecar_mtime))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        drop(stmt);
        let batch: Vec<(i64, String, i64)> = batch.into_iter().filter_map(|(id, abs, sm)| abs.map(|a| (id, a, sm))).collect();
        if batch.is_empty() {
            break;
        }
        progress(ScanProgress { phase: "sidecar".into(), done: result.read, total: result.read + batch.len(), current: String::new() });

        let read: Vec<(i64, i64, crate::library::Sidecar)> = batch
            .par_iter()
            .map(|(id, abs, sidecar_mtime)| (*id, *sidecar_mtime, crate::library::get_sidecar(abs.clone())))
            .collect();

        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for (id, sidecar_mtime, sc) in &read {
            tx.execute(
                "UPDATE photos SET rating = ?1, label = ?2, edited = ?3, favorite = ?4, sidecar_parsed_mtime = ?5 WHERE id = ?6",
                params![sc.rating, sc.label, sc.edited as i64, sc.favorite as i64, sidecar_mtime, id],
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
    // Phases B and C chained automatically: one catalog_scan call from the frontend (fired from
    // openFolder's catalogRegisterFolder) gets a walked, metadata-read AND sidecar-synced
    // catalog, with no extra round trips from JS.
    //
    // ⚠️ Content hashing (phase E, below) is deliberately NOT chained here. Reading an EXIF
    // header or a small XMP file is cheap; hashing a whole RAW or video is a full-file read —
    // chaining it into the scan that fires on every ordinary folder-open would make routine
    // browsing noticeably slower on a large archive. It runs as its own explicit/background
    // pass (catalog_hash) instead.
    metadata_run(&conn, &mut emit, &state.cancel)?;
    sidecar_run(&conn, &mut emit, &state.cancel)?;
    Ok(result)
}

// ── Scan phase E: content-hash integrity ────────────────────────────────────────────────────
//
// The single most-requested photo-library feature that isn't duplicate/missing-file detection
// (per this project's own research into what other tools' users actually ask for): silent
// corruption — a file that is present and opens fine but has quietly bit-rotted. Lightroom
// warns about missing photos but never about corrupted-but-present ones.
//
// `hashed_at` stores the file's `mtime` AT THE TIME the hash was computed — same convention as
// `meta_mtime`/`sidecar_parsed_mtime` elsewhere in this schema — NOT a wall-clock timestamp
// despite the name (kept for schema-compat with the original design; the semantics are the
// resumability marker, exactly like its siblings). This is what lets `hash_run` double as
// "hash it for the first time" AND "the file legitimately changed since we last hashed it, so
// re-baseline" in one query, and what lets `verify_run` tell the two apart later.

#[derive(Serialize, Clone, Default)]
pub struct HashResult {
    pub hashed: usize,
}

fn blake3_hex(path: &str) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let mut hasher = blake3::Hasher::new();
    hasher.update_reader(file).ok()?;
    Some(hasher.finalize().to_hex().to_string())
}

/// Same chunked/resumable/offline-safe shape as metadata_run and sidecar_run. Resumable via
/// `content_hash IS NULL OR hashed_at != mtime` — a photo hashed once and never modified since
/// costs nothing on a re-run; one whose mtime changed (a legitimate edit) gets re-baselined
/// rather than left pointing at a hash of its old content.
pub fn hash_run(conn: &Connection, progress: &mut dyn FnMut(ScanProgress), cancel: &AtomicBool) -> Result<HashResult, String> {
    let mut result = HashResult::default();
    loop {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let mut stmt = conn
            .prepare(
                "SELECT p.id, p.rel_path, p.mtime, v.last_path, v.is_local
                 FROM photos p JOIN volumes v ON v.id = p.volume_id
                 WHERE p.present = 1 AND (p.content_hash IS NULL OR p.hashed_at != p.mtime)
                 LIMIT 64", // smaller batch than metadata/sidecar — each unit of work is a full-file read
            )
            .map_err(|e| e.to_string())?;
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
            break;
        }
        progress(ScanProgress { phase: "hash".into(), done: result.hashed, total: result.hashed + batch.len(), current: String::new() });

        let hashed: Vec<(i64, i64, Option<String>)> = batch
            .par_iter()
            .map(|(id, abs, mtime)| (*id, *mtime, blake3_hex(abs)))
            .collect();

        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for (id, mtime, hash) in &hashed {
            let Some(hash) = hash else { continue }; // unreadable right now — leave unhashed, retried next pass
            tx.execute("UPDATE photos SET content_hash = ?1, hashed_at = ?2 WHERE id = ?3", params![hash, mtime, id])
                .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        result.hashed += hashed.iter().filter(|(_, _, h)| h.is_some()).count();
    }
    progress(ScanProgress { phase: "done".into(), done: result.hashed, total: result.hashed, current: String::new() });
    Ok(result)
}

#[tauri::command]
pub fn catalog_hash(app: tauri::AppHandle, state: tauri::State<CatalogState>) -> Result<HashResult, String> {
    use tauri::Emitter;
    state.cancel.store(false, Ordering::Relaxed);
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    hash_run(&conn, &mut |p| { let _ = app.emit("catalog-scan", p); }, &state.cancel)
}

#[derive(Serialize, Clone)]
pub struct VerifyEntry {
    pub id: i64,
    pub name: String,
    pub path: String,
}

#[derive(Serialize, Default)]
pub struct VerifyResult {
    pub checked: usize,
    pub ok: usize,
    /// Content changed AND mtime changed since the stored baseline — an ordinary edit
    /// (re-export, overwrite), not corruption. Re-baselined automatically (same as hash_run).
    pub changed: usize,
    /// Content changed but mtime did NOT — the file was modified without its mtime updating,
    /// which is the anomaly silent corruption actually looks like. THE list a user needs to see.
    pub corrupt: Vec<VerifyEntry>,
}

/// Re-reads and re-hashes every already-hashed, present photo RIGHT NOW and compares against
/// the stored baseline — this is the explicit "Verify" action, distinct from hash_run (which
/// only establishes a baseline for photos that don't have one yet). The whole point of a
/// verify sweep is doing the expensive re-read even when nothing else has asked for it.
pub fn verify_run(conn: &Connection, progress: &mut dyn FnMut(ScanProgress), cancel: &AtomicBool) -> Result<VerifyResult, String> {
    let mut result = VerifyResult::default();
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.name, p.rel_path, p.mtime, p.hashed_at, p.content_hash, v.last_path, v.is_local
             FROM photos p JOIN volumes v ON v.id = p.volume_id
             WHERE p.present = 1 AND p.content_hash IS NOT NULL",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(i64, String, String, i64, i64, String, String, bool)> = stmt
        .query_map([], |r| {
            let is_local: i64 = r.get(7)?;
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, is_local != 0))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    let total = rows.len();
    for (i, (id, name, rel_path, stored_mtime, hashed_at, stored_hash, last_path, is_local)) in rows.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        if i % 32 == 0 {
            progress(ScanProgress { phase: "verify".into(), done: i, total, current: name.clone() });
        }
        if !is_local && !Path::new(last_path).is_dir() {
            continue; // offline — can't verify what isn't reachable, and mustn't report it as corrupt
        }
        let abs = abs_path(last_path, *is_local, rel_path);
        let Ok(current_meta) = std::fs::metadata(&abs) else { continue }; // gone since present was set — a rescan will catch it
        let current_mtime = current_meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(*stored_mtime);
        let Some(fresh_hash) = blake3_hex(&abs) else { continue };

        if &fresh_hash == stored_hash {
            result.ok += 1;
            continue;
        }
        if current_mtime == *hashed_at {
            // Content differs, mtime does not — this is what corruption looks like.
            result.corrupt.push(VerifyEntry { id: *id, name: name.clone(), path: abs });
        } else {
            // A legitimate edit hash_run hasn't caught up to yet — re-baseline now rather than
            // waiting for the next scan, and don't report it as a problem.
            let _ = conn.execute(
                "UPDATE photos SET content_hash = ?1, hashed_at = ?2 WHERE id = ?3",
                params![fresh_hash, current_mtime, id],
            );
            result.changed += 1;
        }
    }
    result.checked = total;
    let now = now_secs() as i64;
    let _ = conn.execute(
        "UPDATE photos SET verified_at = ?1 WHERE present = 1 AND content_hash IS NOT NULL",
        params![now],
    );
    progress(ScanProgress { phase: "done".into(), done: total, total, current: String::new() });
    Ok(result)
}

#[tauri::command]
pub fn catalog_verify(app: tauri::AppHandle, state: tauri::State<CatalogState>) -> Result<VerifyResult, String> {
    use tauri::Emitter;
    state.cancel.store(false, Ordering::Relaxed);
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    verify_run(&conn, &mut |p| { let _ = app.emit("catalog-scan", p); }, &state.cancel)
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
    /// Date-browser scoping. `year` alone = that whole year; `year`+`month` = that month;
    /// all three = one day. `month`/`day` without `year` are ignored (not a valid scope).
    /// ⚠️ `#[serde(default)]` on all three: an older/simpler frontend payload (or a test) that
    /// omits these keys entirely must still deserialize — `Option<T>` does NOT auto-default to
    /// `None` for an absent JSON key, only for an explicit `null`, unless told to.
    #[serde(default)]
    pub year: Option<i32>,
    #[serde(default)]
    pub month: Option<i32>,
    #[serde(default)]
    pub day: Option<i32>,
    /// The date browser's "No date" bucket — mutually exclusive with year/month/day, checked
    /// first below.
    #[serde(default)]
    pub no_date: bool,
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
        CatalogQuery { kind: None, text: None, include_offline: true, limit: None, year: None, month: None, day: None, no_date: false }
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
    // Date-browser scope. `month`/`day` are meaningless without `year` (there's no "every
    // March" cross-year view in this design), so they're only applied once year is set.
    if q.no_date {
        where_parts.push("(p.cap_y IS NULL OR p.cap_m IS NULL OR p.cap_d IS NULL)".to_string());
    } else if let Some(y) = q.year {
        where_parts.push(format!("p.cap_y = ?{}", values.len() + 1));
        values.push(Box::new(y));
        if let Some(m) = q.month {
            where_parts.push(format!("p.cap_m = ?{}", values.len() + 1));
            values.push(Box::new(m));
            if let Some(d) = q.day {
                where_parts.push(format!("p.cap_d = ?{}", values.len() + 1));
                values.push(Box::new(d));
            }
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

// ── Date browser ─────────────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct DayCount {
    pub y: i32,
    pub m: i32,
    pub d: i32,
    pub n: u64,
}

#[derive(Serialize)]
pub struct DateCounts {
    /// Flat (year, month, day, count) rows — one per day that has at least one present photo.
    /// The frontend nests these into a Year › Month › Day tree client-side; a flat list plus
    /// one query is what lets the WHOLE tree fill in with counts at every level in a single
    /// round trip, no lazy per-node loading needed even at 15 years of history.
    pub days: Vec<DayCount>,
    /// Photos with no readable capture date — its own bucket rather than folded into a wrong
    /// day, matching the same "don't guess a date" rule `ingest.rs`'s own capture_date follows.
    pub no_date: u64,
}

#[tauri::command]
pub fn catalog_date_counts(state: tauri::State<CatalogState>) -> Result<DateCounts, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    date_counts_run(&conn)
}

pub fn date_counts_run(conn: &Connection) -> Result<DateCounts, String> {
    let mut stmt = conn
        .prepare(
            "SELECT cap_y, cap_m, cap_d, COUNT(*) FROM photos
             WHERE present = 1 AND cap_y IS NOT NULL AND cap_m IS NOT NULL AND cap_d IS NOT NULL
             GROUP BY cap_y, cap_m, cap_d
             ORDER BY cap_y DESC, cap_m DESC, cap_d DESC",
        )
        .map_err(|e| e.to_string())?;
    let days = stmt
        .query_map([], |r| {
            Ok(DayCount { y: r.get(0)?, m: r.get(1)?, d: r.get(2)?, n: r.get::<_, i64>(3)? as u64 })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);
    let no_date: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM photos WHERE present = 1 AND (cap_y IS NULL OR cap_m IS NULL OR cap_d IS NULL)",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(DateCounts { days, no_date: no_date as u64 })
}

// ── Rebuild ──────────────────────────────────────────────────────────────────────────────────
//
// The property that makes this whole SQLite dependency safe to have taken on: the catalog is a
// derived index of disk + XMP, and a rebuild is a rescan away from being exactly right again —
// never data loss the way a corrupt sidecar would be. This is the explicit, user-triggered
// version of that guarantee (the automatic version lives in `CatalogState::new`, which already
// renames a corrupt file aside and starts fresh); this one wipes everything on purpose and
// proves ratings/labels/favorites survive because they were never really stored HERE, only
// mirrored from the files that actually hold them.
//
// ⚠️ `photos.id` is NOT preserved across a rebuild — every row is genuinely new. That is fine
// FOR THIS OPERATION SPECIFICALLY (a rare, explicit, user-initiated reset) and is exactly why
// the "ids must never be reassigned" rule elsewhere in this file is scoped to ordinary
// migrations, not this one: a migration runs silently and often, so an id change there would
// orphan the offline-thumbnail tier without the user ever knowing; a rebuild is a deliberate
// action whose whole point is starting over.

#[tauri::command]
pub fn catalog_rebuild(app: tauri::AppHandle, state: tauri::State<CatalogState>) -> Result<ScanResult, String> {
    use tauri::Emitter;
    state.cancel.store(false, Ordering::Relaxed);
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    rebuild_run(&conn, &mut |p| { let _ = app.emit("catalog-scan", p); }, &state.cancel)
}

pub fn rebuild_run(conn: &Connection, progress: &mut dyn FnMut(ScanProgress), cancel: &AtomicBool) -> Result<ScanResult, String> {
    // Capture every root's absolute path + kind BEFORE wiping (volumes/roots are about to be
    // deleted too — this is what we re-derive from, since there is nothing else to derive it
    // from once the tables are empty).
    let mut stmt = conn
        .prepare("SELECT v.last_path, v.is_local, r.rel_path, r.kind FROM roots r JOIN volumes v ON v.id = r.volume_id")
        .map_err(|e| e.to_string())?;
    let roots: Vec<(String, i64, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);
    let root_abs_paths: Vec<(String, String)> = roots
        .iter()
        .map(|(last_path, is_local, rel_path, kind)| (abs_path(last_path, *is_local != 0, rel_path), kind.clone()))
        .collect();

    conn.execute_batch(
        "DELETE FROM photo_keywords; DELETE FROM keywords; DELETE FROM photos; DELETE FROM roots; DELETE FROM volumes;",
    )
    .map_err(|e| e.to_string())?;

    let mut result = ScanResult::default();
    for (abs, kind) in root_abs_paths {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let Ok(root) = add_root_run(conn, &abs, Some(kind)) else { continue }; // a root that vanished since — skip, don't fail the whole rebuild
        let r = scan_run(conn, Some(root.volume_id), progress, cancel)?;
        result.scanned += r.scanned;
        result.added += r.added;
        metadata_run(conn, progress, cancel)?;
        sidecar_run(conn, progress, cancel)?;
    }
    Ok(result)
}

// ── Delete ───────────────────────────────────────────────────────────────────────────────────
//
// The mechanism (moving the file + its sidecar to ~/.Trash) already exists — library.rs's
// `trash_file` — and already works from the Library context menu. What's missing is the catalog
// side: a trashed photo must stop appearing in a catalog view IMMEDIATELY, not wait for the next
// scan to notice it's gone. This is the same `UPDATE present = 0, never DELETE` rule scan phase
// A already follows — a photo's rating/keywords must survive a delete exactly as they survive a
// temporarily-moved file, since ~/.Trash is recoverable.

/// Resolves an absolute path back to (photo_id, volume_id) by checking it against every known
/// volume's current mount point, longest prefix first — the local volume's own prefix ("/") is
/// a prefix of EVERY absolute path, so it has to be tried last or it would "match" everything
/// before a real external-volume prefix ever gets a chance.
fn find_photo_by_abs_path(conn: &Connection, path: &str) -> Option<i64> {
    let mut stmt = conn.prepare("SELECT id, last_path, is_local FROM volumes").ok()?;
    let mut volumes: Vec<(i64, String, bool)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, i64>(2)? != 0)))
        .ok()?
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    drop(stmt);
    volumes.sort_by_key(|(_, last_path, is_local)| std::cmp::Reverse(if *is_local { 1 } else { last_path.len() }));

    for (vid, last_path, is_local) in &volumes {
        let prefix = if *is_local { "/".to_string() } else { format!("{last_path}/") };
        let Some(rel) = path.strip_prefix(&prefix) else { continue };
        if let Ok(id) = conn.query_row(
            "SELECT id FROM photos WHERE volume_id = ?1 AND rel_path = ?2",
            params![vid, rel],
            |r| r.get(0),
        ) {
            return Some(id);
        }
    }
    None
}

pub fn note_deleted_run(conn: &Connection, paths: &[String]) -> Result<usize, String> {
    let mut updated = 0;
    for p in paths {
        if let Some(id) = find_photo_by_abs_path(conn, p) {
            updated += conn
                .execute("UPDATE photos SET present = 0 WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;
        }
        // A path not found in the catalog is not an error — it may be a photo the catalog never
        // indexed (a folder never opened, or a scan that hasn't reached it yet). Nothing to do.
    }
    Ok(updated)
}

/// Called right after `trash_file` succeeds for a batch of paths — best-effort from the
/// frontend's own delete flow, mirroring `note_sidecar`'s posture: the real, recoverable action
/// (moving the file to Trash) has already happened by the time this runs, so a failure here
/// only means a stale catalog row until the next scan, never a lost file.
#[tauri::command]
pub fn catalog_note_deleted(paths: Vec<String>, state: tauri::State<CatalogState>) -> Result<usize, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    note_deleted_run(&conn, &paths)
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

    /// Sets a file's mtime directly — needed to simulate real bit rot (content changes, mtime
    /// does not), which `std::fs::write` alone can't produce since writing always bumps mtime
    /// to "now". `libc::utimes` rather than a new dependency: `libc` is already real here (see
    /// this file's own statfs use, mirroring ingest.rs's).
    fn set_mtime_for_test(path: &Path, unix_secs: i64) {
        use std::ffi::CString;
        let cpath = CString::new(path.to_str().unwrap()).unwrap();
        let tv = libc::timeval { tv_sec: unix_secs as libc::time_t, tv_usec: 0 };
        let times = [tv, tv];
        unsafe {
            libc::utimes(cpath.as_ptr(), times.as_ptr());
        }
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

    /// The real end-to-end path: `set_sidecar` (library.rs, the app's ONE sidecar writer)
    /// writes a real .xmp, and `sidecar_run` must read it back into the catalog row correctly.
    #[test]
    fn sidecar_run_syncs_rating_label_edited_favorite() {
        let conn = temp_db();
        let dir = scratch_photos_dir("sidecar");
        std::fs::write(dir.join("a.jpg"), b"x").unwrap();
        let photo_path = dir.join("a.jpg").to_string_lossy().into_owned();

        let root = add_root_run(&conn, &dir.to_string_lossy(), None).unwrap();
        let cancel = AtomicBool::new(false);
        scan_run(&conn, Some(root.volume_id), &mut |_| {}, &cancel).unwrap();

        crate::library::set_sidecar(photo_path.clone(), 4, "Green".into(), true, None, Some(true)).unwrap();
        // The sidecar now exists on disk with a real mtime, but the DB row's own sidecar_mtime
        // is still whatever the scan above saw (0, since the sidecar didn't exist yet) — a
        // rescan is what notices the sidecar appeared, exactly like a real edit-then-reopen.
        scan_run(&conn, Some(root.volume_id), &mut |_| {}, &cancel).unwrap();

        let r1 = sidecar_run(&conn, &mut |_| {}, &cancel).unwrap();
        assert_eq!(r1.read, 1);

        let (rating, label, edited, favorite): (i64, String, i64, i64) = conn
            .query_row("SELECT rating, label, edited, favorite FROM photos WHERE name = 'a.jpg'", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .unwrap();
        assert_eq!(rating, 4);
        assert_eq!(label, "Green");
        assert_eq!(edited, 1);
        assert_eq!(favorite, 1);

        let r2 = sidecar_run(&conn, &mut |_| {}, &cancel).unwrap();
        assert_eq!(r2.read, 0, "nothing changed — a second pass must not re-read the sidecar");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// A deleted sidecar must reset the catalog's mirror of it, not leave a stale rating behind
    /// forever — `get_sidecar` on a missing file returns defaults, and this proves that
    /// actually reaches the DB row.
    #[test]
    fn sidecar_run_resets_when_the_sidecar_is_deleted() {
        let conn = temp_db();
        let dir = scratch_photos_dir("sidecar_reset");
        std::fs::write(dir.join("a.jpg"), b"x").unwrap();
        let photo_path = dir.join("a.jpg").to_string_lossy().into_owned();

        let root = add_root_run(&conn, &dir.to_string_lossy(), None).unwrap();
        let cancel = AtomicBool::new(false);
        scan_run(&conn, Some(root.volume_id), &mut |_| {}, &cancel).unwrap();
        crate::library::set_sidecar(photo_path.clone(), 5, "Red".into(), false, None, None).unwrap();
        scan_run(&conn, Some(root.volume_id), &mut |_| {}, &cancel).unwrap();
        sidecar_run(&conn, &mut |_| {}, &cancel).unwrap();
        let rating: i64 = conn.query_row("SELECT rating FROM photos WHERE name = 'a.jpg'", [], |r| r.get(0)).unwrap();
        assert_eq!(rating, 5);

        std::fs::remove_file(dir.join("a.xmp")).unwrap();
        scan_run(&conn, Some(root.volume_id), &mut |_| {}, &cancel).unwrap();
        let r = sidecar_run(&conn, &mut |_| {}, &cancel).unwrap();
        assert_eq!(r.read, 1, "the sidecar's disappearance must itself be detected as a change");

        let (rating, label): (i64, String) = conn
            .query_row("SELECT rating, label FROM photos WHERE name = 'a.jpg'", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(rating, 0, "rating must reset once the sidecar is gone");
        assert_eq!(label, "");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Same infinite-loop guard as metadata_run's, proven the same way: a photo on an offline
    /// volume must not make sidecar_run spin forever re-selecting the same row.
    #[test]
    fn sidecar_run_terminates_when_only_offline_rows_remain() {
        let conn = temp_db();
        conn.execute(
            "INSERT INTO volumes (uuid, label, last_path, is_local, last_seen)
             VALUES ('ext-gone-sc', 'Old LaCie', '/Volumes/DoesNotExist24680', 0, 0)",
            [],
        )
        .unwrap();
        let vid: i64 = conn.query_row("SELECT id FROM volumes WHERE uuid='ext-gone-sc'", [], |r| r.get(0)).unwrap();
        conn.execute(
            "INSERT INTO photos (volume_id, rel_path, rel_dir, name, name_lc, ext, kind, size, mtime, added, present, sidecar_mtime)
             VALUES (?1, 'p.jpg', '', 'p.jpg', 'p.jpg', 'jpg', 'jpeg', 10, 5, 0, 1, 999)",
            params![vid],
        )
        .unwrap();

        let cancel = AtomicBool::new(false);
        let result = sidecar_run(&conn, &mut |_| {}, &cancel).unwrap();
        assert_eq!(result.read, 0, "an offline volume's photo must be skipped, not processed with default sidecar values");

        let sidecar_parsed_mtime: i64 = conn.query_row("SELECT sidecar_parsed_mtime FROM photos WHERE id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(sidecar_parsed_mtime, 0, "must stay unparsed so the row is retried once the volume returns");
    }

    /// The delete flow end to end: a photo is scanned in, deleted with `note_deleted_run`, and
    /// must disappear from query results immediately — no rescan required.
    #[test]
    fn note_deleted_marks_present_zero_immediately() {
        let conn = temp_db();
        let dir = scratch_photos_dir("delete");
        std::fs::write(dir.join("a.jpg"), b"x").unwrap();
        std::fs::write(dir.join("b.jpg"), b"y").unwrap();

        let root = add_root_run(&conn, &dir.to_string_lossy(), None).unwrap();
        let cancel = AtomicBool::new(false);
        scan_run(&conn, Some(root.volume_id), &mut |_| {}, &cancel).unwrap();
        conn.execute("UPDATE photos SET rating = 3 WHERE name = 'a.jpg'", []).unwrap();

        // The path a real caller has is whatever catalog_query itself returned — always the
        // CANONICAL form, since it's reconstructed purely from the volume's last_path + rel_path
        // (both stored canonical by add_root_run). Deriving it the same way here, rather than
        // rejoining the test's own pre-canonicalization `dir`, is what makes this test exercise
        // the real call shape instead of a string form nothing in production ever produces.
        let a_path = query_run(&conn, CatalogQuery::default())
            .unwrap()
            .entries
            .iter()
            .find(|e| e.name == "a.jpg")
            .unwrap()
            .path
            .clone();

        let updated = note_deleted_run(&conn, &[a_path]).unwrap();
        assert_eq!(updated, 1);

        let (present, rating): (i64, i64) = conn
            .query_row("SELECT present, rating FROM photos WHERE name = 'a.jpg'", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(present, 0, "must be marked absent immediately, no rescan needed");
        assert_eq!(rating, 3, "deleting is a move to Trash, not a purge — the rating must survive it exactly like a temporarily-moved file does");

        let page = query_run(&conn, CatalogQuery::default()).unwrap();
        assert_eq!(page.entries.len(), 1, "the deleted photo must not appear in query results");
        assert_eq!(page.entries[0].name, "b.jpg");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// A path the catalog never indexed (never scanned, or a plain typo) must be a harmless
    /// no-op, not an error — the file was really trashed either way; the catalog is a cache.
    #[test]
    fn note_deleted_on_an_unindexed_path_is_a_harmless_no_op() {
        let conn = temp_db();
        let updated = note_deleted_run(&conn, &["/nowhere/ghost.jpg".to_string()]).unwrap();
        assert_eq!(updated, 0);
    }

    /// The prefix-matching order, pinned directly: an external volume's own path must win over
    /// the trivially-matching local "/" prefix, or every external-volume delete would silently
    /// resolve against the wrong (local) volume and match nothing.
    #[test]
    fn note_deleted_prefers_the_external_volume_prefix_over_local() {
        let conn = temp_db();
        conn.execute("INSERT INTO volumes (uuid, label, last_path, is_local, last_seen) VALUES ('local','This Mac','/', 1, 0)", []).unwrap();
        conn.execute(
            "INSERT INTO volumes (uuid, label, last_path, is_local, last_seen) VALUES ('ext-1','Archive','/Volumes/Archive', 0, 0)",
            [],
        )
        .unwrap();
        let ext_id: i64 = conn.query_row("SELECT id FROM volumes WHERE uuid='ext-1'", [], |r| r.get(0)).unwrap();
        conn.execute(
            "INSERT INTO photos (volume_id, rel_path, rel_dir, name, name_lc, ext, kind, size, mtime, added, present)
             VALUES (?1, 'a.jpg', '', 'a.jpg', 'a.jpg', 'jpg', 'jpeg', 10, 0, 0, 1)",
            params![ext_id],
        )
        .unwrap();

        let updated = note_deleted_run(&conn, &["/Volumes/Archive/a.jpg".to_string()]).unwrap();
        assert_eq!(updated, 1, "must resolve against the external volume, not silently match nothing against local's trivial '/' prefix");
    }

    fn insert_dated_photo(conn: &Connection, vid: i64, name: &str, y: i32, m: i32, d: i32) {
        conn.execute(
            "INSERT INTO photos (volume_id, rel_path, rel_dir, name, name_lc, ext, kind, size, mtime, added, present, cap_y, cap_m, cap_d)
             VALUES (?1, ?2, '', ?2, ?2, 'jpg', 'jpeg', 10, 0, 0, 1, ?3, ?4, ?5)",
            params![vid, name, y, m, d],
        )
        .unwrap();
    }

    /// `catalog_date_counts` must produce one row per distinct day, correctly separate from a
    /// "no date" bucket that a naive COUNT(*) grouped by (cap_y,cap_m,cap_d) would otherwise
    /// fold NULLs into as their own (NULL,NULL,NULL) group instead of a named bucket.
    #[test]
    fn date_counts_groups_by_day_and_buckets_undated_separately() {
        let conn = temp_db();
        conn.execute("INSERT INTO volumes (uuid, label, last_path, is_local, last_seen) VALUES ('local','This Mac','/', 1, 0)", []).unwrap();
        let vid: i64 = conn.query_row("SELECT id FROM volumes WHERE uuid='local'", [], |r| r.get(0)).unwrap();
        insert_dated_photo(&conn, vid, "a.jpg", 2026, 8, 20);
        insert_dated_photo(&conn, vid, "b.jpg", 2026, 8, 20);
        insert_dated_photo(&conn, vid, "c.jpg", 2026, 8, 21);
        insert_dated_photo(&conn, vid, "d.jpg", 2025, 1, 1);
        conn.execute(
            "INSERT INTO photos (volume_id, rel_path, rel_dir, name, name_lc, ext, kind, size, mtime, added, present)
             VALUES (?1, 'e.jpg', '', 'e.jpg', 'e.jpg', 'jpg', 'jpeg', 10, 0, 0, 1)",
            params![vid],
        )
        .unwrap();

        let counts = date_counts_run(&conn).unwrap();
        assert_eq!(counts.no_date, 1, "the undated photo must be its own bucket, not a (NULL,NULL,NULL) day");
        assert_eq!(counts.days.len(), 3, "three distinct days");
        let aug20 = counts.days.iter().find(|d| d.y == 2026 && d.m == 8 && d.d == 20).unwrap();
        assert_eq!(aug20.n, 2);
        // Newest first, matching the sidebar's expected order.
        assert_eq!((counts.days[0].y, counts.days[0].m, counts.days[0].d), (2026, 8, 21));
    }

    /// The date-browser scope itself: year alone, year+month, and a full year/month/day must
    /// each narrow correctly, and month/day are meaningless without year (there's no
    /// cross-year "every March" view in this design).
    #[test]
    fn query_run_scopes_by_year_month_day() {
        let conn = temp_db();
        conn.execute("INSERT INTO volumes (uuid, label, last_path, is_local, last_seen) VALUES ('local','This Mac','/', 1, 0)", []).unwrap();
        let vid: i64 = conn.query_row("SELECT id FROM volumes WHERE uuid='local'", [], |r| r.get(0)).unwrap();
        insert_dated_photo(&conn, vid, "aug20.jpg", 2026, 8, 20);
        insert_dated_photo(&conn, vid, "aug21.jpg", 2026, 8, 21);
        insert_dated_photo(&conn, vid, "jul.jpg", 2026, 7, 4);
        insert_dated_photo(&conn, vid, "y2025.jpg", 2025, 8, 20);

        let by_year = query_run(&conn, CatalogQuery { year: Some(2026), ..Default::default() }).unwrap();
        assert_eq!(by_year.entries.len(), 3, "whole year: everything in 2026");

        let by_month = query_run(&conn, CatalogQuery { year: Some(2026), month: Some(8), ..Default::default() }).unwrap();
        assert_eq!(by_month.entries.len(), 2, "one month: just August 2026");

        let by_day = query_run(&conn, CatalogQuery { year: Some(2026), month: Some(8), day: Some(20), ..Default::default() }).unwrap();
        assert_eq!(by_day.entries.len(), 1);
        assert_eq!(by_day.entries[0].name, "aug20.jpg");
    }

    // ── Video capture date ──────────────────────────────────────────────────────────────────

    fn mp4_box(typ: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut v = ((body.len() + 8) as u32).to_be_bytes().to_vec();
        v.extend_from_slice(typ);
        v.extend_from_slice(body);
        v
    }

    /// A minimal but structurally real `moov > mvhd` box, version 0, with a given Mac-epoch
    /// (1904-01-01) creation_time. Pads the rest of mvhd's body with zeros — the parser only
    /// reads the first 8 bytes, but a real mvhd is much longer, and this keeps the fixture
    /// honest about that rather than truncating it to exactly what the parser touches.
    fn moov_with_mvhd(mac_epoch_secs: u32, version: u8) -> Vec<u8> {
        let mut mvhd_body = vec![version, 0, 0, 0];
        if version == 1 {
            mvhd_body.extend_from_slice(&(mac_epoch_secs as u64).to_be_bytes());
            mvhd_body.extend_from_slice(&0u64.to_be_bytes()); // modification_time
        } else {
            mvhd_body.extend_from_slice(&mac_epoch_secs.to_be_bytes());
            mvhd_body.extend_from_slice(&0u32.to_be_bytes()); // modification_time
        }
        mvhd_body.extend_from_slice(&[0u8; 80]); // timescale/duration/rate/volume/matrix/etc — unread padding
        let mvhd = mp4_box(b"mvhd", &mvhd_body);
        mp4_box(b"moov", &mvhd)
    }

    /// A `moov > meta > (keys, ilst)` structure carrying one QuickTime creationdate key, built
    /// by hand to the real spec: `keys`' entries are (size, "mdta" namespace, value-string);
    /// `ilst`'s child box's own 4-byte "type" IS the 1-based key index as a big-endian u32, not
    /// ASCII, containing one `data` sub-box with the actual ISO8601 payload.
    ///
    /// `fullbox_prefix` selects which of the two real conventions to build — see
    /// `find_quicktime_creationdate`'s doc comment: a real Apple-camera file (this repo's own
    /// geneva/IMG_8015.MOV) has NO leading version+flags on `meta`'s body; some non-Apple
    /// encoders write the ISO "FullBox" form WITH it. Both are exercised, not just one.
    fn moov_with_quicktime_date(iso: &str, also_mvhd: Option<u32>, fullbox_prefix: bool) -> Vec<u8> {
        let key_value = b"com.apple.quicktime.creationdate";
        let mut key_entry = ((key_value.len() + 8) as u32).to_be_bytes().to_vec();
        key_entry.extend_from_slice(b"mdta");
        key_entry.extend_from_slice(key_value);
        let mut keys_body = vec![0u8, 0, 0, 0]; // version+flags
        keys_body.extend_from_slice(&1u32.to_be_bytes()); // entry_count
        keys_body.extend_from_slice(&key_entry);
        let keys = mp4_box(b"keys", &keys_body);

        let mut data_body = vec![0u8, 0, 0, 1]; // type indicator (1 = UTF-8, unread by parser)
        data_body.extend_from_slice(&[0u8; 4]); // locale
        data_body.extend_from_slice(iso.as_bytes());
        let data = mp4_box(b"data", &data_body);
        let item = mp4_box(&1u32.to_be_bytes(), &data); // item "type" = key index 1
        let ilst = mp4_box(b"ilst", &item);

        let mut meta_body = if fullbox_prefix { vec![0u8, 0, 0, 0] } else { Vec::new() };
        meta_body.extend_from_slice(&keys);
        meta_body.extend_from_slice(&ilst);
        let meta = mp4_box(b"meta", &meta_body);

        let mut moov_body = meta;
        if let Some(mac_secs) = also_mvhd {
            let mut mvhd_body = vec![0u8, 0, 0, 0];
            mvhd_body.extend_from_slice(&mac_secs.to_be_bytes());
            mvhd_body.extend_from_slice(&[0u8; 84]);
            moov_body.extend_from_slice(&mp4_box(b"mvhd", &mvhd_body));
        }
        mp4_box(b"moov", &moov_body)
    }

    fn write_fixture(tag: &str, moov: &[u8]) -> String {
        let dir = std::env::temp_dir().join(format!("cs_video_fixture_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{tag}.mov"));
        // ftyp then moov then a fake mdat, matching a real file's top-level box order — this
        // also proves find_moov_bytes skips PAST ftyp/mdat rather than only working when moov
        // happens to be first.
        let mut file = mp4_box(b"ftyp", b"qt  \0\0\x02\0qt  ");
        file.extend_from_slice(moov);
        file.extend_from_slice(&mp4_box(b"mdat", &[0u8; 16]));
        std::fs::write(&path, &file).unwrap();
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn days_from_civil_and_civil_from_days_ints_are_inverses() {
        for (y, m, d) in [(1970, 1, 1), (2024, 2, 29), (2026, 8, 23), (1904, 1, 1), (2000, 12, 31)] {
            let days = days_from_civil(y, m, d);
            assert_eq!(civil_from_days_ints(days), (y as i32, m as i32, d as i32), "round trip failed for {y}-{m}-{d}");
        }
    }

    /// The classic bug in this exact parser, pinned directly: QuickTime's mvhd epoch is
    /// 1904-01-01 UTC, not the Unix epoch. A known Mac-epoch value must decode to the correct
    /// Unix-epoch calendar date, not something 66 years off.
    #[test]
    fn mvhd_epoch_is_1904_not_1970() {
        // 1904-01-01 + 3,808,483,200s = 2024-09-24 (computed independently via days_from_civil
        // relative to the Mac epoch, not copied from the implementation under test).
        let target_unix_days = days_from_civil(2024, 9, 24);
        let mac_epoch_secs = (target_unix_days * 86_400 + 2_082_844_800) as u32;
        let moov = moov_with_mvhd(mac_epoch_secs, 0);
        let path = write_fixture("mvhd_only", &moov);
        let vd = video_capture_date(&path).expect("mvhd date must parse");
        assert_eq!((vd.y, vd.m, vd.d), (2024, 9, 24));
        assert_eq!(vd.source, "mvhd");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn video_capture_date_prefers_quicktime_over_mvhd() {
        // mvhd alone: some other (wrong, if quicktime is present) date.
        let wrong_mac_secs = (days_from_civil(1999, 1, 1) * 86_400 + 2_082_844_800) as u32;
        let moov = moov_with_quicktime_date("2026-08-15T14:30:00+02:00", Some(wrong_mac_secs), true);
        let path = write_fixture("both_sources", &moov);
        let vd = video_capture_date(&path).expect("quicktime date must parse");
        assert_eq!(vd.source, "quicktime", "quicktime must win when both sources are present");
        assert_eq!((vd.y, vd.m, vd.d), (2026, 8, 15));
        std::fs::remove_file(&path).ok();
    }

    /// The offset is what makes QuickTime's source correct where mvhd (UTC-only) isn't — a
    /// video shot at 23:00 local with a positive UTC offset must not roll onto the next day.
    #[test]
    fn quicktime_date_uses_the_utc_offset_not_bare_utc() {
        let moov = moov_with_quicktime_date("2026-08-15T23:00:00+02:00", None, true);
        let path = write_fixture("offset", &moov);
        let vd = video_capture_date(&path).expect("quicktime date must parse");
        assert_eq!((vd.y, vd.m, vd.d), (2026, 8, 15), "local calendar date, not the UTC-shifted one");
        std::fs::remove_file(&path).ok();
    }

    /// The form a REAL Apple-camera file actually uses (verified against geneva/IMG_8015.MOV):
    /// `meta`'s body has NO leading version+flags, unlike the ISO "FullBox" convention the other
    /// two tests above exercise. Both forms have to parse — this pins the one that's dominant
    /// in practice, which the fullbox-only version of this parser silently failed on.
    #[test]
    fn quicktime_date_parses_without_the_fullbox_prefix() {
        let moov = moov_with_quicktime_date("2026-08-15T14:30:00+02:00", None, false);
        let path = write_fixture("no_fullbox_prefix", &moov);
        let vd = video_capture_date(&path).expect("quicktime date must parse even without the version+flags prefix");
        assert_eq!(vd.source, "quicktime");
        assert_eq!((vd.y, vd.m, vd.d), (2026, 8, 15));
        std::fs::remove_file(&path).ok();
    }

    /// The other real bug this parser had: a legitimate zero-body top-level box (QuickTime's
    /// own `wide` placeholder, written by real encoders right after `ftyp`) must not truncate
    /// the scan before it ever reaches `moov` — which, in a real file, commonly sits AFTER a
    /// huge `mdat`, not before it.
    #[test]
    fn a_zero_body_box_before_moov_does_not_truncate_the_scan() {
        let moov = moov_with_mvhd((days_from_civil(2026, 1, 1) * 86_400 + 2_082_844_800) as u32, 0);
        let dir = std::env::temp_dir().join(format!("cs_video_fixture_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("wide_then_moov.mov");
        let mut file = mp4_box(b"ftyp", b"qt  \0\0\x02\0qt  ");
        file.extend_from_slice(&mp4_box(b"wide", &[])); // zero-body — the exact real-world trigger
        file.extend_from_slice(&mp4_box(b"mdat", &[0u8; 16]));
        file.extend_from_slice(&moov); // moov AFTER mdat, also matching the real file's layout
        std::fs::write(&path, &file).unwrap();
        let vd = video_capture_date(&path.to_string_lossy()).expect("must find moov past a zero-body box and past mdat");
        assert_eq!(vd.y, 2026);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn a_clip_with_no_date_atoms_returns_none() {
        let moov = mp4_box(b"moov", b""); // present, but empty — no meta, no mvhd
        let path = write_fixture("no_date", &moov);
        assert!(video_capture_date(&path).is_none(), "must not fabricate a date from nothing");
        std::fs::remove_file(&path).ok();
    }

    /// The real end-to-end path, if a real clip exists in the checkout (skipped cleanly
    /// otherwise) — the synthetic fixtures above each cover one mechanism; this is the one
    /// that would catch them composing wrongly against an actual camera-written file.
    #[test]
    fn video_capture_date_reads_a_real_clip() {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../geneva");
        let sample = repo.join("IMG_8015.MOV");
        if !sample.exists() {
            eprintln!("skipping: geneva/IMG_8015.MOV not present in this checkout");
            return;
        }
        let vd = video_capture_date(&sample.to_string_lossy());
        println!("real clip date: {:?} y={:?} m={:?} d={:?} source={:?}",
            vd.as_ref().map(|v| v.captured), vd.as_ref().map(|v| v.y), vd.as_ref().map(|v| v.m), vd.as_ref().map(|v| v.d), vd.as_ref().map(|v| v.source));
        // Whichever source answers (or neither, if this particular file carries no date atoms
        // at all — real camera files vary), it must be internally consistent: a returned date
        // must be a real, plausible calendar date, not garbage.
        if let Some(vd) = vd {
            assert!((1..=12).contains(&vd.m) && (1..=31).contains(&vd.d) && vd.y > 1990 && vd.y < 2100);
        }
    }

    // ── Content-hash integrity ──────────────────────────────────────────────────────────────

    #[test]
    fn hash_run_records_a_hash_for_every_present_photo_and_is_resumable() {
        let conn = temp_db();
        let dir = scratch_photos_dir("hash");
        std::fs::write(dir.join("a.jpg"), b"hello world").unwrap();
        std::fs::write(dir.join("b.jpg"), b"a different file").unwrap();

        let root = add_root_run(&conn, &dir.to_string_lossy(), None).unwrap();
        let cancel = AtomicBool::new(false);
        scan_run(&conn, Some(root.volume_id), &mut |_| {}, &cancel).unwrap();

        let r1 = hash_run(&conn, &mut |_| {}, &cancel).unwrap();
        assert_eq!(r1.hashed, 2);
        let (hash_a, hashed_at_a, mtime_a): (String, i64, i64) = conn
            .query_row("SELECT content_hash, hashed_at, mtime FROM photos WHERE name='a.jpg'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap();
        assert_eq!(hash_a, blake3::hash(b"hello world").to_hex().to_string(), "must be a real BLAKE3 hash of the actual bytes");
        assert_eq!(hashed_at_a, mtime_a, "hashed_at baselines to the mtime the hash corresponds to");

        let r2 = hash_run(&conn, &mut |_| {}, &cancel).unwrap();
        assert_eq!(r2.hashed, 0, "nothing changed — a second pass must not re-hash anything");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// The entire point of this feature, proven directly: a byte flipped WITHOUT touching mtime
    /// (exactly what real bit rot looks like — the filesystem has no idea the bits changed) must
    /// be reported as corrupt. A normal edit (content AND mtime both change) must NOT be.
    #[test]
    fn corruption_is_distinguished_from_an_edit() {
        let conn = temp_db();
        let dir = scratch_photos_dir("corrupt");
        let corrupt_path = dir.join("corrupt.jpg");
        let edited_path = dir.join("edited.jpg");
        std::fs::write(&corrupt_path, b"original bytes here").unwrap();
        std::fs::write(&edited_path, b"original bytes here").unwrap();

        let root = add_root_run(&conn, &dir.to_string_lossy(), None).unwrap();
        let cancel = AtomicBool::new(false);
        scan_run(&conn, Some(root.volume_id), &mut |_| {}, &cancel).unwrap();
        hash_run(&conn, &mut |_| {}, &cancel).unwrap();

        let orig_mtime: i64 = conn.query_row("SELECT mtime FROM photos WHERE name='corrupt.jpg'", [], |r| r.get(0)).unwrap();

        // Corruption: rewrite the bytes, then restore the ORIGINAL mtime — this is what real
        // bit rot looks like (content changes, the filesystem's mtime does not). Uses libc's
        // utimes directly (already a real dependency, via ingest.rs's statfs use) rather than
        // adding a crate for one test.
        std::fs::write(&corrupt_path, b"CORRUPTED byte here!").unwrap();
        set_mtime_for_test(&corrupt_path, orig_mtime);

        // An ordinary edit: rewrite AND let the mtime naturally update.
        std::thread::sleep(std::time::Duration::from_millis(1100)); // ensure a distinct whole-second mtime
        std::fs::write(&edited_path, b"a legitimately edited file").unwrap();

        // Re-walk so the DB's own mtime column reflects disk (scan phase A always does this;
        // verify itself also re-stats fresh, but the corrupted file's mtime was deliberately
        // restored, so this walk must NOT be what changes its stored mtime).
        scan_run(&conn, Some(root.volume_id), &mut |_| {}, &cancel).unwrap();

        let result = verify_run(&conn, &mut |_| {}, &cancel).unwrap();
        assert_eq!(result.corrupt.len(), 1, "exactly the byte-flipped-with-restored-mtime file must be flagged");
        assert_eq!(result.corrupt[0].name, "corrupt.jpg");
        assert_eq!(result.changed, 1, "the legitimately edited file must be re-baselined, not flagged");
        assert_eq!(result.ok, 0);

        // And the edited file's baseline actually updated: on a SECOND verify it now matches
        // its own (new) baseline and reports ok, while the corrupt file — never fixed, its
        // stored hash never updated — is flagged again rather than silently forgotten.
        let result2 = verify_run(&conn, &mut |_| {}, &cancel).unwrap();
        assert_eq!(result2.ok, 1, "the edited file, now re-baselined, must verify clean against its OWN updated hash");
        assert_eq!(result2.changed, 0, "nothing new changed between the two verify calls");
        assert_eq!(result2.corrupt.len(), 1, "the corrupt file must be flagged again, not forgotten after one report");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// The guard that a verifier that cries wolf is one nobody runs: a clean, untouched archive
    /// must produce zero corrupt and zero changed — verify_run must be silent when there is
    /// genuinely nothing to report.
    #[test]
    fn verify_is_a_no_op_on_an_untouched_archive() {
        let conn = temp_db();
        let dir = scratch_photos_dir("clean");
        std::fs::write(dir.join("a.jpg"), b"never touched").unwrap();
        std::fs::write(dir.join("b.jpg"), b"also never touched").unwrap();

        let root = add_root_run(&conn, &dir.to_string_lossy(), None).unwrap();
        let cancel = AtomicBool::new(false);
        scan_run(&conn, Some(root.volume_id), &mut |_| {}, &cancel).unwrap();
        hash_run(&conn, &mut |_| {}, &cancel).unwrap();

        let result = verify_run(&conn, &mut |_| {}, &cancel).unwrap();
        assert_eq!(result.checked, 2);
        assert_eq!(result.ok, 2);
        assert_eq!(result.changed, 0);
        assert!(result.corrupt.is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    /// hash_run must skip a photo whose volume is offline rather than treating "the file isn't
    /// reachable right now" as if it had no content — same class of guard as metadata_run's and
    /// sidecar_run's own offline-termination tests.
    #[test]
    fn hash_run_terminates_when_only_offline_rows_remain() {
        let conn = temp_db();
        conn.execute(
            "INSERT INTO volumes (uuid, label, last_path, is_local, last_seen)
             VALUES ('ext-gone-hash', 'Old LaCie', '/Volumes/DoesNotExist13579', 0, 0)",
            [],
        )
        .unwrap();
        let vid: i64 = conn.query_row("SELECT id FROM volumes WHERE uuid='ext-gone-hash'", [], |r| r.get(0)).unwrap();
        conn.execute(
            "INSERT INTO photos (volume_id, rel_path, rel_dir, name, name_lc, ext, kind, size, mtime, added, present)
             VALUES (?1, 'p.jpg', '', 'p.jpg', 'p.jpg', 'jpg', 'jpeg', 10, 5, 0, 1)",
            params![vid],
        )
        .unwrap();

        let cancel = AtomicBool::new(false);
        let result = hash_run(&conn, &mut |_| {}, &cancel).unwrap();
        assert_eq!(result.hashed, 0);
        let content_hash: Option<String> = conn.query_row("SELECT content_hash FROM photos WHERE id = 1", [], |r| r.get(0)).unwrap();
        assert!(content_hash.is_none(), "must stay unhashed so it's retried once the volume returns");
    }

    // ── Rebuild ──────────────────────────────────────────────────────────────────────────────

    /// The property that makes SQLite safe to depend on here, proven directly: populate a
    /// catalog with real ratings/labels/favorites (via the real set_sidecar writer, not a
    /// hand-built row), wipe it down to nothing, rebuild, and confirm every one of them comes
    /// back byte-for-byte — because they were never really stored in the catalog, only
    /// mirrored from the .xmp files that actually hold them.
    #[test]
    fn rebuild_from_disk_reproduces_every_rating_and_label() {
        let conn = temp_db();
        let dir = scratch_photos_dir("rebuild");
        std::fs::write(dir.join("a.jpg"), b"x").unwrap();
        std::fs::write(dir.join("b.jpg"), b"y").unwrap();
        let a_path = dir.join("a.jpg").to_string_lossy().into_owned();
        let b_path = dir.join("b.jpg").to_string_lossy().into_owned();
        crate::library::set_sidecar(a_path.clone(), 5, "Green".into(), true, None, Some(true)).unwrap();
        crate::library::set_sidecar(b_path.clone(), 2, "Red".into(), false, None, None).unwrap();

        let root = add_root_run(&conn, &dir.to_string_lossy(), None).unwrap();
        let cancel = AtomicBool::new(false);
        scan_run(&conn, Some(root.volume_id), &mut |_| {}, &cancel).unwrap();
        sidecar_run(&conn, &mut |_| {}, &cancel).unwrap();

        let before = query_run(&conn, CatalogQuery::default()).unwrap();
        assert_eq!(before.entries.len(), 2);

        rebuild_run(&conn, &mut |_| {}, &cancel).unwrap();

        // Volume/root/photo ids are NOT expected to match — a rebuild starts over on purpose.
        // What must match is the actual data, re-derived fresh from disk.
        let (rating_a, label_a, edited_a, fav_a): (i64, String, i64, i64) = conn
            .query_row("SELECT rating, label, edited, favorite FROM photos WHERE name='a.jpg'", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .unwrap();
        assert_eq!((rating_a, label_a.as_str(), edited_a, fav_a), (5, "Green", 1, 1));
        let (rating_b, label_b): (i64, String) = conn
            .query_row("SELECT rating, label FROM photos WHERE name='b.jpg'", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!((rating_b, label_b.as_str()), (2, "Red"));

        let after = query_run(&conn, CatalogQuery::default()).unwrap();
        assert_eq!(after.entries.len(), 2, "both photos must reappear after rebuild");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// `CatalogState::new` must never panic — the literal invariant "never a startup failure".
    /// Points a catalog at a path with no writable parent (so even the fresh-file fallback
    /// fails) and confirms it still produces a usable (in-memory) connection instead of
    /// unwrapping into a crash.
    #[test]
    fn catalog_state_new_falls_back_to_in_memory_rather_than_panicking() {
        // CS_CATALOG_DIR pointed at a path that cannot be created (a file, not a directory, as
        // the "directory" component) — create_dir_all inside catalog_dir() will fail, and the
        // subsequent Connection::open will fail too, exercising the real failure path rather
        // than mocking it.
        let blocker = std::env::temp_dir().join(format!("cs_catalog_blocker_{}", std::process::id()));
        std::fs::write(&blocker, b"not a directory").unwrap();
        std::env::set_var("CS_CATALOG_DIR", blocker.join("nested").to_string_lossy().to_string());

        let state = CatalogState::new(); // must not panic
        let conn = state.conn.lock().unwrap();
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, SCHEMA_VERSION, "the in-memory fallback must still be a fully migrated, usable catalog");

        std::fs::remove_file(&blocker).ok();
        std::env::remove_var("CS_CATALOG_DIR");
    }
}
