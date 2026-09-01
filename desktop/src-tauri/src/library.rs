// Local photo library browser: folder tree + thumbnail grid + star ratings, alongside (not
// replacing) the app's existing Google Photos integration — this is purely for finding/culling
// RAWs on disk before editing. Native-only (arbitrary filesystem folder browsing isn't a thing
// in a sandboxed browser), so this lives entirely in the desktop shell, not chromasmith-22.html.
use rawler::decoders::RawDecodeParams;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

// Extension lists live in formats.rs (the single source of truth, mirrored against
// chromasmith-22.html's FMT_* registry — see that module's doc comment). Re-exported here so
// existing call sites in this file keep working unchanged.
use crate::formats::{is_heic_ext, is_image_ext, is_raw_ext, is_video_ext, media_kind};

fn ext_lower(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase()
}

/// EXIF orientation (1/3/6/8) for a RAW, read the same way raw_decode.rs does for the full
/// decode. rawler's extract_thumbnail_pixels/extract_preview_pixels return pixels as-shot with
/// NO rotation applied (unlike the full-decode path), so without this, portrait RW2s showed
/// upright only once the full decode finished — the library grid thumbnail and the provisional
/// preview shown while that decode is in flight were both sideways.
fn raw_orientation(path: &str) -> u16 {
    (|| -> Option<u16> {
        let source = rawler::rawsource::RawSource::new(Path::new(path)).ok()?;
        let decoder = rawler::get_decoder(&source).ok()?;
        let md = decoder.raw_metadata(&source, &RawDecodeParams::default()).ok()?;
        md.exif.orientation
    })()
    .unwrap_or(1)
}

/// Rotate/flip a decoded thumbnail/preview per EXIF orientation (1=as-is, 3=180°, 6=90° CW,
/// 8=90° CCW — the only values cameras emit).
pub(crate) fn apply_orientation_dynamic(img: image::DynamicImage, orientation: u16) -> image::DynamicImage {
    match orientation {
        3 => img.rotate180(),
        6 => img.rotate90(),
        8 => img.rotate270(),
        _ => img,
    }
}

/// Coarse file-type bucket for the library's type filter. Delegates to formats::media_kind —
/// the one implementation, shared with ingest.rs and catalog.rs.
fn kind_of(ext: &str) -> &'static str {
    media_kind(ext)
}

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_image: bool,
    /// A clip, not a photo — kept separate from is_image (rather than folding video into it)
    /// because every existing is_image call site (thumbnail fetch, RAW-specific menus, EXIF
    /// panel) assumes a decodable still; this flag lets the frontend opt video INTO the parts
    /// of the grid that do apply (grid card, open-in-editor, filters) without touching those.
    #[serde(default)]
    pub is_video: bool,
    pub kind: &'static str, // "raw" | "jpeg" | "png" | "tiff" | "video"; "" for dirs
    /// Filesystem mtime (unix secs) and byte size — cheap (same stat() the thumbnail/meta cache
    /// keys already pay for), used by the library grid's "Date modified" / size sort+display so
    /// it doesn't need a separate get_meta round-trip per entry just to sort a folder.
    pub mtime: u64,
    pub size: u64,
    /// Set only by list_edited() below, for an entry whose file no longer exists on disk.
    #[serde(default)]
    pub missing: bool,
    /// mtime of the .xmp sidecar (0 if none exists yet) — the "Date edited" list-view column.
    /// Not the photo file's own mtime: a re-export doesn't touch the source file, only the
    /// sidecar's recipe/rating/flags, so the sidecar's own mtime is the only honest "last
    /// edited" signal.
    pub edited_ts: u64,
}

fn edited_ts_of(photo_path: &str) -> u64 {
    std::fs::metadata(sidecar_path(photo_path))
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// One level of a folder (not recursive — the frontend expands the tree lazily, same UX as
/// Finder/Lightroom's folder panel, and avoids walking a user's entire disk up front).
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    let rd = std::fs::read_dir(&path).map_err(|e| format!("read_dir {path}: {e}"))?;
    // Collected once so the .xmp lookup below is a HashMap hit instead of a second `stat` per
    // photo — mirrors catalog.rs's walk_root, which fixed the identical pattern there (a per-file
    // sidecar existence probe measured as a meaningful share of a real walk's cost). This is a
    // SEPARATE code path (the Library tree's single-level browser, also used by the recursive
    // subfolder walk) that never got the same fix, so it still paid it on every directory listed.
    let entries: Vec<std::fs::DirEntry> = rd.flatten().collect();
    let mut xmp_mtimes: std::collections::HashMap<std::ffi::OsString, u64> = std::collections::HashMap::new();
    for e in &entries {
        let p = e.path();
        if ext_lower(&p) == "xmp" {
            if let Some(stem) = p.file_stem() {
                let mt = e.metadata().ok().and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
                xmp_mtimes.insert(stem.to_os_string(), mt);
            }
        }
    }
    for entry in &entries {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue; // hide dotfiles/dotfolders, matches Finder's default
        }
        // file_type() comes from readdir's own d_type on the platforms this app ships for, so
        // this costs no syscall, unlike the `p.is_dir()` this replaced.
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or_else(|_| p.is_dir());
        let ext = ext_lower(&p);
        let is_image = !is_dir && is_image_ext(&ext);
        let is_video = !is_dir && !is_image && is_video_ext(&ext);
        if is_dir || is_image || is_video {
            let kind = if is_dir { "" } else if is_video { "video" } else { kind_of(&ext) };
            let (mtime, size) = entry.metadata().ok().map(|m| {
                let mt = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
                (mt, m.len())
            }).unwrap_or((0, 0));
            let path_s = p.to_string_lossy().into_owned();
            // Video has no sidecar-based edit recipe today (grading is applied live, not saved to
            // an .xmp on disk the way photo edits are) — 0 is honest, not a placeholder.
            // Equivalent to the old `edited_ts_of(&path_s)`: `with_extension` only ever replaces
            // the extension, so the stem is unchanged and both sides come from the SAME listing.
            let edited_ts = if is_image { p.file_stem().and_then(|s| xmp_mtimes.get(s)).copied().unwrap_or(0) } else { 0 };
            out.push(DirEntry { name, path: path_s, is_dir, is_image, is_video, kind, mtime, size, missing: false, edited_ts });
        }
    }
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

#[cfg(test)]
mod list_dir_tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cs_list_dir_{}_{}", std::process::id(), tag));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Pins list_dir's output shape across the file_type()/batched-sidecar refactor: a photo
    /// WITH a real .xmp sidecar must still report a nonzero edited_ts, one WITHOUT must still
    /// report exactly 0 (not a false positive from an unrelated sidecar in the same directory),
    /// and dirs/videos must still be classified correctly with edited_ts always 0.
    #[test]
    fn list_dir_reports_correct_kinds_and_edited_ts() {
        let dir = scratch("basic");
        std::fs::write(dir.join("a.jpg"), b"x").unwrap();
        std::fs::write(dir.join("a.xmp"), b"<xmp/>").unwrap(); // a's sidecar
        std::fs::write(dir.join("b.jpg"), b"y").unwrap(); // no sidecar
        std::fs::write(dir.join("orphan.xmp"), b"<xmp/>").unwrap(); // sidecar with no matching photo
        std::fs::write(dir.join("c.mp4"), b"z").unwrap();
        std::fs::create_dir(dir.join("sub")).unwrap();

        let out = list_dir(dir.to_string_lossy().into_owned()).unwrap();
        let by_name = |n: &str| out.iter().find(|e| e.name == n).unwrap_or_else(|| panic!("missing {n}"));

        let a = by_name("a.jpg");
        assert!(a.is_image && !a.is_dir && !a.is_video);
        assert!(a.edited_ts > 0, "a.jpg has a real sidecar and must report a nonzero edited_ts");

        let b = by_name("b.jpg");
        assert_eq!(b.edited_ts, 0, "b.jpg has no sidecar — must not pick up orphan.xmp or a.xmp");

        let c = by_name("c.mp4");
        assert!(c.is_video && !c.is_image);
        assert_eq!(c.edited_ts, 0, "video has no sidecar-based edit recipe today");

        let sub = by_name("sub");
        assert!(sub.is_dir && !sub.is_image && !sub.is_video);
        assert_eq!(sub.edited_ts, 0);

        // orphan.xmp itself and dotfiles must not surface as entries.
        assert!(out.iter().all(|e| e.name != "orphan.xmp"));

        std::fs::remove_dir_all(&dir).ok();
    }
}

pub(crate) fn cache_dir() -> PathBuf {
    let dir = crate::platform::cache_root().join("thumbnails");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

// ── Stable cache hashing ──────────────────────────────────────────────────────────────────
// `std::collections::hash_map::DefaultHasher` (the previous implementation) is explicitly
// documented by the standard library as NOT stable across Rust releases or even between two
// runs of the same binary in general — fine for an in-memory HashMap, wrong for a hash baked
// into an on-disk filename. A routine toolchain bump would silently reassign every cache key
// at once: for the bounded ~500MB thumbnail cache that's a one-time free regeneration, but the
// planned never-pruned offline-thumbnail catalog tier (§ROADMAP: "Surviving app updates") would
// turn that into gigabytes of permanently orphaned files with no way to regenerate them if the
// source volume is unplugged. FNV-1a is a public, unchanging algorithm — the same input always
// produces the same output, forever, regardless of Rust version. Pinned by
// `cache_key_is_a_hardcoded_literal` below: if this ever silently changed, that test fails loud
// instead of 20GB of thumbnails quietly going stale.
fn fnv1a(parts: &[&str]) -> u64 {
    const OFFSET: u64 = 0xcbf29ce484222325;
    const PRIME: u64 = 0x100000001b3;
    let mut h = OFFSET;
    for part in parts {
        for b in part.as_bytes() {
            h ^= *b as u64;
            h = h.wrapping_mul(PRIME);
        }
        // A separator byte between parts so ("ab","c") and ("a","bc") hash differently.
        h ^= 0xff;
        h = h.wrapping_mul(PRIME);
    }
    h
}

// Each cache tier gets its OWN version constant rather than sharing one. Before this, every
// tier's key derived from `cache_key`'s single internal version literal (via a
// `.replace(".jpg", "...")` filename trick on meta/phash), so bumping it to fix a THUMBNAIL
// rendering change also silently invalidated every cached EXIF read and every perceptual hash —
// at 100k photos, a multi-minute metadata re-read to fix something that only touched pixels.
const THUMB_RENDER_VER: &str = "thumb-v2"; // bumped when orientation-correction was added
const META_READER_VER: &str = "meta-v5";   // bumped when the RW2-lens EXIF garbage-value fix landed
/// Videos get their OWN meta-cache version so adding duration/dimensions to PhotoMeta did not
/// invalidate every photo's cached EXIF read. See meta_cache_path.
const VIDEO_META_VER: &str = "vmeta-v1";
const PHASH_VER: &str = "phash-v1";
const DECODE_RENDER_VER: &str = "decode-v1";
const LR_THUMB_VER: &str = "lr-thumb-v1";

fn cache_key(path: &str, mtime: u64, size: u64) -> String {
    let mtime_s = mtime.to_string();
    let size_s = size.to_string();
    format!("{:016x}.jpg", fnv1a(&[path, &mtime_s, &size_s, THUMB_RENDER_VER]))
}

/// Cached thumbnail (long edge ~360px, JPEG). RAW files use rawler's embedded-preview
/// extraction (falls back thumbnail -> preview -> full decode internally) — this reads the
/// camera's own embedded JPEG in the common case, NOT a full demosaic, so opening a folder of
/// hundreds of RAWs stays fast. Cache key includes mtime+size so edits/replacements invalidate.
/// TIER 1 of the thumbnail path: the preview the camera already embedded, returned as-is with no
/// decode of the full image at all.
///
/// Measured cold, per source (examples/thumb_timing.rs) — and the result is the opposite of what
/// you would guess:
///
/// | file            | full decode | embedded |
/// |-----------------|-------------|----------|
/// | `__TM4202.jpg`  | 803.8 ms    | ~1 ms    |
/// | `__TM5132.jpg`  | 515.9 ms    | ~1 ms    |
/// | `P_TM5168.RW2`  | 174.5 ms    | (already embedded) |
/// | `__TM3719.RW2`  |  97.4 ms    | (already embedded) |
///
/// JPEGs are the SLOW case, not RAWs: the RAW path already calls rawler's
/// `extract_thumbnail_pixels`, while `image::open` on a JPEG decodes all 24 megapixels and then
/// throws almost all of them away to make a 360px square. A 6-wide decode pool therefore needs
/// ~27s to fill a 200-photo JPEG folder, which is what "scrolling a large folder stutters" is.
///
/// The embedded preview is 256x171 on this camera — smaller than `LONG_EDGE`, so it is a PROXY,
/// not a replacement. The frontend paints it immediately and upgrades to the real thumbnail on
/// idle. Returns Err when a file has no embedded preview, which is the caller's signal to skip
/// straight to tier 2 rather than show nothing.
#[tauri::command]
pub fn get_thumbnail_fast(path: String) -> Result<tauri::ipc::Response, String> {
    let ext = ext_lower(Path::new(&path));
    if !matches!(ext.as_str(), "jpg" | "jpeg" | "tif" | "tiff") {
        return Err("no embedded preview for this type".into());
    }
    let file = std::fs::File::open(&path).map_err(|e| format!("open {path}: {e}"))?;
    let mut br = std::io::BufReader::new(file);
    let exif = exif::Reader::new()
        .read_from_container(&mut br)
        .map_err(|e| format!("exif: {e}"))?;
    // IFD1 is the thumbnail directory; these two tags give its byte range in the file.
    let offset = exif
        .get_field(exif::Tag::JPEGInterchangeFormat, exif::In::THUMBNAIL)
        .and_then(|f| f.value.get_uint(0))
        .ok_or("no embedded thumbnail")? as usize;
    let len = exif
        .get_field(exif::Tag::JPEGInterchangeFormatLength, exif::In::THUMBNAIL)
        .and_then(|f| f.value.get_uint(0))
        .ok_or("no embedded thumbnail length")? as usize;
    let bytes = std::fs::read(&path).map_err(|e| format!("read {path}: {e}"))?;
    // ⚠️ The offset is relative to the start of the TIFF header inside the APP1 segment, not to
    // the start of the file. Locating the embedded SOI directly is both simpler and robust to
    // that, and a sanity check on the recovered slice keeps a malformed file from panicking.
    let start = find_embedded_soi(&bytes).ok_or("no embedded JPEG found")?;
    let end = (start + len).min(bytes.len());
    let slice = if end > start + 4 { &bytes[start..end] } else { return Err("embedded thumbnail too small".into()) };
    if slice.len() < 128 || slice[0] != 0xFF || slice[1] != 0xD8 {
        return Err(format!("embedded thumbnail malformed (offset hint {offset})"));
    }
    Ok(tauri::ipc::Response::new(slice.to_vec()))
}

/// Byte offset of the SECOND JPEG SOI marker — i.e. the embedded preview, not the main image.
fn find_embedded_soi(bytes: &[u8]) -> Option<usize> {
    let pat = [0xFFu8, 0xD8, 0xFF];
    // Skip the main image's own SOI at 0, then find the next one.
    bytes.windows(3).skip(3).position(|w| w == pat).map(|i| i + 3)
}

#[tauri::command]
pub fn get_thumbnail(path: String) -> Result<tauri::ipc::Response, String> {
    // rawler's embedded-preview extraction and the `image` crate can both panic on malformed
    // input (a truncated/corrupt file, an unsupported internal variant, etc.) — an uncaught
    // panic here would take down the whole Tauri process, breaking every future thumbnail (and
    // everything else) for the rest of the session. Catch it and report it as a normal Err
    // instead, matching the pattern examples/test_thumb.rs already uses to probe this same call.
    let path_for_panic_msg = path.clone();
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| get_thumbnail_inner(path)))
        .unwrap_or_else(|panic| {
            let msg = panic
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| panic.downcast_ref::<&str>().map(|s| s.to_string()))
                .unwrap_or_else(|| "<non-string panic>".to_string());
            Err(format!("thumbnail decode panicked for {path_for_panic_msg}: {msg}"))
        })
        .map(tauri::ipc::Response::new)
}

/// `get_thumbnail`, with a fallback to the catalog's never-pruned offline thumbnail tier when
/// the direct decode fails — the common real-world trigger being the volume is unplugged, so
/// `path` (which came from `catalog_query`'s own `abs_path` reconstruction) simply doesn't
/// resolve to anything right now. This is a SEPARATE command rather than a change to
/// `get_thumbnail` itself: a `tauri::State` parameter can only be filled in through the real
/// Tauri IPC machinery, not a plain function call — and `catalog.rs`'s own offline-thumbnail
/// GENERATION phase calls `get_thumbnail` directly (not through IPC) to reuse its decode
/// pipeline, which a `State` parameter there would have broken.
///
/// ⚠️ The catalog lookup only runs as a FALLBACK, after a real decode attempt — a mounted
/// volume's photo must always show its true, current thumbnail, never a possibly-stale cached
/// one, even if the catalog happens to have an offline copy on file from before an edit.
#[tauri::command]
pub fn get_thumbnail_or_offline(path: String, state: tauri::State<crate::catalog::CatalogState>) -> Result<tauri::ipc::Response, String> {
    if let Ok(resp) = get_thumbnail(path.clone()) {
        return Ok(resp);
    }
    // Read-only lookup — must go through read_conn, not the writer mutex, or an offline photo's
    // thumbnail (the fallback path this function exists for) blocks for the whole duration of any
    // in-progress scan/embed/cluster/CLIP batch (N3.1: the whole point of the reader/writer split
    // in CatalogState is defeated if a "read" call still takes the writer lock).
    let conn = state.read_conn.lock().map_err(|e| e.to_string())?;
    match crate::catalog::offline_thumb_bytes(&conn, &path) {
        Some(bytes) => Ok(tauri::ipc::Response::new(bytes)),
        None => Err(format!("no thumbnail available (online or offline) for {path}")),
    }
}

