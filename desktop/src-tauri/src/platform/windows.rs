//! Windows implementations of the `platform` surface. See the Windows-port plan (linked from
//! CLAUDE.md) for the reasoning behind each choice.
//!
//! WIC-based thumbnail decode and Media Foundation video posters are big enough to be their own
//! modules (`winthumb.rs`, `winvideothumb.rs`, not yet written — see the plan's Phase 2) rather
//! than living here; this file covers the platform:: surface itself.

use std::path::{Path, PathBuf};
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, MAX_PATH};
use windows::Win32::Storage::FileSystem::{
    GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives, GetVolumePathNameW, CreateFileW,
    SetFileTime, FILE_GENERIC_WRITE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    FILE_FLAG_BACKUP_SEMANTICS, DRIVE_REMOVABLE,
};
use windows::Win32::System::Com::{
    CoInitializeEx, CoCreateInstance, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{
    FileOperation, IFileOperation, IShellItem, SHCreateItemFromParsingName, SHGetKnownFolderPath,
    FOLDERID_LocalAppData, FOLDERID_RoamingAppData, FOLDERID_Profile, FOLDERID_Downloads,
    FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_SILENT, KF_FLAG_DEFAULT,
};

/// `\\?\` verbatim-prefixes an absolute path so Win32 file calls bypass the 260-char MAX_PATH
/// limit. Cheap, and the failure mode without it ("path not found" on a perfectly real deeply
/// nested cache/catalog path) is genuinely confusing to diagnose — see the Windows-port plan.
pub fn long_path(p: &Path) -> PathBuf {
    if !p.is_absolute() {
        return p.to_path_buf();
    }
    let s = p.to_string_lossy();
    if s.starts_with(r"\\?\") {
        return p.to_path_buf();
    }
    PathBuf::from(format!(r"\\?\{s}"))
}

fn known_folder(id: &windows::core::GUID) -> Result<PathBuf, String> {
    unsafe {
        let pwstr = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None)
            .map_err(|e| format!("SHGetKnownFolderPath: {e}"))?;
        let s = pwstr.to_string().map_err(|e| format!("known folder not UTF-16: {e}"))?;
        windows::Win32::System::Com::CoTaskMemFree(Some(pwstr.0 as *const _));
        Ok(PathBuf::from(s))
    }
}

pub fn home_dir() -> Result<PathBuf, String> {
    known_folder(&FOLDERID_Profile).or_else(|_| {
        std::env::var_os("USERPROFILE").map(PathBuf::from).ok_or_else(|| "USERPROFILE not set".into())
    })
}

/// `%LOCALAPPDATA%\Chromasmith` — the Windows analogue of `~/Library/Caches`. Callers append
/// their own subdir (`thumbnails`, `decode`), same as the macOS side.
pub fn cache_root() -> PathBuf {
    known_folder(&FOLDERID_LocalAppData)
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("Chromasmith")
}

/// `%APPDATA%\Chromasmith` — the Windows analogue of `~/Library/Application Support`.
pub fn data_root() -> PathBuf {
    let dir = known_folder(&FOLDERID_RoamingAppData)
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("Chromasmith");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn documents_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join("Documents"))
}

pub fn downloads_dir() -> Result<PathBuf, String> {
    known_folder(&FOLDERID_Downloads)
}

/// Windows has no single "Trash" directory to move a file into — `move_to_trash` below sends
/// straight to the Recycle Bin via IFileOperation instead. Kept for API-surface parity with the
/// macOS side; not used by callers on this platform.
pub fn trash_dir() -> Result<PathBuf, String> {
    Err("Windows has no filesystem trash directory — use move_to_trash".into())
}

pub fn disk_bytes(path: &Path) -> (u64, u64) {
    let wide = HSTRING::from(path.as_os_str());
    let mut free_avail = 0u64;
    let mut total = 0u64;
    // SAFETY: three valid out-pointers to u64; wide is a live HSTRING for the call's duration.
    let ok = unsafe {
        GetDiskFreeSpaceExW(PCWSTR(wide.as_ptr()), Some(&mut free_avail), Some(&mut total), None)
    };
    if ok.is_ok() {
        (total, free_avail)
    } else {
        (0, 0)
    }
}

/// The root of the volume containing `path` (e.g. `D:\`), analogous to `statfs`'s `f_mntonname`.
pub fn mount_point(path: &Path) -> Option<String> {
    let wide = HSTRING::from(path.as_os_str());
    let mut buf = vec![0u16; MAX_PATH as usize];
    // SAFETY: buf is sized MAX_PATH as the API requires; wide is a live HSTRING for the call.
    let ok = unsafe { GetVolumePathNameW(PCWSTR(wide.as_ptr()), &mut buf) };
    if ok.is_err() {
        return None;
    }
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..len]))
}

/// Compares the volume root against the Windows system drive's root — the Win32 analogue of
/// the macOS APFS-volume-group check in `macos.rs::is_boot_volume`, and genuinely simpler:
/// Windows has no split system/data volume group to account for.
pub fn is_boot_volume(mount_point: &str) -> bool {
    let sys_root = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
    let sys_root = format!("{}\\", sys_root.trim_end_matches('\\'));
    mount_point.eq_ignore_ascii_case(&sys_root)
}

pub fn volume_identity_hint(path: &Path) -> Option<String> {
    // GetVolumeInformationW's serial number would go here; deferred until real hardware is
    // available to verify against — see the Windows-port plan's Phase 2/hands-on list.
    mount_point(path)
}

