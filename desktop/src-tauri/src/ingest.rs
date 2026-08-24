// SD-card import: the step that currently forces a trip through Lightroom before Chromasmith ever
// sees a photo. library.rs can already browse and cull a folder that exists; nothing until now
// could GET the files off a card and into one.
//
// The behaviours here are the ones a card importer is actually judged on, and each is a deliberate
// choice rather than a default:
//
//  - **Never move, only copy.** The card is the only copy until the import is verified, and an
//    importer that deletes is an importer that can lose a shoot. Formatting the card is the
//    camera's job.
//  - **Verify every file by size after writing**, and treat a mismatch as a failed file rather
//    than a failed import — one unreadable file on a flaky card must not cost the other 400.
//  - **A second copy to another volume, written in the same pass** (Lightroom's "Make a Second
//    Copy To"). The point is that it happens BEFORE the card is reused, which is exactly when a
//    single-copy import is at its most fragile.
//  - **Skip files already imported**, matched on name + size, so re-inserting a card mid-shoot
//    imports only what is new instead of making 400 duplicates.
//  - **Sidecars travel with their photo.** A `.xmp` next to a RAW is the user's edits; leaving it
//    behind silently discards work. Same for Panasonic's `.rrdata`.
//
// Dates come from EXIF via library.rs's existing reader, NOT filesystem mtime: a card's mtimes are
// whatever the camera's clock and the copy program felt like, while DateTimeOriginal is when the
// photo was actually taken, which is what a date-based folder tree is meant to mean.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// A mounted volume that looks like a camera card.
#[derive(Serialize)]
pub struct Volume {
    pub name: String,
    pub path: String,
    /// True when a DCIM directory is present — the DCF standard every camera writes. Volumes
    /// without one are still listed (some cameras and card readers vary, and a user may want to
    /// import from a plain folder) but the UI defaults to the ones that have it.
    pub has_dcim: bool,
    pub total_bytes: u64,
    pub free_bytes: u64,
}

/// One importable file found on a card.
///
/// ⚠️ Derives `Deserialize` (not just `Serialize`) because `ingest_run` now takes the
/// already-scanned list back from the frontend instead of re-walking the card itself — see
/// `ingest_run`'s doc comment. `kind` is `String` rather than `&'static str` for exactly that
/// reason: a value coming back from JSON can't borrow a `'static` lifetime.
#[derive(Serialize, Deserialize, Clone)]
pub struct CardFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub kind: String,
    /// EXIF capture date as "YYYY-MM-DD", or None when the file carries no readable date.
    pub date: Option<String>,
    /// Already present at the destination (same name and size) — pre-unchecked in the UI.
    /// Re-verified fresh in `ingest_run` against the destination chosen at import time, so a
    /// stale flag from the initial scan (if the user changed "Copy to" afterward) can't cause
    /// either a wrongly-skipped new photo or a wrongly-offered duplicate.
    pub duplicate: bool,
}

/// ⚠️ `rename_all = "camelCase"` is load-bearing, not cosmetic. Tauri v2's automatic
/// camelCase→snake_case conversion applies to TOP-LEVEL command arguments only — `options`
/// here arrives as an opaque JSON value that goes through plain serde, and the frontend sends
/// camelCase keys (`destRoot`, `backupRoot`, ...) inside it. Without this attribute,
/// `ingest_copy` rejects every call with "missing field `dest_root`" before `ingest_run` is
/// ever entered — see `ingest_options_deserialize_from_the_exact_ui_json` below, which
/// deserializes the literal JSON the UI sends rather than a hand-built struct, because a
/// hand-built struct is exactly what let this ship broken the first time.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestOptions {
    pub dest_root: String,
    /// Second copy written in the same pass; empty/None to skip.
    #[serde(default)]
    pub backup_root: Option<String>,
    /// Folder template under dest_root. Supported tokens: {YYYY} {MM} {DD} {YYYY-MM-DD}.
    /// Defaults to "{YYYY}/{YYYY-MM-DD}" — the layout Lightroom's default import uses.
    #[serde(default)]
    pub folder_template: Option<String>,
    /// Optional rename template. Tokens: {name} {YYYY} {MM} {DD} {n}. Empty keeps camera names.
    #[serde(default)]
    pub filename_template: Option<String>,
    #[serde(default)]
    pub skip_duplicates: bool,
    /// Absolute paths (as returned by scan_card) to import. Empty means everything scanned.
    #[serde(default)]
    pub only: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct IngestProgress {
    pub done: usize,
    pub total: usize,
    pub current: String,
    pub bytes_done: u64,
    pub bytes_total: u64,
}