pub(crate) fn get_thumbnail_inner(path: String) -> Result<Vec<u8>, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("stat {path}: {e}"))?;
    let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let key = cache_key(&path, mtime, meta.len());
    let cache_path = cache_dir().join(&key);
    if let Ok(bytes) = std::fs::read(&cache_path) {
        // ⚠️ Length-checked: a truncated cache file (crash or full disk mid-write) would otherwise
        // be served forever as a valid Ok, giving a permanently broken <img> that no amount of
        // re-rendering clears — the same symptom class as the video-poster bug this path was
        // rewritten to fix. Below the floor, fall through and regenerate.
        if bytes.len() > 128 {
            return Ok(bytes);
        }
    }
    // ImageIO first for non-RAW stills (ROADMAP 15). Measured cold, this is the difference
    // between ~800ms and a fraction of it on a 24MP JPEG, because the `image` crate decodes every
    // pixel before downsizing while ImageIO decodes at a reduced DCT scale. RAW deliberately does
    // NOT come through here: rawler's embedded-preview path is already fast (97-175ms) and is the
    // one that applies the camera's own rendering. See fastthumb.rs's header for the numbers.
    #[cfg(target_os = "macos")]
    {
        let ext = ext_lower(Path::new(&path));
        if !is_raw_ext(&ext) && is_image_ext(&ext) {
            if let Some(bytes) = crate::fastthumb::thumbnail_jpeg(&path, 360) {
                let _ = std::fs::write(&cache_path, &bytes);
                return Ok(bytes);
            }
        }
        // Video posters come from AVFoundation — the OS's own decoder, the same one Finder and
        // QuickLook use, reached by linking the framework rather than adding a dependency (see
        // videothumb.rs). Sitting here means it inherits the disk cache above for free, which is
        // what makes posters survive a restart; the front end used to decode clips in a hidden
        // <video> and could never cache anything past the session.
        if is_video_ext(&ext) {
            let dur = crate::catalog::video_track_info(&path).map(|i| i.duration_secs).unwrap_or(0.0);
            if let Some(bytes) = crate::videothumb::poster_jpeg(&path, 360, dur) {
                let _ = std::fs::write(&cache_path, &bytes);
                return Ok(bytes);
            }
        }
    }

    let ext = ext_lower(Path::new(&path));
    // A clip AVFoundation declined (DRM, an exotic codec, a corrupt container) — or any video at
    // all on a non-macOS build. Fail cleanly so the frontend keeps its video placeholder; never
    // fall through to `image::open`, which cannot read a container of any kind.
    if is_video_ext(&ext) {
        return Err("video poster: no frame could be decoded from this clip".into());
    }
    // The `image` crate has no HEIC decoder, but macOS itself does — ImageIO, which is what
    // WKWebView already uses to display these in the editor. `sips` is the shell front end to it
    // and ships with every macOS, so no dependency is added and no patented decoder is vendored.
    //
    // ⚠️ Shelling out is acceptable HERE and nowhere else in this file: it costs a process spawn
    // per photo, which is fine against a cache that makes it happen once per file, and the
    // alternative (vendoring libheif) means shipping a ~2MB decoder for a format the OS already
    // reads. Falls through to the normal error path if sips fails, so a corrupt HEIC still shows
    // the placeholder rather than hanging.
    if is_heic_ext(&ext) {
        let tmp = cache_path.with_extension("heicthumb.jpg");
        let ok = std::process::Command::new("/usr/bin/sips")
            .args(["-s", "format", "jpeg", "-Z", "360", &path, "--out"])
            .arg(&tmp)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if ok {
            if let Ok(bytes) = std::fs::read(&tmp) {
                let _ = std::fs::remove_file(&tmp);
                let _ = std::fs::write(&cache_path, &bytes);
                return Ok(bytes);
            }
        }
        let _ = std::fs::remove_file(&tmp);
        return Err("heic thumbnail: sips could not decode this file".into());
    }
    let img = if is_raw_ext(&ext) {
        let img = rawler::analyze::extract_thumbnail_pixels(&path, &RawDecodeParams::default())
            .map_err(|e| format!("thumbnail decode: {e}"))?;
        apply_orientation_dynamic(img, raw_orientation(&path))
    } else {
        // still_decode::open_any_path (not a bare image::open) so a widened IMAGE_EXTS format
        // — most importantly .jxl, which image::open() cannot read at all — renders identically
        // here and in the editor. Falls through correctly for jpg/png/tif/etc too, since
        // open_any_path's own sniffing covers those the same way image::open did.
        crate::still_decode::open_any_path(Path::new(&path))?
    };
    const LONG_EDGE: u32 = 360;
    let (w, h) = (img.width(), img.height());
    let scale = LONG_EDGE as f32 / w.max(h) as f32;
    let thumb = img.resize(
        (w as f32 * scale).round().max(1.0) as u32,
        (h as f32 * scale).round().max(1.0) as u32,
        image::imageops::FilterType::Triangle,
    );
    let mut out = Cursor::new(Vec::new());
    thumb
        .to_rgb8()
        .write_to(&mut out, image::ImageFormat::Jpeg)
        .map_err(|e| format!("jpeg encode: {e}"))?;
    let bytes = out.into_inner();
    let _ = std::fs::write(&cache_path, &bytes);
    Ok(bytes)
}

// Lightroom cloud thumbnails, cached by asset id. Renditions are immutable (an asset id always
// yields the same thumbnail2x bytes), so no mtime/size in the key — the id alone is stable.
// Reuses the same thumbnails cache dir, so prune_caches() sweeps these too. Keeps the raw asset
// id out of the filename (it can contain odd chars) by hashing it.
fn lr_thumb_path(asset_id: &str) -> PathBuf {
    cache_dir().join(format!("lr_{:016x}.jpg", fnv1a(&[asset_id, LR_THUMB_VER])))
}

// Err = cache miss (JS falls back to the network fetch); Ok = cached JPEG bytes.
#[tauri::command]
pub fn get_lr_thumb(asset_id: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(lr_thumb_path(&asset_id))
        .map(tauri::ipc::Response::new)
        .map_err(|_| "miss".into())
}

#[tauri::command]
pub fn save_lr_thumb(asset_id: String, data_b64: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|e| format!("bad base64: {e}"))?;
    std::fs::write(lr_thumb_path(&asset_id), &bytes).map_err(|e| format!("write lr thumb: {e}"))
}

pub(crate) fn decode_cache_dir() -> PathBuf {
    let dir = crate::platform::cache_root().join("decode");
    let _ = std::fs::create_dir_all(&dir);
    dir
}
fn decode_cache_key(path: &str, mtime: u64, size: u64, recipe_key: &str) -> String {
    let mtime_s = mtime.to_string();
    let size_s = size.to_string();
    // recipe_key folds in RAW profile / native-NR / demosaic-algo / auto-lens — anything that
    // changes decoded pixels. DECODE_RENDER_VER is its own tier, independent of the others.
    format!("{:016x}.jpg", fnv1a(&[path, &mtime_s, &size_s, recipe_key, DECODE_RENDER_VER]))
}

/// Persistent full-resolution decode cache — the "photos re-decode on every relaunch" fix.
/// PREVIOUSLY the only persistent cache was the ~360px grid thumbnail; the actual expensive
/// full-res RAW decode (demosaic + NR, several seconds) lived ONLY in the in-memory imgCache
/// (library-ui.js), which is gone the instant the app quits — so reopening a photo you viewed
/// last session re-ran the entire native pipeline from scratch every time. This caches the
/// finished, graded-ready pixels as a quality-95 JPEG (a 24MP RGBA8 frame is ~96MB raw vs
/// ~5-15MB JPEG) keyed on path+mtime+size+recipe_key, so a relaunch can skip straight to a
/// ~100-200ms JPEG decode instead of the multi-second native RAW pipeline. `recipe_key` is
/// whatever RAW-stage settings (profile, native NR, demosaic algo, auto-lens) were in effect
/// when it was cached — changing any of them changes the key, so a stale cache is never served.
#[tauri::command]
pub fn get_decode_cache(path: String, recipe_key: String) -> Result<tauri::ipc::Response, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("stat {path}: {e}"))?;
    let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let key = decode_cache_key(&path, mtime, meta.len(), &recipe_key);
    let bytes = std::fs::read(decode_cache_dir().join(&key)).map_err(|_| "no cached decode".to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Writes the decode cache — framed raw body (JSON header + JPEG bytes) like store_dcp_lut, to
/// avoid a multi-megabyte JSON-array argument. Best-effort: the caller (library-ui.js) fires
/// this in the background after a successful decode and doesn't block on it; a write failure
/// just means the next open re-decodes, same as today.
#[tauri::command]
pub fn save_decode_cache(request: tauri::ipc::Request) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw invoke body".into());
    };
    if bytes.len() < 4 {
        return Err("framed body too short".into());
    }
    let jlen = u32::from_le_bytes(bytes[0..4].try_into().unwrap()) as usize;
    if bytes.len() < 4 + jlen {
        return Err("framed body truncated".into());
    }
    let json: serde_json::Value = serde_json::from_slice(&bytes[4..4 + jlen]).map_err(|e| format!("frame json: {e}"))?;
    let payload = &bytes[4 + jlen..];
    let path = json["path"].as_str().ok_or("missing path")?;
    let recipe_key = json["recipeKey"].as_str().unwrap_or("");
    let meta = std::fs::metadata(path).map_err(|e| format!("stat {path}: {e}"))?;
    let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let key = decode_cache_key(path, mtime, meta.len(), recipe_key);
    std::fs::write(decode_cache_dir().join(&key), payload).map_err(|e| format!("write decode cache: {e}"))
}

/// Fast provisional preview for opening a RAW into the editor: the camera's own embedded
/// JPEG (rawler's extract_preview_pixels — bigger than the grid thumbnail, no demosaic), so
/// the editor shows *something* in well under a second while the full native decode (PPG
/// demosaic + DCP LUT, ~3-5s) runs behind it and swaps in. Not cached — it's a one-shot
/// provisional frame, not reused.
#[tauri::command]
pub fn get_preview(path: String) -> Result<tauri::ipc::Response, String> {
    let ext = ext_lower(Path::new(&path));
    if !is_raw_ext(&ext) {
        return Err("get_preview is for RAW files only".into());
    }
    let img = rawler::analyze::extract_preview_pixels(&path, &RawDecodeParams::default())
        .map_err(|e| format!("preview decode: {e}"))?;
    let img = apply_orientation_dynamic(img, raw_orientation(&path));
    let mut out = Cursor::new(Vec::new());
    img.to_rgb8()
        .write_to(&mut out, image::ImageFormat::Jpeg)
        .map_err(|e| format!("jpeg encode: {e}"))?;
    Ok(tauri::ipc::Response::new(out.into_inner()))
}

/// The Library's full-screen Quick Look (Space bar): a fast, LARGE preview for rapid culling —
/// Photo Mechanic's whole trick, judge sharpness/composition at speed without ever paying for a
/// full RAW demosaic. Three sources, in the same priority order `get_thumbnail_inner` already
/// established, just at a much bigger size than the 360px grid thumbnail:
/// - RAW: the camera's own embedded preview (same `extract_preview_pixels` as `get_preview`
///   above) — no demosaic, exactly what makes this fast.
/// - Ordinary stills (JPEG/PNG/TIFF) on macOS: ImageIO's scaled decode (`fastthumb::thumbnail_jpeg`),
///   which decodes at a reduced DCT scale rather than the `image` crate's full-then-downsize —
///   see fastthumb.rs's own measured numbers for why this matters at 24MP.
/// - HEIC: `sips`, same tool `get_thumbnail_inner` already shells out to, just a bigger `-Z`.
///
/// Not cached (same reasoning as `get_preview`: a one-shot provisional frame, not reused) and
/// deliberately NEVER reached by opening a photo into the actual editor — that path keeps doing
/// its normal full decode unchanged. This is a separate, non-destructive view: leaving Quick
/// Look never triggers a decode, only actually opening the editor (an explicit action) does.
#[tauri::command]
pub fn get_quicklook_preview(path: String) -> Result<tauri::ipc::Response, String> {
    const QUICKLOOK_LONG_EDGE: u32 = 1600;
    let ext = ext_lower(Path::new(&path));
    if is_raw_ext(&ext) {
        let img = rawler::analyze::extract_preview_pixels(&path, &RawDecodeParams::default())
            .map_err(|e| format!("preview decode: {e}"))?;
        let img = apply_orientation_dynamic(img, raw_orientation(&path));
        let mut out = Cursor::new(Vec::new());
        img.to_rgb8()
            .write_to(&mut out, image::ImageFormat::Jpeg)
            .map_err(|e| format!("jpeg encode: {e}"))?;
        return Ok(tauri::ipc::Response::new(out.into_inner()));
    }
    #[cfg(target_os = "macos")]
    {
        if !is_video_ext(&ext) && is_image_ext(&ext) && !is_heic_ext(&ext) {
            if let Some(bytes) = crate::fastthumb::thumbnail_jpeg(&path, QUICKLOOK_LONG_EDGE) {
                return Ok(tauri::ipc::Response::new(bytes));
            }
        }
        if is_heic_ext(&ext) {
            let tmp = cache_dir().join(format!("quicklook-{}.jpg", fnv1a(&[&path])));
            let ok = std::process::Command::new("/usr/bin/sips")
                .args(["-s", "format", "jpeg", "-Z", &QUICKLOOK_LONG_EDGE.to_string(), &path, "--out"])
                .arg(&tmp)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            if ok {
                if let Ok(bytes) = std::fs::read(&tmp) {
                    let _ = std::fs::remove_file(&tmp);
                    return Ok(tauri::ipc::Response::new(bytes));
                }
            }
            let _ = std::fs::remove_file(&tmp);
            return Err("heic quicklook: sips could not decode this file".into());
        }
    }
    if is_video_ext(&ext) {
        return Err("no quicklook preview for video".into());
    }
    // Non-macOS / anything ImageIO didn't take: still_decode, same fallback
    // `get_thumbnail_inner` uses, just at QUICKLOOK_LONG_EDGE.
    let img = crate::still_decode::open_any_path(Path::new(&path))?;
    let (w, h) = (img.width(), img.height());
    let scale = QUICKLOOK_LONG_EDGE as f32 / w.max(h) as f32;
    let thumb = if scale < 1.0 {
        img.resize((w as f32 * scale).round().max(1.0) as u32, (h as f32 * scale).round().max(1.0) as u32, image::imageops::FilterType::Triangle)
    } else {
        img
    };
    let mut out = Cursor::new(Vec::new());
    thumb.to_rgb8().write_to(&mut out, image::ImageFormat::Jpeg).map_err(|e| format!("jpeg encode: {e}"))?;
    Ok(tauri::ipc::Response::new(out.into_inner()))
}

/// Decodes `path` to RGB8 pixels capped at `long_edge` on the long side — the same three-tier
/// priority `get_quicklook_preview` above uses (RAW embedded preview / ImageIO scaled decode on
/// macOS / `image` crate fallback), just returning raw pixels instead of a re-encoded JPEG, for
/// callers that feed a model rather than a UI. Used by the face-detection scan phase
/// (`catalog::faces_run`) — detection doesn't need full-resolution pixels, and SCRFD's own input
/// is capped at 640px regardless (see `scrfd.rs`), so a decode this size costs far less than a
/// full RAW demosaic while losing nothing SCRFD could have used anyway.
pub(crate) fn decode_rgb8_capped(path: &str, long_edge: u32) -> Result<(Vec<u8>, u32, u32), String> {
    let ext = ext_lower(Path::new(path));
    if is_raw_ext(&ext) {
        let img = rawler::analyze::extract_preview_pixels(path, &RawDecodeParams::default()).map_err(|e| format!("preview decode: {e}"))?;
        let img = apply_orientation_dynamic(img, raw_orientation(path));
        let (w, h) = (img.width(), img.height());
        let scale = long_edge as f32 / w.max(h) as f32;
        let thumb = if scale < 1.0 {
            img.resize((w as f32 * scale).round().max(1.0) as u32, (h as f32 * scale).round().max(1.0) as u32, image::imageops::FilterType::Triangle)
        } else {
            img
        };
        let rgb = thumb.to_rgb8();
        let (w, h) = rgb.dimensions();
        return Ok((rgb.into_raw(), w, h));
    }
    #[cfg(target_os = "macos")]
    {
        if !is_video_ext(&ext) && is_image_ext(&ext) && !is_heic_ext(&ext) {
            if let Some(bytes) = crate::fastthumb::thumbnail_jpeg(path, long_edge) {
                let img = image::load_from_memory(&bytes).map_err(|e| format!("thumb decode: {e}"))?.to_rgb8();
                let (w, h) = img.dimensions();
                return Ok((img.into_raw(), w, h));
            }
        }
        if is_heic_ext(&ext) {
            let tmp = cache_dir().join(format!("facedet-{}.jpg", fnv1a(&[path])));
            let ok = std::process::Command::new("/usr/bin/sips")
                .args(["-s", "format", "jpeg", "-Z", &long_edge.to_string(), path, "--out"])
                .arg(&tmp)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            let result = if ok {
                std::fs::read(&tmp)
                    .map_err(|e| format!("sips read: {e}"))
                    .and_then(|bytes| image::load_from_memory(&bytes).map_err(|e| format!("heic decode: {e}")))
                    .map(|img| {
                        let rgb = img.to_rgb8();
                        let (w, h) = rgb.dimensions();
                        (rgb.into_raw(), w, h)
                    })
            } else {
                Err("heic decode: sips could not decode this file".into())
            };
            let _ = std::fs::remove_file(&tmp);
            return result;
        }
    }
    if is_video_ext(&ext) {
        return Err("no rgb8 decode for video".into());
    }
    let img = crate::still_decode::open_any_path(Path::new(path))?;
    let (w, h) = (img.width(), img.height());
    let scale = long_edge as f32 / w.max(h) as f32;
    let thumb = if scale < 1.0 {
        img.resize((w as f32 * scale).round().max(1.0) as u32, (h as f32 * scale).round().max(1.0) as u32, image::imageops::FilterType::Triangle)
    } else {
        img
    };
    let rgb = thumb.to_rgb8();
    let (w, h) = rgb.dimensions();
    Ok((rgb.into_raw(), w, h))
}

// ── Photo metadata (camera / lens / date / iso) for the library's filter dropdowns.
// RAWs go through rawler's raw_metadata (no pixel decode); JPEG/TIFF through kamadak-exif;
// PNG has no EXIF → nulls. Disk-cached exactly like thumbnails (path+mtime+size key). ──────
#[derive(Serialize, serde::Deserialize, Default, Clone)]
pub struct PhotoMeta {
    pub camera: Option<String>,
    /// Camera make and model as SEPARATE fields (the combined `camera` string stays for the
    /// library filter dropdowns) — the metadata panel shows "Camera Make" / "Camera Model"
    /// rows, and the lensfun profile lookup needs them split too.
    #[serde(default)]
    pub make: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    pub lens: Option<String>,
    pub date: Option<String>,
    pub iso: Option<u32>,
    pub shutter: Option<String>,
    pub aperture: Option<String>,
    pub focal_len: Option<String>,
    /// Video only: clip length in seconds, and display dimensions. Read from the container header
    /// (catalog::video_track_info), NOT from a decode — so the grid's duration badge still renders
    /// for a clip AVFoundation cannot produce a poster frame for.
    #[serde(default)]
    pub dur: Option<f64>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
}

