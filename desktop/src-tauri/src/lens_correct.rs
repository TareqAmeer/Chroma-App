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
fn read_patched_rw2_exif(bytes: &[u8]) -> Option<exif::Exif> {
    if bytes.len() < 4 || bytes[0] != b'I' || bytes[1] != b'I' || bytes[2] != 0x55 || bytes[3] != 0x00 {
        return None; // not an RW2-shaped header — don't guess at other RAW formats' quirks
    }
    let mut patched = bytes.to_vec();
    patched[2] = 0x2A;
    exif::Reader::new().read_raw(patched).ok()
}

pub fn exif_lens_model_fallback(bytes: &[u8]) -> Option<String> {
    let exif = read_patched_rw2_exif(bytes)?;
    let v = exif.get_field(exif::Tag::LensModel, exif::In::PRIMARY)?.display_value().to_string();
    let cleaned = v.trim().trim_matches('"').trim().to_string();
    if cleaned.is_empty() { None } else { Some(cleaned) }
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
        let fast = crate::raw_decode::decode_rw2_bytes(&bytes, true, true, "", true, None)
            .expect("fast decode should succeed");
        assert!(!fast.lens_applied, "fast pass should defer lens correction to the refine pass");
        // …and the refine pass must.
        let refined = crate::raw_decode::decode_rw2_bytes(&bytes, true, true, "", false, None)
            .expect("refine decode should succeed");
        assert!(refined.lens_applied, "expected lens correction to apply on __TM6917.RW2 with auto_lens=true (refine pass)");
    }
}



