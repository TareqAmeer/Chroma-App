// One-shot subject recognition — "remember this dog", then find it again in any other photo.
//
// The method is PerSAM (Zhang et al., ICLR 2024) in its training-free point-prompt form, and the
// reason it's worth doing at all is that it needs NO new model, NO fine-tuning and NO training
// data: everything it runs on already exists in sam.rs. A subject is a 256-float vector — a few
// KB on disk, not a checkpoint.
//
// How it works, in one paragraph. sam::encode() already produces a [1,256,64,64] image embedding:
// a 64x64 grid of 256-dimensional semantic feature vectors. Given ONE reference photo plus a mask
// of the subject in it (which the user already produces by scribbling — sam_points returns exactly
// that raster), the masked mean of those feature vectors, L2-normalised, is a "prototype" of the
// subject. In a NEW photo, the cosine similarity between that prototype and each of the 4096
// spatial features gives a heat map of "how much does this location look like the subject"; its
// argmax is a positive point prompt and its argmin a negative one, and those go straight into the
// EXISTING decode_points() to produce a real, edge-accurate mask.
//
// Why this matters for this app specifically: CLAUDE.md §5b documents at length that a COLOUR gate
// cannot separate this user's dark-brown dog from their own shadowed skin (measured: the dog's head
// gated 0.75 on a skin colour range). Prototypes are semantic features, not colour, so they can —
// and the repo's own __TM3390.jpg, which contains exactly that person-plus-brown-dog pair, is what
// the test at the bottom of this file asserts against.
//
// ⚠️ Prototypes are tied to the ENCODER that produced them. The two encoders have different
// preprocessing (resize-longest-side+pad vs a direct square resize) and different feature spaces,
// so a prototype learned under one is meaningless under the other — `encoder` is recorded in the
// stored JSON and checked before use, rather than silently returning confident nonsense.
//
// ── What this actually achieves, measured (examples/subject_eval.rs) ──────────────────────────
//
// Two datasets of one dog (Lucifer, a curly apricot labradoodle), both gitignored user captures:
// `geneva/` is 7 frames from ONE trip, `lucifer/` is 25 spanning years, six cameras, snow /
// blossom / indoors / beach / city, and both coat states. Recall is "the located point falls
// inside the dog"; the reference window is rotated over the whole set so no lucky choice of
// reference photos can flatter it; "wrong-dog" counts misses landing on a different animal.
//
//   set        encoder  refs  recall     95% CI      wrong-dog
//   lucifer    edgesam    1     58%     54-62%  n=600     6
//   lucifer    edgesam    6     65%     60-69%  n=475     6
//   lucifer    sam2       1     71%     67-74%  n=600     3
//   lucifer    sam2       2     75%     71-78%  n=575     1
//   lucifer    sam2       3     77%     73-80%  n=550     1
//   lucifer    sam2       4     79%     75-82%  n=525     0
//   lucifer    sam2       6     80%     76-84%  n=475     0
//
// ⚠️ The realistic number is ~77-80%, NOT the ~86% the first round reported. That round used only
// the 7-frame single-trip set, where 86% came out of 28 trials with a 69-95% interval — consistent
// with anything from mediocre to excellent. One trip, one coat, one camera flatters this task
// badly. Do not quote a recall figure from a small same-session set.
//
// Four findings drive the shipped design:
//
//  1. SAM 2.1 features, decisively. On the single-trip set the two encoders looked comparable
//     (86% vs 86%); on realistic data EdgeSAM is ~15 points worse (65% vs 80%) AND keeps landing
//     on other dogs (6 vs 0). This gap is invisible without a varied photo set, which is why the
//     harness carries one.
//  2. References keep helping past 3, slowly: 71 -> 75 -> 77 -> 79 -> 80% for 1/2/3/4/6. An
//     earlier "plateau at 3" reading was an artifact of the small set. Three is a reasonable
//     default to ask a user for; more is genuinely better, so the UI should let them keep adding.
//  3. WRONG-DOG GOES TO ZERO at 4+ references (1 in 550 trials at 2-3). This is the property that
//     makes the feature safe to offer at all: a miss onto background reads as obviously wrong,
//     where a confident match on the neighbours dog is the one a user accepts by mistake.
//     (Spatial smoothing of the map was also measured: it helps EdgeSAM 69->74% and HURTS
//     SAM 2.1 71->62%, whose map is sharper. There is none in the code. A top-3 centroid was
//     worse than argmax at 67%.)
//  4. ⚠️ WHICH photos you teach from matters MORE than how many. Three good references transfer
//     across datasets at 84% (geneva -> lucifer, wrong-dog 0); a poor triple went the other way at
//     1/7. So the UI must show what a reference contributes, not just count them — and a user
//     whose results are bad should be told to swap a reference, not merely add another.
//
// ── A haircut does NOT break a taught subject ─────────────────────────────────────────────────
//
// This was the open question the single-trip set structurally could not answer, since a curly
// doodles coat is its largest appearance change. Learning on one coat state and testing on the
// other is statistically indistinguishable from the same-state controls:
//
//   shaggy  -> groomed              75%   (n=36)
//   groomed -> shaggy               78%   (n=36)
//   shaggy  -> shaggy   (control)   71%   (n=24)
//   groomed -> groomed  (control)   79%   (n=24)
//
// Cross-coat actually beat one control. So the features are keying on something more stable than
// coat texture, and the UI must NOT tell users to re-teach after a groom — that advice would have
// been the intuitive guess and it is wrong.
//
// ⚠️ There is still NO reliable "is the subject even in this photo" signal. Raw cosine does not
// separate present from absent at all (a prototype learned from SKY scored 0.937 on a frame where
// the dog scored 0.892), and peak sharpness only separates on average, with overlapping ranges.
// An argmax always returns a point, so this must be presented as a suggestion the user confirms,
// never auto-applied across a batch. `score` is returned for display and deliberately never
// thresholded. Note in the per-frame table that hits and misses both sit around 0.70-0.79.
//
// ⚠️ One dog. These are honest measurements of a real case, not a benchmark.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::sam::{Embedding, Sam2Embedding, SAM_FEAT_GRID, SAM_PATCH, SAM_SIZE};