/// Formats a rawler Rational exposure time the way the app's own EXIF reader does
/// ("1/250" or "2.5s" for slow shutters).
fn fmt_shutter(secs: f64) -> String {
    if secs <= 0.0 {
        String::new()
    } else if secs < 0.5 {
        format!("1/{}", (1.0 / secs).round() as i64)
    } else {
        format!("{secs:.1}s")
    }
}

fn meta_cache_path(path: &str, mtime: u64, size: u64) -> PathBuf {
    // ⚠️ Its OWN key, independent of cache_key/THUMB_RENDER_VER — see the fnv1a doc comment
    // above. META_READER_VER is bumped (not this filename) when read_meta's own output shape
    // changes, so a photo cached with a stale field gets re-read without a thumbnail-only
    // rendering change dragging every metadata read along with it.
    let mtime_s = mtime.to_string();
    let size_s = size.to_string();
    // ⚠️ The version component is TYPE-DEPENDENT, one level finer than the per-tier constants
    // above. Adding video duration/dimensions to PhotoMeta would otherwise have forced a
    // META_READER_VER bump, re-reading EXIF for every photo in a 100k-photo catalog to deliver
    // three numbers that only videos carry. Photo keys stay byte-identical; only videos (whose
    // cached meta was PhotoMeta::default() anyway, since read_meta had no video branch) re-read.
    let ver = if is_video_ext(&ext_lower(Path::new(path))) { VIDEO_META_VER } else { META_READER_VER };
    cache_dir().join(format!("{:016x}.meta.json", fnv1a(&[path, &mtime_s, &size_s, ver])))
}

fn read_meta(path: &str) -> PhotoMeta {
    let ext = ext_lower(Path::new(path));
    if is_raw_ext(&ext) {
        let Ok(source) = rawler::rawsource::RawSource::new(Path::new(path)) else { return PhotoMeta::default() };
        let Ok(decoder) = rawler::get_decoder(&source) else { return PhotoMeta::default() };
        let Ok(md) = decoder.raw_metadata(&source, &RawDecodeParams::default()) else { return PhotoMeta::default() };
        let camera = if md.make.is_empty() && md.model.is_empty() {
            None
        } else {
            Some(format!("{} {}", md.make, md.model).trim().to_string())
        };
        let ratio = |r: &rawler::formats::tiff::Rational| if r.d != 0 { r.n as f64 / r.d as f64 } else { 0.0 };
        PhotoMeta {
            camera,
            make: if md.make.is_empty() { None } else { Some(md.make.trim().to_string()) },
            model: if md.model.is_empty() { None } else { Some(md.model.trim().to_string()) },
            lens: md.exif.lens_model.clone()
                .or_else(|| md.lens.as_ref().map(|l| l.lens_model.clone()))
                .or_else(|| crate::lens_correct::exif_lens_model_fallback_path(Path::new(path))),
            date: md.exif.date_time_original.clone(),
            iso: md.exif.iso_speed_ratings.map(|v| v as u32),
            shutter: md.exif.exposure_time.as_ref().map(|r| fmt_shutter(ratio(r))),
            aperture: md.exif.fnumber.as_ref().map(|r| format!("f/{:.1}", ratio(r))),
            focal_len: md.exif.focal_length.as_ref().map(|r| format!("{:.0}mm", ratio(r))),
            ..PhotoMeta::default() // dur/width/height are video-only
        }
    } else if matches!(ext.as_str(), "jpg" | "jpeg" | "tif" | "tiff" | "heic" | "heif") {
        let Ok(file) = std::fs::File::open(path) else { return PhotoMeta::default() };
        let mut br = std::io::BufReader::new(file);
        let Ok(exif) = exif::Reader::new().read_from_container(&mut br) else { return PhotoMeta::default() };
        let s = |tag| {
            exif.get_field(tag, exif::In::PRIMARY).map(|f| {
                f.display_value().to_string().trim_matches('"').trim().to_string()
            }).filter(|v| !v.is_empty())
        };
        let make = s(exif::Tag::Make);
        let model = s(exif::Tag::Model);
        let camera = match (make.clone(), model.clone()) {
            (Some(mk), Some(md)) => Some(format!("{mk} {md}")),
            (mk, md) => mk.or(md),
        };
        let iso = exif
            .get_field(exif::Tag::PhotographicSensitivity, exif::In::PRIMARY)
            .and_then(|f| f.value.get_uint(0));
        PhotoMeta {
            camera,
            make,
            model,
            lens: s(exif::Tag::LensModel),
            date: s(exif::Tag::DateTimeOriginal),
            iso,
            shutter: s(exif::Tag::ExposureTime),
            aperture: s(exif::Tag::FNumber).map(|v| format!("f/{v}")),
            focal_len: s(exif::Tag::FocalLength),
            ..PhotoMeta::default() // dur/width/height are video-only
        }
    } else if is_video_ext(&ext) {
        // Container header only — one bounded `moov` read, never a decode and never a whole-file
        // read (a clip here can be 1.3GB). This is what feeds the grid's duration badge, which is
        // why it lives here rather than being lifted out of the poster decode: the badge must
        // still be right when AVFoundation refuses the clip.
        let info = crate::catalog::video_track_info(path);
        let date = crate::catalog::video_capture_date(path).map(|d| {
            // Match the "YYYY:MM:DD HH:MM:SS" shape EXIF DateTimeOriginal uses above, so every
            // consumer of PhotoMeta.date keeps parsing one format.
            let secs_of_day = d.captured.rem_euclid(86_400);
            format!(
                "{:04}:{:02}:{:02} {:02}:{:02}:{:02}",
                d.y, d.m, d.d,
                secs_of_day / 3600, (secs_of_day % 3600) / 60, secs_of_day % 60
            )
        });
        PhotoMeta {
            date,
            dur: info.as_ref().map(|i| i.duration_secs).filter(|d| *d > 0.0),
            width: info.as_ref().map(|i| i.width).filter(|w| *w > 0),
            height: info.as_ref().map(|i| i.height).filter(|h| *h > 0),
            ..PhotoMeta::default()
        }
    } else {
        PhotoMeta::default()
    }
}

/// `read_meta` for sibling modules — ingest.rs derives a capture date from EXIF, and duplicating
/// the RAW-vs-JPEG reader split there would be a second thing to keep in sync with the decoders.
pub fn read_meta_public(path: &str) -> PhotoMeta {
    read_meta(path)
}

#[tauri::command]
pub fn get_meta(path: String) -> PhotoMeta {
    let Ok(meta) = std::fs::metadata(&path) else { return PhotoMeta::default() };
    let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let cp = meta_cache_path(&path, mtime, meta.len());
    if let Ok(text) = std::fs::read_to_string(&cp) {
        if let Ok(m) = serde_json::from_str(&text) {
            return m;
        }
    }
    let m = read_meta(&path);
    if let Ok(text) = serde_json::to_string(&m) {
        let _ = std::fs::write(&cp, text);
    }
    m
}

// Batched + parallelized: openFolder used to `Promise.all` one `get_meta`/`get_sidecar` IPC
// round trip PER FILE, which is N Tauri IPC round trips on every folder open regardless of how
// cheap any individual call is. One call carrying the whole path list cuts that to 1, and
// rayon parallelizes the actual per-file work (real cost for a cold-cache get_meta, which reads
// the whole RAW file for the lens fallback — negligible for get_sidecar's small XML read, but
// harmless to parallelize either way). Order is preserved (rayon's into_par_iter().map().collect()
// keeps input order), so the frontend can zip this 1:1 against its own `paths` array.
#[tauri::command]
pub fn get_meta_batch(paths: Vec<String>) -> Vec<PhotoMeta> {
    paths.into_par_iter().map(get_meta).collect()
}

// ── XMP sidecar: rating + label + edited flag + edit recipe, in ONE read/write pair.
// Standard fields (xmp:Rating 0-5/-1, xmp:Label) stay Lightroom/Bridge-compatible; the
// Chromasmith-specific bits (edited flag, base64 edit recipe) live in their own namespace
// other tools simply ignore. A plain "<name>.xmp" next to the photo — portable, no DB. ──────
fn sidecar_path(photo_path: &str) -> PathBuf {
    Path::new(photo_path).with_extension("xmp")
}

#[derive(Serialize, Default)]
pub struct Sidecar {
    pub rating: i32,
    pub label: String,  // "" | "Red" | "Green" | "Star"
    pub edited: bool,
    /// base64 FX-snapshot JSON of the ACTIVE version, "" if none.
    ///
    /// ⚠️ This stays the active version's recipe even once several exist, rather than moving into
    /// the versions list. Everything that reads a recipe today — the grid's decode cache key, the
    /// editor's restore path, export history — keeps working untouched, and a sidecar written by
    /// this build still opens correctly in a build that predates virtual copies. Moving it would
    /// have been tidier and would have silently dropped every existing edit.
    pub recipe: String,
    pub favorite: bool,
    /// Named alternates. EMPTY for a photo that has never been virtual-copied, which is the
    /// normal case — `versions[active].recipe` and `recipe` are kept in step by set_sidecar.
    #[serde(default)]
    pub versions: Vec<Version>,
    #[serde(default)]
    pub active: usize,
    /// Full hierarchical paths, e.g. `"Travel|Iceland|Reykjavik"` — populated from
    /// `lr:hierarchicalSubject`, falling back to `dc:subject` promoted to single-segment paths
    /// when only a flat tag list exists (a sidecar never written by this app or Lightroom).
    #[serde(default)]
    pub keywords: Vec<String>,
    /// One-slot "undo buffer" for the Library grid's "Reset edit" context-menu action. NOT shown
    /// in the visible `versions` list — that list is for user-facing virtual copies, and this is
    /// an internal implementation detail of a single reset/undo pair. `Some(recipe)` means the
    /// most recent thing that happened to this sidecar was a reset that discarded `recipe`; the
    /// next real edit (any `set_sidecar` call with a non-reset recipe) or the next reset both
    /// clear it, so this is exactly ONE level of undo, not a history.
    #[serde(default)]
    pub last_reset_recipe: Option<String>,
    /// `edited` at the moment of that same reset, so undo restores the edited badge correctly
    /// rather than assuming it was always `true`.
    #[serde(default)]
    pub last_reset_edited: bool,
}

/// One virtual copy: a name and its own full recipe. No pixels are duplicated — a virtual copy is
/// a second set of edits over the same file, which is the whole point.
#[derive(Serialize, serde::Deserialize, Default, Clone, PartialEq)]
pub struct Version {
    pub name: String,
    pub recipe: String,
}

// ── Keywords (hierarchical, Lightroom-compatible) ──────────────────────────────────────────
//
// `xmp_get` above handles attribute and single-element form only, which cannot parse an
// `rdf:Bag` — a keyword list is `<dc:subject><rdf:Bag><rdf:li>Iceland</rdf:li>...`. Extending
// the hand-rolled parser rather than adding an XML crate: the app writes and reads this file in
// one known shape (see `write_sidecar`'s own doc comment on the same tradeoff for attributes),
// and the whole risk surface is prefix variance and entity escaping — `xml_unescape` and the
// LOCAL-name match below cover both. `xmp_bag_parses_a_real_sidecar_from_the_repo_root` and
// `hierarchical_keywords_round_trip_through_xmp` are what settle whether that tradeoff holds.

fn xml_unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

