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

/// Coarse file-type bucket for the library's type filter.
fn kind_of(ext: &str) -> &'static str {
    if is_raw_ext(ext) {
        "raw"
    } else {
        match ext {
            "jpg" | "jpeg" => "jpeg",
            "png" => "png",
            "tif" | "tiff" => "tiff",
            _ => "",
        }
    }
}

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_image: bool,
    pub kind: &'static str, // "raw" | "jpeg" | "png" | "tiff"; "" for dirs
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
            let kind = if is_dir { "" } else { kind_of(&ext) };
            out.push(DirEntry { name, path: p.to_string_lossy().into_owned(), is_dir, is_image, kind });
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
    let mut out = Cursor::new(Vec::new());
    img.to_rgb8()
        .write_to(&mut out, image::ImageFormat::Jpeg)
        .map_err(|e| format!("jpeg encode: {e}"))?;
    Ok(tauri::ipc::Response::new(out.into_inner()))
}

// ── Photo metadata (camera / lens / date / iso) for the library's filter dropdowns.
// RAWs go through rawler's raw_metadata (no pixel decode); JPEG/TIFF through kamadak-exif;
// PNG has no EXIF → nulls. Disk-cached exactly like thumbnails (path+mtime+size key). ──────
#[derive(Serialize, serde::Deserialize, Default, Clone)]
pub struct PhotoMeta {
    pub camera: Option<String>,
    pub lens: Option<String>,
    pub date: Option<String>,
    pub iso: Option<u32>,
    pub shutter: Option<String>,
    pub aperture: Option<String>,
    pub focal_len: Option<String>,
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
    // .meta2.json: bumped from .meta.json when shutter/aperture/focal_len were added, so
    // pre-existing cache entries (missing the new fields) don't get served stale.
    cache_dir().join(cache_key(path, mtime, size).replace(".jpg", ".meta2.json"))
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
            lens: md.exif.lens_model.clone().or_else(|| md.lens.as_ref().map(|l| l.lens_model.clone())),
            date: md.exif.date_time_original.clone(),
            iso: md.exif.iso_speed_ratings.map(|v| v as u32),
            shutter: md.exif.exposure_time.as_ref().map(|r| fmt_shutter(ratio(r))),
            aperture: md.exif.fnumber.as_ref().map(|r| format!("f/{:.1}", ratio(r))),
            focal_len: md.exif.focal_length.as_ref().map(|r| format!("{:.0}mm", ratio(r))),
        }
    } else if matches!(ext.as_str(), "jpg" | "jpeg" | "tif" | "tiff") {
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
        let camera = match (make, model) {
            (Some(mk), Some(md)) => Some(format!("{mk} {md}")),
            (mk, md) => mk.or(md),
        };
        let iso = exif
            .get_field(exif::Tag::PhotographicSensitivity, exif::In::PRIMARY)
            .and_then(|f| f.value.get_uint(0));
        PhotoMeta {
            camera,
            lens: s(exif::Tag::LensModel),
            date: s(exif::Tag::DateTimeOriginal),
            iso,
            shutter: s(exif::Tag::ExposureTime),
            aperture: s(exif::Tag::FNumber).map(|v| format!("f/{v}")),
            focal_len: s(exif::Tag::FocalLength),
        }
    } else {
        PhotoMeta::default()
    }
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
    pub recipe: String, // base64 FX-snapshot JSON, "" if none
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
    Sidecar {
        rating: xmp_get(&text, "xmp:Rating").and_then(|v| v.parse().ok()).unwrap_or(0),
        label: xmp_get(&text, "xmp:Label").unwrap_or_default(),
        edited: xmp_get(&text, "chromasmith:Edited").as_deref() == Some("True"),
        recipe: xmp_get(&text, "chromasmith:Recipe").unwrap_or_default(),
    }
}

/// Writes the whole sidecar in one shot. `recipe: None` keeps the existing recipe (so a
/// rating/label click never clobbers stored edits); `Some("")` explicitly clears it.
#[tauri::command]
pub fn set_sidecar(
    path: String,
    rating: i32,
    label: String,
    edited: bool,
    recipe: Option<String>,
) -> Result<(), String> {
    let existing = get_sidecar(path.clone());
    let recipe = recipe.unwrap_or(existing.recipe);
    let rating = rating.clamp(-1, 5);
    let label = match label.as_str() {
        "Red" | "Green" | "Star" => label,
        _ => String::new(),
    };
    let mut attrs = format!("xmp:Rating=\"{rating}\"");
    if !label.is_empty() {
        attrs.push_str(&format!(" xmp:Label=\"{label}\""));
    }
    if edited {
        attrs.push_str(" chromasmith:Edited=\"True\"");
    }
    if !recipe.is_empty() {
        // base64 payload — XML-attribute-safe by construction
        attrs.push_str(&format!(" chromasmith:Recipe=\"{recipe}\""));
    }
    let xmp = format!(
        r#"<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Chromasmith">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:chromasmith="http://chromasmith.app/ns/1.0/" {attrs}/>
 </rdf:RDF>
</x:xmpmeta>
"#
    );
    std::fs::write(sidecar_path(&path), xmp).map_err(|e| format!("write sidecar: {e}"))
}
