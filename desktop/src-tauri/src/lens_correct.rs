// Automatic lens-profile correction (distortion) via the `lensfun` crate's bundled community
// database, looked up by camera+lens EXIF. Runs server-side (Rust) on the linear 16-bit RGB
// buffer right after orientation is applied in raw_decode.rs, geometrically warping pixels —
// this sidesteps needing a new GLSL pass for a per-pixel remap (unlike the existing manual
// Distortion/Vignette/CA sliders, which are simple radial shader terms). The manual sliders
// remain the fallback/override when no profile match exists for this camera+lens pairing.
//
// ⚠️ `lensfun` 0.7.0 is pre-alpha — its own docs say the API may still shift. Pin the exact
// version in Cargo.toml and re-check this file's calls (Database::load_bundled/find_cameras/
// find_lenses, Modifier::new/enable_distortion_correction/apply_geometry_distortion) on upgrade.
use lensfun::{Database, Modifier};
use rayon::prelude::*;
use std::sync::OnceLock;

// Panasonic RW2 deliberately breaks the TIFF magic number (0x0055 at offset 2-3 instead of the
// standard 0x002A) — specifically so generic TIFF/EXIF readers refuse the file outright — even
// though the IFD structure underneath is standard EXIF (confirmed: exifread/Python parses it
// fine; kamadak-exif's format-sniff step is what rejects it). rawler's OWN structured metadata
// (raw_metadata().exif.lens_model / .lens) comes back empty for at least one real DC-S9 file
// that DOES carry a LensModel EXIF tag (verified: `exiftool`-equivalent read found "LUMIX S
// 18-40/F4.5-6.3" in the raw bytes rawler's own parse missed) — a rawler gap, not a missing
// tag. Patch the magic number in a scratch copy and hand it to kamadak-exif (already a
// dependency, used for JPEG/TIFF elsewhere) as a fallback when rawler comes back empty.
/// Patches the RW2 magic number IN PLACE and moves `buf` into kamadak-exif's reader — no copy.
/// Callers that already own a full-file `Vec<u8>` (the byte-slice API below, and raw_decode.rs's
/// already-loaded RAW) go through here directly; `exif_lens_model_fallback_path` builds its
/// (usually much smaller) buffer straight from a bounded read, so this is the ONLY place a copy
/// of the whole buffer used to happen (`bytes.to_vec()`), and now never does.
fn patch_and_read(mut buf: Vec<u8>) -> Option<exif::Exif> {
    if buf.len() < 4 || buf[0] != b'I' || buf[1] != b'I' || buf[2] != 0x55 || buf[3] != 0x00 {
        return None; // not an RW2-shaped header — don't guess at other RAW formats' quirks
    }
    buf[2] = 0x2A;
    exif::Reader::new().read_raw(buf).ok()
}

/// Byte-slice form — kept for the two callers that already hold the full file in memory and have
/// no path to re-read from: main.rs's peek_raw_camera (bytes arrive over Tauri IPC, no path at
/// all) and raw_decode.rs's auto-lens pass (already holds the decoded-from RAW buffer). Both
/// legitimately need this shape; only library.rs's read_meta (a cold metadata pass over
/// thousands of files) had a PATH and no reason to materialize a full-file buffer just to call
/// this — see exif_lens_model_fallback_path below for that one.
fn read_patched_rw2_exif(bytes: &[u8]) -> Option<exif::Exif> {
    if bytes.len() < 4 || bytes[0] != b'I' || bytes[1] != b'I' || bytes[2] != 0x55 || bytes[3] != 0x00 {
        return None; // cheap check before the copy below
    }
    patch_and_read(bytes.to_vec())
}

/// Shared by both the slice and path APIs so the garbled-lens fix stays in exactly one place.
/// A TIFF ASCII field decodes as Value::Ascii(Vec<Vec<u8>>) — kamadak-exif splits it into
/// multiple components on every embedded NUL. display_value().to_string() stringifies the
/// WHOLE Vec (quoted, comma-joined), so a garbage/uninitialized fixed-length field on this
/// camera (scattered NULs instead of one clean terminator) rendered as a repeating
/// `"", "", "", ...`-shaped string instead of failing the emptiness check. Take just the
/// first component's bytes directly and validate THAT.
fn lens_model_from_exif(exif: &exif::Exif) -> Option<String> {
    let field = exif.get_field(exif::Tag::LensModel, exif::In::PRIMARY)?;
    let raw = match field.value {
        exif::Value::Ascii(ref v) => v.first()?.as_slice(),
        _ => return None,
    };
    let cleaned = String::from_utf8_lossy(raw)
        .trim_matches(|c: char| c == '\0' || c.is_whitespace() || c == '"')
        .to_string();
    if cleaned.is_empty() || !cleaned.chars().any(|c| c.is_ascii_alphanumeric()) { None } else { Some(cleaned) }
}