#[derive(Serialize)]
pub struct IngestResult {
    pub copied: usize,
    /// Files deliberately NOT copied because `skip_duplicates` was on and they matched the
    /// destination. Distinct from `failed` on purpose — a skip is a decision, a failure is a
    /// problem. (The old `skipped` field conflated the two: it was computed as
    /// `total - copied`, so it silently reported FAILURE count while duplicates-skipped never
    /// surfaced anywhere at all.)
    pub duplicates_skipped: usize,
    /// Per-file failures, as "<name>: <reason>". The import continues past each one.
    pub failed: Vec<String>,
    pub dest_root: String,
    pub bytes: u64,
}

const SIDECAR_EXTS: &[&str] = &["xmp", "rrdata"];

fn ext_lower(p: &Path) -> String {
    p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase()
}

/// Media the app can actually open, mirroring library.rs's own extension lists. Sidecars are
/// deliberately NOT here: they ride along with their photo rather than being importable alone.
fn media_kind(ext: &str) -> Option<&'static str> {
    match ext {
        "rw2" | "raw" | "dng" | "cr2" | "cr3" | "nef" | "arw" | "orf" => Some("raw"),
        "jpg" | "jpeg" => Some("jpeg"),
        // iPhone photos come off a card as HEIC too — importing everything EXCEPT those would be
        // a silent partial import, the worst possible failure for a tool whose job is not losing
        // photos. library.rs lists them for the same reason.
        "heic" | "heif" => Some("heic"),
        "png" => Some("png"),
        "tif" | "tiff" => Some("tiff"),
        "mp4" | "mov" | "m4v" => Some("video"),
        _ => None,
    }
}

/// Lists mounted volumes. macOS mounts everything removable under /Volumes; the boot disk is
/// excluded by checking which volume "/" lives on rather than by name-matching "Macintosh HD",
/// which is user-renameable and localised.
#[tauri::command]
pub fn list_volumes() -> Result<Vec<Volume>, String> {
    let root_dev = std::fs::metadata("/").ok().map(|m| {
        use std::os::unix::fs::MetadataExt;
        m.dev()
    });
    let mut out = Vec::new();
    let rd = match std::fs::read_dir("/Volumes") {
        Ok(rd) => rd,
        Err(e) => return Err(format!("read /Volumes: {e}")),
    };
    for entry in rd.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        // Skip the boot volume (which /Volumes symlinks to on modern macOS).
        if let (Some(rd), Ok(md)) = (root_dev, std::fs::metadata(&p)) {
            use std::os::unix::fs::MetadataExt;
            if md.dev() == rd {
                continue;
            }
        }
        let (total_bytes, free_bytes) = statfs_bytes(&p);
        out.push(Volume {
            has_dcim: p.join("DCIM").is_dir(),
            name,
            path: p.to_string_lossy().into_owned(),
            total_bytes,
            free_bytes,
        });
    }
    out.sort_by(|a, b| b.has_dcim.cmp(&a.has_dcim).then(a.name.cmp(&b.name)));
    Ok(out)
}

/// Total/free bytes for the filesystem containing `path`, via statfs(2). Best-effort: a card that
/// won't stat still imports, it just can't show a capacity bar.
fn statfs_bytes(path: &Path) -> (u64, u64) {
    use std::ffi::CString;
    let Some(cstr) = path.to_str().and_then(|s| CString::new(s).ok()) else { return (0, 0) };
    // SAFETY: statfs writes into a zeroed, correctly-sized struct and we only read scalars back.
    unsafe {
        let mut st: libc::statfs = std::mem::zeroed();
        if libc::statfs(cstr.as_ptr(), &mut st) != 0 {
            return (0, 0);
        }
        let bs = st.f_bsize as u64;
        (st.f_blocks * bs, st.f_bavail * bs)
    }
}

