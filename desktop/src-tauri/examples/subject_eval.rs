//! Measures how well subject.rs's PerSAM prototypes actually recognise ONE named dog — the honest
//! version of "remember this dog", run against real captures.
//!
//!   cargo run --release --example subject_eval
//!
//! Why an example and not a #[test]: this is calibration-style measurement (a table you read and
//! judge), the same split the repo already uses for dump_rw2.rs and the Python calib/ scripts. The
//! standing regression assertions live in subject.rs's own test module and are far cheaper.
//!
//! Two datasets, both gitignored user captures — this skips whatever isn't in the checkout:
//!
//!   geneva/   7 frames from ONE trip. Five contain another dog, two of them a similarly-brown
//!             smooth-coated one. Same coat, same week, same camera: a best case for appearance
//!             consistency, and the set the first round of numbers came from.
//!   lucifer/  25 frames spanning years, six cameras (iPhone HEIC, Sony, Lumix), snow / blossom /
//!             indoors / beach / city, and — the reason it matters most — BOTH coat states, from
//!             fully shaggy (L07, L01) to freshly groomed (L18, L20, L24). For a curly doodle a
//!             haircut is the single largest appearance change there is, so this is what says
//!             whether a taught subject survives one.
//!
//! ⚠️ Orientation is applied here, from EXIF. Half the phone photos in lucifer/ are stored
//! rotated, and neither the `image` crate nor `sips -s format` bakes the tag in — feeding those
//! straight to the encoder measures the model's ability to recognise an upside-down dog, which is
//! not the question. (The app itself is unaffected: it encodes from its own preview canvas, which
//! geomCanvas has already oriented.)

#[path = "../src/sam.rs"]
mod sam;
#[path = "../src/subject.rs"]
mod subject;

use std::path::{Path, PathBuf};

/// How shaggy the dog is in a frame — the axis a grooming cut moves along.
#[derive(PartialEq, Clone, Copy, Debug)]
enum Coat {
    Shaggy,
    Medium,
    Groomed,
}

