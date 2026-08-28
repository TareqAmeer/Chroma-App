// ═══ MIRROR OF chromasmith-22.html's FMT_* registry — see that file's "FORMAT REGISTRY" block
// near RAW_FILE_EXT_RE. Keep the two lists in sync: test/lint_formats.mjs (npm test) and this
// file's own matches_html_registry() both fail loudly if they drift. Do NOT add a third/Nth
// copy of an extension list anywhere else in the repo — everything (library.rs, ingest.rs,
// catalog.rs, main.rs) must go through the functions below instead.
//
// This module is deliberately dependency-free (no rawler, no image crate) so that anything
// which only needs "is this a RAW extension" — e.g. catalog.rs's fast media_kind classifier —
// can use it without pulling in the RAW-decode-heavy dependency surface library.rs carries.

pub const RAW_EXTS: &[&str] = &[
    "3fr", "ari", "arw", "bay", "crw", "cr2", "cr3", "dcr", "dcs", "dng", "erf", "fff", "iiq",
    "k25", "kdc", "mef", "mos", "mrw", "nef", "nrw", "orf", "pef", "pro", "ptx", "raf", "raw",
    "rw2", "rwl", "sr2", "srf", "srw", "x3f",
];

// Decodable by a plain <img> in at least one shipping surface (web, WKWebView, or both).
// NEVER route these through the Rust still-decode path — the export goldens depend on
// jpg/png/webp keeping the browser-native <img> path byte-exact.
pub const STILL_NATIVE_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "heic", "heif",
];

pub const HEIC_EXTS: &[&str] = &["heic", "heif"];

// TIFF is its own path (UTIF in the browser, `image`'s tiff feature natively) on every
// platform — kept separate so it is never folded into STILL_NATIVE_EXTS or STILL_RUST_EXTS.
pub const STILL_TIFF_EXTS: &[&str] = &["tif", "tiff"];

// Desktop-only: no browser decodes these. Handled by the `image` crate + jxl-oxide
// (still_decode.rs).
pub const STILL_RUST_EXTS: &[&str] = &[
    "exr", "hdr", "tga", "dds", "qoi", "ff", "pnm", "pbm", "pgm", "ppm", "pam", "jxl",
];

// Same three extensions chromasmith-22.html's VID_EXT_RE accepts for video grading — kept in
// sync deliberately so a clip the Library lists is always one the editor can actually open.
pub const VIDEO_EXTS: &[&str] = &["mp4", "mov", "m4v"];

/// Flat union of every still-image extension, for call sites that just need to iterate "every
/// extension a photo could have" (e.g. resolving a sidecar's photo by trying each candidate
/// extension). Prefer is_image_ext()/media_kind() for a yes/no or bucket question — this is for
/// the small number of places that genuinely need to enumerate.
pub fn all_image_exts() -> impl Iterator<Item = &'static &'static str> {
    RAW_EXTS
        .iter()
        .chain(STILL_NATIVE_EXTS)
        .chain(STILL_TIFF_EXTS)
        .chain(STILL_RUST_EXTS)
}

pub fn is_raw_ext(ext: &str) -> bool {
    RAW_EXTS.contains(&ext)
}
pub fn is_still_native_ext(ext: &str) -> bool {
    STILL_NATIVE_EXTS.contains(&ext)
}
pub fn is_heic_ext(ext: &str) -> bool {
    HEIC_EXTS.contains(&ext)
}
pub fn is_tiff_ext(ext: &str) -> bool {
    STILL_TIFF_EXTS.contains(&ext)
}
pub fn is_rust_still_ext(ext: &str) -> bool {
    STILL_RUST_EXTS.contains(&ext)
}
pub fn is_video_ext(ext: &str) -> bool {
    VIDEO_EXTS.contains(&ext)
}
/// Everything the Library will list as an image (not video), across all four still buckets.
pub fn is_image_ext(ext: &str) -> bool {
    is_raw_ext(ext) || is_still_native_ext(ext) || is_tiff_ext(ext) || is_rust_still_ext(ext)
}