/// Every fixed or removable drive letter except the boot volume. Unlike macOS's `/Volumes`
/// (removable-only), Windows drive letters mix internal secondary drives with real removable
/// media — `ingest.rs`'s own `has_dcim` sort already prioritises card-shaped folders, so this
/// deliberately returns both classes rather than trying to out-guess `GetDriveTypeW`.
pub fn list_removable() -> Result<Vec<PathBuf>, String> {
    // SAFETY: GetLogicalDrives takes no arguments and cannot fail.
    let mask = unsafe { GetLogicalDrives() };
    if mask == 0 {
        return Err("GetLogicalDrives failed".into());
    }
    let mut out = Vec::new();
    for i in 0..26u32 {
        if mask & (1 << i) == 0 {
            continue;
        }
        let letter = (b'A' + i as u8) as char;
        let root = format!("{letter}:\\");
        if is_boot_volume(&root) {
            continue;
        }
        let wide = HSTRING::from(root.as_str());
        // SAFETY: wide is a live, NUL-terminated wide string for the call.
        let drive_type = unsafe { GetDriveTypeW(PCWSTR(wide.as_ptr())) };
        if drive_type == DRIVE_REMOVABLE || drive_type.0 == windows::Win32::Storage::FileSystem::DRIVE_FIXED.0 {
            out.push(PathBuf::from(root));
        }
    }
    Ok(out)
}

/// Best-effort eject. `IOCTL_STORAGE_EJECT_MEDIA` needs a handle to the physical device (not the
/// volume) and admin rights on some configurations; a failed eject here should never block the
/// import that already completed, so callers treat this as advisory. Verify against real
/// hardware before relying on it (Windows-port plan, hands-on list item 5).
pub fn eject(_path: &Path) -> Result<(), String> {
    Err("eject: not yet implemented for Windows — safe to remove the drive manually once import finishes".into())
}

/// Reveals a file in Explorer, selected — the Win32 analogue of `open -R`.
pub fn reveal_in_file_manager(path: &str) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(format!("/select,{path}"))
        .spawn()
        .map(|_| ())
        // explorer.exe returns a non-zero/odd status on success by convention; spawn succeeding
        // is the only signal worth checking.
        .map_err(|e| format!("explorer /select: {e}"))
}

pub fn open_url(url: &str) -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("start: {e}"))
}

/// Sets a file's mtime to `unix_secs`, via `SetFileTime`. Uses `\\?\`-prefixed opens so this
/// works on deeply nested catalog paths past MAX_PATH.
pub fn set_file_mtime(path: &Path, unix_secs: i64) -> Result<(), String> {
    let long = long_path(path);
    let wide = HSTRING::from(long.as_os_str());
    // Unix epoch -> Windows FILETIME (100ns ticks since 1601-01-01).
    let ticks: i64 = unix_secs * 10_000_000 + 116_444_736_000_000_000;
    let ft = windows::Win32::Foundation::FILETIME {
        dwLowDateTime: (ticks & 0xFFFF_FFFF) as u32,
        dwHighDateTime: ((ticks >> 32) & 0xFFFF_FFFF) as u32,
    };
    unsafe {
        let handle: HANDLE = CreateFileW(
            PCWSTR(wide.as_ptr()),
            FILE_GENERIC_WRITE.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            None,
        )
        .map_err(|e| format!("CreateFileW({}): {e}", path.display()))?;
        let res = SetFileTime(handle, None, None, Some(&ft));
        let _ = CloseHandle(handle);
        res.map_err(|e| format!("SetFileTime({}): {e}", path.display()))
    }
}

/// Moves a file to the Recycle Bin via `IFileOperation`.
///
/// ⚠️ Shell COM objects require a single-threaded apartment (STA). Tauri `invoke` handlers run
/// on a multi-threaded async pool (MTA) — calling `IFileOperation` straight from a command
/// handler will fail or panic. This spawns a dedicated OS thread, initialises COM as STA on it,
/// runs the operation, and joins — never call the private `move_to_trash_sta` directly from an
/// async context.
pub fn move_to_trash(path: &Path) -> Result<(), String> {
    let path = path.to_path_buf();
    std::thread::spawn(move || move_to_trash_sta(&path))
        .join()
        .map_err(|_| "trash worker thread panicked".to_string())?
}

fn move_to_trash_sta(path: &Path) -> Result<(), String> {
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| format!("CoInitializeEx: {e}"))?;
        let result = (|| -> Result<(), String> {
            let op: IFileOperation =
                CoCreateInstance(&FileOperation, None, CLSCTX_ALL).map_err(|e| format!("CoCreateInstance(FileOperation): {e}"))?;
            op.SetOperationFlags(FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT)
                .map_err(|e| format!("SetOperationFlags: {e}"))?;
            let wide = HSTRING::from(long_path(path).as_os_str());
            let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None)
                .map_err(|e| format!("SHCreateItemFromParsingName({}): {e}", path.display()))?;
            op.DeleteItem(&item, None).map_err(|e| format!("IFileOperation::DeleteItem: {e}"))?;
            op.PerformOperations().map_err(|e| format!("IFileOperation::PerformOperations: {e}"))
        })();
        CoUninitialize();
        result
    }
}

/// The ONNX Runtime shared-library filename bundled under `vendor/onnxruntime/`.
pub fn ort_lib_filename() -> &'static str {
    "onnxruntime.dll"
}
