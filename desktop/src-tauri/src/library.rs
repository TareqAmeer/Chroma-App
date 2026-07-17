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
fn apply_orientation_dynamic(img: image::DynamicImage, orientation: u16) -> image::DynamicImage {
    match orientation {
        3 => img.rotate180(),
        6 => img.rotate90(),
        8 => img.rotate270(),
        _ => img,
    }
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
    /// Filesystem mtime (unix secs) and byte size — cheap (same stat() the thumbnail/meta cache
    /// keys already pay for), used by the library grid's "Date modified" / size sort+display so
    /// it doesn't need a separate get_meta round-trip per entry just to sort a folder.
    pub mtime: u64,
    pub size: u64,
    /// Set only by list_edited() below, for an entry whose file no longer exists on disk.
    #[serde(default)]
    pub missing: bool,
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
            let (mtime, size) = entry.metadata().ok().map(|m| {
                let mt = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
                (mt, m.len())
            }).unwrap_or((0, 0));
            out.push(DirEntry { name, path: p.to_string_lossy().into_owned(), is_dir, is_image, kind, mtime, size, missing: false });
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
    // "v2": bumped when orientation-correction was added to get_thumbnail, so pre-existing
    // sideways-cached portrait thumbnails aren't served stale.
    "v2".hash(&mut h);
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
        let img = rawler::analyze::extract_thumbnail_pixels(&path, &RawDecodeParams::default())
            .map_err(|e| format!("thumbnail decode: {e}"))?;
        apply_orientation_dynamic(img, raw_orientation(&path))
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

fn decode_cache_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    let dir = PathBuf::from(home).join("Library/Caches/com.tareq.chromasmith/decode");
    let _ = std::fs::create_dir_all(&dir);
    dir
}
fn decode_cache_key(path: &str, mtime: u64, size: u64, recipe_key: &str) -> String {
    let mut h = DefaultHasher::new();
    path.hash(&mut h);
    mtime.hash(&mut h);
    size.hash(&mut h);
    recipe_key.hash(&mut h); // RAW profile / native-NR / demosaic-algo / auto-lens — anything that changes decoded pixels
    "v1".hash(&mut h);
    format!("{:016x}.jpg", h.finish())
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
    // .meta4.json: bumped from .meta3.json when the kamadak-exif RW2-lens fallback was added,
    // so a photo already cached with an empty lens (from before the fallback existed) gets
    // re-read instead of serving the stale empty value forever.
    cache_dir().join(cache_key(path, mtime, size).replace(".jpg", ".meta4.json"))
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
                .or_else(|| std::fs::read(path).ok().and_then(|b| crate::lens_correct::exif_lens_model_fallback(&b))),
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
    std::fs::write(sidecar_path(&path), xmp).map_err(|e| format!("write sidecar: {e}"))?;
    registry_set(&path, edited);
    Ok(())
}

// ── Cross-folder "All Edited" registry ────────────────────────────────────────────────────
// A flat JSON list of every photo path that currently has edited:true, kept in the app cache
// dir (NOT next to the photos — this is app-internal bookkeeping, not a portable sidecar).
// Lets the library show every edited photo regardless of which folder it lives in, without
// re-scanning the whole disk: updated incrementally every time set_sidecar changes the
// edited flag (add on true, remove on false), and backfilled once at startup by scanning
// recently-used folders for existing .xmp sidecars (see backfill_edited_registry below).
fn registry_path() -> PathBuf {
    cache_dir().join("edited_registry.json")
}
fn registry_read() -> Vec<String> {
    std::fs::read_to_string(registry_path())
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}
fn registry_write(list: &[String]) {
    if let Ok(text) = serde_json::to_string(list) {
        let _ = std::fs::write(registry_path(), text);
    }
}
fn registry_set(path: &str, edited: bool) {
    let mut list = registry_read();
    let present = list.iter().any(|p| p == path);
    if edited && !present {
        list.push(path.to_string());
        registry_write(&list);
    } else if !edited && present {
        list.retain(|p| p != path);
        registry_write(&list);
    }
}

/// Every photo ever marked edited, across all folders — stat'd fresh so renamed/deleted files
/// are flagged `missing` instead of silently vanishing or erroring the whole list. Sorted
/// newest-mtime-first; the frontend re-sorts/filters same as a normal folder view.
#[tauri::command]
pub fn list_edited() -> Vec<DirEntry> {
    let mut out: Vec<DirEntry> = registry_read()
        .into_iter()
        .map(|path| {
            let p = Path::new(&path);
            let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.clone());
            let ext = ext_lower(p);
            let kind = kind_of(&ext);
            match std::fs::metadata(&path) {
                Ok(m) => {
                    let mtime = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
                    DirEntry { name, path, is_dir: false, is_image: true, kind, mtime, size: m.len(), missing: false }
                }
                Err(_) => DirEntry { name, path, is_dir: false, is_image: true, kind, mtime: 0, size: 0, missing: true },
            }
        })
        .collect();
    out.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    out
}

/// One-time backfill for photos edited before the registry existed: scan a set of known
/// folders (recents + the given root) for `.xmp` sidecars with `chromasmith:Edited="True"`
/// and register any not already tracked. Cheap (text scan, no image decode); called once by
/// the frontend on first Library open per session, not on every folder browse.
#[tauri::command]
pub fn backfill_edited_registry(folders: Vec<String>) -> usize {
    let mut list = registry_read();
    let mut added = 0usize;
    for folder in folders {
        let Ok(rd) = std::fs::read_dir(&folder) else { continue };
        for entry in rd.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) != Some("xmp") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&p) else { continue };
            if xmp_get(&text, "chromasmith:Edited").as_deref() != Some("True") {
                continue;
            }
            let photo = p.with_extension(""); // best-effort; sidecar_path() is <photo>.xmp exactly
            // Try every image extension the sidecar could belong to (with_extension("") strips
            // the .xmp but the photo's real extension is unknown from the sidecar name alone).
            for ext in IMAGE_EXTS {
                let candidate = photo.with_extension(ext);
                if candidate.exists() {
                    let s = candidate.to_string_lossy().into_owned();
                    if !list.iter().any(|p2| p2 == &s) {
                        list.push(s);
                        added += 1;
                    }
                    break;
                }
            }
        }
    }
    if added > 0 {
        registry_write(&list);
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
#[tauri::command]
pub fn trash_file(path: String) -> Result<(), String> {
    let src = Path::new(&path);
    let trash_dir = dirs_trash().ok_or("could not resolve ~/.Trash")?;
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

fn move_or_copy(src: &Path, dest: &Path) -> Result<(), String> {
    if std::fs::rename(src, dest).is_ok() {
        return Ok(());
    }
    std::fs::copy(src, dest).map_err(|e| format!("copy {}: {e}", src.display()))?;
    std::fs::remove_file(src).map_err(|e| format!("remove {}: {e}", src.display()))
}

fn dirs_trash() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".Trash"))
}