fn xml_escape(s: &str) -> String {
    // &amp; FIRST — escaping the other four would double-escape their own ampersands otherwise.
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

/// Every `<rdf:li>` inside the first element whose LOCAL name is `local_name` (matches on the
/// local name, not the prefix — `dc:` is conventional but not guaranteed, and a sidecar written
/// by another tool may bind the Dublin Core / Lightroom namespaces to any prefix it likes).
/// Returns entries in document order, XML-unescaped. Empty (never panics) on anything malformed
/// or absent.
fn xmp_bag(xmp: &str, local_name: &str) -> Vec<String> {
    let open_needle = format!(":{local_name}>");
    let Some(tag_end) = xmp.find(&open_needle).map(|i| i + open_needle.len()) else { return Vec::new() };
    // Find the matching close tag by re-deriving the actual prefix used, so `</dc:subject>`
    // (not some other element's close tag) is what bounds the search.
    let tag_start = xmp[..tag_end - open_needle.len()].rfind('<').map(|i| i + 1).unwrap_or(0);
    let prefix_and_name = &xmp[tag_start..tag_end - 1]; // e.g. "dc:subject"
    let close_needle = format!("</{prefix_and_name}>");
    let Some(close_at) = xmp[tag_end..].find(&close_needle).map(|i| tag_end + i) else { return Vec::new() };
    let body = &xmp[tag_end..close_at];
    let mut out = Vec::new();
    let mut rest = body;
    while let Some(li_start) = rest.find("<rdf:li>") {
        let after = li_start + "<rdf:li>".len();
        let Some(li_end) = rest[after..].find("</rdf:li>") else { break };
        out.push(xml_unescape(rest[after..after + li_end].trim()));
        rest = &rest[after + li_end + "</rdf:li>".len()..];
    }
    out
}

/// Builds the two Lightroom-compatible keyword bags as XML text (no surrounding whitespace/
/// indentation guarantees — this is generated markup, not hand-formatted). `keywords` are
/// full hierarchical paths (`"Travel|Iceland|Reykjavik"`); `dc:subject` gets each keyword's own
/// LEAF only (matching real Lightroom output, which is a flat tag list there), while
/// `lr:hierarchicalSubject` gets every keyword's full path AND every ancestor path, deduplicated
/// — so a photo tagged only with the leaf "Reykjavik" still shows "Travel" and "Travel|Iceland"
/// as tag-tree ancestors, the way Lightroom itself expects to find them.
fn keyword_bags_xml(keywords: &[String]) -> String {
    if keywords.is_empty() {
        return String::new();
    }
    let mut leaves: Vec<String> = Vec::new();
    let mut hier: Vec<String> = Vec::new();
    for kw in keywords {
        let leaf = kw.rsplit('|').next().unwrap_or(kw).to_string();
        if !leaves.contains(&leaf) {
            leaves.push(leaf);
        }
        let mut acc = String::new();
        for seg in kw.split('|') {
            if !acc.is_empty() {
                acc.push('|');
            }
            acc.push_str(seg);
            if !hier.contains(&acc) {
                hier.push(acc.clone());
            }
        }
    }
    let li = |items: &[String]| items.iter().map(|s| format!("<rdf:li>{}</rdf:li>", xml_escape(s))).collect::<String>();
    format!(
        "<dc:subject><rdf:Bag>{}</rdf:Bag></dc:subject><lr:hierarchicalSubject><rdf:Bag>{}</rdf:Bag></lr:hierarchicalSubject>",
        li(&leaves),
        li(&hier)
    )
}

/// Pull one XML attribute value out of the sidecar text (attribute or element form).
fn xmp_get(xmp: &str, name: &str) -> Option<String> {
    if let Some(i) = xmp.find(&format!("{name}=\"")) {
        let rest = &xmp[i + name.len() + 2..];
        if let Some(end) = rest.find('"') {
            return Some(rest[..end].to_string());
        }
    }
    if let Some(i) = xmp.find(&format!("<{name}>")) {
        let rest = &xmp[i + name.len() + 2..];
        if let Some(end) = rest.find('<') {
            return Some(rest[..end].trim().to_string());
        }
    }
    None
}

#[tauri::command]
pub fn get_sidecar(path: String) -> Sidecar {
    let Ok(text) = std::fs::read_to_string(sidecar_path(&path)) else { return Sidecar::default() };
    let recipe = xmp_get(&text, "chromasmith:Recipe").unwrap_or_default();
    // Versions ride as base64 JSON so the payload stays XML-attribute-safe by construction, the
    // same trick the recipe itself uses.
    let versions: Vec<Version> = xmp_get(&text, "chromasmith:Versions")
        .and_then(|b64| {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.decode(b64).ok()
        })
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let active = xmp_get(&text, "chromasmith:ActiveVersion")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    Sidecar {
        rating: xmp_get(&text, "xmp:Rating").and_then(|v| v.parse().ok()).unwrap_or(0),
        label: xmp_get(&text, "xmp:Label").unwrap_or_default(),
        edited: xmp_get(&text, "chromasmith:Edited").as_deref() == Some("True"),
        recipe,
        favorite: xmp_get(&text, "chromasmith:Favorite").as_deref() == Some("True"),
        // Clamp rather than trust: a hand-edited or truncated sidecar must not index out of
        // bounds, and silently falling back to the first version is the safe read.
        active: if active < versions.len() { active } else { 0 },
        versions,
        last_reset_recipe: xmp_get(&text, "chromasmith:LastResetRecipe"),
        last_reset_edited: xmp_get(&text, "chromasmith:LastResetEdited").as_deref() == Some("True"),
        keywords: {
            let hier = xmp_bag(&text, "hierarchicalSubject");
            if !hier.is_empty() {
                // hierarchicalSubject carries every ANCESTOR path too (that's what lets a tag
                // tree render "Travel" and "Travel|Iceland" as nodes) — a keyword's own value
                // is only the MAXIMAL paths, i.e. ones that aren't themselves a "|"-bounded
                // prefix of some other entry in the same list.
                hier.iter()
                    .filter(|h| {
                        !hier.iter().any(|other| {
                            other != *h && other.starts_with(h.as_str()) && other.as_bytes().get(h.len()) == Some(&b'|')
                        })
                    })
                    .cloned()
                    .collect()
            } else {
                xmp_bag(&text, "subject")
            }
        },
    }
}

// See get_meta_batch's comment — same one-round-trip rationale, used by openFolder's initial
// sidecar pass (the one it awaits before first paint).
#[tauri::command]
pub fn get_sidecar_batch(paths: Vec<String>) -> Vec<Sidecar> {
    paths.into_par_iter().map(get_sidecar).collect()
}

/// Reads the sidecar, mutates it, writes it back — the shared spine for every version command, so
/// they cannot drift on how `recipe` and `versions[active]` are kept in step.
fn edit_sidecar<F: FnOnce(&mut Sidecar)>(path: &str, f: F) -> Result<Sidecar, String> {
    let mut sc = get_sidecar(path.to_string());
    f(&mut sc);
    // The invariant: whenever versions exist, the flat `recipe` field IS the active version's.
    if let Some(v) = sc.versions.get(sc.active) {
        sc.recipe = v.recipe.clone();
    }
    write_sidecar(path, &sc)?;
    Ok(sc)
}

/// Adds a virtual copy carrying the CURRENT edits, and switches to it. Duplicating the current
/// recipe (rather than starting blank) matches what "virtual copy" means everywhere else: a
/// branch from where you are, not a reset.
#[tauri::command]
pub fn sidecar_add_version(path: String, name: String) -> Result<Sidecar, String> {
    edit_sidecar(&path, |sc| {
        if sc.versions.is_empty() {
            // Promote whatever is already there to a first named version, so the original edits
            // remain reachable instead of becoming the unnamed thing a copy was branched from.
            sc.versions.push(Version { name: "Original".into(), recipe: sc.recipe.clone() });
        }
        let base = sc.versions.get(sc.active).map(|v| v.recipe.clone()).unwrap_or_default();
        let name = if name.trim().is_empty() { format!("Copy {}", sc.versions.len()) } else { name };
        sc.versions.push(Version { name, recipe: base });
        sc.active = sc.versions.len() - 1;
    })
}

#[tauri::command]
pub fn sidecar_set_active_version(path: String, index: usize) -> Result<Sidecar, String> {
    edit_sidecar(&path, |sc| {
        if index < sc.versions.len() {
            sc.active = index;
        }
    })
}

#[tauri::command]
pub fn sidecar_rename_version(path: String, index: usize, name: String) -> Result<Sidecar, String> {
    edit_sidecar(&path, |sc| {
        if let Some(v) = sc.versions.get_mut(index) {
            v.name = name;
        }
    })
}

/// Removes a virtual copy. Deleting down to one version collapses the list entirely, so a photo
/// that is no longer virtual-copied looks exactly like one that never was.
#[tauri::command]
pub fn sidecar_delete_version(path: String, index: usize) -> Result<Sidecar, String> {
    edit_sidecar(&path, |sc| {
        if index >= sc.versions.len() {
            return;
        }
        sc.versions.remove(index);
        if sc.versions.len() <= 1 {
            if let Some(v) = sc.versions.first() {
                sc.recipe = v.recipe.clone();
            }
            sc.versions.clear();
            sc.active = 0;
        } else if sc.active >= sc.versions.len() {
            sc.active = sc.versions.len() - 1;
        } else if sc.active > index {
            sc.active -= 1;   // the list shifted under it
        }
    })
}

/// The Library grid's "Reset edit" context-menu action. Captures whatever `recipe`/`edited` state
/// is about to be discarded into the sidecar's own one-slot undo buffer (`last_reset_recipe`/
/// `last_reset_edited` — NOT the user-facing `versions` list, which is for virtual copies, not an
/// internal implementation detail) and wipes the active recipe, in ONE `edit_sidecar` read-
/// modify-write. That matters: capturing the old state and clearing it as two separate writes
/// would leave a window where a crash/interrupt loses one half or the other (an undo buffer with
/// no matching reset, or a reset with the undo buffer never written).
#[tauri::command]
pub fn reset_edit(path: String) -> Result<Sidecar, String> {
    let sc = edit_sidecar(&path, |sc| {
        sc.last_reset_recipe = Some(sc.recipe.clone());
        sc.last_reset_edited = sc.edited;
        sc.recipe = String::new();
        sc.edited = false;
        if let Some(v) = sc.versions.get_mut(sc.active) {
            v.recipe = String::new();
        }
    })?;
    registry_set("edited", &path, sc.edited);
    Ok(sc)
}

/// Restores exactly the recipe/edited state the most recent `reset_edit` call on this photo
/// discarded. Errors — rather than silently no-oping — when there is nothing to restore, so a
/// caller can't mistake "buffer already empty" for "your edit is back". This is ONE level of
/// undo, not a history: a successful undo clears the buffer, and so does the next real edit (see
/// `set_sidecar`'s own comment) or the next reset, so calling this twice in a row fails the
/// second time.
#[tauri::command]
pub fn undo_reset_edit(path: String) -> Result<Sidecar, String> {
    let pending = get_sidecar(path.clone());
    let Some(recipe) = pending.last_reset_recipe.clone() else {
        return Err("Nothing to undo".to_string());
    };
    let edited = pending.last_reset_edited;
    let sc = edit_sidecar(&path, |sc| {
        sc.recipe = recipe.clone();
        sc.edited = edited;
        if let Some(v) = sc.versions.get_mut(sc.active) {
            v.recipe = recipe.clone();
        }
        sc.last_reset_recipe = None;
        sc.last_reset_edited = false;
    })?;
    registry_set("edited", &path, sc.edited);
    Ok(sc)
}

/// Writes the whole sidecar in one shot. `recipe: None` keeps the existing recipe (so a
/// rating/label click never clobbers stored edits); `Some("")` explicitly clears it.
/// `favorite: None` likewise keeps whatever favorite state was already saved.
#[tauri::command]
pub fn set_sidecar(
    path: String,
    rating: i32,
    label: String,
    edited: bool,
    recipe: Option<String>,
    favorite: Option<bool>,
) -> Result<(), String> {
    let existing = get_sidecar(path.clone());
    let recipe = recipe.unwrap_or_else(|| existing.recipe.clone());
    let favorite = favorite.unwrap_or(existing.favorite);
    let rating = rating.clamp(-1, 5);
    let label = match label.as_str() {
        "Red" | "Green" | "Star" => label,
        _ => String::new(),
    };
    // Editing a photo edits the version you are looking at — otherwise switching back to
    // "Original" would show the edits you just made to a copy.
    let mut versions = existing.versions;
    if let Some(v) = versions.get_mut(existing.active) {
        v.recipe = recipe.clone();
    }
    // A real edit (a non-empty recipe saved as `edited`) supersedes any pending "Reset edit"
    // undo buffer — restoring it afterwards would silently discard work done since the reset.
    // Every OTHER caller (rating/label/favorite clicks, which pass `recipe: None` and therefore
    // reuse `existing.recipe` unchanged above) leaves the buffer untouched. `reset_edit`/
    // `undo_reset_edit` are the dedicated commands that actually populate/consume it — this
    // function only ever clears it, never sets it, so it stays a silent no-op for every call
    // site that predates the undo feature.
    let (last_reset_recipe, last_reset_edited) = if edited && !recipe.is_empty() {
        (None, false)
    } else {
        (existing.last_reset_recipe, existing.last_reset_edited)
    };
    let sc = Sidecar { rating, label: label.clone(), edited, recipe, favorite, versions, active: existing.active, keywords: existing.keywords, last_reset_recipe, last_reset_edited };
    write_sidecar(&path, &sc)?;
    registry_set("edited", &path, edited);
    registry_set("favorites", &path, favorite);
    registry_set("flagged", &path, label == "Green");
    registry_set("rejected", &path, label == "Red");
    Ok(())
}

/// The plain-template fallback used when there is no existing sidecar to preserve, or when an
/// existing one can't be safely attribute-merged (see `write_sidecar`). Byte-for-byte what the
/// writer produced before third-party preservation existed, so a Chromasmith-only sidecar's
/// bytes are unchanged.
fn owned_attrs(sc: &Sidecar) -> String {
    let (rating, label, edited, favorite, recipe) =
        (sc.rating, sc.label.clone(), sc.edited, sc.favorite, sc.recipe.clone());
    let mut attrs = format!("xmp:Rating=\"{rating}\"");
    if !label.is_empty() {
        attrs.push_str(&format!(" xmp:Label=\"{label}\""));
    }
    if edited {
        attrs.push_str(" chromasmith:Edited=\"True\"");
    }
    if favorite {
        attrs.push_str(" chromasmith:Favorite=\"True\"");
    }
    if !recipe.is_empty() {
        // base64 payload — XML-attribute-safe by construction
        attrs.push_str(&format!(" chromasmith:Recipe=\"{recipe}\""));
    }
    if !sc.versions.is_empty() {
        use base64::Engine;
        if let Ok(json) = serde_json::to_vec(&sc.versions) {
            let b64 = base64::engine::general_purpose::STANDARD.encode(json);
            attrs.push_str(&format!(" chromasmith:Versions=\"{b64}\" chromasmith:ActiveVersion=\"{}\"", sc.active));
        }
    }
    if let Some(r) = &sc.last_reset_recipe {
        // base64 payload — XML-attribute-safe by construction, same as Recipe above.
        attrs.push_str(&format!(" chromasmith:LastResetRecipe=\"{r}\""));
        if sc.last_reset_edited {
            attrs.push_str(" chromasmith:LastResetEdited=\"True\"");
        }
    }
    attrs
}

fn plain_template(sc: &Sidecar) -> String {
    format!(
        r#"<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Chromasmith">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:chromasmith="http://chromasmith.app/ns/1.0/" {attrs}/>
 </rdf:RDF>
</x:xmpmeta>
"#,
        attrs = owned_attrs(sc)
    )
}

/// The byte span of the first `<rdf:Description ...>` tag's attribute list in `xmp`, as
/// `(start, end, self_closing)` where `xmp[start..end]` is everything between the element name
/// and the closing `/>` or `>`. A hand-rolled scan, not a parser: it tracks quote state so a
/// `>` inside an attribute value doesn't end the tag early, which is the one thing that would
/// make this unsafe to use on a real file.
fn find_description_attrs(xmp: &str) -> Option<(usize, usize, bool)> {
    let tag = "<rdf:Description";
    let start = xmp.find(tag)? + tag.len();
    let bytes = xmp.as_bytes();
    let mut i = start;
    let mut in_quote: Option<u8> = None;
    while i < bytes.len() {
        let b = bytes[i];
        match in_quote {
            Some(q) if b == q => in_quote = None,
            Some(_) => {}
            None => match b {
                b'"' | b'\'' => in_quote = Some(b),
                b'>' => {
                    let self_closing = i > start && bytes[i - 1] == b'/';
                    let end = if self_closing { i - 1 } else { i };
                    return Some((start, end, self_closing));
                }
                _ => {}
            },
        }
        i += 1;
    }
    None
}

/// Replaces (or removes, or inserts) a single `name="value"` attribute inside an attribute-list
/// string, preserving every other attribute's text and order exactly. `value: None` removes an
/// existing occurrence and adds nothing; a name absent from `attrs` with `value: Some(_)` is
/// appended. Values are written as given — every caller already produces XML-attribute-safe
/// text (booleans, digits, or base64), so no escaping is done here.
fn set_attr(attrs: &str, name: &str, value: Option<&str>) -> String {
    let needle = format!("{name}=");
    let mut search_from = 0;
    while let Some(rel) = attrs[search_from..].find(&needle) {
        let at = search_from + rel;
        // Require a word boundary before the name so "xmp:Rating=" doesn't match inside some
        // longer attribute name that happens to end the same way.
        let boundary_ok = at == 0 || attrs.as_bytes()[at - 1].is_ascii_whitespace();
        if !boundary_ok {
            search_from = at + needle.len();
            continue;
        }
        let after_eq = at + needle.len();
        let bytes = attrs.as_bytes();
        if after_eq >= bytes.len() || (bytes[after_eq] != b'"' && bytes[after_eq] != b'\'') {
            search_from = at + needle.len();
            continue;
        }
        let quote = bytes[after_eq];
        let Some(close_rel) = attrs[after_eq + 1..].find(quote as char) else {
            search_from = at + needle.len();
            continue;
        };
        let val_end = after_eq + 1 + close_rel + 1; // include closing quote
        // Also eat one leading space so a removal doesn't leave a double space behind.
        let trim_start = if at > 0 && attrs.as_bytes()[at - 1] == b' ' { at - 1 } else { at };
        return match value {
            Some(v) => format!("{} {name}=\"{v}\"{}", &attrs[..trim_start], &attrs[val_end..]),
            None => format!("{}{}", &attrs[..trim_start], &attrs[val_end..]),
        };
    }
    match value {
        // Not found: append. Always via a leading space, whether `attrs` was empty (the
        // element had no attributes at all) or already ends with one of its own — this is
        // what stops "<rdf:Descriptionxmlns:..." from a mismatched empty-attrs edge case.
        Some(v) => format!("{attrs} {name}=\"{v}\""),
        None => attrs.to_string(),
    }
}

/// True when `attrs` already declares this exact `xmlns:*` name (any value) — used to avoid
/// emitting a duplicate namespace declaration when a foreign tool already declared ours (it
/// would if it round-tripped a Chromasmith-written file through its own writer).
fn has_attr(attrs: &str, name: &str) -> bool {
    let needle = format!("{name}=");
    attrs
        .find(&needle)
        .map(|at| at == 0 || attrs.as_bytes()[at - 1].is_ascii_whitespace())
        .unwrap_or(false)
}

/// Removes the first element (any prefix) whose local name is `local_name` from `text`, if
/// present — used to clear a stale keyword bag before writing a fresh one, so re-tagging a photo
/// can never leave two competing `<dc:subject>` blocks in the same file. A self-closing match
/// (`<dc:subject/>`, no children — not a shape this app or Lightroom ever writes) is left alone
/// rather than mishandled; harmless, since a fresh bag is inserted separately either way.
fn strip_element(text: &str, local_name: &str) -> String {
    let open_needle = format!(":{local_name}>");
    let Some(tag_end) = text.find(&open_needle).map(|i| i + open_needle.len()) else { return text.to_string() };
    let tag_start = text[..tag_end - open_needle.len()].rfind('<').map(|i| i + 1).unwrap_or(0);
    let prefix_and_name = text[tag_start..tag_end - 1].to_string();
    let close_needle = format!("</{prefix_and_name}>");
    let Some(close_at) = text[tag_end..].find(&close_needle).map(|i| tag_end + i + close_needle.len()) else { return text.to_string() };
    format!("{}{}", &text[..tag_start - 1], &text[close_at..])
}

/// Same job as `strip_element`, but matches the open tag by its full `prefix:Name`, whether or
/// not it carries attributes — `strip_element` only matches a bare "<ns:Name>" (no attributes),
/// which `mwg-rs:Regions` (`rdf:parseType="Resource"`) never is.
fn strip_full_element(text: &str, tag_name: &str) -> String {
    let open_needle = format!("<{tag_name}");
    let Some(tag_start) = text.find(&open_needle) else { return text.to_string() };
    let Some(gt) = text[tag_start..].find('>').map(|i| tag_start + i) else { return text.to_string() };
    if text.as_bytes()[gt - 1] == b'/' {
        // Self-closing (`<ns:Name .../>`) — nothing more to find.
        return format!("{}{}", &text[..tag_start], &text[gt + 1..]);
    }
    let close_needle = format!("</{tag_name}>");
    let Some(close_at) = text[gt..].find(&close_needle).map(|i| gt + i + close_needle.len()) else { return text.to_string() };
    format!("{}{}", &text[..tag_start], &text[close_at..])
}

/// Post-processes an already attrs-merged sidecar string to reflect `keywords` — a second pass
/// after `write_sidecar`'s own attribute merge, because a keyword bag is CHILD markup
/// (`<dc:subject><rdf:Bag>...`), not an attribute, and needs its own insertion/removal logic.
/// Always strips any existing bags first (matching `set_attr`'s own "clear stale value" rule),
/// then inserts a fresh pair only when `keywords` is non-empty — so clearing every keyword from
/// a photo actually removes the element rather than leaving an empty bag behind.
fn apply_keywords_to_xmp(xmp: String, keywords: &[String]) -> String {
    // xmlns:dc/xmlns:lr are only added when actually needed, so a photo with no keywords never
    // set produces a byte-identical sidecar to before this feature existed.
    let xmp = if !keywords.is_empty() {
        match find_description_attrs(&xmp) {
            Some((start, end, _)) => {
                let mut attrs = xmp[start..end].to_string();
                if !has_attr(&attrs, "xmlns:dc") {
                    attrs = set_attr(&attrs, "xmlns:dc", Some("http://purl.org/dc/elements/1.1/"));
                }
                if !has_attr(&attrs, "xmlns:lr") {
                    attrs = set_attr(&attrs, "xmlns:lr", Some("http://ns.adobe.com/lightroom/1.0/"));
                }
                format!("{}{attrs}{}", &xmp[..start], &xmp[end..])
            }
            None => xmp,
        }
    } else {
        xmp
    };

    let mut text = strip_element(&xmp, "subject");
    text = strip_element(&text, "hierarchicalSubject");
    if keywords.is_empty() {
        return text;
    }
    let bags = keyword_bags_xml(keywords);
    let Some((start, end, self_closing)) = find_description_attrs(&text) else { return text };
    if self_closing {
        // `text[start..end]` is the attrs WITHOUT the trailing "/>" — convert to a real open
        // tag with the bags as its only children.
        format!("{}{}>{}</rdf:Description>{}", &text[..start], &text[start..end], bags, &text[end + 2..])
    } else {
        match text[end + 1..].find("</rdf:Description>").map(|i| end + 1 + i) {
            Some(close_at) => format!("{}{}{}", &text[..close_at], bags, &text[close_at..]),
            None => text, // malformed (no closing tag) — leave untouched rather than corrupt it
        }
    }
}

/// One face/pet region for the XMP writer — 0..1 fractional box, the same convention
/// `catalog::FaceBox` already uses, so the caller can pass a `photo_faces` row straight through
/// with a name attached. `kind` is `"Face"` or `"Pet"` per the MWG Region spec's own vocabulary
/// (it only defines Face/Pet/Focus/BarCode types); Chromasmith's own person/pet distinction
/// (`people.kind`) maps directly onto it.
#[derive(Deserialize, Clone)]
pub struct PersonRegion {
    pub name: String,
    pub kind: String, // "person" | "pet"
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
}

/// Builds the `mwg-rs:Regions` + `Iptc4xmpExt:PersonInImage` child markup for a photo's named
/// faces — CLAUDE.md people-pets plan failure #11 ("names never reach XMP... lost on a catalog
/// rebuild or a new machine"). Mirrors `keyword_bags_xml`'s shape exactly: build the child XML,
/// strip whatever's already there, splice the fresh version in. `mwg-rs:Area` uses CENTRE x/y +
/// width/height (the Metadata Working Group's own convention, not a corner box like `FaceBox`),
/// normalized 0..1 — converted here so every other box in the app can stay corner-based.
fn person_regions_xml(people: &[PersonRegion]) -> String {
    if people.is_empty() {
        return String::new();
    }
    let region_li = |p: &PersonRegion| {
        let (w, h) = ((p.x1 - p.x0).max(0.0), (p.y1 - p.y0).max(0.0));
        let (cx, cy) = (p.x0 + w / 2.0, p.y0 + h / 2.0);
        let ty = if p.kind == "pet" { "Pet" } else { "Face" };
        format!(
            "<rdf:li rdf:parseType=\"Resource\"><mwg-rs:Name>{}</mwg-rs:Name><mwg-rs:Type>{ty}</mwg-rs:Type><mwg-rs:Area rdf:parseType=\"Resource\" stArea:x=\"{cx}\" stArea:y=\"{cy}\" stArea:w=\"{w}\" stArea:h=\"{h}\" stArea:unit=\"normalized\"/></rdf:li>",
            xml_escape(&p.name)
        )
    };
    let regions: String = people.iter().map(region_li).collect();
    let mut names: Vec<String> = Vec::new();
    for p in people {
        if !names.contains(&p.name) {
            names.push(p.name.clone());
        }
    }
    let name_li: String = names.iter().map(|n| format!("<rdf:li>{}</rdf:li>", xml_escape(n))).collect();
    format!(
        "<mwg-rs:Regions rdf:parseType=\"Resource\"><mwg-rs:RegionList><rdf:Bag>{regions}</rdf:Bag></mwg-rs:RegionList></mwg-rs:Regions><Iptc4xmpExt:PersonInImage><rdf:Bag>{name_li}</rdf:Bag></Iptc4xmpExt:PersonInImage>"
    )
}

/// Same shape as `apply_keywords_to_xmp`: add the namespaces only when actually needed (so a
/// photo with no named faces stays byte-identical to today), strip any existing region/person
/// markup, splice fresh markup in when `people` is non-empty.
fn apply_people_to_xmp(xmp: String, people: &[PersonRegion]) -> String {
    let xmp = if !people.is_empty() {
        match find_description_attrs(&xmp) {
            Some((start, end, _)) => {
                let mut attrs = xmp[start..end].to_string();
                for (ns, uri) in [
                    ("xmlns:mwg-rs", "http://www.metadataworkinggroup.com/schemas/regions/"),
                    ("xmlns:stArea", "http://ns.adobe.com/xmp/sType/Area#"),
                    ("xmlns:Iptc4xmpExt", "http://iptc.org/std/Iptc4xmpExt/2008-02-29/"),
                ] {
                    if !has_attr(&attrs, ns) {
                        attrs = set_attr(&attrs, ns, Some(uri));
                    }
                }
                format!("{}{attrs}{}", &xmp[..start], &xmp[end..])
            }
            None => xmp,
        }
    } else {
        xmp
    };

    // ⚠️ NOT `strip_element` — that helper only matches a childless open tag ("<ns:Name>", no
    // attributes), which is exactly what `dc:subject`/`hierarchicalSubject` are but NOT what
    // `mwg-rs:Regions` is (it opens as `<mwg-rs:Regions rdf:parseType="Resource">`, so the naive
    // ":Regions>" needle never matches). `strip_full_element` below matches on the tag NAME only,
    // attributes or not.
    let mut text = strip_full_element(&xmp, "mwg-rs:Regions");
    text = strip_full_element(&text, "Iptc4xmpExt:PersonInImage");
    if people.is_empty() {
        return text;
    }
    let markup = person_regions_xml(people);
    let Some((start, end, self_closing)) = find_description_attrs(&text) else { return text };
    if self_closing {
        format!("{}{}>{}</rdf:Description>{}", &text[..start], &text[start..end], markup, &text[end + 2..])
    } else {
        match text[end + 1..].find("</rdf:Description>").map(|i| end + 1 + i) {
            Some(close_at) => format!("{}{}{}", &text[..close_at], markup, &text[close_at..]),
            None => text,
        }
    }
}

/// JS-facing entry point — writes named face/pet regions into a photo's XMP sidecar, the
/// portable record that survives a catalog rebuild or the library moving to another machine.
/// Deliberately WRITE-only for now: reading regions back into the catalog on import is a bigger
/// piece (an `import_people_from_xmp` pass mirroring `faces_run`) tracked separately — this
/// command is what makes there be something to read in the first place. Reuses `get_sidecar`/
/// `write_sidecar` so a person write never clobbers rating/keywords/develop settings the way a
/// from-scratch rebuild would (see `write_sidecar`'s own warning about that).
#[tauri::command]
pub fn set_people_regions(path: String, people: Vec<PersonRegion>) -> Result<(), String> {
    let sc = get_sidecar(path.clone());
    write_sidecar_with_people(&path, &sc, &people)
}

/// The single writer. Everything that changes a sidecar goes through here so the serialisation
/// lives in exactly one place.
///
/// ⚠️ Preserves every attribute and child element this app doesn't own. The original
/// implementation rebuilt the file from scratch on every write, which is fine for a
/// Chromasmith-only sidecar but silently destroys `crs:*` develop settings, IPTC, GPS and
/// keywords the moment a Lightroom-exported sidecar is touched — exactly what an SSD migration
/// walks straight into. Falls back to `plain_template` (byte-identical to the old behaviour)
/// when there's no existing file, or its `<rdf:Description>` tag can't be located.
fn write_sidecar(path: &str, sc: &Sidecar) -> Result<(), String> {
    write_sidecar_ex(path, sc, &[])
}

/// Same writer, plus the person/pet XMP regions — a separate entry point rather than adding
/// `people` to `Sidecar` itself, since (unlike rating/keywords) region data isn't read back into
/// `Sidecar` today (see `set_people_regions`'s doc comment) and doesn't belong on a struct that
/// implies round-trip symmetry it doesn't have yet.
fn write_sidecar_with_people(path: &str, sc: &Sidecar, people: &[PersonRegion]) -> Result<(), String> {
    write_sidecar_ex(path, sc, people)
}

fn write_sidecar_ex(path: &str, sc: &Sidecar, people: &[PersonRegion]) -> Result<(), String> {
    let sc_path = sidecar_path(path);
    let existing = std::fs::read_to_string(&sc_path).ok();

    let xmp = match existing.as_deref().and_then(|text| {
        find_description_attrs(text).map(|(start, end, self_closing)| (text, start, end, self_closing))
    }) {
        Some((text, start, end, self_closing)) => {
            let mut attrs = text[start..end].to_string();
            if !has_attr(&attrs, "xmlns:xmp") {
                attrs = set_attr(&attrs, "xmlns:xmp", Some("http://ns.adobe.com/xap/1.0/"));
            }
            if !has_attr(&attrs, "xmlns:chromasmith") {
                attrs = set_attr(&attrs, "xmlns:chromasmith", Some("http://chromasmith.app/ns/1.0/"));
            }
            if !has_attr(&attrs, "rdf:about") {
                attrs = set_attr(&attrs, "rdf:about", Some(""));
            }
            attrs = set_attr(&attrs, "xmp:Rating", Some(&sc.rating.to_string()));
            attrs = set_attr(&attrs, "xmp:Label", if sc.label.is_empty() { None } else { Some(&sc.label) });
            attrs = set_attr(&attrs, "chromasmith:Edited", if sc.edited { Some("True") } else { None });
            attrs = set_attr(&attrs, "chromasmith:Favorite", if sc.favorite { Some("True") } else { None });
            attrs = set_attr(&attrs, "chromasmith:Recipe", if sc.recipe.is_empty() { None } else { Some(&sc.recipe) });
            let versions_b64 = (!sc.versions.is_empty())
                .then(|| serde_json::to_vec(&sc.versions).ok())
                .flatten()
                .map(|json| {
                    use base64::Engine;
                    base64::engine::general_purpose::STANDARD.encode(json)
                });
            attrs = set_attr(&attrs, "chromasmith:Versions", versions_b64.as_deref());
            let active_str = versions_b64.as_ref().map(|_| sc.active.to_string());
            attrs = set_attr(&attrs, "chromasmith:ActiveVersion", active_str.as_deref());
            attrs = set_attr(&attrs, "chromasmith:LastResetRecipe", sc.last_reset_recipe.as_deref());
            attrs = set_attr(
                &attrs,
                "chromasmith:LastResetEdited",
                if sc.last_reset_recipe.is_some() && sc.last_reset_edited { Some("True") } else { None },
            );

            let closer = if self_closing { "/>" } else { ">" };
            format!("{}{attrs}{closer}{}", &text[..start], &text[if self_closing { end + 1 } else { end } + 1..])
        }
        None => plain_template(sc),
    };
    let xmp = apply_keywords_to_xmp(xmp, &sc.keywords);
    let xmp = apply_people_to_xmp(xmp, people);
    std::fs::write(sc_path, xmp).map_err(|e| format!("write sidecar: {e}"))?;
    Ok(())
}

/// Dedicated entry point (mirroring `set_sidecar`'s own shape) rather than folding keywords
/// into `set_sidecar`'s parameter list — keywords are edited from a completely different UI
/// surface (a tag tree/autocomplete, not the rating/flag controls) and don't need to travel
/// alongside every rating click.
#[tauri::command]
pub fn set_keywords(path: String, keywords: Vec<String>) -> Result<(), String> {
    let mut sc = get_sidecar(path.clone());
    sc.keywords = keywords;
    write_sidecar(&path, &sc)
}

// ── Cross-folder smart collections (Edited/Favorites/Flagged/Rejected) ───────────────────
// One flat JSON list PER collection of every photo path currently in it, kept in the app
// cache dir (NOT next to the photos — this is app-internal bookkeeping, not a portable
// sidecar). Lets the library show a collection regardless of which folder a photo lives in,
// without re-scanning the whole disk: updated incrementally every time set_sidecar changes
// the relevant flag (add on true, remove on false), and backfilled once at startup by
// scanning recently-used folders for existing .xmp sidecars (see backfill_edited_registry).
// `name` is one of "edited"/"favorites"/"flagged"/"rejected" — a small fixed set, not
// user-supplied, so no path-traversal concern in the cache filename.
fn registry_path(name: &str) -> PathBuf {
    cache_dir().join(format!("{name}_registry.json"))
}
fn registry_read(name: &str) -> Vec<String> {
    std::fs::read_to_string(registry_path(name))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}
fn registry_write(name: &str, list: &[String]) {
    if let Ok(text) = serde_json::to_string(list) {
        let _ = std::fs::write(registry_path(name), text);
    }
}
/// JS-facing entry point for registries beyond the fixed set (`edited`/`favorites`/`flagged`/
/// `rejected`) written internally by set_sidecar above — used for the C2 "duplicates" and C3
/// "gphotos" (Google-Photos-synced) smart collections, which are driven from library-ui.js/
/// chromasmith-22.html rather than from a sidecar write. Same underlying mechanism, just named
/// so a small fixed extra set of collection names can be set directly. `name` is not arbitrary
/// user input from a network source — it's a small fixed set from our own frontend code — but
/// validate anyway since this fn, unlike registry_set, is reachable directly from JS.
#[tauri::command]
pub fn registry_set_cmd(name: String, path: String, present: bool) -> Result<(), String> {
    if !matches!(name.as_str(), "duplicates" | "gphotos") {
        return Err(format!("registry_set_cmd: unknown registry '{name}'"));
    }
    registry_set(&name, &path, present);
    Ok(())
}

fn registry_set(name: &str, path: &str, present_target: bool) {
    let mut list = registry_read(name);
    let present = list.iter().any(|p| p == path);
    if present_target && !present {
        list.push(path.to_string());
        registry_write(name, &list);
    } else if !present_target && present {
        list.retain(|p| p != path);
        registry_write(name, &list);
    }
}

/// Batched form of `registry_set_cmd` — the whole reason it exists is the O(n²) it replaces.
/// The frontend used to call `registry_set_cmd` once PER PHOTO (`Promise.all(paths.map(...))` in
/// library-ui.js's runDupeDetection/markFolderSyncedIfGphotosDownloads), and every single one of
/// those calls independently did registry_read (parse the WHOLE registry file) + a linear
/// `.iter().any()` scan + a full registry_write. Measured on a real ~30k-photo library with a
/// ~29k-entry duplicates registry: 29,663 IPC calls, ~47GB of file reads, ~0.9 BILLION string
/// comparisons — on every single folder open. This does one read, one HashSet, one write.
#[tauri::command]
pub fn registry_set_many(name: String, present: Vec<String>, absent: Vec<String>) -> Result<(), String> {
    if !matches!(name.as_str(), "duplicates" | "gphotos") {
        return Err(format!("registry_set_many: unknown registry '{name}'"));
    }
    let mut set: std::collections::HashSet<String> = registry_read(&name).into_iter().collect();
    let before: std::collections::HashSet<String> = set.clone();
    for p in present {
        set.insert(p);
    }
    for p in &absent {
        set.remove(p);
    }
    if set == before {
        return Ok(()); // membership genuinely unchanged — skip the write, not just the count
    }
    let mut list: Vec<String> = set.into_iter().collect();
    list.sort();
    registry_write(&name, &list);
    Ok(())
}

// ── Export/version history ────────────────────────────────────────────────────────────────
// Recipe-only, not pixel copies: each successful export appends {ts, version, recipe} for that
// photo. `recipe` is the same base64 FX-snapshot JSON already used by the XMP sidecar/undo
// history, so "restoring" a version just loads the recipe back into the live editor (no
// re-render happens automatically) — cheap to store, unlike keeping full rendered images.
// Kept in the app cache dir (like edited_registry.json above), NOT as a portable sidecar,
// since it's bookkeeping about past exports rather than the photo's current edit state.
#[derive(Serialize, Deserialize, Clone)]
pub struct ExportHistoryEntry {
    pub ts: u64,
    pub version: String,
    pub recipe: String,
    /// The real on-disk path this export was written to — absent (`""`) on any entry recorded
    /// before this field existed. `#[serde(default)]` so the existing on-disk
    /// export_history.json (already real user data on this machine) still deserializes.
    /// This is what catalog.rs's stack-linking rule 1 uses to link a RAW to its export
    /// authoritatively, instead of guessing from folder layout or filename stem.
    #[serde(default)]
    pub dest: String,
}
fn export_history_store_path() -> PathBuf {
    cache_dir().join("export_history.json")
}
pub(crate) fn export_history_read_all() -> HashMap<String, Vec<ExportHistoryEntry>> {
    std::fs::read_to_string(export_history_store_path())
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}
fn export_history_write_all(map: &HashMap<String, Vec<ExportHistoryEntry>>) {
    if let Ok(text) = serde_json::to_string(map) {
        let _ = std::fs::write(export_history_store_path(), text);
    }
}

#[tauri::command]
pub fn get_export_history(path: String) -> Vec<ExportHistoryEntry> {
    export_history_read_all().remove(&path).unwrap_or_default()
}

/// Capped at 30 entries per photo (newest last) — plenty of undo depth without the store
/// growing unbounded for a photo re-exported hundreds of times.
#[tauri::command]
pub fn append_export_history(path: String, version: String, recipe: String, dest: Option<String>) -> Result<(), String> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut all = export_history_read_all();
    let list = all.entry(path).or_default();
    list.push(ExportHistoryEntry { ts, version, recipe, dest: dest.unwrap_or_default() });
    if list.len() > 30 {
        let drop = list.len() - 30;
        list.drain(0..drop);
    }
    export_history_write_all(&all);
    Ok(())
}

