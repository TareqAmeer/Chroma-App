//! Windows implementations of the `platform` surface. See docs/windows-port.md for the reasoning
//! behind each choice, the status of the port, and what's still open.
//!
//! WIC-based thumbnail decode and Media Foundation video posters are big enough to be their own
//! modules (`winthumb.rs`, `winvideothumb.rs`, not yet written — see that doc's Phase 2) rather
//! than living here; this file covers the platform:: surface itself.

use std::path::{Path, PathBuf};
use windows::core::{implement, HSTRING, PCWSTR, HRESULT};
use windows::Win32::Foundation::{CloseHandle, HANDLE, MAX_PATH};
use windows::Win32::Storage::FileSystem::{
    GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives, GetVolumePathNameW, GetVolumeNameForVolumeMountPointW, CreateFileW,
    SetFileTime, MoveFileW, FILE_GENERIC_WRITE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    FILE_FLAG_BACKUP_SEMANTICS,
};

// GetDriveTypeW returns a bare u32, not a typed constant from the `windows` crate (0.58 doesn't
// wrap these) — these match the values documented for GetDriveTypeW at
// https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-getdrivetypew.
const DRIVE_REMOVABLE: u32 = 2;
const DRIVE_FIXED: u32 = 3;
use windows::Win32::System::Com::{
    CoInitializeEx, CoCreateInstance, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{
    FileOperation, IFileOperation, IFileOperationProgressSink, IFileOperationProgressSink_Impl, IShellItem, SHCreateItemFromParsingName, SHGetKnownFolderPath,
    FOLDERID_LocalAppData, FOLDERID_RoamingAppData, FOLDERID_Profile, FOLDERID_Downloads, FOLDERID_ProgramData,
    FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_SILENT, FOF_RENAMEONCOLLISION, KF_FLAG_DEFAULT, SIGDN_DESKTOPABSOLUTEPARSING, SIGDN_FILESYSPATH,
};
use windows::Win32::System::Com::CoTaskMemFree;
use std::sync::{Arc, Mutex};

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
    // A UNC path's verbatim form REPLACES the leading "\\" with "UNC\" — it is NOT simply "\\?\"
    // glued onto the original, which would produce "\\?\\\server\share" (four leading
    // backslashes), a different and invalid path (docs/windows-port.md G7: this used to be the
    // whole function, and it broke every NAS/network-share library). Forward slashes (a UNC path
    // can arrive as "//server/share/..." too, and Win32 file APIs require backslashes in the
    // verbatim form even though they accept "/" in the non-verbatim one) are normalized either way.
    let backslashed = s.replace('/', "\\");
    if let Some(unc_rest) = backslashed.strip_prefix(r"\\") {
        return PathBuf::from(format!(r"\\?\UNC\{unc_rest}"));
    }
    PathBuf::from(format!(r"\\?\{backslashed}"))
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

/// Where Adobe Camera Raw's installed camera profiles live on Windows (docs/windows-port.md
/// G10) — the Windows analogue of macos.rs's `adobe_profile_roots`, following the SAME real
/// on-disk shapes Adobe uses per-OS: per-user under roaming AppData, all-users under ProgramData
/// (the Windows equivalent of macOS's `/Library` for machine-wide, not-this-user-only data).
/// `bool` marks the per-camera-subfolder shape (`Camera\`) vs the flat one-file-per-camera shape
/// (`Adobe Standard\`) — see `dcp_store.rs`'s own module doc comment for what those look like.
pub fn adobe_profile_roots() -> Vec<(&'static str, PathBuf, bool)> {
    const CAMERA_TREE: &str = "Adobe\\CameraRaw\\CameraProfiles\\Camera";
    const ADOBE_STANDARD_TREE: &str = "Adobe\\CameraRaw\\CameraProfiles\\Adobe Standard";
    let mut roots = Vec::new();
    if let Ok(roaming) = known_folder(&FOLDERID_RoamingAppData) {
        roots.push(("user-camera", roaming.join(CAMERA_TREE), true));
    }
    if let Ok(program_data) = known_folder(&FOLDERID_ProgramData) {
        roots.push(("system-camera", program_data.join(CAMERA_TREE), true));
        roots.push(("adobe-standard", program_data.join(ADOBE_STANDARD_TREE), false));
    }
    roots
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

/// A `\\?\Volume{GUID}\` path identifying the volume — stable across a drive-letter
/// reassignment (a card reader/external drive reconnecting as a different letter), unlike
/// `mount_point`'s own return value. `catalog.rs`'s `volume_identity` prefers this over the
/// drive letter for its read-only-media fingerprint fallback (docs/windows-port.md G8).
pub fn volume_identity_hint(path: &Path) -> Option<String> {
    let root = mount_point(path)?;
    let wide = HSTRING::from(root.as_str());
    let mut buf = vec![0u16; 128]; // a GUID volume path ("\\?\Volume{...}\") is always short and fixed-length
    // SAFETY: buf is a live, adequately-sized buffer; wide is a live, NUL-terminated wide string
    // for the call's duration.
    unsafe { GetVolumeNameForVolumeMountPointW(PCWSTR(wide.as_ptr()), &mut buf).ok()? };
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..len]))
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
        if drive_type == DRIVE_REMOVABLE || drive_type == DRIVE_FIXED {
            out.push(PathBuf::from(root));
        }
    }
    Ok(out)
}