pub fn exif_lens_model_fallback(bytes: &[u8]) -> Option<String> {
    lens_model_from_exif(&read_patched_rw2_exif(bytes)?)
}

/// Panasonic PhotoStyle (ROADMAP.md's F2) — reads makernote tag 0x0089 and returns its raw
/// value, so `main.rs::peek_raw_camera` can offer it to JS for auto-enabling the V-Log input
/// transform (value 17). Mapping verified against real files with ExifTool + Lightroom (see
/// CLAUDE.md's Format widening backlog): 1=Standard (covers "Custom" too), 3=Natural, 17=VLog,
/// 22=Leica Monochrome — all four confirmed present across this session's real RW2 sample.
///
/// ⚠️ The PhotoStyle tag is NOT reachable from RW2's own container structure at all — traced
/// this empirically (dumping raw IFD bytes and cross-checking against `exiftool -v3`), not
/// assumed. RW2's own IFD0 (magic-patched 0x0055→0x002A the way `read_patched_rw2_exif` does)
/// has an ExifIFD (tag 0x8769) with 30 ordinary tags and NO MakerNote among them. What DOES
/// carry PhotoStyle is a complete standalone EXIF+MakerNote block inside the JPEG PREVIEW that
/// RW2 embeds under its own tag 0x002e ("JpgFromRaw" in ExifTool's Panasonic.pm) — a real,
/// independent `ÿØÿá…` JPEG file with a normal (non-magic-broken) EXIF structure,
/// which is why kamadak-exif can parse it directly via `read_from_container` with no patching,
/// and — unlike the raw container's own ExifIFD — its MakerNote (tag 0x927c) really is present.
/// Inside that MakerNote: a 12-byte ASCII signature "Panasonic\0\0\0", then a standard
/// 2-byte-count + 12-byte-entry mini-IFD (little-endian, values ≤4 bytes inline — every real
/// file checked carries PhotoStyle as SHORT or LONG, count 1, no offset indirection).
pub fn panasonic_photo_style(bytes: &[u8]) -> Option<u32> {
    if bytes.len() < 8 || bytes[0] != b'I' || bytes[1] != b'I' {
        return None; // RW2 is always little-endian Intel byte order — don't guess at others
    }
    let u16_at = |o: usize| -> Option<u16> { bytes.get(o..o + 2).map(|b| u16::from_le_bytes([b[0], b[1]])) };
    let u32_at = |o: usize| -> Option<u32> { bytes.get(o..o + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]])) };
    let ifd0_off = u32_at(4)? as usize;
    let count = u16_at(ifd0_off)? as usize;
    if count == 0 || count > 512 {
        return None; // a real RW2 IFD0 has ~60 entries — bounded the same way ingest.rs's raw_exif_date_fast is
    }
    let entries_start = ifd0_off + 2;
    let entries = bytes.get(entries_start..entries_start + count * 12)?;
    const TAG_JPG_FROM_RAW: u16 = 0x002e;
    let (_, _, jpg_len, jpg_off_bytes) = entries
        .chunks_exact(12)
        .map(|c| (u16::from_le_bytes([c[0], c[1]]), u16::from_le_bytes([c[2], c[3]]), u32::from_le_bytes([c[4], c[5], c[6], c[7]]), [c[8], c[9], c[10], c[11]]))
        .find(|e| e.0 == TAG_JPG_FROM_RAW)?;
    let jpg_off = u32::from_le_bytes(jpg_off_bytes) as usize;
    let jpg = bytes.get(jpg_off..jpg_off + jpg_len as usize)?;
    if jpg.len() < 4 || jpg[0] != 0xff || jpg[1] != 0xd8 {
        return None; // not a JPEG SOI marker — this body's embedded-preview tag/shape differs
    }
    let embedded = exif::Reader::new().read_from_container(&mut std::io::Cursor::new(jpg)).ok()?;
    let field = embedded.get_field(exif::Tag::MakerNote, exif::In::PRIMARY)?;
    let mn = match field.value {
        exif::Value::Undefined(ref v, _) => v.as_slice(),
        _ => return None,
    };
    const SIG: &[u8; 12] = b"Panasonic\0\0\0";
    if mn.len() < 14 || &mn[0..12] != SIG {
        return None; // not Panasonic's makernote shape — don't guess at another vendor's layout
    }
    let ifd = &mn[12..];
    let mn_count = u16::from_le_bytes([ifd[0], ifd[1]]) as usize;
    if mn_count == 0 || mn_count > 512 || ifd.len() < 2 + mn_count * 12 {
        return None;
    }
    const TAG_PHOTO_STYLE: u16 = 0x0089;
    for entry in ifd[2..2 + mn_count * 12].chunks_exact(12) {
        let tag = u16::from_le_bytes([entry[0], entry[1]]);
        if tag != TAG_PHOTO_STYLE {
            continue;
        }
        let typ = u16::from_le_bytes([entry[2], entry[3]]);
        return match typ {
            3 => Some(u16::from_le_bytes([entry[8], entry[9]]) as u32),
            4 => Some(u32::from_le_bytes([entry[8], entry[9], entry[10], entry[11]])),
            _ => None,
        };
    }
    None
}