/// A 64x64 grid of 256-d features plus the geometry needed to map a cell back to the photo.
///
/// Both encoders emit the same [1,256,64,64] shape but arrange the image inside it DIFFERENTLY,
/// and that difference is the whole reason this type exists rather than a bare slice: EdgeSAM
/// resizes the longest side and zero-pads the rest of the square (so a large slice of the grid is
/// padding that must be excluded), while SAM 2.1 resizes directly to a square (so every cell is
/// image, and the aspect distortion is undone in coordinate space instead).
#[derive(Clone, Copy)]
pub struct FeatureGrid<'a> {
    data: &'a [f32],
    orig_w: u32,
    orig_h: u32,
    /// True for EdgeSAM's resize-longest-side-and-pad layout, false for SAM 2.1's square resize.
    padded: bool,
}

impl<'a> FeatureGrid<'a> {
    pub fn edgesam(e: &'a Embedding) -> Self {
        Self { data: &e.data, orig_w: e.orig_w, orig_h: e.orig_h, padded: true }
    }
    pub fn sam2(e: &'a Sam2Embedding) -> Self {
        Self { data: &e.image_embed, orig_w: e.orig_w, orig_h: e.orig_h, padded: false }
    }
    /// Which encoder produced these features — stored alongside every prototype and checked
    /// before matching, since the two feature spaces are not interchangeable.
    pub fn encoder_tag(&self) -> &'static str {
        if self.padded { ENC_EDGESAM } else { ENC_SAM2 }
    }
    /// The unpadded canvas extent, in canvas pixels. For the square-resize encoder the image fills
    /// the canvas by definition.
    fn extent(&self) -> (f32, f32) {
        if self.padded {
            input_extent(self.orig_w, self.orig_h)
        } else {
            (SAM_SIZE as f32, SAM_SIZE as f32)
        }
    }
}

/// Feature-vector length of one spatial location in the [1,256,64,64] embedding.
const PROTO_DIM: usize = 256;
/// Tags recorded in the stored JSON so a prototype can never be matched against features from a
/// different encoder. Prefer SAM 2.1 (see finding 2 in the module comment); EdgeSAM is the
/// fallback for when its slower encode hasn't landed yet.
pub const ENC_SAM2: &str = "sam2-1024";
pub const ENC_EDGESAM: &str = "edgesam-1024";

/// A learned subject: a name, and the averaged L2-normalised feature prototype.
#[derive(Serialize, Deserialize, Clone)]
pub struct Subject {
    pub id: String,
    pub name: String,
    /// The merged, L2-normalised prototype actually used for matching. Derived from `refs` —
    /// stored rather than recomputed only so `load_subjects` stays a plain file read.
    pub prototype: Vec<f32>,
    /// Every reference kept SEPARATELY, not just folded into a running average.
    ///
    /// The measurements say WHICH photos you teach from matters more than how many (three good
    /// references transfer across datasets at 84%; a poor triple managed 1 in 7). Acting on that
    /// means a user has to be able to drop the bad reference and keep the rest — impossible from
    /// a merged vector alone, which is why an earlier running-average version of this struct was
    /// replaced. The cost is 1KB per reference.
    #[serde(default)]
    pub refs: Vec<Reference>,
    pub encoder: String,
}

/// One taught photo: the prototype it contributed plus enough to name it in a list.
#[derive(Serialize, Deserialize, Clone)]
pub struct Reference {
    /// Stable id — the source photo path when there is one, else a timestamp.
    pub id: String,
    /// What to show in the references list (a filename, usually).
    pub label: String,
    pub prototype: Vec<f32>,
}

// ── Pure vector maths, all unit-testable without the model ────────────────────────────────────

/// L2-normalises in place. A zero vector is left as-is (all-zero) rather than producing NaNs —
/// callers treat an all-zero prototype as "learning failed", which is what an empty mask gives.
fn l2_normalise(v: &mut [f32]) {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 1e-12 {
        for x in v.iter_mut() {
            *x /= norm;
        }
    }
}

fn is_zero(v: &[f32]) -> bool {
    v.iter().all(|&x| x == 0.0)
}

/// Folds a newly-learned prototype into an existing one, weighted by how many references each
/// already represents, then renormalises. This is what makes "add another photo of the dog" cover
/// pose and lighting change: a single reference is one viewpoint, and averaging pulls the
/// prototype toward whatever is INVARIANT across viewpoints.
///
/// ⚠️ Weighted, not a plain mean of the two: with a plain mean the 4th reference photo would carry
/// as much weight as the first three combined, so one bad scribble could dominate a well-taught
/// subject.
pub fn merge_prototypes(existing: &[f32], existing_refs: u32, incoming: &[f32]) -> Vec<f32> {
    if existing.len() != incoming.len() || is_zero(existing) {
        return incoming.to_vec();
    }
    let w = existing_refs.max(1) as f32;
    let mut out: Vec<f32> = existing
        .iter()
        .zip(incoming)
        .map(|(&a, &b)| (a * w + b) / (w + 1.0))
        .collect();
    l2_normalise(&mut out);
    out
}