/// Best-effort eject via the standard volume-handle sequence (Microsoft KB165721: lock, dismount,
/// allow media removal, eject) — simpler than, and an alternative to, walking the PnP device tree
/// to find an ejectable ancestor DEVINST and calling `CM_Request_Device_EjectW` on it (what an
/// earlier version of this doc comment / the original Windows-port plan proposed). This sequence
/// operates entirely on the VOLUME handle, not the physical disk, so — unlike calling
/// `IOCTL_STORAGE_EJECT_MEDIA` directly on a physical-drive handle — it does not need admin
/// rights for ordinary removable media. A failed eject here should never block the import that
/// already completed, so callers treat this as advisory.
/// ⚠️ Not yet verified against real hardware (no removable drive was plugged into the dev
/// machine this was written on) — see docs/windows-port.md's hands-on verification list.
pub fn eject(path: &Path) -> Result<(), String> {
    use windows::Win32::Foundation::{BOOLEAN, GENERIC_READ};
    use windows::Win32::System::IO::DeviceIoControl;
    use windows::Win32::System::Ioctl::{
        FSCTL_LOCK_VOLUME, FSCTL_DISMOUNT_VOLUME, IOCTL_STORAGE_EJECT_MEDIA, IOCTL_STORAGE_MEDIA_REMOVAL, PREVENT_MEDIA_REMOVAL,
    };
    let root = mount_point(path).ok_or("eject: could not resolve a volume for this path")?;
    // CreateFileW on `\\.\D:` (no trailing backslash — MSDN's own documented form for opening a
    // volume, distinct from `D:\` which opens the root DIRECTORY instead of the volume device).
    let device_path = format!(r"\\.\{}", root.trim_end_matches('\\'));
    let wide = HSTRING::from(device_path.as_str());
    unsafe {
        let handle: HANDLE = CreateFileW(
            PCWSTR(wide.as_ptr()),
            (GENERIC_READ.0 | FILE_GENERIC_WRITE.0) as u32,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES(0),
            None,
        )
        .map_err(|e| format!("CreateFileW({device_path}): {e}"))?;
        let ioctl = |code: u32, in_buf: Option<&[u8]>| -> Result<(), String> {
            let (ptr, len) = in_buf.map(|b| (b.as_ptr() as *const _, b.len() as u32)).unwrap_or((std::ptr::null(), 0));
            DeviceIoControl(handle, code, Some(ptr), len, None, 0, None, None).map_err(|e| format!("DeviceIoControl(0x{code:x}): {e}"))
        };
        let result = (|| -> Result<(), String> {
            ioctl(FSCTL_LOCK_VOLUME, None)?;
            ioctl(FSCTL_DISMOUNT_VOLUME, None)?;
            // PREVENT_MEDIA_REMOVAL { PreventMediaRemoval: BOOLEAN } — FALSE (0) means ALLOW
            // removal, the counter-intuitive-sounding but correct value for actually ejecting.
            let allow_removal = PREVENT_MEDIA_REMOVAL { PreventMediaRemoval: BOOLEAN(0) };
            let allow_removal_bytes = std::slice::from_raw_parts(
                &allow_removal as *const _ as *const u8,
                std::mem::size_of::<PREVENT_MEDIA_REMOVAL>(),
            );
            ioctl(IOCTL_STORAGE_MEDIA_REMOVAL, Some(allow_removal_bytes))?;
            ioctl(IOCTL_STORAGE_EJECT_MEDIA, None)
        })();
        let _ = CloseHandle(handle);
        result
    }
}

