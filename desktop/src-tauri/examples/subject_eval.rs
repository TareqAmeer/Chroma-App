//! Measures how well subject.rs's PerSAM prototypes actually recognise ONE named dog across
//! different photos — the honest version of "remember this dog", run against real captures.
//!
//! Run:  cargo run --release --example subject_eval
//!
//! Why an example and not a #[test]: this is calibration-style measurement (a table of scores you
//! read and judge), the same split the repo already uses for dump_rw2.rs and the Python calib/
//! scripts. The standing regression assertions live in subject.rs's own test module and are
//! deliberately much cheaper.
//!
//! The photos are `geneva/*.jpg`, which are gitignored user captures — this exits cleanly if they
//! aren't in the checkout. The subject is Lucifer, a curly apricot labradoodle. The set was chosen
//! because it is HARD in the specific way that matters: five of the seven frames contain another
//! dog, and in two of them (__TM4933, __TM5132) the distractor is a similarly brown smooth-coated
//! dog. So a passing score here means the prototype discriminates an INDIVIDUAL, not just "dog" —
//! and CLAUDE.md §5b already established that colour cannot do this (the dog gated 0.75 on a human
//! skin colour range).

#[path = "../src/sam.rs"]
mod sam;
#[path = "../src/subject.rs"]
mod subject;

use std::path::PathBuf;

/// A photo, the box Lucifer occupies in it, and the box of the most confusable other thing.
/// Boxes are (x0, y0, x1, y1) as fractions of frame, read off the images by hand.
struct Frame {
    name: &'static str,
    lucifer: (f32, f32, f32, f32),
    distractor: Option<(&'static str, (f32, f32, f32, f32))>,
}

const FRAMES: &[Frame] = &[
    Frame { name: "__TM4056", lucifer: (0.51, 0.30, 0.64, 0.72), distractor: Some(("black dog",   (0.18, 0.20, 0.30, 0.36))) },
    Frame { name: "__TM4202", lucifer: (0.06, 0.32, 0.37, 0.70), distractor: None },
    Frame { name: "__TM4304", lucifer: (0.41, 0.54, 0.59, 0.83), distractor: Some(("grey dog",    (0.31, 0.38, 0.40, 0.50))) },
    Frame { name: "__TM4666", lucifer: (0.41, 0.30, 0.51, 0.70), distractor: Some(("grey dog",    (0.04, 0.02, 0.27, 0.33))) },
    Frame { name: "__TM4933", lucifer: (0.16, 0.40, 0.58, 0.88), distractor: Some(("brown dog",   (0.65, 0.32, 1.00, 1.00))) },
    Frame { name: "__TM5132", lucifer: (0.31, 0.39, 0.52, 0.61), distractor: Some(("brown dog",   (0.56, 0.40, 0.78, 0.64))) },
    Frame { name: "__TM5199", lucifer: (0.57, 0.58, 0.80, 0.98), distractor: Some(("person",      (0.16, 0.12, 0.44, 0.58))) },
];

/// Which encoder experiments 1-5 run against; experiment 6 compares both directly.
const USE_SAM2: bool = false;

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

struct Loaded {
    name: &'static str,
    embed: sam::Embedding,
    /// SAM 2.1's Hiera encoder over the same pixels — a far heavier backbone than EdgeSAM's
    /// distilled RepViT, and the open question this harness exists to settle: does a stronger
    /// feature space actually discriminate one individual dog from another?
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

fn main() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    sam::set_dylib_path(manifest.join("vendor/onnxruntime/libonnxruntime.dylib"));
    sam::set_sam2_model_paths(
        manifest.join("vendor/sam2/encoder.onnx"),
        manifest.join("vendor/sam2/decoder.onnx"),
    );
    let geneva = manifest.join("../../geneva");
    if !geneva.exists() {
        eprintln!("geneva/ not in this checkout — nothing to measure. (These are gitignored user photos.)");
        return;
    }