/// Folds every kept reference into one prototype, weighting each equally. Equal weighting is the
/// point of keeping them separately: with a running average the first reference would carry more
/// influence than the fifth purely because it arrived first, which is not a property anyone asked
/// for and makes "remove the bad one" only partially effective.
pub fn merge_all(refs: &[Reference]) -> Vec<f32> {
    if refs.is_empty() {
        return Vec::new();
    }
    let dim = refs[0].prototype.len();
    let mut acc = vec![0f32; dim];
    for r in refs {
        if r.prototype.len() != dim {
            continue;
        }
        for (a, v) in acc.iter_mut().zip(&r.prototype) {
            *a += v;
        }
    }
    l2_normalise(&mut acc);
    acc
}

/// Cosine similarity of two vectors that are BOTH already L2-normalised — i.e. just a dot product.
/// Kept as a named function because the "already normalised" precondition is the whole reason this
/// is cheap, and inlining a bare dot product would lose that.
fn cosine_prenormalised(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(&x, &y)| x * y).sum()
}

// ── Feature-grid geometry ─────────────────────────────────────────────────────────────────────
//
// EdgeSAM resizes the longest side to SAM_SIZE and zero-pads to a square, so the image occupies
// only the TOP-LEFT (input_w x input_h) of the 1024x1024 canvas — see sam::encode. The 64x64
// feature grid covers that whole padded square, so a large part of it can be pure padding.
//
// ⚠️ The padded cells must be excluded from BOTH the masked mean and the similarity search.
// Leaving them in is not a subtle inaccuracy: padding is a large, perfectly uniform region, so it
// produces its own strong self-consistent feature, and an argmin (the negative point prompt) would
// land there essentially every time — handing the decoder a "background" hint that points at
// nothing in the actual photo.

/// The unpadded region of the SAM canvas that the resized image actually occupies, in canvas
/// pixels. Mirrors the identical computation in sam::encode/decode_points.
fn input_extent(orig_w: u32, orig_h: u32) -> (f32, f32) {
    let scale = SAM_SIZE as f32 / orig_w.max(orig_h) as f32;
    ((orig_w as f32 * scale).max(1.0), (orig_h as f32 * scale).max(1.0))
}

/// Whether feature cell (fx, fy)'s CENTRE falls inside the real image rather than the zero padding.
///
/// Centre-inside rather than fully-inside on purpose: a subject touching the frame edge lands in a
/// cell that straddles the boundary, and requiring full containment would drop it exactly when the
/// user has framed the subject to the edge.
fn cell_is_image(fx: u32, fy: u32, input_w: f32, input_h: f32) -> bool {
    let px = (fx as f32 + 0.5) * SAM_PATCH as f32;
    let py = (fy as f32 + 0.5) * SAM_PATCH as f32;
    px < input_w && py < input_h
}

/// Feature cell centre → normalised (0..1) coordinate in the ORIGINAL image, the convention
/// sam::decode_points takes its point prompts in.
fn cell_to_norm(fx: u32, fy: u32, input_w: f32, input_h: f32) -> (f32, f32) {
    let px = (fx as f32 + 0.5) * SAM_PATCH as f32;
    let py = (fy as f32 + 0.5) * SAM_PATCH as f32;
    ((px / input_w).clamp(0.0, 1.0), (py / input_h).clamp(0.0, 1.0))
}

/// Reads the 256-d feature vector at one spatial cell out of the [1,256,64,64] row-major embedding.
/// Channel c of cell (fx,fy) lives at `c*64*64 + fy*64 + fx` — the tensor is channel-planar, so a
/// feature VECTOR is a strided gather, not a contiguous slice. (Reading it as contiguous is the
/// obvious mistake here and would silently produce 256 values from one channel of 256 different
/// locations, which still normalises and still yields plausible-looking similarities.)
fn feature_at(data: &[f32], fx: u32, fy: u32) -> Vec<f32> {
    let plane = (SAM_FEAT_GRID * SAM_FEAT_GRID) as usize;
    let idx = (fy * SAM_FEAT_GRID + fx) as usize;
    (0..PROTO_DIM).map(|c| data[c * plane + idx]).collect()
}

/// Mean mask coverage (0..1) of the original-image pixels that map into feature cell (fx, fy).
/// `mask` is one byte per ORIGINAL pixel, row-major — exactly what sam::decode_points returns.
fn cell_mask_weight(mask: &[u8], orig_w: u32, orig_h: u32, fx: u32, fy: u32, padded: bool) -> f32 {
    // Padded (EdgeSAM): one uniform scale on both axes, image in the top-left of the canvas.
    // Square-resize (SAM 2.1): independent per-axis scales, image fills the canvas.
    let (sx, sy) = if padded {
        let s = SAM_SIZE as f32 / orig_w.max(orig_h) as f32;
        (s, s)
    } else {
        (SAM_SIZE as f32 / orig_w as f32, SAM_SIZE as f32 / orig_h as f32)
    };
    let x0 = (fx as f32 * SAM_PATCH as f32 / sx).floor().max(0.0) as u32;
    let y0 = (fy as f32 * SAM_PATCH as f32 / sy).floor().max(0.0) as u32;
    let x1 = (((fx + 1) as f32 * SAM_PATCH as f32 / sx).ceil() as u32).min(orig_w);
    let y1 = (((fy + 1) as f32 * SAM_PATCH as f32 / sy).ceil() as u32).min(orig_h);
    if x1 <= x0 || y1 <= y0 {
        return 0.0;
    }
    let mut sum = 0f32;
    for y in y0..y1 {
        let row = (y as usize) * (orig_w as usize);
        for x in x0..x1 {
            sum += mask[row + x as usize] as f32;
        }
    }
    sum / (((x1 - x0) * (y1 - y0)) as f32 * 255.0)
}

// ── Learn ─────────────────────────────────────────────────────────────────────────────────────