/// Reveals a file in Explorer, selected — the Win32 analogue of `open -R`.
pub fn reveal_in_file_manager(path: &str) -> Result<(), String> {
    std::process::Command::new("explorer")
        // Explorer's /select, expects backslashes; a `/` path (duplicate_file returns mixed ones) may not select.
        .arg(format!("/select,{}", path.replace('/', "\\")))
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
    move_to_trash_with_identity(path).map(|_| ())
}

/// Delete through the system Recycle Bin and capture the exact shell identity created by that
/// IFileOperation. No filename/time search through existing Recycle Bin items is used.
pub fn move_to_trash_with_identity(path: &Path) -> Result<crate::trash_undo::PlatformTrashIdentity, String> {
    let path = path.to_path_buf();
    std::thread::spawn(move || move_to_trash_sta(&path))
        .join()
        .map_err(|_| "trash worker thread panicked".to_string())?
}

fn move_to_trash_sta(path: &Path) -> Result<crate::trash_undo::PlatformTrashIdentity, String> {
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| format!("CoInitializeEx: {e}"))?;
        let result = (|| -> Result<crate::trash_undo::PlatformTrashIdentity, String> {
            let op: IFileOperation =
                CoCreateInstance(&FileOperation, None, CLSCTX_ALL).map_err(|e| format!("CoCreateInstance(FileOperation): {e}"))?;
            op.SetOperationFlags(FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT)
                .map_err(|e| format!("SetOperationFlags: {e}"))?;
            let captured = Arc::new(Mutex::new(None));
            let sink: IFileOperationProgressSink = TrashIdentitySink(captured.clone()).into();
            let cookie = op.Advise(&sink).map_err(|e| format!("IFileOperation::Advise: {e}"))?;
            // NOT long_path(): the shell namespace API rejects a `\\?\` verbatim path outright (E_INVALIDARG,
            // 0x80070057 — verified live: trash_file failed for every file), and it also rejects `/`.
            // Plain backslash-separated is what SHCreateItemFromParsingName wants; the shell handles
            // long paths itself.
            let plain = path.to_string_lossy().replace('/', "\\");
            let plain = plain.strip_prefix(r"\\?\").unwrap_or(&plain).to_string();
            let wide = HSTRING::from(plain.as_str());
            let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None)
                .map_err(|e| format!("SHCreateItemFromParsingName({}): {e}", path.display()))?;
            let queued = op.DeleteItem(&item, None);
            if let Err(e) = queued { let _ = op.Unadvise(cookie); return Err(format!("IFileOperation::DeleteItem: {e}")); }
            let performed = op.PerformOperations();
            let aborted = op.GetAnyOperationsAborted();
            let _ = op.Unadvise(cookie);
            if let Some(identity) = captured.lock().unwrap().take() {
                return Ok(crate::trash_undo::PlatformTrashIdentity::WindowsShell(identity));
            }
            performed.map_err(|e| format!("IFileOperation::PerformOperations: {e}"))?;
            if aborted.map_err(|e| format!("check Recycle Bin deletion result: {e}"))?.as_bool() {
                return Err("Windows aborted the Recycle Bin deletion".into());
            }
            Err("Recycle Bin did not return an undo identity for the deleted item".into())
        })();
        CoUninitialize();
        result
    }
}

#[implement(IFileOperationProgressSink)]
struct TrashIdentitySink(Arc<Mutex<Option<String>>>);