    // Encode every frame once; every experiment below reuses these.
    let mut loaded: Vec<Loaded> = Vec::new();
    for frame in FRAMES {
        let path = geneva.join(format!("{}.jpg", frame.name));
        if !path.exists() {
            eprintln!("skip {}: not present", frame.name);
            continue;
        }
        let img = image::open(&path).expect("open").to_rgb8();
        let (iw, ih) = img.dimensions();
        // Same downsample the app does before sam_encode — the model resizes to 1024 anyway, so
        // sending full-res RAW pixels would only cost time.
        let (w, h) = (iw / 8, ih / 8);
        let small = sam::resize_rgb8(img.as_raw(), iw, ih, w, h);
        let embed = sam::encode(&small, w, h).expect("encode");
        let embed2 = sam::sam2_encode(&small, w, h).ok();
        println!("encoded {} ({}x{} -> {}x{}){}", frame.name, iw, ih, w, h,
            if embed2.is_some() { "" } else { "  [sam2 unavailable]" });
        loaded.push(Loaded { name: frame.name, embed, embed2, w, h, frame });
    }
    if loaded.len() < 2 {
        eprintln!("need at least 2 frames to measure cross-photo recognition");
        return;
    }
    println!();

    // ── Experiment 1: leave-one-out. Learn from exactly ONE photo, find Lucifer in the others. ──
    println!("── 1. single reference ───────────────────────────────────────────────────────");
    println!("{:<10} {:>6}  {:<38} {}", "learn from", "hits", "misses land on", "mean score");
    println!("{}", "-".repeat(78));
    let mut single_hits = 0usize;
    let mut single_total = 0usize;
    for src in &loaded {
        let mask = box_mask(src.w, src.h, src.frame.lucifer);
        let proto = match subject::learn(src.grid(USE_SAM2), &mask) {
            Ok(p) => p,
            Err(e) => { println!("{:<10} learn failed: {e}", src.name); continue; }
        };
        let (mut hits, mut n, mut score_sum) = (0usize, 0usize, 0f32);
        let mut misses: Vec<String> = Vec::new();
        for tgt in &loaded {
            if tgt.name == src.name { continue; }
            let f = subject::locate(tgt.grid(USE_SAM2), &proto).expect("locate");
            n += 1;
            score_sum += f.score;
            if inside(tgt.frame.lucifer, f.x, f.y) {
                hits += 1;
            } else {
                let what = tgt.frame.distractor
                    .filter(|(_, b)| inside(*b, f.x, f.y))
                    .map(|(label, _)| label.to_string())
                    .unwrap_or_else(|| "background".into());
                misses.push(format!("{}:{what}", &tgt.name[2..]));
            }
        }
        single_hits += hits;
        single_total += n;
        println!("{:<10} {:>3}/{:<2}  {:<38} {:.3}", src.name, hits, n, misses.join(" "), score_sum / n.max(1) as f32);
    }
    println!("{}", "-".repeat(78));
    println!("single-reference recall: {single_hits}/{single_total} = {:.0}%\n",
        100.0 * single_hits as f32 / single_total.max(1) as f32);

    // ── Experiment 2: three references merged, the way the UI's "add another photo" builds up. ──
    println!("── 2. three references merged ────────────────────────────────────────────────");
    let refs: Vec<&Loaded> = loaded.iter().take(3).collect();
    let mut proto: Vec<f32> = Vec::new();
    let mut nrefs = 0u32;
    for r in &refs {
        let mask = box_mask(r.w, r.h, r.frame.lucifer);
        let p = subject::learn(r.grid(USE_SAM2), &mask).expect("learn");
        proto = if proto.is_empty() { p } else { subject::merge_prototypes(&proto, nrefs, &p) };
        nrefs += 1;
    }
    println!("learned from: {}", refs.iter().map(|r| r.name).collect::<Vec<_>>().join(", "));
    println!("{:<10} {:>7} {:>7}  {}", "photo", "x", "y", "result");
    println!("{}", "-".repeat(78));
    let (mut hits, mut n) = (0usize, 0usize);
    for tgt in &loaded {
        if refs.iter().any(|r| r.name == tgt.name) { continue; }
        let f = subject::locate(tgt.grid(USE_SAM2), &proto).expect("locate");
        n += 1;
        let ok = inside(tgt.frame.lucifer, f.x, f.y);
        if ok { hits += 1; }
        let what = if ok { "LUCIFER".to_string() } else {
            tgt.frame.distractor.filter(|(_, b)| inside(*b, f.x, f.y))
                .map(|(l, _)| l.to_uppercase()).unwrap_or_else(|| "background".into())
        };
        println!("{:<10} {:>7.3} {:>7.3}  {:<12} score {:.3}", tgt.name, f.x, f.y, what, f.score);
    }
    println!("{}", "-".repeat(78));
    println!("merged-reference recall: {hits}/{n}\n");