/// The 256KB reads only enough of the file to cover the TIFF/EXIF header + IFD0, where LensModel
/// lives — measured on real DC-S9 RW2 files, the tag sits at byte offset ~4,300, so this is a
/// ~60x margin. This exists because `exif_lens_model_fallback(&whole_file)` was measured costing
/// 32ms/file (a full std::fs::read of a 26.5MB RW2, PLUS the to_vec() copy patch_and_read now
/// avoids) — at 8,492 RAWs on a real ~30k-photo library, that's 203GB read and 273s (4.5 MINUTES)
/// just for this one fallback, which fires on nearly every RW2 since rawler's own structured EXIF
/// comes back empty for this camera (see the module doc comment above). A 256KB prefix measures
/// at 0.3ms/file — 2.6s total, ~105x faster — for the identical result on every file sampled.
const RW2_EXIF_PREFIX: usize = 256 * 1024;

pub fn exif_lens_model_fallback_path(path: &std::path::Path) -> Option<String> {
    use std::io::Read;
    let mut f = std::fs::File::open(path).ok()?;
    let file_len = f.metadata().ok()?.len() as usize;
    let want = RW2_EXIF_PREFIX.min(file_len);
    let mut prefix = vec![0u8; want];
    f.read_exact(&mut prefix).ok()?;
    // Cheap check BEFORE deciding whether to escalate — a non-RW2 RAW (ARW/CR2/DNG) fails here
    // for free, instead of the old code's `fs::read`-the-whole-file-then-reject-on-byte-3.
    if prefix.len() < 4 || prefix[0] != b'I' || prefix[1] != b'I' || prefix[2] != 0x55 || prefix[3] != 0x00 {
        return None;
    }
    // IFD0 offset is a little-endian u32 at bytes 4..8 of the (unpatched) TIFF header — if it
    // points past what we read, the prefix genuinely can't answer the question and we must
    // escalate. This is the ONLY correctness-motivated escalation: a successful parse that
    // simply has no LensModel tag must NOT escalate, or every lens-less RAW pays the full cost
    // right back.
    let ifd0_offset = u32::from_le_bytes(prefix[4..8].try_into().ok()?) as usize;
    let truncated = file_len > prefix.len();
    if truncated && ifd0_offset >= prefix.len() {
        return read_full_file_fallback(path);
    }
    match patch_and_read(prefix) {
        Some(exif) => lens_model_from_exif(&exif),
        // kamadak-exif rejected the truncated buffer outright (e.g. a sub-IFD pointer landed
        // past the prefix during parsing, which the offset check above can't see in advance) —
        // escalate only if there was more file left to read.
        None if truncated => read_full_file_fallback(path),
        None => None,
    }
}

/// The pre-fix behavior, kept only as the rare escalation path — never the common case once the
/// prefix read above is doing its job.
fn read_full_file_fallback(path: &std::path::Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    exif_lens_model_fallback(&bytes)
}

// Same root cause as exif_lens_model_fallback above (rawler's structured EXIF comes back empty
// for at least one real DC-S9 RW2 that DOES carry the tag): the lens NAME already had a
// fallback, but FocalLength didn't, so correct_distortion's `focal_len > 0.0` gate silently
// skipped correction even when profile_available() reported the camera+lens pairing as present
// in the DB — the exact "Auto shows available but nothing happens" symptom.
pub fn exif_focal_length_fallback(bytes: &[u8]) -> Option<f32> {
    let exif = read_patched_rw2_exif(bytes)?;
    let field = exif.get_field(exif::Tag::FocalLength, exif::In::PRIMARY)?;
    match &field.value {
        exif::Value::Rational(v) => v.first().map(|r| r.to_f32()).filter(|f| *f > 0.0),
        _ => None,
    }
}