#[allow(non_snake_case)]
impl IFileOperationProgressSink_Impl for TrashIdentitySink_Impl {
    fn StartOperations(&self) -> windows::core::Result<()> { Ok(()) }
    fn FinishOperations(&self, _hrresult: HRESULT) -> windows::core::Result<()> { Ok(()) }
    fn PreRenameItem(&self, _dwflags: u32, _psiitem: Option<&IShellItem>, _psznewname: &PCWSTR) -> windows::core::Result<()> { Ok(()) }
    fn PostRenameItem(&self, _dwflags: u32, _psiitem: Option<&IShellItem>, _psznewname: &PCWSTR, _hrrename: HRESULT, _psinewlycreated: Option<&IShellItem>) -> windows::core::Result<()> { Ok(()) }
    fn PreMoveItem(&self, _dwflags: u32, _psiitem: Option<&IShellItem>, _psidestinationfolder: Option<&IShellItem>, _psznewname: &PCWSTR) -> windows::core::Result<()> { Ok(()) }
    fn PostMoveItem(&self, _dwflags: u32, _psiitem: Option<&IShellItem>, _psidestinationfolder: Option<&IShellItem>, _psznewname: &PCWSTR, hrmove: HRESULT, psinewlycreated: Option<&IShellItem>) -> windows::core::Result<()> {
        if hrmove.is_ok() {
            if let Some(item) = psinewlycreated {
                let display = unsafe { item.GetDisplayName(SIGDN_FILESYSPATH)? };
                let identity = unsafe { display.to_string().map_err(|_| windows::core::Error::from_hresult(HRESULT(0x8007000Du32 as i32)))? };
                unsafe { CoTaskMemFree(Some(display.0 as *const _)); }
                *self.this.0.lock().unwrap() = Some(identity);
            }
        }
        Ok(())
    }
    fn PreCopyItem(&self, _dwflags: u32, _psiitem: Option<&IShellItem>, _psidestinationfolder: Option<&IShellItem>, _psznewname: &PCWSTR) -> windows::core::Result<()> { Ok(()) }
    fn PostCopyItem(&self, _dwflags: u32, _psiitem: Option<&IShellItem>, _psidestinationfolder: Option<&IShellItem>, _psznewname: &PCWSTR, _hrcopy: HRESULT, _psinewlycreated: Option<&IShellItem>) -> windows::core::Result<()> { Ok(()) }
    fn PreDeleteItem(&self, _dwflags: u32, _psiitem: Option<&IShellItem>) -> windows::core::Result<()> { Ok(()) }
    fn PostDeleteItem(&self, _dwflags: u32, _psiitem: Option<&IShellItem>, hrdelete: HRESULT, psinewlycreated: Option<&IShellItem>) -> windows::core::Result<()> {
        if hrdelete.is_ok() {
            let item = psinewlycreated.ok_or_else(|| windows::core::Error::from_hresult(HRESULT(0x80004005u32 as i32)))?;
            let display = unsafe { item.GetDisplayName(SIGDN_DESKTOPABSOLUTEPARSING)? };
            let identity = unsafe { display.to_string().map_err(|_| windows::core::Error::from_hresult(HRESULT(0x8007000Du32 as i32)))? };
            unsafe { CoTaskMemFree(Some(display.0 as *const _)); }
            *self.this.0.lock().unwrap() = Some(identity);
        }
        Ok(())
    }
    fn PreNewItem(&self, _dwflags: u32, _psidestinationfolder: Option<&IShellItem>, _psznewname: &PCWSTR) -> windows::core::Result<()> { Ok(()) }
    fn PostNewItem(&self, _dwflags: u32, _psidestinationfolder: Option<&IShellItem>, _psznewname: &PCWSTR, _psztemplatename: &PCWSTR, _dwfileattributes: u32, _hrnew: HRESULT, _psinewitem: Option<&IShellItem>) -> windows::core::Result<()> { Ok(()) }
    fn UpdateProgress(&self, _iworktotal: u32, _iworksofar: u32) -> windows::core::Result<()> { Ok(()) }
    fn ResetTimer(&self) -> windows::core::Result<()> { Ok(()) }
    fn PauseTimer(&self) -> windows::core::Result<()> { Ok(()) }
    fn ResumeTimer(&self) -> windows::core::Result<()> { Ok(()) }
}

enum RestoreFailure {
    Operation(String),
    Retryable(crate::trash_undo::PlatformTrashIdentity, String),
}
impl From<String> for RestoreFailure { fn from(value: String) -> Self { Self::Operation(value) } }
impl From<&str> for RestoreFailure { fn from(value: &str) -> Self { Self::Operation(value.to_string()) } }