/// EXIF capture date as "YYYY-MM-DD". library.rs's read_meta already covers both RAW (rawler) and
/// JPEG/TIFF (kamadak-exif) and returns EXIF's "YYYY:MM:DD HH:MM:SS"; this just takes the date.
///
/// ⚠️ Falls back to filesystem mtime ONLY when there is no EXIF date at all (video, mostly — this
/// app has no MP4 metadata reader, and adding an ffmpeg dependency to learn a folder name would be
/// absurd). A wrong-but-plausible date is worse than an obviously-missing one everywhere else.
fn capture_date(path: &str) -> Option<String> {
    let meta = crate::library::read_meta_public(path);
    if let Some(d) = meta.date.as_ref() {
        let head: String = d.chars().take(10).collect();
        if head.len() == 10 && head.chars().filter(|c| c.is_ascii_digit()).count() == 8 {
            return Some(head.replace(':', "-"));
        }
    }
    None
}

fn mtime_date(path: &Path) -> Option<String> {
    let secs = std::fs::metadata(path).ok()?.modified().ok()?
        .duration_since(std::time::UNIX_EPOCH).ok()?.as_secs() as i64;
    Some(civil_from_days(secs.div_euclid(86_400)))
}

/// Days-since-epoch → "YYYY-MM-DD", via Howard Hinnant's civil_from_days. Written out rather than
/// pulling in `chrono` for one conversion; it is exact for all dates this will ever see.
fn civil_from_days(z: i64) -> String {
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
    format!("{y:04}-{m:02}-{d:02}")
}

#[derive(Serialize, Clone)]
pub struct ScanProgress {
    pub scanned: usize,
    pub current: String,
}

/// Recursively finds importable media. Walks the whole volume rather than only DCIM/ so a card
/// with a non-standard layout (or a plain folder of files) still works.
///
/// ⚠️ Per-file EXIF reads (`capture_date`) on a real card of thousands of RAWs make this
/// genuinely slow — measured hanging the entire UI for minutes on a real SD card with no
/// feedback, because a plain sync `#[tauri::command]` was being invoked in a way that blocked the
/// WKWebView's own main thread rather than running off it (confirmed via `sample`: the OS main
/// thread's own stack was inside this walk, not idle). Async + `spawn_blocking` moves the walk
/// onto Tauri's async runtime's blocking pool instead, and periodic `scan-progress` events (same
/// pattern as `ingest-progress` below) give the UI something to show instead of a frozen dialog.
#[tauri::command]
pub async fn scan_card(app: tauri::AppHandle, path: String, dest_root: Option<String>) -> Result<Vec<CardFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Emitter;
        let root = PathBuf::from(&path);
        if !root.is_dir() {
            return Err(format!("not a folder: {path}"));
        }
        let mut files = Vec::new();
        let mut stack = vec![root];
        let mut scanned = 0usize;
        while let Some(dir) = stack.pop() {
            let Ok(rd) = std::fs::read_dir(&dir) else { continue };
            for entry in rd.flatten() {
                let p = entry.path();
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') {
                    continue; // .Spotlight-V100, ._AppleDouble stubs, etc
                }
                if p.is_dir() {
                    stack.push(p);
                    continue;
                }
                let Some(kind) = media_kind(&ext_lower(&p)) else { continue };
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                let ps = p.to_string_lossy().into_owned();
                let date = capture_date(&ps).or_else(|| mtime_date(&p));
                files.push(CardFile { path: ps, name: name.clone(), size, kind: kind.to_string(), date, duplicate: false });
                scanned += 1;
                // Every 20 files, not every file — this loop is already the bottleneck, so the
                // event-emit overhead itself shouldn't compete with it for a fast local folder.
                if scanned % 20 == 0 {
                    let _ = app.emit("scan-progress", ScanProgress { scanned, current: name });
                }
            }
        }
        files.sort_by(|a, b| a.name.cmp(&b.name));

        // Mark files already imported. Matching on name+size (not a content hash) is the same
        // trade-off every importer makes: a hash of 400 RAWs would take longer than the import.
        if let Some(dest) = dest_root.filter(|d| !d.is_empty()) {
            let existing = index_destination(Path::new(&dest));
            for f in files.iter_mut() {
                f.duplicate = existing.get(&f.name).is_some_and(|&s| s == f.size);
            }
        }
        let _ = app.emit("scan-progress", ScanProgress { scanned, current: String::new() });
        Ok(files)
    })
    .await
    .map_err(|e| format!("scan_card task panicked: {e}"))?
}