static DB: OnceLock<Option<Database>> = OnceLock::new();

fn db() -> Option<&'static Database> {
    DB.get_or_init(|| {
        Database::load_bundled()
            .map_err(|e| eprintln!("lensfun: bundled DB failed to load: {e}"))
            .ok()
    })
    .as_ref()
}

#[derive(serde::Serialize)]
pub struct LensProfileEntry {
    pub maker: String,
    pub model: String,
    /// Prime lens (focal_min == focal_max): the UI can auto-fill the focal-length field instead
    /// of asking the user to type a number they may not know for an old manual lens.
    pub focal_min: f32,
    pub focal_max: f32,
}

/// Case-insensitive substring patterns for the 5 lenses actually owned (TTArtisan 14mm manual,
/// Panasonic LUMIX S 18-40 AF, a 7Artisans/SG-image 35mm AF, Sony RX100 V, Panasonic LUMIX
/// TZ60/ZS60 built-in). The bundled lensfun DB has hundreds of entries across every maker; the
/// manual-lens dropdown only needs to show these.
///
/// Verified against the ACTUAL bundled DB contents (see `examples/dump_lenses.rs` — run with
/// `cargo run --example dump_lenses` to reprint this list against a future lensfun DB update):
/// - Panasonic 18-40 matches exactly: "LUMIX S 18-40/F4.5-6.3". Good.
/// - TTArtisan has NO 14mm entry at all (closest: 23mm/25mm/27mm/35mm/40mm/50mm/7.5mm fisheye) —
///   the "ttartisan" pattern surfaces all 7 as the closest available substitute; there's no
///   distortion profile for the actual 14mm to select even with an exact-match filter.
/// - 7Artisans has no AF 35mm — only "35mm f/1.4 APS-C (manual)" and "35mm f/0.95"; no exact
///   "SG image" maker exists in this DB at all (the sgimage/sg-image patterns currently match
///   nothing and are kept only in case a future DB revision adds it).
/// - Sony RX100 has II/III/VI/"Standard" (covers I) but curiously NO "V" entry — the broad
///   "rx100" pattern surfaces all 4 as the closest available since an exact V match doesn't exist.
/// - Panasonic TZ60/ZS60 has ZERO entries — lensfun's DB is built for interchangeable lenses,
///   not fixed-lens compact cameras, so this camera's built-in zoom has no distortion profile in
///   this database at all; the dropdown will simply show nothing for it (no crash).
const OWNED_LENS_PATTERNS: &[&str] = &[
    "ttartisan",              // TTArtisan (no exact 14mm in DB — shows closest available, see above)
    "18-40",                  // Panasonic LUMIX S 18-40/F4.5-6.3 — exact match
    "7artisan",                // 7Artisans (no AF 35mm in DB — shows closest available, see above)
    "sgimage", "sg image", "sg-image", // not present in DB today; kept for a future DB update
    "rx100",                  // Sony RX100 (no exact "V" in DB — shows closest available, see above)
    "tz60", "zs60",           // Panasonic LUMIX TZ60/ZS60 — NOT in this DB (fixed-lens compact); dropdown will be empty for it
];

fn is_owned_lens(maker: &str, model: &str) -> bool {
    let hay = format!("{} {}", maker.to_lowercase(), model.to_lowercase());
    OWNED_LENS_PATTERNS.iter().any(|p| hay.contains(p))
}

/// The 5 owned lenses, for the manual lens-override picker (Lens Correction panel) — a fallback
/// for manual/adapted lenses (TTArtisan and similar mechanical-only optics) that write no lens
/// EXIF at all, so the auto-detect fallbacks in this file have nothing to recover. Filtered down
/// from the full bundled lensfun DB (hundreds of entries across every maker) via
/// `is_owned_lens`, since the dropdown previously listed everything. Sorted by maker then model
/// so it reads like a small catalog, not DB insertion order.
pub fn list_lens_profiles() -> Vec<LensProfileEntry> {
    let Some(db) = db() else { return Vec::new() };
    let mut out: Vec<LensProfileEntry> = db
        .lenses
        .iter()
        .filter(|l| is_owned_lens(&l.maker, &l.model))
        .map(|l| LensProfileEntry {
            maker: l.maker.clone(),
            model: l.model.clone(),
            focal_min: l.focal_min,
            focal_max: l.focal_max,
        })
        .collect();
    out.sort_by(|a, b| (&a.maker, &a.model).cmp(&(&b.maker, &b.model)));
    if out.is_empty() {
        eprintln!("lens_correct: owned-lens filter matched 0 of {} bundled entries — patterns in OWNED_LENS_PATTERNS likely don't match this DB's naming; check list_lens_profiles' unfiltered output", db.lenses.len());
    }
    out
}