/// Restore the exact Recycle Bin shell item to its original path. The shell performs the actual
/// restore so Recycle Bin metadata is removed with the item; occupied paths are rejected first.
pub fn restore_from_trash(identity: &mut crate::trash_undo::PlatformTrashIdentity, destination: &Path) -> Result<(), String> {
    if destination.exists() { return Err(format!("restore refused because the original path is occupied: {}", destination.display())); }
    if let crate::trash_undo::PlatformTrashIdentity::RestoredTemp(temp) = identity {
        let from = HSTRING::from(temp.as_str()); let to = HSTRING::from(destination.as_os_str());
        return unsafe { MoveFileW(PCWSTR(from.as_ptr()), PCWSTR(to.as_ptr())) }
            .map_err(|e| format!("restore retry refused without overwriting the original path: {e}"));
    }
    let shell_identity = match identity {
        crate::trash_undo::PlatformTrashIdentity::WindowsShell(value) => value.clone(),
        _ => return Err("receipt identity is not a Windows Recycle Bin item".into()),
    };
    let destination = destination.to_path_buf();
    let result = std::thread::spawn(move || unsafe {
        if let Err(e) = CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok() {
            return Err(RestoreFailure::Operation(format!("CoInitializeEx: {e}")));
        }
        let result = (|| -> Result<String, RestoreFailure> {
            let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(HSTRING::from(shell_identity.as_str()).as_ptr()), None)
                .map_err(|e| format!("Recycle Bin item is unavailable: {e}"))?;
            let parent = destination.parent().ok_or("restore target has no parent directory")?;
            let plain = parent.to_string_lossy().replace('/', "\\");
            let folder: IShellItem = SHCreateItemFromParsingName(PCWSTR(HSTRING::from(plain.as_str()).as_ptr()), None)
                .map_err(|e| format!("resolve restore folder: {e}"))?;
            // Reserve a unique temporary name. RENAMEONCOLLISION makes the Shell choose another
            // name if anything races this reservation; the progress sink returns the exact file.
            let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
            let temp_name = format!(".chromasmith-restore-{}-{nonce:x}.tmp", std::process::id());
            let temp_placeholder = parent.join(&temp_name);
            let capture = Arc::new(Mutex::new(None));
            let sink: IFileOperationProgressSink = TrashIdentitySink(capture.clone()).into();
            let op: IFileOperation = CoCreateInstance(&FileOperation, None, CLSCTX_ALL).map_err(|e| format!("CoCreateInstance(FileOperation): {e}"))?;
            op.SetOperationFlags(FOF_NOCONFIRMATION | FOF_SILENT | FOF_RENAMEONCOLLISION).map_err(|e| format!("SetOperationFlags: {e}"))?;
            let cookie = op.Advise(&sink).map_err(|e| format!("IFileOperation::Advise: {e}"))?;
            std::fs::OpenOptions::new().write(true).create_new(true).open(&temp_placeholder)
                .map_err(|e| { let _ = op.Unadvise(cookie); format!("reserve collision-safe restore name: {e}") })?;
            let queued = op.MoveItem(&item, &folder, PCWSTR(HSTRING::from(temp_name.as_str()).as_ptr()), None);
            if let Err(e) = queued { let _ = op.Unadvise(cookie); let _ = std::fs::remove_file(&temp_placeholder); return Err(format!("queue exact Recycle Bin restore: {e}").into()); }
            let performed = op.PerformOperations();
            let aborted = op.GetAnyOperationsAborted().map_err(|e| format!("check Recycle Bin restore result: {e}"));
            let _ = op.Unadvise(cookie);
            let performed_error = performed.err().map(|e| e.to_string());
            let aborted_state = aborted.ok().map(|v| v.as_bool());
            let restored = capture.lock().unwrap().take();
            let _ = std::fs::remove_file(&temp_placeholder);
            let restored = restored.ok_or_else(|| {
                if let Some(e) = &performed_error { format!("perform Recycle Bin restore: {e}") }
                else if aborted_state != Some(false) { "Windows aborted the Recycle Bin restore".into() }
                else { "Windows did not confirm which file it restored".into() }
            })?;
            if performed_error.is_some() || aborted_state != Some(false) {
                let detail = performed_error.unwrap_or_else(|| "Windows reported an aborted restore".into());
                let (next_identity, return_detail) = match move_to_trash_sta(Path::new(&restored)) {
                    Ok(identity) => (identity, String::new()),
                    Err(retrash_error) => (crate::trash_undo::PlatformTrashIdentity::RestoredTemp(restored.clone()), format!("; returning item to Recycle Bin also failed: {retrash_error}")),
                };
                return Err(RestoreFailure::Retryable(next_identity, format!("restore operation did not complete cleanly: {detail}{return_detail}")));
            }
            if !Path::new(&restored).is_file() { return Err("Recycle Bin restore callback did not identify an existing file".into()); }
            let from = HSTRING::from(restored.as_str()); let to = HSTRING::from(destination.as_os_str());
            if let Err(e) = MoveFileW(PCWSTR(from.as_ptr()), PCWSTR(to.as_ptr())) {
                let (next_identity, return_detail) = match move_to_trash_sta(Path::new(&restored)) {
                    Ok(identity) => (identity, String::new()),
                    Err(retrash_error) => (crate::trash_undo::PlatformTrashIdentity::RestoredTemp(restored.clone()), format!("; returning item to Recycle Bin also failed: {retrash_error}")),
                };
                return Err(RestoreFailure::Retryable(next_identity, format!("original path could not be placed without overwrite: {e}{return_detail}")));
            }
            Ok(restored)
        })();
        CoUninitialize();
        result
    }).join().map_err(|_| "restore worker thread panicked".to_string())?;
    match result {
        Ok(_) => Ok(()),
        Err(RestoreFailure::Retryable(next_identity, detail)) => {
            let retry_location = match &next_identity { crate::trash_undo::PlatformTrashIdentity::RestoredTemp(path) => Some(path.clone()), _ => None };
            *identity = next_identity;
            if let Some(path) = retry_location { Err(format!("{detail}; exact item remains available for retry at {path}")) }
            else { Err(format!("{detail}; exact item was returned to the Recycle Bin and remains retryable")) }
        }
        Err(RestoreFailure::Operation(error)) => Err(error),
    }
}