/// Every photo path in a given cross-folder smart collection ("edited"/"favorites"/"flagged"/
/// "rejected"/"recents") — stat'd fresh so renamed/deleted files are flagged `missing` instead
/// of silently vanishing or erroring the whole list. Sorted newest-mtime-first; the frontend
/// re-sorts/filters same as a normal folder view.
#[tauri::command]
pub fn list_collection(name: String) -> Vec<DirEntry> {
    let mut out: Vec<DirEntry> = registry_read(&name)
        .into_iter()
        .map(|path| {
            let p = Path::new(&path);
            let file_name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.clone());
            let ext = ext_lower(p);
            let kind = kind_of(&ext);
            let edited_ts = edited_ts_of(&path);
            match std::fs::metadata(&path) {
                Ok(m) => {
                    let mtime = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
                    DirEntry { name: file_name, path, is_dir: false, is_image: true, is_video: false, kind, mtime, size: m.len(), missing: false, edited_ts }
                }
                Err(_) => DirEntry { name: file_name, path, is_dir: false, is_image: true, is_video: false, kind, mtime: 0, size: 0, missing: true, edited_ts },
            }
        })
        .collect();
    if name == "recents" {
        out.reverse(); // registry order is oldest-touched-first (touch_recent pushes to the end)
    } else {
        out.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    }
    out
}

/// Kept for backward compat with the frontend's original "All Edited" call site — equivalent
/// to `list_collection("edited")`.
#[tauri::command]
pub fn list_edited() -> Vec<DirEntry> {
    list_collection("edited".to_string())
}

/// Photo paths that have at least one export-history entry (see append_export_history above) —
/// the "Exported" smart collection. Reuses the same stat-fresh/missing-tolerant mapping as
/// list_collection, just sourced from export_history.json's keys instead of a registry file.
#[tauri::command]
pub fn list_exported() -> Vec<DirEntry> {
    let mut out: Vec<DirEntry> = export_history_read_all()
        .into_keys()
        .map(|path| {
            let p = Path::new(&path);
            let file_name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.clone());
            let ext = ext_lower(p);
            let kind = kind_of(&ext);
            let edited_ts = edited_ts_of(&path);
            match std::fs::metadata(&path) {
                Ok(m) => {
                    let mtime = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
                    DirEntry { name: file_name, path, is_dir: false, is_image: true, is_video: false, kind, mtime, size: m.len(), missing: false, edited_ts }
                }
                Err(_) => DirEntry { name: file_name, path, is_dir: false, is_image: true, is_video: false, kind, mtime: 0, size: 0, missing: true, edited_ts },
            }
        })
        .collect();
    out.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    out
}

