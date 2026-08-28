//! macOS bodies — moved verbatim from library.rs/ingest.rs/catalog.rs/subject.rs/main.rs when
//! the `platform` module was introduced. Behaviour must stay byte-identical to before the move;
//! `cargo test` is what proves that.

use std::ffi::{CStr, CString};
use std::path::{Path, PathBuf};

pub fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME").map(PathBuf::from).ok_or_else(|| "HOME not set".into())
}

/// `$HOME/Library/Caches/com.tareq.chromasmith` — created on first use. Callers append their
/// own subdir (`thumbnails`, `decode`), matching the pre-move layout exactly.
pub fn cache_root() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    PathBuf::from(home).join("Library/Caches/com.tareq.chromasmith")
}

/// `$HOME/Library/Application Support/com.tareq.chromasmith` — created on first use.
pub fn data_root() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    let dir = PathBuf::from(home).join("Library/Application Support/com.tareq.chromasmith");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn documents_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join("Documents"))
}

pub fn downloads_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join("Downloads"))
}

/// `$HOME/.Trash` — the destination `trash_file` moves (or copies, cross-volume) into.
pub fn trash_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".Trash"))
}

/// Total/available bytes for the filesystem containing `path`, via `statfs(2)`. Best-effort:
/// callers treat (0, 0) as "couldn't measure", not an error.
pub fn disk_bytes(path: &Path) -> (u64, u64) {
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

fn statfs_mount_point(path: &Path) -> Option<(String, String)> {
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

pub fn mount_point(path: &Path) -> Option<String> {
    statfs_mount_point(path).map(|(onname, _)| onname)
}

/// macOS's split System/Data APFS volume group means a perfectly ordinary path under `/Users`
/// or a temp dir under `/var` (itself a symlink to `/private/var`) resolves via `statfs` to
/// `/System/Volumes/Data`, NOT `/` — every one of the OS's own internal volumes (Data, Preboot,
/// VM, Update, ...) lives under that prefix. A real external drive always shows up under
/// `/Volumes/...` instead, so this prefix check is what actually distinguishes "this Mac" from
/// "an attached drive" on modern macOS; checking only `mount_point == "/"` (the pre-APFS-
/// volume-group assumption) treats the user's own Documents folder as an unmounted external
/// disk, which silently walks nothing (see `volume_identity`'s canonicalize comment).
pub fn is_boot_volume(mount_point: &str) -> bool {
    mount_point == "/" || mount_point.starts_with("/System/Volumes/")
}

pub fn volume_identity_hint(path: &Path) -> Option<String> {
    statfs_mount_point(path).map(|(_, fromname)| fromname)
}

/// Lists mounted volumes. macOS mounts everything removable under /Volumes; the boot disk is
/// excluded by checking which volume "/" lives on rather than by name-matching "Macintosh HD",
/// which is user-renameable and localised.
pub fn list_removable() -> Result<Vec<PathBuf>, String> {
    let root_dev = std::fs::metadata("/").ok().map(|m| {
        use std::os::unix::fs::MetadataExt;
        m.dev()
    });
    let mut out = Vec::new();
    let rd = std::fs::read_dir("/Volumes").map_err(|e| format!("read /Volumes: {e}"))?;
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
        out.push(p);
    }
    Ok(out)
}

pub fn eject(path: &Path) -> Result<(), String> {
    let status = std::process::Command::new("/usr/sbin/diskutil")
        .arg("eject")
        .arg(path)
        .status()
        .map_err(|e| format!("diskutil eject: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("diskutil eject exited with {status}"))
    }
}

/// Reveal a file in Finder — standard file-browser context-menu expectation.
pub fn reveal_in_file_manager(path: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("open -R: {e}"))
}

pub fn open_url(url: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("open: {e}"))
}

/// Sets a file's mtime to `unix_secs`, via `utimes(2)`.
pub fn set_file_mtime(path: &Path, unix_secs: i64) -> Result<(), String> {
    let cpath = CString::new(path.to_str().ok_or("non-UTF8 path")?).map_err(|e| e.to_string())?;
    let tv = libc::timeval { tv_sec: unix_secs as libc::time_t, tv_usec: 0 };
    let times = [tv, tv];
    // SAFETY: cpath is a valid NUL-terminated C string for the lifetime of the call; times is a
    // valid 2-element array as utimes(2) requires.
    let rc = unsafe { libc::utimes(cpath.as_ptr(), times.as_ptr()) };
    if rc == 0 {
        Ok(())
    } else {
        Err(format!("utimes({}) failed", path.display()))
    }
}

/// The ONNX Runtime shared-library filename bundled under `vendor/onnxruntime/`.
pub fn ort_lib_filename() -> &'static str {
    "libonnxruntime.dylib"
}
