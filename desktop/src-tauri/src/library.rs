// Local photo library browser: folder tree + thumbnail grid + star ratings, alongside (not
// replacing) the app's existing Google Photos integration — this is purely for finding/culling
// RAWs on disk before editing. Native-only (arbitrary filesystem folder browsing isn't a thing
// in a sandboxed browser), so this lives entirely in the desktop shell, not chromasmith-22.html.
use rawler::decoders::RawDecodeParams;
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const IMAGE_EXTS: &[&str] = &[
    "rw2", "raw", "dng", "cr2", "cr3", "nef", "arw", "orf", "jpg", "jpeg", "png", "tif", "tiff",
];
const RAW_EXTS: &[&str] = &["rw2", "raw", "dng", "cr2", "cr3", "nef", "arw", "orf"];

fn ext_lower(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase()
}
fn is_image_ext(ext: &str) -> bool {
    IMAGE_EXTS.contains(&ext)
}
fn is_raw_ext(ext: &str) -> bool {
    RAW_EXTS.contains(&ext)
}

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_image: bool,
}

/// One level of a folder (not recursive — the frontend expands the tree lazily, same UX as
/// Finder/Lightroom's folder panel, and avoids walking a user's entire disk up front).
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    let rd = std::fs::read_dir(&path).map_err(|e| format!("read_dir {path}: {e}"))?;
    for entry in rd.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue; // hide dotfiles/dotfolders, matches Finder's default
        }
        let is_dir = p.is_dir();
        let ext = ext_lower(&p);
        let is_image = !is_dir && is_image_ext(&ext);
        if is_dir || is_image {
            out.push(DirEntry { name, path: p.to_string_lossy().into_owned(), is_dir, is_image });
        }
    }
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

fn cache_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    let dir = PathBuf::from(home).join("Library/Caches/com.tareq.chromasmith/thumbnails");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn cache_key(path: &str, mtime: u64, size: u64) -> String {
    let mut h = DefaultHasher::new();
    path.hash(&mut h);
    mtime.hash(&mut h);
    size.hash(&mut h);
    format!("{:016x}.jpg", h.finish())
}

/// Cached thumbnail (long edge ~360px, JPEG). RAW files use rawler's embedded-preview
/// extraction (falls back thumbnail -> preview -> full decode internally) — this reads the
/// camera's own embedded JPEG in the common case, NOT a full demosaic, so opening a folder of
/// hundreds of RAWs stays fast. Cache key includes mtime+size so edits/replacements invalidate.
#[tauri::command]
pub fn get_thumbnail(path: String) -> Result<tauri::ipc::Response, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("stat {path}: {e}"))?;
    let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let key = cache_key(&path, mtime, meta.len());
    let cache_path = cache_dir().join(&key);
    if let Ok(bytes) = std::fs::read(&cache_path) {
        return Ok(tauri::ipc::Response::new(bytes));
    }

    let ext = ext_lower(Path::new(&path));
    let img = if is_raw_ext(&ext) {
        rawler::analyze::extract_thumbnail_pixels(&path, &RawDecodeParams::default())
            .map_err(|e| format!("thumbnail decode: {e}"))?
    } else {
        image::open(&path).map_err(|e| format!("image open: {e}"))?
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
    Ok(tauri::ipc::Response::new(bytes))
}

// ── Star ratings via XMP sidecar (standard xmp:Rating, 0-5; -1 = rejected, matches the
// convention Lightroom/Bridge/etc use) — a plain "<name>.xmp" next to the photo, so it's
// portable and interchange-compatible with real photo tools, not a private database. ──────
fn sidecar_path(photo_path: &str) -> PathBuf {
    let p = Path::new(photo_path);
    p.with_extension("xmp")
}

#[tauri::command]
pub fn get_rating(path: String) -> i32 {
    let sc = sidecar_path(&path);
    let Ok(text) = std::fs::read_to_string(&sc) else { return 0 };
    parse_rating(&text)
}

fn parse_rating(xmp: &str) -> i32 {
    // Handles both attribute form (xmp:Rating="3") and element form (<xmp:Rating>3</xmp:Rating>).
    if let Some(i) = xmp.find("xmp:Rating=\"") {
        let rest = &xmp[i + 12..];
        if let Some(end) = rest.find('"') {
            if let Ok(v) = rest[..end].parse::<i32>() {
                return v;
            }
        }
    }
    if let Some(i) = xmp.find("<xmp:Rating>") {
        let rest = &xmp[i + 12..];
        if let Some(end) = rest.find('<') {
            if let Ok(v) = rest[..end].trim().parse::<i32>() {
                return v;
            }
        }
    }
    0
}

#[tauri::command]
pub fn set_rating(path: String, rating: i32) -> Result<(), String> {
    let sc = sidecar_path(&path);
    let rating = rating.clamp(-1, 5);
    let xmp = format!(
        r#"<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Chromasmith">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="{rating}"/>
 </rdf:RDF>
</x:xmpmeta>
"#
    );
    std::fs::write(&sc, xmp).map_err(|e| format!("write sidecar: {e}"))
}