/// The ONNX Runtime shared-library filename bundled under `vendor/onnxruntime/`.
pub fn ort_lib_filename() -> &'static str {
    "onnxruntime.dll"
}

/// Loads a shared library from an absolute `path`, forcing DLLs it depends on to resolve from
/// `path`'s own directory first, ahead of `C:\Windows\System32` — where, on many current Windows
/// installs, Windows ML already ships its OWN `onnxruntime.dll` (confirmed present on this port's
/// dev machine). A plain `LoadLibraryW`/`libloading::Library::new` searches System32 before an
/// arbitrary directory that isn't on `PATH`, so without this flag the app can silently load
/// Microsoft's version instead of the one it was built and tested against — a mismatch that would
/// show up only as "AI features behave subtly differently on some machines," not as an error.
/// `LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR` adds `path`'s directory to THIS LoadLibrary call's private
/// search path; `LOAD_LIBRARY_SEARCH_DEFAULT_DIRS` keeps the normal safe default order for
/// anything not found there (application dir, System32, `PATH`) rather than restricting the
/// search to only `path`'s directory, which would break resolving Windows' own base DLLs
/// (kernel32 etc.) that `onnxruntime.dll` itself depends on.
pub fn load_dylib(path: &Path) -> Result<libloading::Library, String> {
    use windows::Win32::System::LibraryLoader::{LOAD_LIBRARY_SEARCH_DEFAULT_DIRS, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR};
    let flags = (LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR.0 | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS.0) as u32;
    unsafe {
        libloading::os::windows::Library::load_with_flags(path, flags)
            .map(libloading::Library::from)
            .map_err(|e| format!("LoadLibraryExW({}): {e}", path.display()))
    }
}

/// Crate-manifest-relative path to the ONNX Runtime library in the DEV TREE — see macos.rs's
/// `ort_lib_dev_path` doc comment for why this exists as a shared platform fn rather than a
/// hardcoded literal at each call site (found the hard way: every one of those call sites was
/// still hardcoding the macOS `.dylib` path, so every ONNX-backed test failed on Windows with a
/// `LoadLibraryExW failed` error even after the crate itself compiled and linked cleanly).
/// `vendor/onnxruntime/win-x64/` (not flattened, unlike the bundled resource) because that's
/// where `docs/windows-port.md`'s G5/G18 fetch puts the gitignored `.dll` — see that directory's
/// own `README.md`.
pub fn ort_lib_dev_path() -> &'static str {
    "vendor/onnxruntime/win-x64/onnxruntime.dll"
}