/// Whether a lens profile exists for this camera+lens pairing — lets the UI show "Auto" as
/// available/unavailable without doing the (cheap but pointless) full correction pass.
///
/// Diagnostic eprintln!s below exist because auto-detect has been reported to fail for a real
/// camera+lens pairing (Panasonic LUMIX S 18-40) even though the EXIF fallback chain
/// (exif_lens_model_fallback/exif_focal_length_fallback above) successfully recovers the lens
/// name and focal length from the RW2 bytes. The lensfun crate does its own internal
/// fuzzy/normalized matching inside find_cameras/find_lenses, so the mismatch is most likely a
/// naming-convention difference between what EXIF reports and what the bundled DB stores (e.g.
/// camera model string, or lens string punctuation/spacing) — these logs surface the exact
/// strings on both sides so that can be confirmed against a real RW2 next test run, rather than
/// guessing at a "fix" to the matching logic itself.
pub fn profile_available(make: &str, model: &str, lens_model: &str) -> bool {
    let Some(db) = db() else {
        eprintln!("lens_correct: profile_available({make:?}, {model:?}, {lens_model:?}) — bundled DB failed to load");
        return false;
    };
    let cameras = db.find_cameras(Some(make), model);
    let Some(camera) = cameras.into_iter().next() else {
        eprintln!("lens_correct: profile_available — no camera match for make={make:?} model={model:?} (0 candidates from find_cameras)");
        return false;
    };
    eprintln!("lens_correct: profile_available — camera matched: db maker={:?} model={:?} (looked up make={make:?} model={model:?})", camera.maker, camera.model);
    let lenses = db.find_lenses(Some(camera), lens_model);
    let found = lenses.first();
    eprintln!(
        "lens_correct: profile_available — lens lookup for lens_model={lens_model:?}: {}",
        match found {
            Some(l) => format!("MATCHED db maker={:?} model={:?}", l.maker, l.model),
            None => "NO MATCH (0 candidates from find_lenses)".to_string(),
        }
    );
    found.is_some()
}

fn bilinear_sample(src: &[u16], w: usize, h: usize, x: f32, y: f32) -> [u16; 3] {
    if x < 0.0 || y < 0.0 || x >= (w - 1) as f32 || y >= (h - 1) as f32 {
        return [0, 0, 0]; // outside the source frame — matches upstream's black-fill behaviour
    }
    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let fx = x - x0 as f32;
    let fy = y - y0 as f32;
    let px = |xx: usize, yy: usize, c: usize| src[(yy * w + xx) * 3 + c] as f32;
    let mut out = [0u16; 3];
    for c in 0..3 {
        let v00 = px(x0, y0, c);
        let v10 = px(x0 + 1, y0, c);
        let v01 = px(x0, y0 + 1, c);
        let v11 = px(x0 + 1, y0 + 1, c);
        let v = v00 * (1.0 - fx) * (1.0 - fy)
            + v10 * fx * (1.0 - fy)
            + v01 * (1.0 - fx) * fy
            + v11 * fx * fy;
        out[c] = v.round().clamp(0.0, 65535.0) as u16;
    }
    out
}