    // ── Experiment 3: does the score separate "subject present" from "subject absent"? ──
    // The UI needs a usable threshold for batch work ("find Lucifer in this shoot"), and an argmax
    // ALWAYS returns a point — so without a separating score, a photo with no dog in it reports a
    // confident-looking hit. Compare Lucifer's score against a prototype learned from a MOUNTAIN
    // in a frame where no mountain-like subject exists.
    println!("── 3. score separation (is the subject even here?) ───────────────────────────");
    let a = &loaded[0];
    let sky_box = (0.0f32, 0.0f32, 1.0f32, 0.12f32); // top strip: sky/trees, not the dog
    let sky_proto = subject::learn(a.grid(USE_SAM2), &box_mask(a.w, a.h, sky_box)).expect("learn sky");
    let dog_proto = subject::learn(a.grid(USE_SAM2), &box_mask(a.w, a.h, a.frame.lucifer)).expect("learn dog");
    println!("{:<10} {:>12} {:>12}", "photo", "dog score", "sky score");
    for tgt in &loaded {
        let d = subject::locate(tgt.grid(USE_SAM2), &dog_proto).expect("locate");
        let s = subject::locate(tgt.grid(USE_SAM2), &sky_proto).expect("locate");
        println!("{:<10} {:>12.3} {:>12.3}", tgt.name, d.score, s.score);
    }
    println!("\nIf these two columns overlap, a single global threshold cannot mean \"present\".");

    // ── Experiment 5: strategy comparison, on the same leave-one-out matrix as experiment 1. ──
    // Experiment 3 showed raw cosine cannot answer "is the subject here", so the question is what
    // CAN. Three candidates, measured rather than assumed (§10.3 — validate the mechanism on
    // read-only computations before editing anything):
    //   argmax    — one peak cell (what locate() does today)
    //   smoothed  — 3x3-mean the similarity map first, so a single noisy cell can't win
    //   top3      — centroid of the 3 best cells
    // and as a confidence signal, PEAKEDNESS (max-mean)/std of the map, which unlike raw cosine
    // is scale-free per photo.
    println!("\n── 5. locate strategy + confidence ───────────────────────────────────────────");
    let smooth = |m: &Vec<f32>, valid: &Vec<bool>| -> Vec<f32> {
        let g = 64usize;
        let mut out = m.clone();
        for y in 0..g {
            for x in 0..g {
                if !valid[y * g + x] { continue; }
                let (mut s, mut n) = (0f32, 0f32);
                for dy in -1i32..=1 {
                    for dx in -1i32..=1 {
                        let (nx, ny) = (x as i32 + dx, y as i32 + dy);
                        if nx < 0 || ny < 0 || nx >= g as i32 || ny >= g as i32 { continue; }
                        if !valid[ny as usize * g + nx as usize] { continue; }
                        s += m[ny as usize * g + nx as usize];
                        n += 1.0;
                    }
                }
                out[y * g + x] = s / n.max(1.0);
            }
        }
        out
    };

    let mut tally = [(0usize, 0usize); 3]; // argmax, smoothed, top3
    let mut hit_peak: Vec<f32> = Vec::new();
    let mut miss_peak: Vec<f32> = Vec::new();
    for src in &loaded {
        let mask = box_mask(src.w, src.h, src.frame.lucifer);
        let Ok(p) = subject::learn(src.grid(USE_SAM2), &mask) else { continue };
        for tgt in &loaded {
            if tgt.name == src.name { continue; }
            let (map, valid, iw, ih) = subject::similarity_map(tgt.grid(USE_SAM2), &p).expect("map");
            let g = 64usize;
            let pick = |m: &Vec<f32>| -> (f32, f32) {
                let mut best = (f32::NEG_INFINITY, 0usize);
                for i in 0..m.len() { if valid[i] && m[i] > best.0 { best = (m[i], i); } }
                subject::cell_norm(best.1 as u32 % 64, best.1 as u32 / 64, iw, ih)
            };
            let (ax, ay) = pick(&map);
            let sm = smooth(&map, &valid);
            let (sx, sy) = pick(&sm);
            // top-3 centroid
            let mut idx: Vec<usize> = (0..map.len()).filter(|&i| valid[i]).collect();
            idx.sort_by(|&a, &b| map[b].total_cmp(&map[a]));
            let (mut cx, mut cy) = (0f32, 0f32);
            for &i in idx.iter().take(3) {
                let (nx, ny) = subject::cell_norm(i as u32 % 64, i as u32 / 64, iw, ih);
                cx += nx / 3.0;
                cy += ny / 3.0;
            }
            for (k, (x, y)) in [(ax, ay), (sx, sy), (cx, cy)].iter().enumerate() {
                tally[k].1 += 1;
                if inside(tgt.frame.lucifer, *x, *y) { tally[k].0 += 1; }
            }
            // Peakedness of the smoothed map, bucketed by whether the smoothed pick was right.
            let vals: Vec<f32> = (0..sm.len()).filter(|&i| valid[i]).map(|i| sm[i]).collect();
            let mean = vals.iter().sum::<f32>() / vals.len() as f32;
            let std = (vals.iter().map(|v| (v - mean).powi(2)).sum::<f32>() / vals.len() as f32).sqrt();
            let max = vals.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
            let peak = if std > 1e-6 { (max - mean) / std } else { 0.0 };
            if inside(tgt.frame.lucifer, sx, sy) { hit_peak.push(peak) } else { miss_peak.push(peak) }
        }
    }
    for (name, (h, n)) in ["argmax", "smoothed", "top3"].iter().zip(tally.iter()) {
        println!("{:<10} {h}/{n} = {:.0}%", name, 100.0 * *h as f32 / *n as f32);
    }
    let stat = |v: &Vec<f32>| {
        let m = v.iter().sum::<f32>() / v.len().max(1) as f32;
        let mut s = v.clone();
        s.sort_by(f32::total_cmp);
        (m, s.first().copied().unwrap_or(0.0), s.last().copied().unwrap_or(0.0))
    };
    let (hm, hlo, _) = stat(&hit_peak);
    let (mm, _, mhi) = stat(&miss_peak);
    println!("peakedness  hits mean {hm:.2} (min {hlo:.2})   misses mean {mm:.2} (max {mhi:.2})");
    println!("            -> a threshold only helps if hits sit clearly above misses");