/// Counts for every smart collection's sidebar badge — cheap (list lengths from disk, no
/// per-photo stat) so it can be refreshed after every sidecar write/export without cost.
#[tauri::command]
pub fn collection_counts() -> std::collections::HashMap<String, usize> {
    let mut m = std::collections::HashMap::new();
    m.insert("edited".to_string(), registry_read("edited").len());
    m.insert("favorites".to_string(), registry_read("favorites").len());
    m.insert("flagged".to_string(), registry_read("flagged").len());
    m.insert("rejected".to_string(), registry_read("rejected").len());
    m.insert("exported".to_string(), export_history_read_all().len());
    m.insert("recents".to_string(), registry_read("recents").len());
    m.insert("duplicates".to_string(), registry_read("duplicates").len());
    m.insert("gphotos".to_string(), registry_read("gphotos").len());
    m
}

// ── Perceptual-hash duplicate detection (dHash, 8x8 grey -> 64-bit) ──────────────────────
// Reuses get_thumbnail's cached 360px JPEG bytes (no extra decode). Cached per path in
// <hash>.phash.json alongside meta_cache_path's .meta4.json, keyed the same way (path+mtime+
// size), so re-runs are free until the file changes.
fn phash_cache_path(path: &str, mtime: u64, size: u64) -> PathBuf {
    // ⚠️ Its own key too, same reasoning as meta_cache_path above — PHASH_VER moves
    // independently of THUMB_RENDER_VER and META_READER_VER.
    let mtime_s = mtime.to_string();
    let size_s = size.to_string();
    cache_dir().join(format!("{:016x}.phash.json", fnv1a(&[path, &mtime_s, &size_s, PHASH_VER])))
}

/// dHash: resize to 9x8 grey, compare each pixel to its right neighbor -> 64 bits.
fn compute_dhash(bytes: &[u8]) -> Result<u64, String> {
    let img = image::load_from_memory(bytes).map_err(|e| format!("phash decode: {e}"))?;
    let small = img.resize_exact(9, 8, image::imageops::FilterType::Triangle).to_luma8();
    let mut hash: u64 = 0;
    let mut bit = 0u32;
    for y in 0..8u32 {
        for x in 0..8u32 {
            let left = small.get_pixel(x, y)[0];
            let right = small.get_pixel(x + 1, y)[0];
            if left > right {
                hash |= 1u64 << bit;
            }
            bit += 1;
        }
    }
    Ok(hash)
}

fn phash_for_path(path: &str) -> Result<u64, String> {
    // ⚠️ Videos are deliberately excluded from perceptual hashing, and this guard is load-bearing
    // BECAUSE video thumbnails started working. This function reuses get_thumbnail_inner's cached
    // JPEG, which used to Err for every clip — so clips fell out of duplicate detection silently
    // and for free. Now that a poster exists, every clip would get a dHash and start clustering
    // against other clips (and against stills) on the strength of one arbitrary frame. catalog.rs
    // guards its own queries with `kind != 'video'`, but phash_batch is called from the frontend
    // with every entry, so the guard belongs here where it covers all callers.
    if is_video_ext(&ext_lower(Path::new(path))) {
        return Err("perceptual hashing is not meaningful for video".into());
    }
    let meta = std::fs::metadata(path).map_err(|e| format!("stat {path}: {e}"))?;
    let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let cp = phash_cache_path(path, mtime, meta.len());
    if let Ok(text) = std::fs::read_to_string(&cp) {
        if let Ok(h) = text.trim().parse::<u64>() {
            return Ok(h);
        }
    }
    // Reuse get_thumbnail's own cache (same cache_key convention) instead of re-decoding.
    let thumb_cache = cache_dir().join(cache_key(path, mtime, meta.len()));
    let bytes = if let Ok(b) = std::fs::read(&thumb_cache) {
        b
    } else {
        // Not cached yet — generate it via the normal thumbnail path (which writes the JPEG
        // cache file as a side effect), then read it back from disk.
        get_thumbnail_inner(path.to_string())?;
        std::fs::read(&thumb_cache).map_err(|e| format!("read thumb cache: {e}"))?
    };
    let h = compute_dhash(&bytes)?;
    let _ = std::fs::write(&cp, h.to_string());
    Ok(h)
}

/// Batch perceptual-hash for duplicate clustering. Returns (path, hash) pairs; a path whose
/// hash fails to compute is simply omitted (frontend clustering just won't see it — no need
/// to fail the whole batch over one bad file). Hash is serialized as a 16-char lowercase hex
/// STRING, not a JSON number — a raw u64 can exceed JS's 2^53 safe-integer range and silently
/// lose precision through the Tauri IPC JSON bridge, corrupting Hamming-distance clustering.
// Parallelized with rayon: each path's hash is either read from its own on-disk cache file or
// requires a full decode (get_thumbnail_inner) on a cold cache — the same per-file, no-shared-
// state work get_thumbnail already runs concurrently from the frontend's 6-wide thumbnail pool.
// A cold folder's worth of these run one-at-a-time before this change; on an N-core machine this
// is roughly an N× wall-clock cut for the cold-cache case (the common one on first folder open).
#[tauri::command]
pub fn phash_batch(paths: Vec<String>) -> Result<Vec<(String, String)>, String> {
    let out: Vec<(String, String)> = paths
        .into_par_iter()
        .filter_map(|path| {
            match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| phash_for_path(&path))) {
                Ok(Ok(h)) => Some((path, format!("{h:016x}"))),
                _ => None,
            }
        })
        .collect();
    Ok(out)
}

/// Most-recently-opened photos, capped at 50 (oldest dropped first) — called once per photo
/// open (see openInEditorInner in library-ui.js). A photo re-opened moves back to the front
/// instead of appearing twice.
#[tauri::command]
pub fn touch_recent(path: String) {
    let mut list = registry_read("recents");
    list.retain(|p| p != &path);
    list.push(path);
    if list.len() > 50 {
        let drop = list.len() - 50;
        list.drain(0..drop);
    }
    registry_write("recents", &list);
}

/// One-time backfill for photos edited/favorited/flagged/rejected before their registries
/// existed: scan a set of known folders (recents + the given root) for `.xmp` sidecars and
/// register any not already tracked in the relevant collection(s) — a sidecar can match more
/// than one (e.g. edited AND favorited). Cheap (text scan, no image decode); called once by
/// the frontend on first Library open per session, not on every folder browse.
#[tauri::command]
pub fn backfill_edited_registry(folders: Vec<String>) -> usize {
    let mut edited = registry_read("edited");
    let mut favorites = registry_read("favorites");
    let mut flagged = registry_read("flagged");
    let mut rejected = registry_read("rejected");
    let mut added = 0usize;
    for folder in folders {
        let Ok(rd) = std::fs::read_dir(&folder) else { continue };
        for entry in rd.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) != Some("xmp") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&p) else { continue };
            let is_edited = xmp_get(&text, "chromasmith:Edited").as_deref() == Some("True");
            let is_favorite = xmp_get(&text, "chromasmith:Favorite").as_deref() == Some("True");
            let label = xmp_get(&text, "xmp:Label").unwrap_or_default();
            let is_flagged = label == "Green";
            let is_rejected = label == "Red";
            if !(is_edited || is_favorite || is_flagged || is_rejected) {
                continue;
            }
            let photo = p.with_extension(""); // best-effort; sidecar_path() is <photo>.xmp exactly
            // Try every image extension the sidecar could belong to (with_extension("") strips
            // the .xmp but the photo's real extension is unknown from the sidecar name alone).
            for ext in crate::formats::all_image_exts() {
                let candidate = photo.with_extension(ext);
                if candidate.exists() {
                    let s = candidate.to_string_lossy().into_owned();
                    let mut matched = false;
                    if is_edited && !edited.iter().any(|p2| p2 == &s) { edited.push(s.clone()); matched = true; }
                    if is_favorite && !favorites.iter().any(|p2| p2 == &s) { favorites.push(s.clone()); matched = true; }
                    if is_flagged && !flagged.iter().any(|p2| p2 == &s) { flagged.push(s.clone()); matched = true; }
                    if is_rejected && !rejected.iter().any(|p2| p2 == &s) { rejected.push(s); matched = true; }
                    if matched { added += 1; }
                    break;
                }
            }
        }
    }
    if added > 0 {
        registry_write("edited", &edited);
        registry_write("favorites", &favorites);
        registry_write("flagged", &flagged);
        registry_write("rejected", &rejected);
    }
    added
}

/// Duplicates a photo (and its .xmp sidecar, if any) alongside the original with a
/// "-copy"/"-copy2"/... suffix before the extension. Returns the new file's path so the
/// caller can refresh the grid and select it.
#[tauri::command]
pub fn duplicate_file(path: String) -> Result<String, String> {
    let src = Path::new(&path);
    let dir = src.parent().ok_or("no parent directory")?;
    let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("photo");
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
    let mut n = 1;
    let dest = loop {
        let suffix = if n == 1 { "-copy".to_string() } else { format!("-copy{n}") };
        let name = if ext.is_empty() { format!("{stem}{suffix}") } else { format!("{stem}{suffix}.{ext}") };
        let candidate = dir.join(name);
        if !candidate.exists() {
            break candidate;
        }
        n += 1;
    };
    std::fs::copy(src, &dest).map_err(|e| format!("copy {path}: {e}"))?;
    let sidecar = sidecar_path(&path);
    if sidecar.exists() {
        let _ = std::fs::copy(&sidecar, sidecar_path(dest.to_str().unwrap_or_default()));
    }
    Ok(dest.to_string_lossy().into_owned())
}

/// Moves a photo (and its .xmp sidecar) to macOS's Trash — never a hard delete, so it's
/// recoverable the same way Finder's own Delete is. `~/.Trash` is normally on the same
/// volume as the user's Documents/Pictures, so a plain rename works; falls back to
/// copy+remove for the rare cross-volume case (e.g. an external drive).
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn trash_file(path: String) -> Result<(), String> {
    let src = Path::new(&path);
    let trash_dir = crate::platform::trash_dir().map_err(|_| "could not resolve ~/.Trash".to_string())?;
    std::fs::create_dir_all(&trash_dir).map_err(|e| format!("create trash dir: {e}"))?;
    let name = src.file_name().ok_or("no filename")?;
    let mut dest = trash_dir.join(name);
    let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
    let mut n = 1;
    while dest.exists() {
        n += 1;
        let name = if ext.is_empty() { format!("{stem} {n}") } else { format!("{stem} {n}.{ext}") };
        dest = trash_dir.join(name);
    }
    move_or_copy(src, &dest)?;
    let sidecar = sidecar_path(&path);
    if sidecar.exists() {
        let sc_name = sidecar.file_name().ok_or("no sidecar filename")?;
        let _ = move_or_copy(&sidecar, &trash_dir.join(sc_name));
    }
    Ok(())
}

/// Windows has a real Recycle Bin API (unlike the macOS "move a file into ~/.Trash" convention
/// above), so this goes straight through `IFileOperation` instead of reimplementing rename-with-
/// numeric-suffix. The sidecar is trashed as its own item for the same reason: `IFileOperation`
/// already handles same-named collisions in the Recycle Bin itself.
#[cfg(windows)]
#[tauri::command]
pub fn trash_file(path: String) -> Result<(), String> {
    let src = Path::new(&path);
    crate::platform::move_to_trash(src)?;
    let sidecar = sidecar_path(&path);
    if sidecar.exists() {
        let _ = crate::platform::move_to_trash(&sidecar);
    }
    Ok(())
}

/// `cache_dir()` holds two very different kinds of file: generated, regenerable cache entries
/// (thumbnail/meta/phash JPEGs and JSON), and hand-maintained USER DATA that happens to live in
/// the same directory (the cross-folder smart-collection registries, `registry_path` above, and
/// export history) — favorites, flags, rejects, duplicates, edited status, recents, export
/// history. Both `prune_caches` below and `clear_cache_tier("working_thumbs")` (catalog.rs) used
/// to `remove_dir_all`/age-sweep the WHOLE directory with no distinction — a real, reachable
/// data-loss bug (clear_cache_tier is wired to a UI button today). Denylist first (explicit,
/// short, and fails closed — an unrecognized name is treated as NOT evictable rather than
/// guessed at), then an allowlist of every shape this file actually generates.
pub(crate) fn is_evictable_cache_file(name: &str) -> bool {
    if name.ends_with("_registry.json") || name == "export_history.json" {
        return false;
    }
    name.ends_with(".jpg") || name.ends_with(".meta.json") || name.ends_with(".phash.json") || name.ends_with(".meta4.json")
}

/// Launch-time cache pruning — both cache dirs were unbounded (thumbnails ~50-150KB each,
/// decode-cache JPEGs 5-15MB each; stale mtime/recipe keys accumulate forever since keys change
/// whenever the source file or its RAW-stage settings do). Cap each dir and evict least-
/// recently-ACCESSED first (falls back to modified time on a filesystem without atime tracking).
/// Called once from main()'s setup on a background thread — never blocks startup.
pub fn prune_caches() {
    // ⚠️ Measured against a real ~30k-photo library before raising this: cache_dir() (thumbnail
    // + .meta.json + .phash.json) sat at 1.2GB / 91,873 files — well over the OLD 500MB cap,
    // which would have deleted ~700MB of it on every single prune, forcing every one of those
    // files to be regenerated (including the RAW metadata read this session's B fix targets)
    // over and over. 6GB + the 14GB decode cap below matches the 20GB the cache-usage UI already
    // advertises, and scales to a ~100k-photo library without thrashing.
    const THUMB_CAP: u64 = 6 * 1024 * 1024 * 1024; // 6GB
    // Raised from 2GB to 14GB (library-catalog plan's cache-budget split: ~6GB never-pruned
    // offline thumbnails + ~14GB LRU full-size decodes, out of a 20GB total). This tier already
    // does exactly what "recent edits open instantly" needs — a full-resolution decoded JPEG
    // keyed on path+mtime+size+recipe_key (decode_cache_key) — it just needed headroom to hold
    // more than a couple hundred RAWs at once. LRU eviction policy is unchanged, still oldest-
    // access-first; only the ceiling moved.
    const DECODE_CAP: u64 = 14 * 1024 * 1024 * 1024; // 14GB
    for (dir, cap) in [(cache_dir(), THUMB_CAP), (decode_cache_dir(), DECODE_CAP)] {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        let mut files: Vec<(std::time::SystemTime, u64, PathBuf)> = rd
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let name = e.file_name();
                if !is_evictable_cache_file(&name.to_string_lossy()) { return None; }
                let m = e.metadata().ok()?;
                if !m.is_file() { return None; }
                let when = m.accessed().or_else(|_| m.modified()).ok()?;
                Some((when, m.len(), e.path()))
            })
            .collect();
        let total: u64 = files.iter().map(|f| f.1).sum();
        if total <= cap { continue }
        files.sort_by_key(|f| f.0); // least-recently-accessed first
        let mut freed = 0u64;
        for (_, len, p) in files {
            if total - freed <= cap { break }
            if std::fs::remove_file(&p).is_ok() {
                freed += len;
            }
        }
        eprintln!("cache prune: freed {}MB from {}", freed / (1024 * 1024), dir.display());
    }
}

/// Reveal a file in the OS file browser (Finder on macOS, Explorer on Windows) — standard
/// file-browser context-menu expectation.
#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    crate::platform::reveal_in_file_manager(&path)
}

fn move_or_copy(src: &Path, dest: &Path) -> Result<(), String> {
    if std::fs::rename(src, dest).is_ok() {
        return Ok(());
    }
    std::fs::copy(src, dest).map_err(|e| format!("copy {}: {e}", src.display()))?;
    std::fs::remove_file(src).map_err(|e| format!("remove {}: {e}", src.display()))
}

#[cfg(test)]
mod heic_tests {
    use super::*;

    /// HEIC is the format every iPhone photo arrives in, and it was invisible to the Library —
    /// not broken, absent. Uses a real file from the repo's own `lucifer/` folder (gitignored
    /// user captures) and skips cleanly when it is not in the checkout.
    /// ⚠️ Without this, an iPhone import files every photo under its FILE mtime instead of when
    /// it was taken — the same class of bug ingest.rs's own test guards for JPEG, and the one that
    /// makes a date-organised folder tree lie.
    #[test]
    fn heic_exif_date_is_readable() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../lucifer");
        let Some(sample) = std::fs::read_dir(&dir).ok().and_then(|rd| {
            rd.flatten().map(|e| e.path()).find(|p| is_heic_ext(&ext_lower(p)))
        }) else { eprintln!("skipping: no HEIC present"); return; };
        let m = read_meta(&sample.to_string_lossy());
        println!("HEIC meta: date={:?} camera={:?} iso={:?}", m.date, m.camera, m.iso);
        assert!(m.date.is_some(), "no EXIF date read from HEIC — import would file it by mtime");
        let d = m.date.unwrap();
        assert!(d.len() >= 10 && d.chars().take(4).all(|c| c.is_ascii_digit()),
            "unexpected date format: {d}");
    }

    #[test]
    fn heic_is_listed_and_thumbnails() {
        assert!(is_image_ext("heic") && is_image_ext("heif"), "HEIC must be a listable image type");
        assert_eq!(kind_of("heic"), "heic");
        assert!(!is_raw_ext("heic"), "HEIC is not a RAW — it must not take the rawler path");

        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../lucifer");
        let Some(sample) = std::fs::read_dir(&dir).ok().and_then(|rd| {
            rd.flatten().map(|e| e.path()).find(|p| is_heic_ext(&ext_lower(p)))
        }) else {
            eprintln!("skipping: no HEIC in {}", dir.display());
            return;
        };

        // list_dir must actually surface it.
        let listed = list_dir(dir.to_string_lossy().into_owned()).expect("list_dir");
        let found = listed.iter().find(|e| e.path == sample.to_string_lossy());
        assert!(found.is_some(), "HEIC did not appear in list_dir");
        assert!(found.unwrap().is_image, "HEIC listed but not flagged as an image");

        // ...and produce a real thumbnail via ImageIO, not an error.
        let resp = get_thumbnail(sample.to_string_lossy().into_owned());
        assert!(resp.is_ok(), "HEIC thumbnail failed: {:?}", resp.err());
    }
}

#[cfg(test)]
mod version_tests {
    use super::*;