/// Geometrically undistorts `rgb16` (interleaved, w*h*3) in place using the matched lens
/// profile. Returns false (buffer untouched) if no camera/lens/distortion-model match exists —
/// a graceful no-op, since the DC-S9 + LUMIX S18-40 pairing may not be in the community DB yet.
pub fn correct_distortion(
    rgb16: &mut Vec<u16>,
    w: usize,
    h: usize,
    make: &str,
    model: &str,
    lens_model: &str,
    focal_len: f32,
) -> bool {
    if focal_len <= 0.0 {
        return false;
    }
    let Some(db) = db() else { return false };
    let Some(camera) = db.find_cameras(Some(make), model).into_iter().next() else { return false };
    let Some(lens) = db.find_lenses(Some(camera), lens_model).into_iter().next() else { return false };
    // `reverse` MUST be false here: per lensfun's own docs, reverse=false corrects distortion
    // in an existing photo, while reverse=true does the opposite — simulates/ADDS the lens's
    // distortion to a clean image. This was passing `true`, so every photo got the real
    // in-camera distortion PLUS a second, simulated dose of the same distortion compounding on
    // top (reported: straight lamppost/horizon visibly bowed after "correction").
    let mut modifier = Modifier::new(lens, focal_len, camera.crop_factor, w as u32, h as u32, false);
    if !modifier.enable_distortion_correction(lens) {
        return false; // lens has no distortion calibration in the DB — leave pixels as-is
    }

    // Auto-scale ("Constrain Crop"): correcting real barrel/pincushion distortion without any
    // compensating zoom necessarily exposes invalid (out-of-frame) content at the corners/edges
    // — the corrected coordinate for a frame-edge pixel samples OUTSIDE the original photo,
    // which `bilinear_sample` fills with black (reported: "black layer behind the photo").
    // Lightroom/ACR hide this by silently zooming in just enough to crop it away; Chromasmith
    // didn't, so the SAME correction that looks clean in Lightroom showed black wedges here.
    // Find the minimal centered zoom `scale` (>=1) such that every border sample's corrected
    // coordinate stays within the original frame. This probes the GEOMETRY directly (not pixel
    // content), so it's exact regardless of how dark the photo is — a content-based black-pixel
    // scan would misfire on a genuinely dark scene (this exact case: a night beach photo).
    let cx = (w as f32 - 1.0) / 2.0;
    let cy = (h as f32 - 1.0) / 2.0;
    let in_bounds = |mx: f32, my: f32| mx >= 0.0 && mx <= w as f32 - 1.0 && my >= 0.0 && my <= h as f32 - 1.0;
    let fits_at = |s: f32| -> bool {
        const N: usize = 32;
        let mut coords = [0f32; 2];
        for k in 0..N {
            let t = k as f32 / (N - 1) as f32;
            for &(ox, oy) in &[
                (t * (w as f32 - 1.0), 0.0),
                (t * (w as f32 - 1.0), h as f32 - 1.0),
                (0.0, t * (h as f32 - 1.0)),
                (w as f32 - 1.0, t * (h as f32 - 1.0)),
            ] {
                let qx = cx + (ox - cx) / s;
                let qy = cy + (oy - cy) / s;
                modifier.apply_geometry_distortion(qx, qy, 1, 1, &mut coords);
                if !in_bounds(coords[0], coords[1]) {
                    return false;
                }
            }
        }
        true
    };
    let mut scale = 1.0f32;
    // Cap at 2.0 — if the calibration data were ever bad enough to need more than a 2x crop,
    // that's a sign something upstream is wrong; better to leave a (rare) black sliver than
    // silently throw away half the frame.
    while scale < 2.0 && !fits_at(scale) {
        scale += 0.002;
    }

    let src = rgb16.clone();
    rgb16
        .par_chunks_mut(w * 3)
        .enumerate()
        .for_each(|(row, out_row)| {
            let mut coords = [0.0f32; 2];
            for col in 0..w {
                let qx = cx + (col as f32 - cx) / scale;
                let qy = cy + (row as f32 - cy) / scale;
                modifier.apply_geometry_distortion(qx, qy, 1, 1, &mut coords);
                let sample = bilinear_sample(&src, w, h, coords[0], coords[1]);
                out_row[col * 3] = sample[0];
                out_row[col * 3 + 1] = sample[1];
                out_row[col * 3 + 2] = sample[2];
            }
        });
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_db_loads() {
        assert!(db().is_some(), "lensfun bundled DB must load");
    }

    #[test]
    fn dc_s9_lookup_does_not_error() {
        // Whether or not the DC-S9 + LUMIX S 18-40 pairing is IN the community DB, the lookup
        // itself must not panic and must return a plain bool. Print the verdict so a plain
        // `cargo test -- --nocapture` doubles as the diagnostic the UI status line reports.
        let avail = profile_available("Panasonic", "DC-S9", "LUMIX S 18-40/F4.5-6.3");
        println!("DC-S9 + LUMIX S 18-40 profile available: {avail}");
        let cams = db().map(|d| d.find_cameras(Some("Panasonic"), "DC-S9").len()).unwrap_or(0);
        println!("Panasonic DC-S9 camera entries in DB: {cams}");
    }

    // The DC-S9 + LUMIX S 18-40 pairing has a real calibrated profile in the bundled lensfun DB
    // (mil-panasonic.xml) — this pins that down as a permanent regression guard, since
    // exif_focal_length_fallback below is only worth having if the DB match actually exists.
    #[test]
    fn dc_s9_profile_is_in_bundled_db() {
        assert!(
            profile_available("Panasonic", "DC-S9", "LUMIX S 18-40/F4.5-6.3"),
            "DC-S9 + LUMIX S 18-40/F4.5-6.3 must resolve in the bundled lensfun DB"
        );
    }

    // Root-cause regression guard for issue #8 ("lens auto-correction shows Available but never
    // applies"): rawler's structured EXIF comes back empty for focal_length on real DC-S9 RW2s,
    // same gap as the lens-name fallback above. Gated on the repo's own test RW2 existing so
    // this doesn't break CI/checkouts that don't carry the sample photos.
    #[test]
    fn focal_length_fallback_reads_real_rw2() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../__TM8519.RW2");
        let Ok(bytes) = std::fs::read(&path) else {
            eprintln!("skipping: {} not present in this checkout", path.display());
            return;
        };
        let lens = exif_lens_model_fallback(&bytes);
        println!("fallback lens_model: {lens:?}");
        assert_eq!(lens.as_deref(), Some("LUMIX S 18-40/F4.5-6.3"));
        let focal = exif_focal_length_fallback(&bytes);
        println!("fallback focal_length: {focal:?}");
        assert!(focal.is_some_and(|f| f > 0.0), "focal length fallback must recover a positive value, got {focal:?}");
    }

    /// The path API must return the SAME lens as the slice API on the same real RW2 — proves the
    /// bounded-prefix read reaches an identical answer to reading the whole file, not a
    /// coincidentally-similar one.
    #[test]
    fn path_fallback_matches_slice_fallback_on_a_real_rw2() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../__TM8519.RW2");
        if !path.exists() {
            eprintln!("skipping: {} not present in this checkout", path.display());
            return;
        }
        let via_slice = exif_lens_model_fallback(&std::fs::read(&path).unwrap());
        let via_path = exif_lens_model_fallback_path(&path);
        assert_eq!(via_path, via_slice, "path and slice APIs must agree");
        assert_eq!(via_path.as_deref(), Some("LUMIX S 18-40/F4.5-6.3"));
    }

    /// A 4KB truncated copy of a real RW2 must STILL yield the lens — the LensModel tag sits at
    /// byte ~4,300 on this camera, well inside a 4KB slice, and this proves the bounded-prefix
    /// path is what answers it (not a silent escalation to a full re-read, which a truncated
    /// on-disk copy can't do anyway — there's nothing more to read).
    #[test]
    fn path_fallback_works_from_a_truncated_copy() {
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../__TM8519.RW2");
        let Ok(full) = std::fs::read(&src) else {
            eprintln!("skipping: {} not present in this checkout", src.display());
            return;
        };
        assert!(full.len() > 4096, "fixture must be larger than the truncation point to be a real test");
        let truncated = &full[..4096];
        let tmp = std::env::temp_dir().join(format!("cs_lens_truncated_{}.RW2", std::process::id()));
        std::fs::write(&tmp, truncated).unwrap();
        let lens = exif_lens_model_fallback_path(&tmp);
        std::fs::remove_file(&tmp).ok();
        assert_eq!(lens.as_deref(), Some("LUMIX S 18-40/F4.5-6.3"), "a 4KB truncated RW2 must still yield the lens via the bounded prefix path");
    }

    /// A file that isn't RW2-shaped at all (wrong magic) must return None without ever escalating
    /// to a full read — this is the "stop reading a 26MB ARW/CR2/DNG just to reject it" win.
    #[test]
    fn path_fallback_declines_a_non_rw2_without_a_full_read() {
        let tmp = std::env::temp_dir().join(format!("cs_lens_notrw2_{}.bin", std::process::id()));
        std::fs::write(&tmp, b"not an rw2 header at all, just plain bytes").unwrap();
        assert!(exif_lens_model_fallback_path(&tmp).is_none());
        std::fs::remove_file(&tmp).ok();
    }

    #[test]
    fn path_fallback_declines_a_missing_file_instead_of_panicking() {
        assert!(exif_lens_model_fallback_path(std::path::Path::new("/nonexistent/nope.RW2")).is_none());
    }

    /// Real-drive verification, if the user's actual library is present on this machine (skips
    /// cleanly otherwise) — the committed __TM8519.RW2 fixture is not in every checkout, but this
    /// is what actually matters: does the path API produce the right answer, and does it agree
    /// with the slice API, on real files from the library this fix was measured against.
    #[test]
    fn path_fallback_matches_slice_fallback_on_real_library_files_if_present() {
        let dir = std::path::PathBuf::from("/Volumes/Crucial/PHOTOS");
        if !dir.exists() {
            eprintln!("skipping: /Volumes/Crucial/PHOTOS not mounted on this machine");
            return;
        }
        let mut checked = 0;
        for entry in walkdir_rw2(&dir).into_iter().take(20) {
            let via_slice = exif_lens_model_fallback(&std::fs::read(&entry).unwrap());
            let via_path = exif_lens_model_fallback_path(&entry);
            assert_eq!(via_path, via_slice, "mismatch on {}", entry.display());
            checked += 1;
        }
        println!("checked {checked} real RW2 files, path API agreed with slice API on every one");
        assert!(checked > 0, "found no .RW2 files under {}", dir.display());
    }

    fn walkdir_rw2(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
        let mut out = Vec::new();
        let mut stack = vec![dir.to_path_buf()];
        while let Some(d) = stack.pop() {
            let Ok(rd) = std::fs::read_dir(&d) else { continue };
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    stack.push(p);
                } else if p.extension().map(|x| x.eq_ignore_ascii_case("rw2")).unwrap_or(false) {
                    out.push(p);
                    if out.len() >= 20 {
                        return out;
                    }
                }
            }
        }
        out
    }

    // End-to-end regression guard for issue #8: calls the EXACT function main.rs's decode_raw_v2
    // command calls, with the same auto_lens=true argument, on a real DC-S9 RW2 that has a real
    // lensfun profile — proves the whole pipeline (metadata read -> fallback -> DB lookup ->
    // distortion correction) actually applies, not just the individual pieces in isolation.
    // fast=false: lens correction is deliberately DEFERRED to the full-quality refine pass
    // (see raw_decode.rs's "auto_lens && !fast" gate) — the fast first-paint decode skips the
    // full-frame resample because refine() replaces that buffer ~1s later anyway.
    #[test]
    fn tm6917_full_decode_applies_lens_correction() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../__TM6917.RW2");
        let Ok(bytes) = std::fs::read(&path) else {
            eprintln!("skipping: {} not present in this checkout", path.display());
            return;
        };
        // The fast pass must NOT apply it (that's the deferral working, not a detection failure)…
        let fast = crate::raw_decode::decode_rw2_bytes(&bytes, true, crate::raw_decode::NrTier::Fast, "", true, None)
            .expect("fast decode should succeed");
        assert!(!fast.lens_applied, "fast pass should defer lens correction to the refine pass");
        // …and the refine pass must.
        let refined = crate::raw_decode::decode_rw2_bytes(&bytes, true, crate::raw_decode::NrTier::Fast, "", false, None)
            .expect("refine decode should succeed");
        assert!(refined.lens_applied, "expected lens correction to apply on __TM6917.RW2 with auto_lens=true (refine pass)");
    }

    /// Real-world coverage across all four documented PhotoStyle values (ROADMAP.md's F2),
    /// each independently confirmed against the same files with `exiftool -PhotoStyle` before
    /// writing this assertion: 1=Standard, 3=Natural, 17=V-Log, 22=Leica Monochrome (ExifTool's
    /// own table doesn't name 22, reporting "Unknown (22)" — CLAUDE.md's mapping was verified
    /// independently against Lightroom). Paths are outside the checkout (real captures aren't
    /// committed) — skips silently if a machine doesn't have that particular file, same pattern
    /// as `focal_length_fallback_reads_real_rw2` above.
    #[test]
    fn photo_style_reads_real_files() {
        let cases: &[(&str, u32)] = &[
            ("/Users/tareqameer/Downloads/P_TM5168.RW2", 17),  // V-Log
            ("/Users/tareqameer/Downloads/__TM3238.RW2", 3),   // Natural
            ("/Users/tareqameer/Downloads/__TM2153.RW2", 1),   // Standard or Custom
            ("/Users/tareqameer/Downloads/P_TM2125.RW2", 22),  // Leica Monochrome
        ];
        let mut checked = 0;
        for (path, expected) in cases {
            let Ok(bytes) = std::fs::read(path) else {
                eprintln!("skipping: {path} not present on this machine");
                continue;
            };
            let style = panasonic_photo_style(&bytes);
            assert_eq!(style, Some(*expected), "{path}: expected PhotoStyle {expected}, got {style:?}");
            checked += 1;
        }
        if checked == 0 {
            eprintln!("photo_style_reads_real_files: no fixtures present on this machine, nothing verified");
        }
    }

    /// A non-Panasonic RW2-shaped input (or garbage) must return None, not panic — every offset
    /// this function reads is bounds-checked via `bytes.get(...)`, never a raw index.
    #[test]
    fn photo_style_declines_garbage_without_panicking() {
        assert_eq!(panasonic_photo_style(&[]), None);
        assert_eq!(panasonic_photo_style(b"not a tiff file at all"), None);
        assert_eq!(panasonic_photo_style(&[0u8; 64]), None);
    }
}