/// Builds a prototype from one reference photo: the mask-weighted mean of the embedding's spatial
/// features, L2-normalised.
///
/// `mask` is one byte per pixel of the ORIGINAL image (sam::decode_points' output format). Cells
/// are weighted by how much of the subject they contain, so a cell half-covered by the subject
/// contributes half as much as one fully inside it — a hard threshold would either discard the
/// subject's whole boundary or drag in a ring of background.
pub fn learn(grid: FeatureGrid, mask: &[u8]) -> Result<Vec<f32>, String> {
    let expect = (grid.orig_w as usize) * (grid.orig_h as usize);
    if mask.len() != expect {
        return Err(format!(
            "subject learn: mask is {} bytes, expected {}x{} = {expect}",
            mask.len(),
            grid.orig_w,
            grid.orig_h
        ));
    }
    let (input_w, input_h) = grid.extent();
    let mut acc = vec![0f32; PROTO_DIM];
    let mut total = 0f32;
    for fy in 0..SAM_FEAT_GRID {
        for fx in 0..SAM_FEAT_GRID {
            if !cell_is_image(fx, fy, input_w, input_h) {
                continue;
            }
            let w = cell_mask_weight(mask, grid.orig_w, grid.orig_h, fx, fy, grid.padded);
            if w <= 0.0 {
                continue;
            }
            let feat = feature_at(grid.data, fx, fy);
            for (a, f) in acc.iter_mut().zip(&feat) {
                *a += f * w;
            }
            total += w;
        }
    }
    if total <= 0.0 {
        return Err("subject learn: the reference mask is empty — scribble over the subject first".into());
    }
    for a in acc.iter_mut() {
        *a /= total;
    }
    l2_normalise(&mut acc);
    if is_zero(&acc) {
        return Err("subject learn: degenerate prototype (all-zero features)".into());
    }
    Ok(acc)
}

// ── Locate ────────────────────────────────────────────────────────────────────────────────────

/// Where the subject appears to be in a photo, before any segmentation.
#[derive(Debug, Clone, Copy)]
pub struct Located {
    /// Normalised (0..1) position of the best-matching feature cell — the positive point prompt.
    pub x: f32,
    pub y: f32,
    /// Normalised position of the worst-matching cell — the negative prompt.
    pub neg_x: f32,
    pub neg_y: f32,
    /// Cosine similarity at the argmax, in -1..1. This is the ONLY signal that the subject is
    /// present at all: an argmax always exists, so without a score a photo with no dog in it
    /// returns a confident-looking point on something that merely looks most dog-like.
    pub score: f32,
}

/// The raw similarity field: cosine of the prototype against every one of the 64x64 spatial
/// features, plus which cells are image rather than zero padding, plus the unpadded canvas extent
/// so a caller can map cells back to image coordinates. Exposed for `examples/subject_eval.rs`,
/// which compares peak-picking strategies over the same field.
pub fn similarity_map(grid: FeatureGrid, prototype: &[f32]) -> Result<(Vec<f32>, Vec<bool>, f32, f32), String> {
    if prototype.len() != PROTO_DIM {
        return Err(format!("subject map: prototype is {} long, expected {PROTO_DIM}", prototype.len()));
    }
    let (input_w, input_h) = grid.extent();
    let n = (SAM_FEAT_GRID * SAM_FEAT_GRID) as usize;
    let mut map = vec![f32::NEG_INFINITY; n];
    let mut valid = vec![false; n];
    for fy in 0..SAM_FEAT_GRID {
        for fx in 0..SAM_FEAT_GRID {
            if !cell_is_image(fx, fy, input_w, input_h) {
                continue;
            }
            let i = (fy * SAM_FEAT_GRID + fx) as usize;
            let mut feat = feature_at(grid.data, fx, fy);
            l2_normalise(&mut feat);
            map[i] = cosine_prenormalised(prototype, &feat);
            valid[i] = true;
        }
    }
    Ok((map, valid, input_w, input_h))
}

/// Public wrapper over the cell→normalised-coordinate mapping, for the same harness.
pub fn cell_norm(fx: u32, fy: u32, input_w: f32, input_h: f32) -> (f32, f32) {
    cell_to_norm(fx, fy, input_w, input_h)
}

/// Scores every non-padded spatial feature against the prototype and returns the best and worst
/// locations. Pure given an embedding — no model call, ~4096 dot products of length 256.
pub fn locate(grid: FeatureGrid, prototype: &[f32]) -> Result<Located, String> {
    if prototype.len() != PROTO_DIM {
        return Err(format!("subject locate: prototype is {} long, expected {PROTO_DIM}", prototype.len()));
    }
    let (input_w, input_h) = grid.extent();
    let mut best = (f32::NEG_INFINITY, 0u32, 0u32);
    let mut worst = (f32::INFINITY, 0u32, 0u32);
    for fy in 0..SAM_FEAT_GRID {
        for fx in 0..SAM_FEAT_GRID {
            if !cell_is_image(fx, fy, input_w, input_h) {
                continue;
            }
            let mut feat = feature_at(grid.data, fx, fy);
            l2_normalise(&mut feat);
            let s = cosine_prenormalised(prototype, &feat);
            if s > best.0 {
                best = (s, fx, fy);
            }
            if s < worst.0 {
                worst = (s, fx, fy);
            }
        }
    }
    if !best.0.is_finite() {
        return Err("subject locate: no image-region features (degenerate embedding)".into());
    }
    let (x, y) = cell_to_norm(best.1, best.2, input_w, input_h);
    let (neg_x, neg_y) = cell_to_norm(worst.1, worst.2, input_w, input_h);
    Ok(Located { x, y, neg_x, neg_y, score: best.0 })
}

/// One candidate location from `locate_topk`, without the negative-point/mask machinery `Located`
/// carries — a caller re-locating a SECOND instance just needs a point to feed back into the
/// existing single-point sam_points/sam2_points decoder, not a fresh mask-decode path of its own.
#[derive(Debug, Clone, Copy)]
pub struct MultiLocated {
    pub x: f32,
    pub y: f32,
    pub score: f32,
}