/// A photo, the box the subject occupies in it, and the most confusable other thing.
/// Boxes are (x0, y0, x1, y1) as fractions of frame, read off the images by hand.
struct Frame {
    dir: &'static str,
    name: &'static str,
    subject: (f32, f32, f32, f32),
    distractor: Option<(&'static str, (f32, f32, f32, f32))>,
    coat: Coat,
}

use Coat::*;

const FRAMES: &[Frame] = &[
    // ── geneva/: one trip, one coat state ────────────────────────────────────────────────────
    Frame { dir: "geneva", name: "__TM4056", subject: (0.51, 0.30, 0.64, 0.72), distractor: Some(("black dog", (0.18, 0.20, 0.30, 0.36))), coat: Medium },
    Frame { dir: "geneva", name: "__TM4202", subject: (0.06, 0.32, 0.37, 0.70), distractor: None, coat: Medium },
    Frame { dir: "geneva", name: "__TM4304", subject: (0.41, 0.54, 0.59, 0.83), distractor: Some(("grey dog", (0.31, 0.38, 0.40, 0.50))), coat: Medium },
    Frame { dir: "geneva", name: "__TM4666", subject: (0.41, 0.30, 0.51, 0.70), distractor: Some(("grey dog", (0.04, 0.02, 0.27, 0.33))), coat: Medium },
    Frame { dir: "geneva", name: "__TM4933", subject: (0.16, 0.40, 0.58, 0.88), distractor: Some(("brown dog", (0.65, 0.32, 1.00, 1.00))), coat: Medium },
    Frame { dir: "geneva", name: "__TM5132", subject: (0.31, 0.39, 0.52, 0.61), distractor: Some(("brown dog", (0.56, 0.40, 0.78, 0.64))), coat: Medium },
    Frame { dir: "geneva", name: "__TM5199", subject: (0.57, 0.58, 0.80, 0.98), distractor: Some(("person", (0.16, 0.12, 0.44, 0.58))), coat: Medium },
    // ── lucifer/: years, cameras, seasons, and both coat states ──────────────────────────────
    Frame { dir: "lucifer", name: "L01", subject: (0.05, 0.15, 0.60, 0.92), distractor: None, coat: Shaggy },
    Frame { dir: "lucifer", name: "L02", subject: (0.20, 0.33, 0.36, 0.72), distractor: Some(("golden retriever", (0.38, 0.32, 0.62, 1.00))), coat: Medium },
    Frame { dir: "lucifer", name: "L03", subject: (0.25, 0.30, 0.80, 0.95), distractor: None, coat: Medium },
    Frame { dir: "lucifer", name: "L04", subject: (0.38, 0.28, 0.65, 0.98), distractor: Some(("black dog", (0.03, 0.35, 0.32, 0.95))), coat: Shaggy },
    Frame { dir: "lucifer", name: "L05", subject: (0.30, 0.15, 0.95, 0.95), distractor: None, coat: Shaggy },
    Frame { dir: "lucifer", name: "L06", subject: (0.40, 0.62, 0.72, 1.00), distractor: Some(("black dog", (0.70, 0.68, 1.00, 1.00))), coat: Medium },
    Frame { dir: "lucifer", name: "L07", subject: (0.20, 0.15, 0.85, 0.85), distractor: None, coat: Shaggy },
    Frame { dir: "lucifer", name: "L08", subject: (0.05, 0.42, 0.62, 1.00), distractor: Some(("black dog", (0.65, 0.45, 0.85, 0.68))), coat: Medium },
    Frame { dir: "lucifer", name: "L09", subject: (0.35, 0.30, 0.95, 0.95), distractor: None, coat: Medium },
    Frame { dir: "lucifer", name: "L10", subject: (0.30, 0.10, 1.00, 0.95), distractor: None, coat: Medium },
    Frame { dir: "lucifer", name: "L11", subject: (0.25, 0.25, 0.70, 0.90), distractor: None, coat: Medium },
    Frame { dir: "lucifer", name: "L12", subject: (0.42, 0.40, 0.62, 0.80), distractor: None, coat: Medium },
    Frame { dir: "lucifer", name: "L13", subject: (0.30, 0.45, 0.70, 0.95), distractor: None, coat: Groomed },
    Frame { dir: "lucifer", name: "L14", subject: (0.25, 0.15, 0.85, 0.95), distractor: None, coat: Groomed },
    Frame { dir: "lucifer", name: "L15", subject: (0.15, 0.20, 0.85, 0.95), distractor: None, coat: Medium },
    Frame { dir: "lucifer", name: "L16", subject: (0.20, 0.25, 0.90, 0.95), distractor: None, coat: Medium },
    Frame { dir: "lucifer", name: "L17", subject: (0.15, 0.30, 0.90, 0.95), distractor: None, coat: Shaggy },
    Frame { dir: "lucifer", name: "L18", subject: (0.30, 0.40, 0.75, 0.90), distractor: None, coat: Groomed },
    Frame { dir: "lucifer", name: "L19", subject: (0.45, 0.35, 0.80, 0.95), distractor: Some(("person", (0.10, 0.10, 0.45, 0.95))), coat: Medium },
    Frame { dir: "lucifer", name: "L20", subject: (0.20, 0.25, 0.85, 0.85), distractor: None, coat: Groomed },
    Frame { dir: "lucifer", name: "L21", subject: (0.08, 0.18, 0.35, 0.52), distractor: Some(("golden retriever", (0.45, 0.28, 0.72, 0.58))), coat: Shaggy },
    Frame { dir: "lucifer", name: "L22", subject: (0.30, 0.40, 0.62, 0.85), distractor: None, coat: Medium },
    Frame { dir: "lucifer", name: "L23", subject: (0.42, 0.45, 0.72, 0.85), distractor: None, coat: Groomed },
    Frame { dir: "lucifer", name: "L24", subject: (0.28, 0.15, 0.70, 1.00), distractor: Some(("black dog", (0.70, 0.48, 0.88, 0.78))), coat: Groomed },
    Frame { dir: "lucifer", name: "L25", subject: (0.50, 0.30, 0.95, 0.95), distractor: Some(("person", (0.10, 0.15, 0.55, 0.95))), coat: Medium },
];

fn inside(b: (f32, f32, f32, f32), x: f32, y: f32) -> bool {
    x >= b.0 && x <= b.2 && y >= b.1 && y <= b.3
}

/// A solid box mask over the subject, at the encode resolution. A real user scribble gives SAM a
/// tighter mask than this; a box is the PESSIMISTIC stand-in, since it folds a ring of background
/// into the prototype. If it works from a box it works from a scribble.
fn box_mask(w: u32, h: u32, b: (f32, f32, f32, f32)) -> Vec<u8> {
    let mut m = vec![0u8; (w * h) as usize];
    let (x0, y0) = ((b.0 * w as f32) as u32, (b.1 * h as f32) as u32);
    let (x1, y1) = ((b.2 * w as f32) as u32, (b.3 * h as f32) as u32);
    for y in y0..y1.min(h) {
        for x in x0..x1.min(w) {
            m[(y * w + x) as usize] = 255;
        }
    }
    m
}

/// EXIF orientation (1/3/6/8), the same four values library.rs's raw_orientation handles.
fn exif_orientation(path: &Path) -> u16 {
    (|| -> Option<u16> {
        let file = std::fs::File::open(path).ok()?;
        let mut br = std::io::BufReader::new(file);
        let ex = exif::Reader::new().read_from_container(&mut br).ok()?;
        ex.get_field(exif::Tag::Orientation, exif::In::PRIMARY)?.value.get_uint(0).map(|v| v as u16)
    })()
    .unwrap_or(1)
}

/// Finds the frame's file, converting HEIC via sips into a cache dir if needed. HEIC is what an
/// iPhone actually writes and the `image` crate cannot read it; sips is already on every Mac this
/// app targets, so this beats vendoring a HEIF decoder for a dev harness.
fn resolve(root: &Path, frame: &Frame) -> Option<PathBuf> {
    let dir = root.join(frame.dir);
    for ext in ["jpg", "JPG", "jpeg", "png"] {
        let p = dir.join(format!("{}.{ext}", frame.name));
        if p.is_file() {
            return Some(p);
        }
    }
    // lucifer/ files were renamed L01.. by hand from mixed-camera originals; look for a cached
    // conversion, then try to make one from any HEIC of that name.
    let cache = root.join("target/subject_eval_cache");
    let cached = cache.join(format!("{}.jpg", frame.name));
    if cached.is_file() {
        return Some(cached);
    }
    for ext in ["HEIC", "heic"] {
        let src = dir.join(format!("{}.{ext}", frame.name));
        if src.is_file() {
            std::fs::create_dir_all(&cache).ok()?;
            let ok = std::process::Command::new("sips")
                .args(["-s", "format", "jpeg"])
                .arg(&src)
                .arg("--out")
                .arg(&cached)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            if ok {
                return Some(cached);
            }
        }
    }
    None
}

struct Loaded {
    name: &'static str,
    dir: &'static str,
    embed: sam::Embedding,
    embed2: Option<sam::Sam2Embedding>,
    w: u32,
    h: u32,
    frame: &'static Frame,
}
impl Loaded {
    fn grid(&self, sam2: bool) -> subject::FeatureGrid<'_> {
        match (sam2, &self.embed2) {
            (true, Some(e)) => subject::FeatureGrid::sam2(e),
            _ => subject::FeatureGrid::edgesam(&self.embed),
        }
    }
}