/// name -> size for every media file under `dest`, used for duplicate detection. Walks once and
/// caches nothing: an import is rare enough that a stale index would be a worse trade than a walk.
fn index_destination(dest: &Path) -> std::collections::HashMap<String, u64> {
    let mut map = std::collections::HashMap::new();
    let mut stack = vec![dest.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
            } else if media_kind(&ext_lower(&p)).is_some() {
                let name = entry.file_name().to_string_lossy().into_owned();
                map.insert(name, entry.metadata().map(|m| m.len()).unwrap_or(0));
            }
        }
    }
    map
}

/// Expands {YYYY} {MM} {DD} {YYYY-MM-DD} against a "YYYY-MM-DD" date.
fn expand_folder(template: &str, date: &str) -> String {
    let (y, m, d) = (&date[0..4], &date[5..7], &date[8..10]);
    template
        .replace("{YYYY-MM-DD}", date)
        .replace("{YYYY}", y)
        .replace("{MM}", m)
        .replace("{DD}", d)
}

/// Expands a filename template. `{name}` is the original stem, `{n}` a 1-based counter.
/// The extension is always preserved — a rename that changes it would break the decoder choice.
fn expand_filename(template: &str, stem: &str, date: &str, n: usize) -> String {
    let (y, m, d) = (&date[0..4], &date[5..7], &date[8..10]);
    template
        .replace("{name}", stem)
        .replace("{YYYY-MM-DD}", date)
        .replace("{YYYY}", y)
        .replace("{MM}", m)
        .replace("{DD}", d)
        .replace("{n}", &format!("{n:04}"))
}

/// Copies one file and verifies the result by size, removing a partial write so a failed copy can
/// never leave a truncated file that later looks importable.
fn copy_verified(src: &Path, dest: &Path) -> Result<u64, String> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    let expect = std::fs::metadata(src).map_err(|e| format!("stat source: {e}"))?.len();
    std::fs::copy(src, dest).map_err(|e| format!("copy: {e}"))?;
    let got = std::fs::metadata(dest).map_err(|e| format!("stat copy: {e}"))?.len();
    if got != expect {
        let _ = std::fs::remove_file(dest);
        return Err(format!("size mismatch after copy ({got} vs {expect} bytes)"));
    }
    Ok(got)
}

/// Sidecars sharing a photo's stem, in the same directory (`.xmp`, `.rrdata` — including
/// Panasonic's `NAME.RW2.rrdata` double extension).
fn sidecars_for(src: &Path) -> Vec<PathBuf> {
    let Some(dir) = src.parent() else { return Vec::new() };
    let Some(stem) = src.file_stem().and_then(|s| s.to_str()) else { return Vec::new() };
    let full = src.file_name().and_then(|s| s.to_str()).unwrap_or("");
    let mut out = Vec::new();
    for ext in SIDECAR_EXTS {
        for candidate in [dir.join(format!("{stem}.{ext}")), dir.join(format!("{full}.{ext}"))] {
            if candidate.is_file() && !out.contains(&candidate) {
                out.push(candidate);
            }
        }
    }
    out
}

/// Copies the selected files into a date-organised tree, optionally to a second volume too,
/// emitting `ingest-progress` events as it goes.
///
/// ⚠️ Takes the frontend's own `scan_card` result rather than a source path to re-scan. Before
/// this, `ingest_run` called `scan_card` internally — so every card file's EXIF got read AND
/// the whole destination tree got walked TWICE per import: once for the modal's preview, once
/// again here. The card-side EXIF read is the expensive half (a RAW's metadata read is real
/// I/O); the destination-side duplicate check is re-run anyway, fresh, because it's cheap and
/// because the user can change "Copy to" in the modal after the initial scan — trusting a
/// stale `duplicate` flag from a different destination would be wrong, not just slow.
///
/// ⚠️ Every per-file failure is collected and the loop continues — the same lesson exportFX()'s
/// per-photo try/catch encodes (CLAUDE.md §4): one bad file on a flaky card must not discard the
/// hundreds that copied fine before it.
#[tauri::command]
pub fn ingest_copy(app: tauri::AppHandle, files: Vec<CardFile>, options: IngestOptions) -> Result<IngestResult, String> {
    use tauri::Emitter;
    ingest_run(files, options, &mut |p| { let _ = app.emit("ingest-progress", p); })
}