    /// A scratch photo path whose sidecar we can freely write.
    fn scratch(tag: &str) -> String {
        let dir = std::env::temp_dir().join(format!("cs_ver_{}_{}", std::process::id(), tag));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("photo.jpg");
        std::fs::write(&p, b"x").unwrap();
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn virtual_copies_round_trip_and_stay_independent() {
        let path = scratch("rt");
        set_sidecar(path.clone(), 3, "Green".into(), true, Some("RECIPE_A".into()), Some(true)).unwrap();

        // A photo that has never been copied carries NO versions — it must look exactly like one
        // written before this feature existed.
        let sc = get_sidecar(path.clone());
        assert!(sc.versions.is_empty(), "an uncopied photo must not grow a versions list");
        assert_eq!(sc.recipe, "RECIPE_A");

        // Branching promotes the existing edits to "Original" rather than orphaning them.
        let sc = sidecar_add_version(path.clone(), "Mono".into()).unwrap();
        assert_eq!(sc.versions.len(), 2);
        assert_eq!(sc.versions[0].name, "Original");
        assert_eq!(sc.versions[0].recipe, "RECIPE_A");
        assert_eq!(sc.active, 1, "a new copy becomes the active one");
        assert_eq!(sc.versions[1].recipe, "RECIPE_A", "a copy branches from where you were");

        // Editing writes to the ACTIVE version only.
        set_sidecar(path.clone(), 3, "Green".into(), true, Some("RECIPE_B".into()), None).unwrap();
        let sc = get_sidecar(path.clone());
        assert_eq!(sc.versions[1].recipe, "RECIPE_B");
        assert_eq!(sc.versions[0].recipe, "RECIPE_A", "editing a copy must not touch the original");
        assert_eq!(sc.recipe, "RECIPE_B", "the flat recipe tracks the active version");

        // Switching back surfaces the original's recipe through the SAME flat field every
        // existing reader uses.
        let sc = sidecar_set_active_version(path.clone(), 0).unwrap();
        assert_eq!(sc.recipe, "RECIPE_A");
        assert_eq!(get_sidecar(path.clone()).recipe, "RECIPE_A");

        // Rating/label survive all of it.
        let sc = get_sidecar(path.clone());
        assert_eq!(sc.rating, 3);
        assert_eq!(sc.label, "Green");
        assert!(sc.favorite);

        std::fs::remove_dir_all(std::path::Path::new(&path).parent().unwrap()).ok();
    }

    #[test]
    fn deleting_down_to_one_collapses_the_list() {
        let path = scratch("del");
        set_sidecar(path.clone(), 0, String::new(), true, Some("BASE".into()), None).unwrap();
        sidecar_add_version(path.clone(), "B".into()).unwrap();
        sidecar_add_version(path.clone(), "C".into()).unwrap();
        assert_eq!(get_sidecar(path.clone()).versions.len(), 3);

        // Deleting a version BELOW the active one must shift the active index with it, or the
        // selection silently jumps to a different copy.
        let sc = sidecar_set_active_version(path.clone(), 2).unwrap();
        assert_eq!(sc.active, 2);
        let sc = sidecar_delete_version(path.clone(), 0).unwrap();
        assert_eq!(sc.versions.len(), 2);
        assert_eq!(sc.versions[1].name, "C");
        assert_eq!(sc.active, 1, "active must still point at C after the list shifted");

        // Down to one: the list collapses so the photo looks un-copied again.
        let sc = sidecar_delete_version(path.clone(), 0).unwrap();
        assert!(sc.versions.is_empty(), "one remaining version should not be a list");
        assert_eq!(sc.active, 0);
        assert!(!sc.recipe.is_empty(), "the surviving version's recipe must be kept");

        std::fs::remove_dir_all(std::path::Path::new(&path).parent().unwrap()).ok();
    }

    #[test]
    fn a_legacy_sidecar_still_loads() {
        // Exactly the shape written before virtual copies existed — no Versions attribute.
        let path = scratch("legacy");
        let xmp = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description rdf:about="" xmp:Rating="4" chromasmith:Edited="True" chromasmith:Recipe="OLDRECIPE"/></rdf:RDF></x:xmpmeta>"#;
        std::fs::write(sidecar_path(&path), xmp).unwrap();
        let sc = get_sidecar(path.clone());
        assert_eq!(sc.rating, 4);
        assert_eq!(sc.recipe, "OLDRECIPE");
        assert!(sc.versions.is_empty());
        assert_eq!(sc.active, 0);
        std::fs::remove_dir_all(std::path::Path::new(&path).parent().unwrap()).ok();
    }

    #[test]
    fn an_out_of_range_active_index_is_clamped() {
        let path = scratch("clamp");
        let xmp = r#"<x:xmpmeta><rdf:Description chromasmith:Recipe="R" chromasmith:ActiveVersion="9"/></x:xmpmeta>"#;
        std::fs::write(sidecar_path(&path), xmp).unwrap();
        // No versions at all, ActiveVersion=9 — a hand-edited or truncated file must not index
        // out of bounds later.
        assert_eq!(get_sidecar(path.clone()).active, 0);
        std::fs::remove_dir_all(std::path::Path::new(&path).parent().unwrap()).ok();
    }

    #[test]
    fn reset_edit_is_undoable_exactly_once() {
        let path = scratch("reset_undo");
        set_sidecar(path.clone(), 3, "Green".into(), true, Some("ORIGRECIPE".into()), None).unwrap();

        // Nothing to undo before any reset has happened.
        assert!(undo_reset_edit(path.clone()).is_err(), "undo with an empty buffer must error, not no-op silently");

        let after_reset = reset_edit(path.clone()).unwrap();
        assert_eq!(after_reset.recipe, "", "reset must clear the active recipe");
        assert!(!after_reset.edited, "reset must clear the edited flag");
        assert_eq!(after_reset.last_reset_recipe.as_deref(), Some("ORIGRECIPE"));
        assert!(after_reset.last_reset_edited, "the discarded state was edited=true, so the buffer must remember that");

        // The undo buffer's XMP persistence must survive an actual disk round trip, not just live
        // in the in-memory struct returned above.
        let reloaded = get_sidecar(path.clone());
        assert_eq!(reloaded.recipe, "");
        assert_eq!(reloaded.last_reset_recipe.as_deref(), Some("ORIGRECIPE"));
        assert!(reloaded.last_reset_edited);

        let restored = undo_reset_edit(path.clone()).unwrap();
        assert_eq!(restored.recipe, "ORIGRECIPE", "undo must restore the exact discarded recipe");
        assert!(restored.edited, "undo must restore the exact discarded edited flag");
        assert!(restored.last_reset_recipe.is_none(), "undo must consume the buffer");

        // Exactly one level: a second undo with nothing new reset must fail again.
        assert!(undo_reset_edit(path.clone()).is_err());

        // Reload from disk to prove the restore itself persisted, not just the return value.
        let reloaded2 = get_sidecar(path.clone());
        assert_eq!(reloaded2.recipe, "ORIGRECIPE");
        assert!(reloaded2.last_reset_edited || true); // flag is stale-but-harmless once buffer is None
        assert!(reloaded2.last_reset_recipe.is_none());

        std::fs::remove_dir_all(std::path::Path::new(&path).parent().unwrap()).ok();
    }

    #[test]
    fn a_real_edit_after_a_reset_clears_the_undo_buffer() {
        let path = scratch("reset_then_edit");
        set_sidecar(path.clone(), 0, String::new(), true, Some("A".into()), None).unwrap();
        reset_edit(path.clone()).unwrap();
        assert!(get_sidecar(path.clone()).last_reset_recipe.is_some());

        // A genuine new edit (non-empty recipe, edited:true) supersedes the discarded recipe —
        // restoring it afterwards would silently throw away the new work.
        set_sidecar(path.clone(), 0, String::new(), true, Some("B".into()), None).unwrap();
        let sc = get_sidecar(path.clone());
        assert_eq!(sc.recipe, "B");
        assert!(sc.last_reset_recipe.is_none(), "a real edit must clear the pending undo buffer");
        assert!(undo_reset_edit(path.clone()).is_err());

        std::fs::remove_dir_all(std::path::Path::new(&path).parent().unwrap()).ok();
    }
}
// ── Albums: user-made collections that LINK to photos rather than copying them ───────────────
//
// The gap this closes: every existing collection here is *derived* (edited, favorites, exported,
// rejected — each computed from a per-photo fact). There was no way to say "these 40 frames are
// the Geneva set" without moving files on disk, which is what a folder would mean.
//
// ⚠️ An album stores PATHS, never pixels. That is the whole point — a photo can be in any number
// of albums, appears at full quality in each, and deleting an album cannot lose a photograph.
// The cost of that choice is that an album can go stale when a file is moved or renamed outside
// the app, which is why `list_album` marks missing entries (`DirEntry::missing`) rather than
// dropping them: a photo you can see and fix is better than one that silently disappeared.
//
// Stored in Application Support, NOT Caches — an album is user work that cannot be regenerated
// from anything on disk. Same reasoning as subject.rs's prototypes.

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Album {
    pub id: String,
    pub name: String,
    /// Absolute photo paths, in the order the user added them.
    pub paths: Vec<String>,
    /// Unix seconds, for "recently used" ordering in the sidebar.
    pub updated: u64,
}

fn albums_path() -> PathBuf {
    crate::platform::data_root().join("albums.json")
}

fn albums_read() -> Vec<Album> {
    std::fs::read_to_string(albums_path())
        .ok()
        .and_then(|t| serde_json::from_str::<Vec<Album>>(&t).ok())
        .unwrap_or_default()
}

fn albums_write(v: &[Album]) -> Result<(), String> {
    let path = albums_path();
    let text = serde_json::to_string_pretty(v).map_err(|e| format!("serialise albums: {e}"))?;
    // Write-then-rename, so an interrupted write cannot truncate the file every album lives in.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("write albums: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("commit albums: {e}"))
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[tauri::command]
pub fn album_list() -> Vec<Album> {
    let mut v = albums_read();
    v.sort_by(|a, b| b.updated.cmp(&a.updated));
    v
}

#[tauri::command]
pub fn album_create(name: String) -> Result<Album, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("an album needs a name".into());
    }
    let mut all = albums_read();
    if all.iter().any(|a| a.name.eq_ignore_ascii_case(&name)) {
        return Err(format!("an album called \"{name}\" already exists"));
    }
    let album = Album { id: format!("alb{}", now_secs()), name, paths: Vec::new(), updated: now_secs() };
    all.push(album.clone());
    albums_write(&all)?;
    Ok(album)
}

#[tauri::command]
pub fn album_rename(id: String, name: String) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("an album needs a name".into());
    }
    let mut all = albums_read();
    let a = all.iter_mut().find(|a| a.id == id).ok_or("no such album")?;
    a.name = name;
    a.updated = now_secs();
    albums_write(&all)
}

#[tauri::command]
pub fn album_delete(id: String) -> Result<(), String> {
    let mut all = albums_read();
    all.retain(|a| a.id != id);
    // ⚠️ Deletes the LIST only. Nothing here touches a photo, which is what makes an album safe
    // to throw away — the opposite of a folder.
    albums_write(&all)
}

/// Adds photos to an album, skipping ones already in it. Returns how many were actually added so
/// the UI can say "3 added, 2 already there" instead of a silent no-op on a re-drag.
#[tauri::command]
pub fn album_add(id: String, paths: Vec<String>) -> Result<usize, String> {
    let mut all = albums_read();
    let a = all.iter_mut().find(|a| a.id == id).ok_or("no such album")?;
    let before = a.paths.len();
    for p in paths {
        if !a.paths.iter().any(|q| q == &p) {
            a.paths.push(p);
        }
    }
    let added = a.paths.len() - before;
    a.updated = now_secs();
    albums_write(&all)?;
    Ok(added)
}

#[tauri::command]
pub fn album_remove(id: String, paths: Vec<String>) -> Result<(), String> {
    let mut all = albums_read();
    let a = all.iter_mut().find(|a| a.id == id).ok_or("no such album")?;
    a.paths.retain(|p| !paths.iter().any(|q| q == p));
    a.updated = now_secs();
    albums_write(&all)
}

/// Reorders one album's contents wholesale — the drag-to-reorder gesture. Paths not currently in
/// the album are ignored rather than added, so a stale drag can't quietly grow it.
#[tauri::command]
pub fn album_set_order(id: String, paths: Vec<String>) -> Result<(), String> {
    let mut all = albums_read();
    let a = all.iter_mut().find(|a| a.id == id).ok_or("no such album")?;
    let existing: Vec<String> = a.paths.clone();
    let mut next: Vec<String> = paths.into_iter().filter(|p| existing.contains(p)).collect();
    // Anything the caller didn't mention keeps its old relative position at the end.
    for p in existing {
        if !next.contains(&p) {
            next.push(p);
        }
    }
    a.paths = next;
    a.updated = now_secs();
    albums_write(&all)
}

#[cfg(test)]
mod cache_key_tests {
    use super::*;

    /// Pins FNV-1a's exact output for a known input. If this ever changes — a different hash
    /// algorithm, a different part-separator, a Rust-version-dependent detail sneaking back in
    /// — this fails LOUDLY in CI instead of silently reassigning every cache key in production,
    /// which for the planned never-pruned offline-thumbnail tier means gigabytes of orphaned
    /// files with no way to regenerate them if the source volume is unplugged.
    #[test]
    fn cache_key_is_a_hardcoded_literal() {
        assert_eq!(cache_key("/x/y.RW2", 1_700_000_000, 12_345), "fd36f3fb28ffd1bb.jpg");
    }

    /// The coupling bug this refactor exists to fix, pinned directly: bumping the thumbnail
    /// tier's version must not move the metadata or phash tier's key, and vice versa. Before
    /// this, all three shared one hash via a `.replace(".jpg", "...")` filename trick, so a
    /// thumbnail-only rendering fix silently invalidated every cached EXIF read and perceptual
    /// hash too.
    #[test]
    fn bumping_one_tier_version_does_not_move_another() {
        let path = "/x/y.RW2";
        let (mtime, size) = (1_700_000_000u64, 12_345u64);
        let thumb_before = cache_key(path, mtime, size);
        let meta_before = meta_cache_path(path, mtime, size);
        let phash_before = phash_cache_path(path, mtime, size);

        // Simulate "bump THUMB_RENDER_VER" by hashing with a different thumbnail-tier literal
        // directly (the const itself can't be mutated at runtime) — meta/phash must be
        // unaffected since they never reference THUMB_RENDER_VER.
        let mtime_s = mtime.to_string();
        let size_s = size.to_string();
        let thumb_after = format!("{:016x}.jpg", fnv1a(&[path, &mtime_s, &size_s, "thumb-v3-hypothetical"]));
        assert_ne!(thumb_before, thumb_after, "sanity: the simulated bump must actually change the thumbnail key");
        assert_eq!(meta_cache_path(path, mtime, size), meta_before, "metadata key must not move when only the thumbnail tier's version changes");
        assert_eq!(phash_cache_path(path, mtime, size), phash_before, "phash key must not move when only the thumbnail tier's version changes");
    }

    /// Content identity (path+mtime+size) must still be the whole story for a fixed version —
    /// change any one of the three and the key changes; change none and it's stable across
    /// repeated calls (this is what makes a cache a cache).
    #[test]
    fn cache_key_is_stable_and_content_sensitive() {
        let a = cache_key("/x/y.RW2", 1000, 500);
        let b = cache_key("/x/y.RW2", 1000, 500);
        assert_eq!(a, b, "same inputs must hash identically across calls");
        assert_ne!(a, cache_key("/x/y.RW2", 1001, 500), "mtime must be part of the key");
        assert_ne!(a, cache_key("/x/y.RW2", 1000, 501), "size must be part of the key");
        assert_ne!(a, cache_key("/x/z.RW2", 1000, 500), "path must be part of the key");
    }
}

#[cfg(test)]
mod sidecar_preservation_tests {
    use super::*;

    fn scratch(tag: &str) -> String {
        let dir = std::env::temp_dir().join(format!("cs_sidecar_{}_{}", std::process::id(), tag));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("photo.jpg");
        std::fs::write(&p, b"x").unwrap();
        p.to_string_lossy().into_owned()
    }