/// Builds a prototype from a set of reference frames, folded in the order the UI would.
fn build_proto(refs: &[&Loaded], sam2: bool) -> Vec<f32> {
    let (mut proto, mut c) = (Vec::new(), 0u32);
    for r in refs {
        let m = box_mask(r.w, r.h, r.frame.subject);
        if let Ok(p) = subject::learn(r.grid(sam2), &m) {
            proto = if proto.is_empty() { p } else { subject::merge_prototypes(&proto, c, &p) };
            c += 1;
        }
    }
    proto
}

/// (hit, landed-on-another-dog) for one prototype against one frame.
fn score_one(tgt: &Loaded, proto: &[f32], sam2: bool) -> (bool, bool) {
    let Ok(f) = subject::locate(tgt.grid(sam2), proto) else { return (false, false) };
    let hit = inside(tgt.frame.subject, f.x, f.y);
    let wrong_dog = !hit
        && tgt.frame.distractor.map(|(l, b)| l.contains("dog") && inside(b, f.x, f.y)).unwrap_or(false);
    (hit, wrong_dog)
}

/// Wilson 95% confidence interval — the honest way to report a percentage from 28 trials, and the
/// whole reason for wanting a bigger photo set in the first place.
fn wilson(hits: usize, n: usize) -> (f32, f32) {
    if n == 0 {
        return (0.0, 0.0);
    }
    let (p, n) = (hits as f32 / n as f32, n as f32);
    let z = 1.96f32;
    let d = 1.0 + z * z / n;
    let c = p + z * z / (2.0 * n);
    let s = z * ((p * (1.0 - p) / n) + z * z / (4.0 * n * n)).sqrt();
    (((c - s) / d).max(0.0) * 100.0, ((c + s) / d).min(1.0) * 100.0)
}