/// The whole import, minus the event emitting — split out for the same reason applyGeomTo was
/// split from geomCanvas (CLAUDE.md §12): the AppHandle is the only thing standing between this
/// logic and a test, and file layout is exactly the part worth testing against real files rather
/// than reasoning about.
pub fn ingest_run(
    files: Vec<CardFile>,
    options: IngestOptions,
    progress: &mut dyn FnMut(IngestProgress),
) -> Result<IngestResult, String> {
    let dest_root = PathBuf::from(&options.dest_root);
    if options.dest_root.is_empty() {
        return Err("no destination chosen".into());
    }
    std::fs::create_dir_all(&dest_root).map_err(|e| format!("create destination: {e}"))?;

    // Duplicate flags are re-verified against the destination NOW, not trusted from whatever
    // scan produced `files` — see the doc comment above.
    let existing = index_destination(&dest_root);
    let mut all = files;
    for f in all.iter_mut() {
        f.duplicate = existing.get(&f.name).is_some_and(|&s| s == f.size);
    }

    let after_only: Vec<CardFile> = all
        .into_iter()
        .filter(|f| options.only.is_empty() || options.only.iter().any(|p| p == &f.path))
        .collect();
    let duplicates_skipped = after_only.iter().filter(|f| options.skip_duplicates && f.duplicate).count();
    let wanted: Vec<CardFile> = after_only
        .into_iter()
        .filter(|f| !(options.skip_duplicates && f.duplicate))
        .collect();

    let folder_tpl = options.folder_template.clone().unwrap_or_else(|| "{YYYY}/{YYYY-MM-DD}".into());
    let backup_root = options.backup_root.clone().filter(|s| !s.is_empty()).map(PathBuf::from);
    let bytes_total: u64 = wanted.iter().map(|f| f.size).sum();
    let total = wanted.len();

    let mut result = IngestResult {
        copied: 0,
        duplicates_skipped,
        failed: Vec::new(),
        dest_root: options.dest_root.clone(),
        bytes: 0,
    };

    for (i, f) in wanted.iter().enumerate() {
        progress(IngestProgress {
            done: i,
            total,
            current: f.name.clone(),
            bytes_done: result.bytes,
            bytes_total,
        });

        let date = f.date.clone().unwrap_or_else(|| "0000-00-00".into());
        let src = Path::new(&f.path);
        let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("photo");
        let ext = src.extension().and_then(|s| s.to_str()).unwrap_or("");
        let out_name = match options.filename_template.as_deref().filter(|t| !t.is_empty()) {
            Some(tpl) => {
                let base = expand_filename(tpl, stem, &date, i + 1);
                if ext.is_empty() { base } else { format!("{base}.{ext}") }
            }
            None => f.name.clone(),
        };
        let dir = dest_root.join(expand_folder(&folder_tpl, &date));
        // ⚠️ unique_dest, not a bare join: two cameras (or two cards) routinely produce the same
        // DSC_0001.JPG, and silently overwriting one shoot with another is unrecoverable.
        let dest = crate::unique_dest_pub(&dir, &out_name);

        match copy_verified(src, &dest) {
            Ok(n) => {
                result.copied += 1;
                result.bytes += n;
                // Sidecars follow their photo, under the photo's final (possibly renamed) stem so
                // the pairing survives a rename template.
                let dest_stem = dest.file_stem().and_then(|s| s.to_str()).unwrap_or(stem).to_string();
                for side in sidecars_for(src) {
                    let side_ext = ext_lower(&side);
                    // Panasonic writes NAME.RW2.rrdata, so preserve the doubled form.
                    let side_name = if side.file_stem().and_then(|s| s.to_str()) == Some(&format!("{stem}.{ext}")) {
                        format!("{dest_stem}.{ext}.{side_ext}")
                    } else {
                        format!("{dest_stem}.{side_ext}")
                    };
                    if let Err(e) = copy_verified(&side, &dir.join(&side_name)) {
                        result.failed.push(format!("{side_name}: {e}"));
                    }
                }
                if let Some(backup) = &backup_root {
                    let bdir = backup.join(expand_folder(&folder_tpl, &date));
                    let bdest = crate::unique_dest_pub(&bdir, &out_name);
                    if let Err(e) = copy_verified(src, &bdest) {
                        // A failed BACKUP copy is reported but does not fail the file: the primary
                        // copy is already written and verified, and losing the whole import
                        // because a second disk filled up would be the wrong call.
                        result.failed.push(format!("{} (backup): {e}", f.name));
                    }
                }
            }
            Err(e) => result.failed.push(format!("{}: {e}", f.name)),
        }
    }

    progress(IngestProgress { done: total, total, current: String::new(), bytes_done: result.bytes, bytes_total });
    Ok(result)
}

