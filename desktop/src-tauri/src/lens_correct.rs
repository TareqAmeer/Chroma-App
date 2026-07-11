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
    let mut modifier = Modifier::new(lens, focal_len, camera.crop_factor, w as u32, h as u32, true);
    if !modifier.enable_distortion_correction(lens) {
        return false; // lens has no distortion calibration in the DB — leave pixels as-is
    }
    let src = rgb16.clone();
    rgb16
        .par_chunks_mut(w * 3)
        .enumerate()
        .for_each(|(row, out_row)| {
            let mut coords = vec![0.0f32; w * 2];
            modifier.apply_geometry_distortion(0.0, row as f32, w, 1, &mut coords);
            for col in 0..w {
                let sample = bilinear_sample(&src, w, h, coords[col * 2], coords[col * 2 + 1]);
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
