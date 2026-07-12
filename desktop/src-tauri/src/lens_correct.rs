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
pub fn exif_lens_model_fallback(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 4 || bytes[0] != b'I' || bytes[1] != b'I' || bytes[2] != 0x55 || bytes[3] != 0x00 {
        return None; // not an RW2-shaped header — don't guess at other RAW formats' quirks
    }
    let mut patched = bytes.to_vec();
    patched[2] = 0x2A;
    let exif = exif::Reader::new().read_raw(patched).ok()?;
    let v = exif.get_field(exif::Tag::LensModel, exif::In::PRIMARY)?.display_value().to_string();
    let cleaned = v.trim().trim_matches('"').trim().to_string();
    if cleaned.is_empty() { None } else { Some(cleaned) }
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

/// Whether a lens profile exists for this camera+lens pairing — lets the UI show "Auto" as
/// available/unavailable without doing the (cheap but pointless) full correction pass.
pub fn profile_available(make: &str, model: &str, lens_model: &str) -> bool {
    let Some(db) = db() else { return false };
    let Some(camera) = db.find_cameras(Some(make), model).into_iter().next() else { return false };
    db.find_lenses(Some(camera), lens_model).into_iter().next().is_some()
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
}