/// Up to `k` distinct-looking matches for `prototype` in `grid`, greedily picked highest-score
/// first and rejecting any candidate within `min_cell_dist` feature cells of one already picked.
///
/// Exists because plain `locate()` is an argmax — it always returns exactly one point, so a photo
/// with the same taught subject appearing twice (e.g. a litter, or two dogs in one frame) can only
/// ever have one instance found. The minimum-distance rule is what keeps this from just returning
/// the top-k cells of the SAME blob (which all score similarly near a real match's centre) as if
/// they were separate instances.
pub fn locate_topk(grid: FeatureGrid, prototype: &[f32], k: usize, min_cell_dist: u32) -> Result<Vec<MultiLocated>, String> {
    let (map, valid, input_w, input_h) = similarity_map(grid, prototype)?;
    let mut cells: Vec<(f32, u32, u32)> = Vec::new();
    for fy in 0..SAM_FEAT_GRID {
        for fx in 0..SAM_FEAT_GRID {
            let i = (fy * SAM_FEAT_GRID + fx) as usize;
            if valid[i] {
                cells.push((map[i], fx, fy));
            }
        }
    }
    // NaN can't appear here (cosine of two finite, non-degenerate vectors), so total_cmp is safe
    // and avoids partial_cmp's Option unwrap on every comparison.
    cells.sort_by(|a, b| b.0.total_cmp(&a.0));
    let mind2 = (min_cell_dist as i64) * (min_cell_dist as i64);
    // ⚠️ Without a score floor, once the real peak(s) are exhausted this would keep filling up to
    // `k` with whatever's farthest away regardless of how poorly it matches — i.e. it would present
    // plain background as if it were additional "instances". RELATIVE_MARGIN keeps only candidates
    // within this much cosine similarity of the single best match in the whole grid, so a second
    // instance has to look genuinely comparable, not merely be the least-bad leftover cell.
    const RELATIVE_MARGIN: f32 = 0.15;
    let min_score = cells.first().map(|c| c.0 - RELATIVE_MARGIN).unwrap_or(f32::NEG_INFINITY);
    let mut picked: Vec<(f32, u32, u32)> = Vec::new();
    for &(s, fx, fy) in &cells {
        if picked.len() >= k || s < min_score {
            break;
        }
        let far_enough = picked.iter().all(|&(_, px, py)| {
            let dx = fx as i64 - px as i64;
            let dy = fy as i64 - py as i64;
            dx * dx + dy * dy >= mind2
        });
        if far_enough {
            picked.push((s, fx, fy));
        }
    }
    Ok(picked
        .into_iter()
        .map(|(score, fx, fy)| {
            let (x, y) = cell_to_norm(fx, fy, input_w, input_h);
            MultiLocated { x, y, score }
        })
        .collect())
}

/// Locate a stored Subject, refusing to match across feature spaces.
///
/// Returns a distinct, matchable error when the grid on hand is the wrong encoder — the frontend
/// fires sam2_encode in the background AFTER sam_encode, so "taught under SAM 2.1, asked while
/// only EdgeSAM is ready" is a normal transient state to retry, not a failure to report.
pub fn locate_subject(grid: FeatureGrid, subject: &Subject) -> Result<Located, String> {
    if subject.encoder != grid.encoder_tag() {
        return Err(format!(
            "encoder-mismatch: \"{}\" was taught with {} but this photo is encoded with {}",
            subject.name, subject.encoder, grid.encoder_tag()
        ));
    }
    locate(grid, &subject.prototype)
}

/// `locate_topk`, with the same encoder guard as `locate_subject`.
pub fn locate_topk_subject(grid: FeatureGrid, subject: &Subject, k: usize, min_cell_dist: u32) -> Result<Vec<MultiLocated>, String> {
    if subject.encoder != grid.encoder_tag() {
        return Err(format!(
            "encoder-mismatch: \"{}\" was taught with {} but this photo is encoded with {}",
            subject.name, subject.encoder, grid.encoder_tag()
        ));
    }
    locate_topk(grid, &subject.prototype, k, min_cell_dist)
}

/// Locate, then hand the resulting point pair to the EXISTING SAM decoder for a real mask.
/// Returns the mask raster (one byte per original pixel) alongside the match score, so a caller
/// can reject a weak match without a second call.
pub fn locate_and_segment(embed: &Embedding, prototype: &[f32]) -> Result<(Vec<u8>, Located), String> {
    let found = locate(FeatureGrid::edgesam(embed), prototype)?;
    let points = [(found.x, found.y, true), (found.neg_x, found.neg_y, false)];
    let mask = crate::sam::decode_points(embed, &points)?;
    Ok((mask, found))
}

// ── Persistence ───────────────────────────────────────────────────────────────────────────────
//
// Application Support, NOT Library/Caches where library.rs keeps thumbnails: a thumbnail can be
// regenerated from the photo, but a prototype represents work the user did (scribbling over their
// dog in several photos) and cannot be. macOS is free to purge Caches at any time.

fn subjects_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    let dir = PathBuf::from(home).join("Library/Application Support/com.tareq.chromasmith");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("subjects.json")
}

fn read_subjects_at(path: &Path) -> Vec<Subject> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str::<Vec<Subject>>(&t).ok())
        .unwrap_or_default()
        .into_iter()
        // A malformed prototype can never be used by anything; a FOREIGN-encoder one still names a
        // subject the user taught, so it is kept and rejected at match time (with a message that
        // says to re-teach) rather than vanishing silently from their list.
        .filter(|s| s.prototype.len() == PROTO_DIM && !s.refs.is_empty())
        .collect()
}