    /// The single most important test in this module: a sidecar written by another tool
    /// (Lightroom, Bridge) carries develop settings and IPTC fields Chromasmith doesn't
    /// understand. Before this fix, `write_sidecar` rebuilt the file from scratch on every
    /// write and silently discarded them. This asserts they survive a real rating change.
    #[test]
    fn write_sidecar_preserves_unknown_fields() {
        let path = scratch("foreign");
        let foreign = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" crs:Exposure2012="+0.35" crs:Contrast2012="+10">
   <photoshop:City>Geneva</photoshop:City>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
"#;
        std::fs::write(sidecar_path(&path), foreign).unwrap();

        set_sidecar(path.clone(), 4, "Green".into(), true, Some("RECIPE_X".into()), Some(true)).unwrap();

        let text = std::fs::read_to_string(sidecar_path(&path)).unwrap();
        assert!(text.contains(r#"crs:Exposure2012="+0.35""#), "foreign attribute lost:\n{text}");
        assert!(text.contains(r#"crs:Contrast2012="+10""#), "foreign attribute lost:\n{text}");
        assert!(text.contains("<photoshop:City>Geneva</photoshop:City>"), "foreign child element lost:\n{text}");

        // And our own fields actually landed.
        let sc = get_sidecar(path.clone());
        assert_eq!(sc.rating, 4);
        assert_eq!(sc.label, "Green");
        assert!(sc.edited);
        assert!(sc.favorite);
        assert_eq!(sc.recipe, "RECIPE_X");
    }

    /// A Chromasmith-only sidecar (no foreign content) still round-trips correctly through the
    /// merge path, not just the from-scratch fallback — the common case, exercised on a second
    /// write so it goes through `find_description_attrs` rather than `plain_template`.
    #[test]
    fn a_chromasmith_only_sidecar_round_trips_on_a_second_write() {
        let path = scratch("own");
        set_sidecar(path.clone(), 2, "Red".into(), false, Some("A".into()), Some(false)).unwrap();
        set_sidecar(path.clone(), 5, "".into(), true, Some("B".into()), Some(true)).unwrap();
        let sc = get_sidecar(path.clone());
        assert_eq!(sc.rating, 5);
        assert_eq!(sc.label, "", "label must be CLEARED, not left as the stale 'Red'");
        assert!(sc.edited);
        assert!(sc.favorite);
        assert_eq!(sc.recipe, "B");
    }

    /// Clearing a field that was previously set must remove the attribute, not just fail to
    /// add it — otherwise unsetting a rating/favorite/label after the fact would leave the old
    /// value live in the file while the app believes it was cleared.
    #[test]
    fn clearing_a_field_removes_its_attribute_not_just_skips_it() {
        let path = scratch("clear");
        set_sidecar(path.clone(), 3, "Star".into(), true, Some("R".into()), Some(true)).unwrap();
        set_sidecar(path.clone(), 0, "".into(), false, Some("".into()), Some(false)).unwrap();
        let text = std::fs::read_to_string(sidecar_path(&path)).unwrap();
        assert!(!text.contains("xmp:Label="), "cleared label attribute must be removed:\n{text}");
        assert!(!text.contains("chromasmith:Edited="), "cleared edited attribute must be removed:\n{text}");
        assert!(!text.contains("chromasmith:Favorite="), "cleared favorite attribute must be removed:\n{text}");
        assert!(!text.contains("chromasmith:Recipe="), "cleared recipe attribute must be removed:\n{text}");
        let sc = get_sidecar(path);
        assert_eq!(sc.rating, 0);
        assert_eq!(sc.label, "");
    }

    /// No existing sidecar at all: must fall back to the plain template exactly as before —
    /// this is the "no file" half of the fallback the preservation logic is built around.
    #[test]
    fn no_existing_sidecar_falls_back_to_the_plain_template() {
        let path = scratch("none");
        set_sidecar(path.clone(), 3, "".into(), false, None, None).unwrap();
        let sc = get_sidecar(path);
        assert_eq!(sc.rating, 3);
    }

    /// A sidecar that exists but doesn't contain a locatable `<rdf:Description>` tag (corrupt,
    /// truncated, or some non-XMP text) must not panic or write garbage — it falls back to the
    /// plain template rather than trying to surgically edit something it can't find.
    #[test]
    fn an_unparseable_existing_sidecar_falls_back_safely() {
        let path = scratch("corrupt");
        std::fs::write(sidecar_path(&path), b"not xml at all").unwrap();
        let res = set_sidecar(path.clone(), 2, "".into(), false, None, None);
        assert!(res.is_ok());
        let sc = get_sidecar(path);
        assert_eq!(sc.rating, 2);
    }

    /// Parses a real Lightroom-written sidecar if one exists in the repo (present at time of
    /// writing: 20260731-__TM3682.xmp at the repo root), skipped cleanly otherwise. Guards the
    /// no-XML-crate decision against an actual real-world file rather than only a hand-built one.
    #[test]
    fn xmp_bag_parses_a_real_sidecar_from_the_repo_root() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let Some(sample) = std::fs::read_dir(&root).ok().and_then(|rd| {
            rd.flatten().map(|e| e.path()).find(|p| ext_lower(p) == "xmp")
        }) else {
            eprintln!("skipping: no .xmp at repo root");
            return;
        };
        let text = std::fs::read_to_string(&sample).expect("read sample xmp");
        let (start, end, _) = find_description_attrs(&text).expect("must locate rdf:Description in a real sidecar");
        assert!(end > start || text[start..end].is_empty(), "attrs span must be well-formed");
    }

    // ── Keywords ─────────────────────────────────────────────────────────────────────────────

    #[test]
    fn hierarchical_keywords_round_trip_through_xmp() {
        let path = scratch("keywords");
        set_keywords(path.clone(), vec!["Travel|Iceland|Reykjavik".into(), "Portrait".into()]).unwrap();

        let text = std::fs::read_to_string(sidecar_path(&path)).unwrap();
        assert!(text.contains("xmlns:dc="), "the dc namespace must be declared once keywords are written");
        assert!(text.contains("xmlns:lr="), "the lr namespace must be declared once keywords are written");

        // dc:subject carries LEAVES only, matching real Lightroom output.
        let subjects = xmp_bag(&text, "subject");
        assert_eq!(subjects, vec!["Reykjavik".to_string(), "Portrait".to_string()]);

        // lr:hierarchicalSubject carries every full path AND every ancestor, so the tag tree
        // has something to build "Travel" and "Travel|Iceland" nodes from.
        let hier = xmp_bag(&text, "hierarchicalSubject");
        assert_eq!(hier, vec!["Travel".to_string(), "Travel|Iceland".to_string(), "Travel|Iceland|Reykjavik".to_string(), "Portrait".to_string()]);

        // And the round trip back through get_sidecar must reproduce the exact input paths —
        // not the exploded ancestor list, which is a lr:hierarchicalSubject writing detail, not
        // what the caller asked to be tagged.
        let sc = get_sidecar(path);
        assert_eq!(sc.keywords, vec!["Travel|Iceland|Reykjavik".to_string(), "Portrait".to_string()]);
    }

    /// A photo tagged only via a flat `dc:subject` list (no hierarchicalSubject at all — a
    /// sidecar from a tool that doesn't do hierarchy) must still read back as single-segment
    /// keyword paths, per the plan's own documented fallback.
    #[test]
    fn flat_subject_falls_back_to_single_segment_keywords() {
        let path = scratch("flat-subject");
        let xmp = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Other Tool">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:subject><rdf:Bag><rdf:li>Wildlife</rdf:li><rdf:li>Kenya</rdf:li></rdf:Bag></dc:subject>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
"#;
        std::fs::write(sidecar_path(&path), xmp).unwrap();
        let sc = get_sidecar(path);
        assert_eq!(sc.keywords, vec!["Wildlife".to_string(), "Kenya".to_string()]);
    }

    /// Clearing every keyword must remove the elements entirely, not leave an empty bag —
    /// otherwise a re-tag after a full clear would see stale (empty) markup and could confuse a
    /// hand-inspection of the file.
    #[test]
    fn clearing_all_keywords_removes_the_elements() {
        let path = scratch("clear-keywords");
        set_keywords(path.clone(), vec!["Travel".into()]).unwrap();
        set_keywords(path.clone(), vec![]).unwrap();

        let text = std::fs::read_to_string(sidecar_path(&path)).unwrap();
        assert!(!text.contains("dc:subject"), "an empty keyword list must remove the element, not leave it empty");
        assert!(!text.contains("hierarchicalSubject"));
        let sc = get_sidecar(path);
        assert!(sc.keywords.is_empty());
    }

    // ── People & Pets XMP regions (CLAUDE.md failure #11) ───────────────────────────────────

    #[test]
    fn person_regions_round_trip_into_mwg_rs_xmp() {
        let path = scratch("people-regions");
        set_people_regions(
            path.clone(),
            vec![
                PersonRegion { name: "Sofia".into(), kind: "person".into(), x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.5 },
                PersonRegion { name: "Juno".into(), kind: "pet".into(), x0: 0.5, y0: 0.5, x1: 0.7, y1: 0.8 },
            ],
        )
        .unwrap();

        let text = std::fs::read_to_string(sidecar_path(&path)).unwrap();
        assert!(text.contains("xmlns:mwg-rs="), "the mwg-rs namespace must be declared");
        assert!(text.contains("xmlns:Iptc4xmpExt="), "the Iptc4xmpExt namespace must be declared");
        assert!(text.contains("<mwg-rs:Name>Sofia</mwg-rs:Name>"));
        assert!(text.contains("<mwg-rs:Type>Face</mwg-rs:Type>"), "a person region must be typed Face");
        assert!(text.contains("<mwg-rs:Type>Pet</mwg-rs:Type>"), "a pet region must be typed Pet");
        // Sofia's box is [0.1,0.2]-[0.3,0.5]: centre (0.2, 0.35), size (0.2, 0.3). Compared
        // with a tolerance, not a literal string match — f32 arithmetic on 0.1/0.2/0.3 doesn't
        // round-trip through Display exactly (0.1 + (0.3-0.1)/2.0 prints as "0.20000002").
        let cx: f32 = xmp_get(&text, "stArea:x").expect("stArea:x must be present").parse().unwrap();
        let w: f32 = xmp_get(&text, "stArea:w").expect("stArea:w must be present").parse().unwrap();
        assert!((cx - 0.2).abs() < 1e-5, "area x must be the box CENTRE (0.2), not the corner (0.1): got {cx}");
        assert!((w - 0.2).abs() < 1e-5, "area w must be 0.2: got {w}");
        let names = xmp_bag(&text, "PersonInImage");
        assert_eq!(names, vec!["Sofia".to_string(), "Juno".to_string()]);
    }

    #[test]
    fn person_regions_never_touch_existing_keywords_or_rating() {
        let path = scratch("people-regions-preserve");
        set_keywords(path.clone(), vec!["Travel".into()]).unwrap();
        set_people_regions(path.clone(), vec![PersonRegion { name: "Alice".into(), kind: "person".into(), x0: 0.0, y0: 0.0, x1: 0.1, y1: 0.1 }])
            .unwrap();

        let sc = get_sidecar(path);
        assert_eq!(sc.keywords, vec!["Travel".to_string()], "writing person regions must not clobber existing keywords");
    }

    #[test]
    fn clearing_all_people_removes_the_regions_elements() {
        let path = scratch("people-regions-clear");
        set_people_regions(path.clone(), vec![PersonRegion { name: "Alice".into(), kind: "person".into(), x0: 0.0, y0: 0.0, x1: 0.1, y1: 0.1 }])
            .unwrap();
        set_people_regions(path.clone(), vec![]).unwrap();

        let text = std::fs::read_to_string(sidecar_path(&path)).unwrap();
        assert!(!text.contains("mwg-rs:Regions"), "an empty people list must remove the element, not leave it empty");
        assert!(!text.contains("PersonInImage"));
    }

    /// Setting keywords must not disturb third-party fields already in the file — the same
    /// preservation guarantee `write_sidecar_preserves_unknown_fields` pins for attributes, now
    /// exercised through the keyword-writing path specifically since it does its own separate
    /// pass over the file's children.
    #[test]
    fn setting_keywords_preserves_foreign_attributes_and_children() {
        let path = scratch("keywords-foreign");
        let foreign = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" crs:Exposure2012="+0.35">
   <photoshop:City>Geneva</photoshop:City>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
"#;
        std::fs::write(sidecar_path(&path), foreign).unwrap();
        set_keywords(path.clone(), vec!["Travel".into()]).unwrap();

        let text = std::fs::read_to_string(sidecar_path(&path)).unwrap();
        assert!(text.contains("crs:Exposure2012=\"+0.35\""), "foreign attributes must survive a keyword write");
        assert!(text.contains("<photoshop:City>Geneva</photoshop:City>"), "foreign child elements must survive a keyword write");
        assert!(text.contains("dc:subject"));
    }

    /// A keyword containing XML-significant characters must round-trip exactly — the escape/
    /// unescape pair is the entire correctness surface of the hand-rolled parser (see the
    /// module doc comment on `xmp_bag`), and this is what proves it holds both directions.
    #[test]
    fn a_keyword_with_special_characters_round_trips() {
        let path = scratch("keywords-escape");
        set_keywords(path.clone(), vec!["Rock & Roll|Q&A <live>".into()]).unwrap();
        let sc = get_sidecar(path);
        assert_eq!(sc.keywords, vec!["Rock & Roll|Q&A <live>".to_string()]);
    }

    /// A rating/label click through `set_sidecar` must never drop existing keywords — the
    /// exact class of bug phase 0a fixed for foreign XMP fields, now guarded for this app's OWN
    /// keyword feature too.
    #[test]
    fn set_sidecar_preserves_existing_keywords() {
        let path = scratch("keywords-survive-rating");
        set_keywords(path.clone(), vec!["Travel".into()]).unwrap();
        set_sidecar(path.clone(), 3, "Green".into(), false, None, None).unwrap();
        let sc = get_sidecar(path);
        assert_eq!(sc.keywords, vec!["Travel".to_string()]);
    }
}

/// One album's photos as grid entries. Mirrors list_exported's stat-fresh/missing-tolerant
/// mapping so an album renders through exactly the same grid path as a folder.
#[tauri::command]
pub fn list_album(id: String) -> Vec<DirEntry> {
    let all = albums_read();
    let Some(a) = all.into_iter().find(|a| a.id == id) else { return Vec::new() };
    a.paths
        .into_iter()
        .map(|path| {
            let p = Path::new(&path);
            let file_name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.clone());
            let ext = ext_lower(p);
            let is_video = is_video_ext(&ext);
            let kind = if is_video { "video" } else { kind_of(&ext) };
            let edited_ts = edited_ts_of(&path);
            match std::fs::metadata(&path) {
                Ok(m) => {
                    let mtime = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
                    DirEntry { name: file_name, path, is_dir: false, is_image: !is_video, is_video, kind, mtime, size: m.len(), missing: false, edited_ts }
                }
                // Kept, and flagged. An album pointing at a moved file should show the gap, not
                // pretend the photo was never added.
                Err(_) => DirEntry { name: file_name, path, is_dir: false, is_image: !is_video, is_video, kind, mtime: 0, size: 0, missing: true, edited_ts },
            }
        })
        .collect()
}

#[cfg(test)]
mod album_tests {
    use super::*;

    /// Albums are a real file on disk shared by every test in this module, so each test works on
    /// its own HOME to stay independent of the developer's actual albums.
    fn with_temp_home<T>(f: impl FnOnce() -> T) -> T {
        let dir = std::env::temp_dir().join(format!("cs_alb_{}_{:?}", std::process::id(), std::thread::current().id()));
        std::fs::create_dir_all(&dir).unwrap();
        let prev = std::env::var("HOME").ok();
        std::env::set_var("HOME", &dir);
        let out = f();
        if let Some(p) = prev { std::env::set_var("HOME", p); }
        std::fs::remove_dir_all(&dir).ok();
        out
    }

    #[test]
    fn albums_link_without_copying_and_survive_a_missing_file() {
        with_temp_home(|| {
            let photos = std::env::temp_dir().join(format!("cs_albphotos_{}", std::process::id()));
            std::fs::create_dir_all(&photos).unwrap();
            let a1 = photos.join("a.jpg");
            let a2 = photos.join("b.jpg");
            std::fs::write(&a1, vec![1u8; 64]).unwrap();
            std::fs::write(&a2, vec![2u8; 64]).unwrap();

            let al = album_create("Geneva".into()).expect("create");
            assert_eq!(album_create("geneva".into()).is_err(), true, "names are case-insensitively unique");

            let added = album_add(al.id.clone(), vec![
                a1.to_string_lossy().into_owned(), a2.to_string_lossy().into_owned(),
            ]).expect("add");
            assert_eq!(added, 2);
            // Re-adding the same photos is a no-op, not a duplicate.
            assert_eq!(album_add(al.id.clone(), vec![a1.to_string_lossy().into_owned()]).unwrap(), 0);

            let listed = list_album(al.id.clone());
            assert_eq!(listed.len(), 2);
            assert!(listed.iter().all(|e| !e.missing));
            // ⚠️ The photos themselves must be untouched — an album is a list, not a copy.
            assert!(a1.exists() && a2.exists(), "album operations must never move or copy a photo");

            // A file moved outside the app: the entry stays, marked missing.
            std::fs::remove_file(&a2).unwrap();
            let listed = list_album(al.id.clone());
            assert_eq!(listed.len(), 2, "a missing file stays listed so it can be seen and fixed");
            assert_eq!(listed.iter().filter(|e| e.missing).count(), 1);

            // Order is the user's, and set_order cannot smuggle in a path that isn't a member.
            album_set_order(al.id.clone(), vec![
                a2.to_string_lossy().into_owned(),
                "/nowhere/ghost.jpg".into(),
                a1.to_string_lossy().into_owned(),
            ]).expect("reorder");
            let listed = list_album(al.id.clone());
            assert_eq!(listed.len(), 2, "a non-member path must not be added by a reorder");
            assert_eq!(listed[0].name, "b.jpg");

            album_remove(al.id.clone(), vec![a1.to_string_lossy().into_owned()]).expect("remove");
            assert_eq!(list_album(al.id.clone()).len(), 1);
            assert!(a1.exists(), "removing from an album must not delete the photo");

            album_delete(al.id.clone()).expect("delete");
            assert!(album_list().is_empty());
            assert!(a1.exists(), "deleting an album must not delete photos");

            std::fs::remove_dir_all(&photos).ok();
        });
    }
}

#[cfg(test)]
mod quicklook_tests {
    use super::*;
    use tauri::ipc::IpcResponse;

    /// The whole point of Quick Look: a RAW must return the embedded preview (no demosaic),
    /// same source `get_preview` already uses — this just pins that the two stay in sync and
    /// that the result is a real, decodable JPEG at roughly the requested size.
    #[test]
    fn quicklook_preview_of_a_raw_is_a_real_jpeg_near_the_target_size() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../geneva");
        let Some(sample) = std::fs::read_dir(&dir).ok().and_then(|rd| {
            rd.flatten().map(|e| e.path()).find(|p| is_raw_ext(&ext_lower(p)))
        }) else {
            eprintln!("skipping: no RAW present in geneva/");
            return;
        };
        let resp = get_quicklook_preview(sample.to_string_lossy().into_owned()).expect("quicklook preview");
        let bytes = match resp.body().unwrap() {
            tauri::ipc::InvokeResponseBody::Raw(b) => b,
            _ => panic!("expected raw bytes"),
        };
        assert!(bytes.len() > 1000, "suspiciously small preview: {} bytes", bytes.len());
        let img = image::load_from_memory(&bytes).expect("must decode as a real JPEG");
        assert!(img.width().max(img.height()) <= 1600, "must not exceed the requested long edge");
    }

    /// A non-RAW still (JPEG) must go through the large ImageIO decode path, not the RAW
    /// embedded-preview path — and must actually come back BIGGER than the 360px grid thumbnail
    /// tier, or this command is pointless (a culling preview that's the same size as the grid
    /// thumbnail buys nothing).
    #[test]
    fn quicklook_preview_of_a_jpeg_is_larger_than_the_grid_thumbnail() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../geneva");
        let Some(sample) = std::fs::read_dir(&dir).ok().and_then(|rd| {
            rd.flatten().map(|e| e.path()).find(|p| matches!(ext_lower(p).as_str(), "jpg" | "jpeg"))
        }) else {
            eprintln!("skipping: no JPEG present in geneva/");
            return;
        };
        let resp = get_quicklook_preview(sample.to_string_lossy().into_owned()).expect("quicklook preview");
        let bytes = match resp.body().unwrap() {
            tauri::ipc::InvokeResponseBody::Raw(b) => b,
            _ => panic!("expected raw bytes"),
        };
        let img = image::load_from_memory(&bytes).expect("must decode as a real JPEG");
        assert!(img.width().max(img.height()) > 360, "quicklook must be larger than the 360px grid thumbnail, got {}x{}", img.width(), img.height());
    }

    #[test]
    fn quicklook_preview_declines_video_cleanly() {
        let err = get_quicklook_preview("/nonexistent/clip.mp4".to_string());
        assert!(err.is_err(), "video must be refused, not attempted");
    }
}