    // ── Experiment 6: EdgeSAM vs SAM 2.1 features, same photos, same protocol. ──
    // This is the decision this harness exists for. EdgeSAM is a distillation tuned for cheap
    // interactive segmentation; SAM 2.1's Hiera backbone is far larger. Recognising an INDIVIDUAL
    // (this dog, not that dog) asks much more of a feature space than segmenting a thing does, so
    // whether the heavier encoder earns its cost is an empirical question, not a design opinion.
    println!("\n── 6. EdgeSAM vs SAM 2.1 features ───────────────────────────────────────────");
    let have_sam2 = loaded.iter().all(|l| l.embed2.is_some());
    if !have_sam2 {
        println!("SAM 2.1 embeddings unavailable — skipping.");
    } else {
        println!("{:<12} {:>10} {:>10}  {}", "", "recall", "smoothed", "misses onto another dog");
        for (label, sam2) in [("edgesam", false), ("sam2", true)] {
            let (mut hits, mut shits, mut n, mut dogmiss) = (0usize, 0usize, 0usize, 0usize);
            for src in &loaded {
                let mask = box_mask(src.w, src.h, src.frame.lucifer);
                let Ok(p) = subject::learn(src.grid(sam2), &mask) else { continue };
                for tgt in &loaded {
                    if tgt.name == src.name { continue; }
                    let (map, valid, iw, ih) = subject::similarity_map(tgt.grid(sam2), &p).expect("map");
                    let pick = |m: &Vec<f32>| -> (f32, f32) {
                        let mut best = (f32::NEG_INFINITY, 0usize);
                        for i in 0..m.len() { if valid[i] && m[i] > best.0 { best = (m[i], i); } }
                        subject::cell_norm(best.1 as u32 % 64, best.1 as u32 / 64, iw, ih)
                    };
                    let (ax, ay) = pick(&map);
                    let (sx, sy) = pick(&smooth(&map, &valid));
                    n += 1;
                    if inside(tgt.frame.lucifer, ax, ay) { hits += 1; }
                    if inside(tgt.frame.lucifer, sx, sy) { shits += 1; } else if
                        tgt.frame.distractor.map(|(l, b)| l.contains("dog") && inside(b, sx, sy)).unwrap_or(false) { dogmiss += 1; }
                }
            }
            println!("{:<12} {:>9.0}% {:>9.0}%  {dogmiss}", label,
                100.0 * hits as f32 / n as f32, 100.0 * shits as f32 / n as f32);
        }
    }