fn write_subjects_at(path: &Path, subjects: &[Subject]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(subjects).map_err(|e| format!("serialise subjects: {e}"))?;
    // Write-then-rename so an interrupted write can't truncate the file the user's taught
    // subjects live in.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("write subjects: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("commit subjects: {e}"))
}

pub fn load_subjects() -> Vec<Subject> {
    read_subjects_at(&subjects_path())
}

/// Inserts a new subject or folds another reference into an existing one (matched by id).
pub fn upsert_subject(
    id: &str,
    name: &str,
    prototype: Vec<f32>,
    encoder: &str,
    ref_id: &str,
    ref_label: &str,
) -> Result<Subject, String> {
    let path = subjects_path();
    let mut all = read_subjects_at(&path);
    let reference = Reference { id: ref_id.to_string(), label: ref_label.to_string(), prototype };
    let updated = match all.iter_mut().find(|s| s.id == id) {
        Some(existing) => {
            // ⚠️ Mixing feature spaces would average two unrelated vector spaces and quietly
            // degrade a subject the user had already taught well. Start over instead, and say so
            // by dropping the old references rather than leaving a misleading count.
            if existing.encoder != encoder {
                existing.refs.clear();
                existing.encoder = encoder.to_string();
            }
            // Re-teaching from the SAME photo replaces that reference instead of stacking a near
            // duplicate, which would silently double its weight in the merge.
            match existing.refs.iter_mut().find(|r| r.id == reference.id) {
                Some(slot) => *slot = reference,
                None => existing.refs.push(reference),
            }
            existing.prototype = merge_all(&existing.refs);
            if !name.is_empty() {
                existing.name = name.to_string();
            }
            existing.clone()
        }
        None => {
            let refs = vec![reference];
            let s = Subject {
                id: id.to_string(),
                name: if name.is_empty() { "Subject".into() } else { name.to_string() },
                prototype: merge_all(&refs),
                refs,
                encoder: encoder.to_string(),
            };
            all.push(s.clone());
            s
        }
    };
    write_subjects_at(&path, &all)?;
    Ok(updated)
}

/// Renames a subject without touching its references — a rename must not perturb what it matches.
pub fn rename_subject(id: &str, name: &str) -> Result<(), String> {
    let path = subjects_path();
    let mut all = read_subjects_at(&path);
    let Some(s) = all.iter_mut().find(|s| s.id == id) else { return Err(format!("no subject {id}")) };
    s.name = name.to_string();
    write_subjects_at(&path, &all)
}

/// Drops one reference and re-merges what is left. Removing the last one deletes the subject —
/// a subject with no references cannot match anything, and leaving an empty shell in the list
/// would be a row that silently never works.
pub fn remove_reference(id: &str, ref_id: &str) -> Result<Option<Subject>, String> {
    let path = subjects_path();
    let mut all = read_subjects_at(&path);
    let Some(idx) = all.iter().position(|s| s.id == id) else { return Ok(None) };
    all[idx].refs.retain(|r| r.id != ref_id);
    if all[idx].refs.is_empty() {
        all.remove(idx);
        write_subjects_at(&path, &all)?;
        return Ok(None);
    }
    all[idx].prototype = merge_all(&all[idx].refs);
    let out = all[idx].clone();
    write_subjects_at(&path, &all)?;
    Ok(Some(out))
}

/// Merges `other_id` INTO `keep_id`: every reference from both (deduped by reference id, `keep`'s
/// copy winning a collision), one recomputed prototype, `other_id` deleted. Exists for the case
/// subject_locate's own doc comment predicts — no "is it even in this photo" signal means a user
/// experimenting with Find is expected to sometimes teach the same real subject twice under two
/// names before realising it, and there was previously no way back from that short of manually
/// re-teaching one from scratch.
///
/// ⚠️ Refuses to merge across encoders, same as upsert_subject's own encoder guard — averaging
/// prototypes from two different feature spaces would silently produce a degenerate merged vector
/// rather than a visible error.
pub fn merge_subjects(keep_id: &str, other_id: &str) -> Result<Subject, String> {
    if keep_id == other_id {
        return Err("merge_subjects: cannot merge a subject with itself".into());
    }
    let path = subjects_path();
    let mut all = read_subjects_at(&path);
    let other = all
        .iter()
        .find(|s| s.id == other_id)
        .cloned()
        .ok_or_else(|| format!("merge_subjects: no subject {other_id}"))?;
    let keep_idx = all
        .iter()
        .position(|s| s.id == keep_id)
        .ok_or_else(|| format!("merge_subjects: no subject {keep_id}"))?;
    if all[keep_idx].encoder != other.encoder {
        return Err(format!(
            "merge_subjects: \"{}\" was taught with {} but \"{}\" was taught with {} — re-teach one to match before merging",
            all[keep_idx].name, all[keep_idx].encoder, other.name, other.encoder
        ));
    }
    for r in other.refs {
        if !all[keep_idx].refs.iter().any(|k| k.id == r.id) {
            all[keep_idx].refs.push(r);
        }
    }
    all[keep_idx].prototype = merge_all(&all[keep_idx].refs);
    let merged = all[keep_idx].clone();
    all.retain(|s| s.id != other_id);
    write_subjects_at(&path, &all)?;
    Ok(merged)
}