fn main() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest.join("../..");
    sam::set_dylib_path(manifest.join("vendor/onnxruntime/libonnxruntime.dylib"));
    sam::set_sam2_model_paths(
        manifest.join("vendor/sam2/encoder.onnx"),
        manifest.join("vendor/sam2/decoder.onnx"),
    );

    let mut loaded: Vec<Loaded> = Vec::new();
    for frame in FRAMES {
        let Some(path) = resolve(&root, frame) else { continue };
        let Ok(img) = image::open(&path) else { continue };
        // ⚠️ Orientation before encoding — see the module comment.
        let img = match exif_orientation(&path) {
            3 => img.rotate180(),
            6 => img.rotate90(),
            8 => img.rotate270(),
            _ => img,
        }
        .to_rgb8();
        let (iw, ih) = img.dimensions();
        let (w, h) = ((iw / 4).max(64), (ih / 4).max(64));
        let small = sam::resize_rgb8(img.as_raw(), iw, ih, w, h);
        let Ok(embed) = sam::encode(&small, w, h) else { continue };
        let embed2 = sam::sam2_encode(&small, w, h).ok();
        loaded.push(Loaded { name: frame.name, dir: frame.dir, embed, embed2, w, h, frame });
    }
    let sets: Vec<&str> = ["geneva", "lucifer"]
        .into_iter()
        .filter(|d| loaded.iter().any(|l| l.dir == *d))
        .collect();
    println!("loaded {} frames from {:?}\n", loaded.len(), sets);
    if loaded.len() < 4 {
        eprintln!("not enough frames present to measure anything");
        return;
    }
    let have_sam2 = loaded.iter().all(|l| l.embed2.is_some());

    // ── 1. Recall vs number of references, per dataset ───────────────────────────────────────
    // The headline question, and the one the first (7-frame) round could not answer with any
    // precision: 86% of 28 trials has a 95% interval of roughly 69-95%.
    println!("── 1. recall vs reference count ─────────────────────────────────────────────────");
    println!("{:<10} {:<9} {:>5} {:>8} {:>16} {:>10}", "set", "encoder", "refs", "recall", "95% CI", "wrong-dog");
    println!("{}", "-".repeat(80));
    for set in &sets {
        let frames: Vec<&Loaded> = loaded.iter().filter(|l| l.dir == *set).collect();
        if frames.len() < 4 {
            continue;
        }
        for (label, sam2) in [("edgesam", false), ("sam2", true)] {
            if sam2 && !have_sam2 {
                continue;
            }
            for nrefs in [1usize, 2, 3, 4, 6] {
                if nrefs + 1 >= frames.len() {
                    continue;
                }
                let (mut hits, mut n, mut dog) = (0usize, 0usize, 0usize);
                // Rotate the reference window over the whole set, so no single lucky choice of
                // reference photos can flatter the result.
                for start in 0..frames.len() {
                    let refs: Vec<&Loaded> = (0..nrefs).map(|k| frames[(start + k) % frames.len()]).collect();
                    let proto = build_proto(&refs, sam2);
                    if proto.is_empty() {
                        continue;
                    }
                    for tgt in &frames {
                        if refs.iter().any(|r| r.name == tgt.name) {
                            continue;
                        }
                        let (hit, wrong) = score_one(tgt, &proto, sam2);
                        n += 1;
                        if hit { hits += 1; }
                        if wrong { dog += 1; }
                    }
                }
                let (lo, hi) = wilson(hits, n);
                println!("{:<10} {:<9} {:>5} {:>7.0}% {:>15} {:>10}", set, label, nrefs,
                    100.0 * hits as f32 / n.max(1) as f32, format!("{lo:.0}-{hi:.0}%  n={n}"), dog);
            }
        }
    }

    // ── 2. Does a taught subject survive a HAIRCUT? ──────────────────────────────────────────
    // For a curly doodle this is the largest appearance change there is, and it is the one thing
    // the single-trip geneva/ set structurally could not answer. If the prototype does not
    // transfer, the UI has to say so ("re-teach after a groom") rather than let a user discover
    // it as a feature that mysteriously stopped working.
    println!("\n── 2. across a haircut ──────────────────────────────────────────────────────────");
    let lucifer: Vec<&Loaded> = loaded.iter().filter(|l| l.dir == "lucifer").collect();
    if lucifer.len() < 6 {
        println!("lucifer/ not present — skipping.");
    } else {
        println!("{:<28} {:>8} {:>8}", "learn on -> test on", "recall", "n");
        for (from, to, label) in [
            (Shaggy, Groomed, "shaggy -> groomed"),
            (Groomed, Shaggy, "groomed -> shaggy"),
            (Shaggy, Shaggy, "shaggy -> shaggy (control)"),
            (Groomed, Groomed, "groomed -> groomed (control)"),
        ] {
            let refs: Vec<&Loaded> = lucifer.iter().filter(|l| l.frame.coat == from).copied().collect();
            let tgts: Vec<&Loaded> = lucifer.iter().filter(|l| l.frame.coat == to).copied().collect();
            if refs.len() < 2 || tgts.is_empty() {
                continue;
            }
            // Two references from the source coat state, rotated over all of them.
            let (mut hits, mut n) = (0usize, 0usize);
            for start in 0..refs.len() {
                let picked: Vec<&Loaded> = (0..2).map(|k| refs[(start + k) % refs.len()]).collect();
                let proto = build_proto(&picked, have_sam2);
                if proto.is_empty() { continue; }
                for tgt in &tgts {
                    if picked.iter().any(|r| r.name == tgt.name) { continue; }
                    let (hit, _) = score_one(tgt, &proto, have_sam2);
                    n += 1;
                    if hit { hits += 1; }
                }
            }
            println!("{:<28} {:>7.0}% {:>8}", label, 100.0 * hits as f32 / n.max(1) as f32, n);
        }
    }

    // ── 3. Does a prototype taught on one trip generalise to years of other photos? ──────────
    // The realistic failure: a user teaches the dog from whatever is open today, then expects it
    // to work on their whole library.
    println!("\n── 3. cross-dataset transfer ────────────────────────────────────────────────────");
    if sets.len() == 2 {
        for (from, to) in [("geneva", "lucifer"), ("lucifer", "geneva")] {
            let refs: Vec<&Loaded> = loaded.iter().filter(|l| l.dir == from).take(3).collect();
            let tgts: Vec<&Loaded> = loaded.iter().filter(|l| l.dir == to).collect();
            let proto = build_proto(&refs, have_sam2);
            if proto.is_empty() { continue; }
            let (mut hits, mut dog) = (0usize, 0usize);
            for tgt in &tgts {
                let (hit, wrong) = score_one(tgt, &proto, have_sam2);
                if hit { hits += 1; }
                if wrong { dog += 1; }
            }
            let (lo, hi) = wilson(hits, tgts.len());
            println!("3 refs from {from:<8} -> {to:<8} {:>3}/{:<3} = {:>3.0}%  (95% CI {lo:.0}-{hi:.0}%)  wrong-dog {dog}",
                hits, tgts.len(), 100.0 * hits as f32 / tgts.len() as f32);
        }
    } else {
        println!("need both datasets present — skipping.");
    }

    // ── 4. Per-frame detail at the shipping configuration ────────────────────────────────────
    println!("\n── 4. per-frame, 3 references, sam2 ─────────────────────────────────────────────");
    let refs: Vec<&Loaded> = loaded.iter().filter(|l| l.dir == "lucifer").take(3).collect();
    if refs.len() == 3 {
        let proto = build_proto(&refs, have_sam2);
        println!("references: {}", refs.iter().map(|r| r.name).collect::<Vec<_>>().join(", "));
        for tgt in &loaded {
            if refs.iter().any(|r| r.name == tgt.name) { continue; }
            let Ok(f) = subject::locate(tgt.grid(have_sam2), &proto) else { continue };
            let hit = inside(tgt.frame.subject, f.x, f.y);
            let what = if hit { "ok".into() } else {
                tgt.frame.distractor.filter(|(_, b)| inside(*b, f.x, f.y))
                    .map(|(l, _)| l.to_uppercase()).unwrap_or_else(|| "background".into())
            };
            println!("  {:<10} {:<8} ({:.2},{:.2}) score {:.3}  {:?}", tgt.name, what, f.x, f.y, f.score, tgt.frame.coat);
        }
    }
}