/// Coarse file-type bucket for the Library's type filter. The ONE media_kind/kind_of
/// implementation — library.rs, ingest.rs and catalog.rs all call this instead of keeping
/// their own copy. Never returns "" for a recognised image ext (that value is unreachable by
/// the type-filter dropdown) — unrecognised-but-still-decodable formats land in "other".
pub fn media_kind(ext: &str) -> &'static str {
    if is_raw_ext(ext) {
        return "raw";
    }
    match ext {
        "jpg" | "jpeg" => "jpeg",
        "png" => "png",
        "tif" | "tiff" => "tiff",
        "heic" | "heif" => "heic",
        "webp" => "webp",
        "exr" | "hdr" => "hdr",
        _ if is_still_native_ext(ext) || is_rust_still_ext(ext) => "other",
        _ => "",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    /// Parse a single-line JS array literal like:
    ///   const FMT_RAW = ['a','b','c'];
    /// out of the HTML source. Panics with the raw match text on failure so a format-registry
    /// edit that breaks parsing fails loudly instead of silently passing an empty set.
    fn parse_js_array(html: &str, const_name: &str) -> BTreeSet<String> {
        let needle = format!("const {const_name} = [");
        let start = html
            .find(&needle)
            .unwrap_or_else(|| panic!("formats.rs: could not find `{needle}` in chromasmith-22.html — did the registry move or get renamed?"));
        let after = &html[start + needle.len()..];
        let end = after.find(']').expect("unterminated array literal");
        let body = &after[..end];
        body.split(',')
            .filter_map(|s| {
                let s = s.trim().trim_matches('\'').trim_matches('"');
                if s.is_empty() {
                    None
                } else {
                    Some(s.to_lowercase())
                }
            })
            .collect()
    }

    fn rust_set(exts: &[&str]) -> BTreeSet<String> {
        exts.iter().map(|s| s.to_lowercase()).collect()
    }

    /// The load-bearing test: if chromasmith-22.html's FMT_* registry and this file's
    /// RAW_EXTS/STILL_*_EXTS ever diverge, this fails with the exact symmetric difference
    /// instead of the two builds silently disagreeing about what a file is.
    #[test]
    fn matches_html_registry() {
        let html_path =
            concat!(env!("CARGO_MANIFEST_DIR"), "/../../chromasmith-22.html");
        let html = std::fs::read_to_string(html_path)
            .unwrap_or_else(|e| panic!("formats.rs test: could not read {html_path}: {e}"));

        let cases: &[(&str, &[&str])] = &[
            ("FMT_RAW", RAW_EXTS),
            ("FMT_STILL_NATIVE", STILL_NATIVE_EXTS),
            ("FMT_STILL_TIFF", STILL_TIFF_EXTS),
            ("FMT_STILL_RUST", STILL_RUST_EXTS),
        ];
        for (name, rust_list) in cases {
            let html_set = parse_js_array(&html, name);
            let rust_set = rust_set(rust_list);
            let missing_from_rust: Vec<_> = html_set.difference(&rust_set).collect();
            let missing_from_html: Vec<_> = rust_set.difference(&html_set).collect();
            assert!(
                missing_from_rust.is_empty() && missing_from_html.is_empty(),
                "{name} drift between chromasmith-22.html and formats.rs:\n  in HTML, not Rust: {missing_from_rust:?}\n  in Rust, not HTML: {missing_from_html:?}"
            );
        }
    }

    /// rawler::supported_extensions() is advertising, not a contract (X3F is listed there but
    /// still fails the CFA-is-RGB check in raw_decode.rs), so this is a lower bound only: if a
    /// rawler upgrade adds a format we don't know about, surface it instead of staying silent.
    #[test]
    fn covers_rawler_supported() {
        // Formats rawler lists but which are NOT expected to work through this app's RAW path
        // (Foveon/CIFF/etc — tracked deliberately, not just ignored).
        const KNOWN_UNLISTED: &[&str] = &["crm", "ori", "qtk"];
        let ours = rust_set(RAW_EXTS);
        for raw_ext in rawler::decoders::supported_extensions() {
            let e = raw_ext.to_lowercase();
            if KNOWN_UNLISTED.contains(&e.as_str()) {
                continue;
            }
            assert!(
                ours.contains(&e),
                "rawler now supports .{e} but formats::RAW_EXTS doesn't list it — add it (or to KNOWN_UNLISTED if it's a deliberate exception)"
            );
        }
    }

    #[test]
    fn media_kind_never_empty_for_known_image() {
        for ext in all_image_exts() {
            assert_ne!(
                media_kind(ext),
                "",
                ".{ext} is a recognised image extension but media_kind() returned \"\" — it would be unreachable by the Library's type filter"
            );
        }
    }
}