    // ── Experiment 7: does MORE evidence close the gap? ──
    // Everything above learns from a single reference. The real UI flow is "teach it 2-3 photos",
    // and the two encoders can also be COMBINED (average the two similarity maps), which costs
    // nothing extra at query time since both embeddings already exist for every open photo.
    // Leave-one-out over every 3-photo reference set is too slow; this rotates the reference
    // window instead, which is the same thing the user actually does.
    println!("\n── 7. merged references, per encoder ─────────────────────────────────────────");
    if have_sam2 {
        println!("{:<22} {:>8} {:>14}", "config", "recall", "wrong-dog");
        for nrefs in [1usize, 2, 3] {
            for (label, mode) in [("edgesam", 0), ("sam2", 1), ("combined", 2)] {
                let (mut hits, mut n, mut dogmiss) = (0usize, 0usize, 0usize);
                // Rotate which contiguous window of `nrefs` photos is the reference set.
                for start in 0..loaded.len() {
                    let refs: Vec<&Loaded> = (0..nrefs).map(|k| &loaded[(start + k) % loaded.len()]).collect();
                    let build = |sam2: bool| -> Vec<f32> {
                        let (mut proto, mut c) = (Vec::new(), 0u32);
                        for r in &refs {
                            let m = box_mask(r.w, r.h, r.frame.lucifer);
                            if let Ok(p) = subject::learn(r.grid(sam2), &m) {
                                proto = if proto.is_empty() { p } else { subject::merge_prototypes(&proto, c, &p) };
                                c += 1;
                            }
                        }
                        proto
                    };
                    let (pe, ps) = (build(false), build(true));
                    if pe.is_empty() || ps.is_empty() { continue; }
                    for tgt in &loaded {
                        if refs.iter().any(|r| r.name == tgt.name) { continue; }
                        let (me, ve, iwe, ihe) = subject::similarity_map(tgt.grid(false), &pe).expect("map");
                        let (ms, vs, iws, ihs) = subject::similarity_map(tgt.grid(true), &ps).expect("map");
                        let (map, valid, iw, ih) = match mode {
                            0 => (me, ve, iwe, ihe),
                            1 => (ms, vs, iws, ihs),
                            // Combined: both grids are 64x64 over the same photo, but EdgeSAM's is
                            // padded and SAM 2.1's is not, so they are only comparable after each
                            // cell is mapped to a normalised coordinate. Averaging the two RAW
                            // grids cell-by-cell would silently align a padded cell with an image
                            // cell on any non-square photo.
                            _ => {
                                let mut c = vec![f32::NEG_INFINITY; me.len()];
                                let mut cv = vec![false; me.len()];
                                for fy in 0..64u32 { for fx in 0..64u32 {
                                    let i = (fy * 64 + fx) as usize;
                                    if !ve[i] { continue; }
                                    let (nx, ny) = subject::cell_norm(fx, fy, iwe, ihe);
                                    // Nearest SAM2 cell to the same normalised point.
                                    let (sx, sy) = (((nx * 64.0) as u32).min(63), ((ny * 64.0) as u32).min(63));
                                    let j = (sy * 64 + sx) as usize;
                                    if !vs[j] { continue; }
                                    c[i] = 0.5 * (me[i] + ms[j]);
                                    cv[i] = true;
                                } }
                                (c, cv, iwe, ihe)
                            }
                        };
                        let mut best = (f32::NEG_INFINITY, 0usize);
                        for i in 0..map.len() { if valid[i] && map[i] > best.0 { best = (map[i], i); } }
                        let (x, y) = subject::cell_norm(best.1 as u32 % 64, best.1 as u32 / 64, iw, ih);
                        n += 1;
                        if inside(tgt.frame.lucifer, x, y) { hits += 1; }
                        else if tgt.frame.distractor.map(|(l, b)| l.contains("dog") && inside(b, x, y)).unwrap_or(false) { dogmiss += 1; }
                    }
                }
                println!("{:<22} {:>7.0}% {:>14}", format!("{label} x{nrefs} refs"),
                    100.0 * hits as f32 / n.max(1) as f32, dogmiss);
            }
        }
    }

    // ── Experiment 4: end to end — the located point actually drives a mask. ──
    println!("\n── 4. locate → segment (the real call path) ──────────────────────────────────");
    for tgt in loaded.iter().take(3) {
        match subject::locate_and_segment(&tgt.embed, &proto) {
            Ok((mask, f)) => {
                let on = mask.iter().filter(|&&v| v > 127).count();
                let frac = on as f32 / mask.len() as f32;
                println!("{:<10} mask covers {:>5.1}% of frame, point ({:.3},{:.3}) score {:.3}",
                    tgt.name, frac * 100.0, f.x, f.y, f.score);
            }
            Err(e) => println!("{:<10} segment failed: {e}", tgt.name),
        }
    }
}