pub fn delete_subject(id: &str) -> Result<(), String> {
    let path = subjects_path();
    let mut all = read_subjects_at(&path);
    all.retain(|s| s.id != id);
    write_subjects_at(&path, &all)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn setup_model() {
        let dylib = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("vendor/onnxruntime/libonnxruntime.dylib");
        crate::sam::set_dylib_path(dylib);
    }

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
    }

    #[test]
    fn merge_all_weights_references_equally() {
        let r = |v: [f32; 3]| Reference { id: "x".into(), label: "x".into(), prototype: v.to_vec() };
        // Two references agreeing on one axis and one disagreeing: the majority must win, and
        // the order they were taught in must not matter (the property a running average lacked).
        let a = merge_all(&[r([1.0, 0.0, 0.0]), r([1.0, 0.0, 0.0]), r([0.0, 1.0, 0.0])]);
        let b = merge_all(&[r([0.0, 1.0, 0.0]), r([1.0, 0.0, 0.0]), r([1.0, 0.0, 0.0])]);
        assert!(a[0] > a[1], "majority axis should dominate: {a:?}");
        for (x, y) in a.iter().zip(&b) {
            assert!((x - y).abs() < 1e-6, "merge must not depend on teaching order: {a:?} vs {b:?}");
        }
        let unit = a.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((unit - 1.0).abs() < 1e-5, "merge must stay L2-normalised, got {unit}");
        assert!(merge_all(&[]).is_empty());
    }

    #[test]
    fn merge_weights_by_reference_count() {
        // Two references, then a third that disagrees: the merged prototype must stay closer to
        // the established pair than to the newcomer, which is the whole point of weighting.
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![0.0, 1.0, 0.0];
        let merged = merge_prototypes(&a, 3, &b);
        assert!(merged[0] > merged[1], "3 references should outweigh 1: {merged:?}");
        let unit = merged.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((unit - 1.0).abs() < 1e-5, "merge must stay L2-normalised, got {unit}");
        // An empty/absent existing prototype is replaced outright, not averaged toward zero.
        assert_eq!(merge_prototypes(&[0.0, 0.0, 0.0], 0, &b), b);
    }

    #[test]
    fn padded_cells_are_excluded() {
        // A 4000x6000 portrait: the resized image is 683x1024, so everything right of x=683 in the
        // 1024 canvas is padding — cells from fx=43 on. Getting this wrong is what would send the
        // negative point prompt into the zero padding on every portrait photo.
        let (iw, ih) = input_extent(4000, 6000);
        assert!((ih - 1024.0).abs() < 0.5, "longest side should map to SAM_SIZE, got {ih}");
        assert!(cell_is_image(42, 10, iw, ih), "cell 42 is inside a 683px-wide image");
        assert!(!cell_is_image(43, 10, iw, ih), "cell 43 centre (696px) is past the image edge");
        // And the mapping back out stays in range at the extremes.
        let (nx, ny) = cell_to_norm(0, 0, iw, ih);
        assert!(nx > 0.0 && nx < 0.05 && ny > 0.0 && ny < 0.05, "top-left cell → {nx},{ny}");
        let (nx, _) = cell_to_norm(42, 0, iw, ih);
        assert!(nx <= 1.0, "last image cell must not exceed 1.0, got {nx}");
    }

    #[test]
    fn feature_gather_is_channel_planar() {
        // Synthesise an embedding where cell (fx,fy)'s channel c holds a value encoding all three,
        // so a contiguous (wrong) read is distinguishable from a strided (right) one.
        let plane = (SAM_FEAT_GRID * SAM_FEAT_GRID) as usize;
        let mut data = vec![0f32; PROTO_DIM * plane];
        for c in 0..PROTO_DIM {
            for i in 0..plane {
                data[c * plane + i] = (c * 10_000 + i) as f32;
            }
        }
        let feat = feature_at(&data, 5, 3);
        let idx = (3 * SAM_FEAT_GRID + 5) as usize;
        for (c, &v) in feat.iter().enumerate() {
            assert_eq!(v, (c * 10_000 + idx) as f32, "channel {c} gathered from the wrong offset");
        }
    }

    /// Synthetic — no model or fixture photo needed. Two feature cells, far apart, are set exactly
    /// equal to the prototype (cosine 1.0); every other cell is left at zero (cosine 0, since
    /// l2_normalise leaves an all-zero vector as-is and cosine_prenormalised of a zero vector is
    /// 0). This is the "two instances of the same taught subject in one photo" case §5b/subject.rs
    /// flagged as unhandled by a plain argmax `locate()`.
    #[test]
    fn locate_topk_finds_distinct_instances_and_respects_min_distance() {
        let plane = (SAM_FEAT_GRID * SAM_FEAT_GRID) as usize;
        let mut data = vec![0f32; PROTO_DIM * plane];
        let mut prototype = vec![0f32; PROTO_DIM];
        prototype[0] = 1.0; // already unit-length
        let idx_a = (10 * SAM_FEAT_GRID + 10) as usize; // (fx=10,fy=10)
        let idx_b = (50 * SAM_FEAT_GRID + 50) as usize; // (fx=50,fy=50) — far corner
        data[0 * plane + idx_a] = 1.0;
        data[0 * plane + idx_b] = 1.0;
        let embed = Sam2Embedding { image_embed: data, high_res_feats_0: vec![], high_res_feats_1: vec![], orig_w: 1024, orig_h: 1024 };
        let grid = FeatureGrid::sam2(&embed);

        // Both peaks are ~57 cells apart, so a small min-distance keeps them both.
        let two = locate_topk(grid, &prototype, 4, 5).expect("locate_topk");
        assert_eq!(two.len(), 2, "two well-separated peaks should both survive: {two:?}");
        assert!(two.iter().all(|c| (c.score - 1.0).abs() < 1e-5), "both peaks should score ~1.0: {two:?}");

        // k=1 still returns exactly one, the (tied) best.
        let one = locate_topk(grid, &prototype, 1, 5).expect("locate_topk k=1");
        assert_eq!(one.len(), 1);

        // A min-distance larger than the actual separation collapses back to one instance — this
        // is the guard against reporting the same blob's neighbouring cells as separate subjects.
        let collapsed = locate_topk(grid, &prototype, 4, 100).expect("locate_topk large min-dist");
        assert_eq!(collapsed.len(), 1, "peaks closer than min_cell_dist must collapse to one: {collapsed:?}");
    }

    /// The real test, and the reason this module exists: __TM3390.jpg holds a person and a
    /// dark-brown dog whose fur CLAUDE.md §5b measured at 0.75 on a skin colour gate — i.e. colour
    /// cannot separate them. Learn the dog from a box over the dog, then locate it, and the match
    /// must land on the dog rather than on the person a few hundred pixels away.
    #[test]
    fn learned_dog_is_located_over_the_person() {
        setup_model();
        let path = repo_root().join("__TM3390.jpg");
        if !path.exists() {
            eprintln!("skipping: {} not present in this checkout", path.display());
            return;
        }
        let img = image::open(&path).expect("open __TM3390.jpg").to_rgb8();
        let (iw, ih) = img.dimensions();
        // Downsample the way the app does before encoding (the model resizes to 1024 regardless).
        let (sw, sh) = (iw / 8, ih / 8);
        let small = crate::sam::resize_rgb8(img.as_raw(), iw, ih, sw, sh);
        let embed = crate::sam::encode(&small, sw, sh).expect("EdgeSAM encode");

        // Subject regions as fractions of frame, read off the photo: the dog sits right of and
        // below the person's head, the person's face left of it.
        let frac_box = |x0: f32, y0: f32, x1: f32, y1: f32| {
            let mut m = vec![0u8; (sw * sh) as usize];
            for y in (y0 * sh as f32) as u32..(y1 * sh as f32) as u32 {
                for x in (x0 * sw as f32) as u32..(x1 * sw as f32) as u32 {
                    m[(y * sw + x) as usize] = 255;
                }
            }
            m
        };
        let dog_mask = frac_box(0.52, 0.58, 0.72, 0.78);
        let proto = learn(FeatureGrid::edgesam(&embed), &dog_mask).expect("learn dog prototype");
        assert_eq!(proto.len(), PROTO_DIM);

        let found = locate(FeatureGrid::edgesam(&embed), &proto).expect("locate dog");
        println!("dog located at ({:.3},{:.3}) score {:.3}", found.x, found.y, found.score);
        // Must land in the dog's half of the frame, not on the face at x≈0.35, y≈0.63.
        assert!(found.x > 0.45, "expected the dog side of frame, got x={:.3}", found.x);
        assert!(found.y > 0.45 && found.y < 0.9, "expected the dog's band, got y={:.3}", found.y);
        // Self-similarity on the photo it was learned from should be strong.
        assert!(found.score > 0.5, "self-match should be confident, got {:.3}", found.score);

        // The converse: a prototype learned from the FACE must not resolve to the dog. This is the
        // assertion that would fail if the features carried mostly colour, since both are brown.
        let face_mask = frac_box(0.25, 0.55, 0.45, 0.72);
        let face_proto = learn(FeatureGrid::edgesam(&embed), &face_mask).expect("learn face prototype");
        let face_found = locate(FeatureGrid::edgesam(&embed), &face_proto).expect("locate face");
        println!("face located at ({:.3},{:.3}) score {:.3}", face_found.x, face_found.y, face_found.score);
        assert!(face_found.x < 0.5, "face prototype drifted onto the dog: x={:.3}", face_found.x);

        // And the two prototypes must actually be distinguishable from each other.
        let cross = cosine_prenormalised(&proto, &face_proto);
        println!("dog·face prototype similarity {cross:.3}");
        assert!(cross < 0.95, "dog and face prototypes are nearly identical ({cross:.3})");
    }

    #[test]
    fn locate_rejects_a_wrong_sized_prototype() {
        let embed = Embedding { data: vec![0.0; PROTO_DIM * 64 * 64], orig_w: 100, orig_h: 100 };
        assert!(locate(FeatureGrid::edgesam(&embed), &[0.0; 8]).is_err(), "a short prototype must be rejected, not padded");
    }

    #[test]
    fn learn_rejects_a_mismatched_mask() {
        let embed = Embedding { data: vec![0.0; PROTO_DIM * 64 * 64], orig_w: 100, orig_h: 100 };
        let grid = FeatureGrid::edgesam(&embed);
        assert!(learn(grid, &[0u8; 99]).is_err(), "mask/embedding size mismatch must be caught");
        assert!(learn(grid, &[0u8; 10_000]).is_err(), "an all-zero mask has nothing to learn from");
    }

    #[test]
    fn persistence_round_trips_and_drops_foreign_encoders() {
        let dir = std::env::temp_dir().join(format!("cs_subjects_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("subjects.json");

        let mkref = |id: &str, v: f32| Reference { id: id.into(), label: id.into(), prototype: vec![v; PROTO_DIM] };
        let mine = Subject {
            id: "dog".into(),
            name: "Dog".into(),
            prototype: vec![0.5; PROTO_DIM],
            refs: vec![mkref("a.jpg", 0.5), mkref("b.jpg", 0.4)],
            encoder: ENC_EDGESAM.into(),
        };
        let foreign = Subject { encoder: "some-future-encoder".into(), ..mine.clone() };
        write_subjects_at(&path, &[mine.clone(), foreign.clone()]).unwrap();

        let back = read_subjects_at(&path);
        assert_eq!(back.len(), 2, "a foreign-encoder subject stays listed (it names real user work)");
        // ...but it must be refused at MATCH time rather than silently compared across spaces.
        let embed = Embedding { data: vec![0.0; PROTO_DIM * 64 * 64], orig_w: 100, orig_h: 100 };
        let grid = FeatureGrid::edgesam(&embed);
        assert!(locate_subject(grid, &mine).is_ok(), "same-encoder match should run");
        let err = locate_subject(grid, &foreign).unwrap_err();
        assert!(err.starts_with("encoder-mismatch:"), "frontend matches on this prefix, got: {err}");

        std::fs::remove_dir_all(&dir).ok();
    }
}