/// Ejects a volume via diskutil. Only offered after a successful import — the UI never presents it
/// while files are still copying.
#[tauri::command]
pub fn eject_volume(path: String) -> Result<(), String> {
    let out = std::process::Command::new("/usr/sbin/diskutil")
        .arg("eject")
        .arg(&path)
        .output()
        .map_err(|e| format!("run diskutil: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_and_filename_templates_expand() {
        assert_eq!(expand_folder("{YYYY}/{YYYY-MM-DD}", "2026-08-15"), "2026/2026-08-15");
        assert_eq!(expand_folder("{YYYY}/{MM}/{DD}", "2026-08-15"), "2026/08/15");
        assert_eq!(expand_filename("{YYYY-MM-DD}_{name}", "__TM4202", "2026-08-15", 7), "2026-08-15___TM4202");
        assert_eq!(expand_filename("shoot_{n}", "x", "2026-08-15", 7), "shoot_0007");
    }

    #[test]
    fn civil_date_conversion_is_exact() {
        // Day numbers cross-checked against Python's datetime rather than worked out by hand —
        // the first version of this test asserted 19_951 for 2024-08-15, which is a day late.
        assert_eq!(civil_from_days(0), "1970-01-01");
        assert_eq!(civil_from_days(19_950), "2024-08-15");
        assert_eq!(civil_from_days(20_680), "2026-08-15");
        // A leap day, the case an off-by-one in the era maths lands on.
        assert_eq!(civil_from_days(19_782), "2024-02-29");
    }

    #[test]
    fn copy_verifies_and_cleans_up() {
        let dir = std::env::temp_dir().join(format!("cs_ingest_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("a.jpg");
        std::fs::write(&src, vec![7u8; 4096]).unwrap();

        let dest = dir.join("out/a.jpg");
        assert_eq!(copy_verified(&src, &dest).unwrap(), 4096);
        assert_eq!(std::fs::read(&dest).unwrap().len(), 4096);
        // Parent directories are created on demand.
        assert!(dest.parent().unwrap().is_dir());

        assert!(copy_verified(&dir.join("missing.jpg"), &dir.join("out/b.jpg")).is_err());
        assert!(!dir.join("out/b.jpg").exists(), "a failed copy must not leave a file behind");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scan_finds_media_and_flags_duplicates() {
        let root = std::env::temp_dir().join(format!("cs_scan_{}", std::process::id()));
        let card = root.join("card/DCIM/100LUMIX");
        let dest = root.join("dest/2026");
        std::fs::create_dir_all(&card).unwrap();
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::write(card.join("P1000001.RW2"), vec![1u8; 100]).unwrap();
        std::fs::write(card.join("P1000002.JPG"), vec![2u8; 200]).unwrap();
        std::fs::write(card.join("readme.txt"), b"not media").unwrap();
        std::fs::write(card.join(".hidden.jpg"), vec![3u8; 50]).unwrap();
        // Already imported, byte-for-byte.
        std::fs::write(dest.join("P1000001.RW2"), vec![1u8; 100]).unwrap();

        let found = scan_card(
            root.join("card").to_string_lossy().into_owned(),
            Some(root.join("dest").to_string_lossy().into_owned()),
        ).unwrap();

        let names: Vec<&str> = found.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, vec!["P1000001.RW2", "P1000002.JPG"], "non-media and dotfiles excluded");
        assert!(found[0].duplicate, "an identically-sized file at the destination is a duplicate");
        assert!(!found[1].duplicate);
        assert_eq!(found[0].kind, "raw");
        assert_eq!(found[1].kind, "jpeg");

        std::fs::remove_dir_all(&root).ok();
    }

    /// The whole import, against REAL photos with real EXIF dates, laid out the way a card is.
    /// The unit tests above each cover one helper; this is the one that would catch them composing
    /// wrongly — a date read but not used, a sidecar copied to the wrong folder, a second copy
    /// that silently didn't happen.
    #[test]
    fn full_import_lays_out_real_photos_by_capture_date() {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../geneva");
        if !repo.exists() {
            eprintln!("skipping: geneva/ not present in this checkout");
            return;
        }
        // Two photos shot 2026-08-03 and one 2026-08-04, so a correct import produces two dated
        // folders — which filesystem mtime (all identical, set by the copy below) would not.
        //
        // ⚠️ These dates are DateTimeOriginal, and they are NOT what `sips -g creation` or Finder
        // shows: those report EXIF DateTime, which for these very files is 2 and 5 days LATER
        // (2026-08-05 / 2026-08-09) because an editor rewrote them. Reading the wrong one would
        // file a shoot under the day it was last touched, and this test was first written with
        // sips' numbers and failed for exactly that reason.
        let sources = ["__TM4202", "__TM4304", "__TM4666"];
        let root = std::env::temp_dir().join(format!("cs_full_ingest_{}", std::process::id()));
        let card = root.join("card/DCIM/100LUMIX");
        std::fs::create_dir_all(&card).unwrap();
        let mut present = 0;
        for name in sources {
            let src = repo.join(format!("{name}.jpg"));
            if !src.exists() { continue; }
            std::fs::copy(&src, card.join(format!("{name}.jpg"))).unwrap();
            let side = repo.join(format!("{name}.xmp"));
            if side.exists() { std::fs::copy(&side, card.join(format!("{name}.xmp"))).unwrap(); }
            present += 1;
        }
        if present == 0 {
            eprintln!("skipping: none of the expected photos are present");
            std::fs::remove_dir_all(&root).ok();
            return;
        }
        std::fs::write(card.join("notes.txt"), b"ignored").unwrap();

        let dest = root.join("dest");
        let backup = root.join("backup");
        let card_path = root.join("card").to_string_lossy().into_owned();
        let scanned = scan_card(card_path.clone(), None).expect("scan_card");
        let mut ticks = 0usize;
        let res = ingest_run(
            scanned,
            IngestOptions {
                dest_root: dest.to_string_lossy().into_owned(),
                backup_root: Some(backup.to_string_lossy().into_owned()),
                folder_template: None, // the "{YYYY}/{YYYY-MM-DD}" default
                filename_template: None,
                skip_duplicates: true,
                only: Vec::new(),
            },
            &mut |_p| ticks += 1,
        ).expect("import");

        assert_eq!(res.copied, present, "every photo should copy: {:?}", res.failed);
        assert!(res.failed.is_empty(), "unexpected failures: {:?}", res.failed);
        assert!(res.bytes > 0);
        assert!(ticks >= present, "progress should tick per file, got {ticks}");

        // Dated folders come from EXIF, not mtime — every file was just copied, so all mtimes are
        // today, and a mtime-based import would put them all in one folder.
        let day = |d: &str, n: &str| dest.join(format!("2026/{d}/{n}"));
        if repo.join("__TM4202.jpg").exists() {
            assert!(day("2026-08-03", "__TM4202.jpg").is_file(), "photo not in its capture-date folder");
            assert!(day("2026-08-03", "__TM4202.xmp").is_file(), "sidecar did not follow its photo");
            assert!(backup.join("2026/2026-08-03/__TM4202.jpg").is_file(), "second copy missing");
        }
        if repo.join("__TM4666.jpg").exists() {
            assert!(day("2026-08-04", "__TM4666.jpg").is_file(), "a different shoot day needs its own folder");
        }

        // Re-importing the same card copies nothing: this is the "I put the card back in" case,
        // and getting it wrong means 400 duplicates. Deliberately re-scans with dest_root=None
        // (as the modal's very first scan does, before a destination is even chosen) — the
        // duplicate flags must still come out right because ingest_run re-verifies them against
        // the REAL destination itself now, not whatever the passed-in scan happened to compute.
        let rescanned = scan_card(card_path, None).expect("rescan");
        let again = ingest_run(
            rescanned,
            IngestOptions {
                dest_root: dest.to_string_lossy().into_owned(),
                backup_root: None,
                folder_template: None,
                filename_template: None,
                skip_duplicates: true,
                only: Vec::new(),
            },
            &mut |_p| {},
        ).expect("re-import");
        assert_eq!(again.copied, 0, "a second import of the same card must copy nothing");
        assert_eq!(again.duplicates_skipped, present, "every file should be reported as a skipped duplicate");

        std::fs::remove_dir_all(&root).ok();
    }

    /// The runtime break, pinned exactly: deserializes the LITERAL JSON `library-ui.js` sends
    /// for `ingest_copy`'s `options` argument — camelCase keys, nested inside the command call —
    /// rather than a hand-built `IngestOptions`. A hand-built struct is what let this ship broken
    /// the first time: it bypasses serde's field-name matching entirely. Before
    /// `#[serde(rename_all = "camelCase")]`, this failed with "missing field `dest_root`".
    #[test]
    fn ingest_options_deserialize_from_the_exact_ui_json() {
        let json = r#"{
            "destRoot": "/Volumes/Archive/Originals",
            "backupRoot": "/Volumes/Backup",
            "folderTemplate": "{YYYY}/{YYYY-MM-DD}",
            "filenameTemplate": "",
            "skipDuplicates": true,
            "only": []
        }"#;
        let opts: IngestOptions = serde_json::from_str(json).expect("UI's exact camelCase JSON must deserialize");
        assert_eq!(opts.dest_root, "/Volumes/Archive/Originals");
        assert_eq!(opts.backup_root.as_deref(), Some("/Volumes/Backup"));
        assert!(opts.skip_duplicates);

        // And the minimal shape the modal sends when the optional fields are left at defaults —
        // `#[serde(default)]` covers everything but dest_root, which the UI always sets.
        let minimal = r#"{"destRoot": "/tmp/x"}"#;
        let opts2: IngestOptions = serde_json::from_str(minimal).expect("minimal camelCase JSON must deserialize");
        assert_eq!(opts2.dest_root, "/tmp/x");
        assert!(opts2.backup_root.is_none());
        assert!(!opts2.skip_duplicates);
    }

    /// `duplicates_skipped` must reflect files that were skipped BECAUSE they were duplicates —
    /// not, as the old `total - copied` formula did, silently double as a failure count. A
    /// failed file and a skipped duplicate must be distinguishable in the result.
    #[test]
    fn duplicates_skipped_is_not_a_failure_count() {
        let root = std::env::temp_dir().join(format!("cs_dupcount_{}", std::process::id()));
        let card = root.join("card");
        let dest = root.join("dest/2026/2026-01-01");
        std::fs::create_dir_all(&card).unwrap();
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::write(card.join("a.jpg"), vec![1u8; 10]).unwrap();
        std::fs::write(card.join("b.jpg"), vec![2u8; 20]).unwrap();
        std::fs::write(dest.join("a.jpg"), vec![1u8; 10]).unwrap(); // pre-existing duplicate of a.jpg

        let scanned = scan_card(card.to_string_lossy().into_owned(), None).unwrap();
        let res = ingest_run(
            scanned,
            IngestOptions {
                dest_root: root.join("dest").to_string_lossy().into_owned(),
                backup_root: None,
                folder_template: None,
                filename_template: None,
                skip_duplicates: true,
                only: Vec::new(),
            },
            &mut |_p| {},
        ).expect("import");

        assert_eq!(res.copied, 1, "only the new file should copy");
        assert_eq!(res.duplicates_skipped, 1, "the pre-existing duplicate must be counted here, not folded into failures");
        assert!(res.failed.is_empty(), "a skipped duplicate is not a failure");

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn sidecars_follow_their_photo() {
        let dir = std::env::temp_dir().join(format!("cs_side_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let raw = dir.join("__TM4202.RW2");
        std::fs::write(&raw, b"raw").unwrap();
        std::fs::write(dir.join("__TM4202.xmp"), b"edits").unwrap();
        // Panasonic's doubled extension, which a plain stem match would miss.
        std::fs::write(dir.join("__TM4202.RW2.rrdata"), b"rr").unwrap();
        std::fs::write(dir.join("__TM4203.xmp"), b"other photo's edits").unwrap();

        let found = sidecars_for(&raw);
        let names: Vec<String> = found.iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert!(names.contains(&"__TM4202.xmp".to_string()), "got {names:?}");
        assert!(names.contains(&"__TM4202.RW2.rrdata".to_string()), "doubled extension missed: {names:?}");
        assert!(!names.contains(&"__TM4203.xmp".to_string()), "another photo's sidecar must not follow");

        std::fs::remove_dir_all(&dir).ok();
    }
}
