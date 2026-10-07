//! Local MI-GAN erase jobs. Photos never leave this machine. Accepted assets live
//! beside their source and recipes hold hashes, not encoded image payloads.
use crate::sam::{check, create_session_from_path, ort_handle, SamSession};
use image::{ImageBuffer, Rgba};
use ort_sys::{ONNXTensorElementDataType as DType, OrtAllocatorType, OrtMemType, OrtValue};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};

pub const MODEL_SHA: &str = "6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b";
const MODEL_URL: &str = "https://huggingface.co/andraniksargsyan/migan/resolve/406830d0fa60666da0071c342ad2fbc8f30c5c64/migan_pipeline_v2.onnx";
const MODEL_BYTES: u64 = 28_079_181;
static ROOT: OnceLock<PathBuf> = OnceLock::new();
static SESSION: OnceLock<Mutex<SamSession>> = OnceLock::new();
pub fn set_root(path: PathBuf) {
    let _ = ROOT.set(path);
}
fn root() -> Result<&'static PathBuf, String> {
    ROOT.get().ok_or("Inpainting storage unavailable".into())
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn hash_file(path: &Path) -> Result<String, String> {
    let mut f = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}
fn assets(source: &Path) -> PathBuf {
    PathBuf::from(format!("{}.chroma-assets", source.to_string_lossy())).join("inpaint")
}
fn valid_hash(id: &str) -> bool {
    id.len() == 64 && id.bytes().all(|c| c.is_ascii_hexdigit())
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PatchRef {
    pub version: u8,
    pub asset: String,
    pub source_id: String,
    pub width: u32,
    pub height: u32,
    pub enabled: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub index: usize,
    pub path: String,
    pub hash: String,
    pub changed_pixels: usize,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub id: String,
    pub phase: String,
    pub done: usize,
    pub total: usize,
    pub error: Option<String>,
    pub candidates: Vec<Candidate>,
}
struct Job {
    report: Report,
    cancel: Arc<AtomicBool>,
    discarded: Arc<AtomicBool>,
    source: PathBuf,
    source_id: String,
    width: u32,
    height: u32,
}
static JOBS: OnceLock<Mutex<HashMap<String, Job>>> = OnceLock::new();
fn jobs() -> &'static Mutex<HashMap<String, Job>> {
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}
#[tauri::command(async)]
pub fn inpaint_model_status() -> Result<bool, String> {
    let p = root()?.join("migan_pipeline_v2.onnx");
    Ok(p.exists() && hash_file(&p)? == MODEL_SHA)
}
#[tauri::command(async)]
pub fn inpaint_model_install() -> Result<(), String> {
    let p = root()?.join("migan_pipeline_v2.onnx");
    if p.exists() && hash_file(&p)? == MODEL_SHA {
        return Ok(());
    }
    fs::create_dir_all(root()?).map_err(|e| e.to_string())?;
    let mut reader = ureq::get(MODEL_URL)
        .call()
        .map_err(|e| e.to_string())?
        .into_reader()
        .take(MODEL_BYTES + 1);
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 != MODEL_BYTES || digest(&bytes) != MODEL_SHA {
        return Err("Inpainting model integrity check failed".into());
    }
    let tmp = p.with_extension("download");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    if p.exists() {
        fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    fs::rename(tmp, p).map_err(|e| e.to_string())?;
    fs::write(
        root()?.join("LICENSE-MI-GAN.txt"),
        include_str!("../vendor/inpainting/LICENSE-MI-GAN.txt"),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Dedicated UINT8 runner: validates output dtype and length before reading the
/// byte buffer. The shared SAM helper returns f32 and cannot read this graph.
pub fn run_u8(
    sess: &Mutex<SamSession>,
    image: &mut [u8],
    mask: &mut [u8],
    w: u32,
    h: u32,
) -> Result<Vec<u8>, String> {
    let ort = ort_handle()?;
    let guard = sess.lock().map_err(|_| "Inpainting session poisoned")?;
    unsafe {
        let mut mem = std::ptr::null_mut();
        check(
            ort.api,
            ((*ort.api).CreateCpuMemoryInfo)(
                OrtAllocatorType::OrtArenaAllocator,
                OrtMemType::OrtMemTypeDefault,
                &mut mem,
            ),
            "inpaint memory",
        )?;
        let mut values: [*mut OrtValue; 2] = [std::ptr::null_mut(); 2];
        let mut out = std::ptr::null_mut();
        let result = (|| {
            for (i, (data, shape)) in [
                (image, &[1i64, 3, h as i64, w as i64][..]),
                (mask, &[1i64, 1, h as i64, w as i64][..]),
            ]
            .into_iter()
            .enumerate()
            {
                check(
                    ort.api,
                    ((*ort.api).CreateTensorWithDataAsOrtValue)(
                        mem,
                        data.as_mut_ptr().cast(),
                        data.len(),
                        shape.as_ptr(),
                        4,
                        DType::ONNX_TENSOR_ELEMENT_DATA_TYPE_UINT8,
                        &mut values[i],
                    ),
                    "inpaint tensor",
                )?;
            }
            let names = [c"image".as_ptr(), c"mask".as_ptr()];
            let output = [c"result".as_ptr()];
            check(
                ort.api,
                ((*ort.api).Run)(
                    guard.0,
                    std::ptr::null(),
                    names.as_ptr(),
                    values.as_ptr().cast(),
                    2,
                    output.as_ptr(),
                    1,
                    &mut out,
                ),
                "inpaint inference",
            )?;
            let mut info = std::ptr::null_mut();
            check(
                ort.api,
                ((*ort.api).GetTensorTypeAndShape)(out, &mut info),
                "inpaint shape",
            )?;
            let mut count = 0;
            let mut dtype = DType::ONNX_TENSOR_ELEMENT_DATA_TYPE_UNDEFINED;
            let validation: Result<(), String> = (|| {
                check(
                    ort.api,
                    ((*ort.api).GetTensorShapeElementCount)(info, &mut count),
                    "inpaint count",
                )?;
                check(
                    ort.api,
                    ((*ort.api).GetTensorElementType)(info, &mut dtype),
                    "inpaint type",
                )?;
                if dtype != DType::ONNX_TENSOR_ELEMENT_DATA_TYPE_UINT8
                    || count != w as usize * h as usize * 3
                {
                    return Err("Unexpected MI-GAN output shape/type".into());
                }
                Ok(())
            })();
            ((*ort.api).ReleaseTensorTypeAndShapeInfo)(info);
            validation?;
            let mut ptr = std::ptr::null_mut();
            check(
                ort.api,
                ((*ort.api).GetTensorMutableData)(out, &mut ptr),
                "inpaint output",
            )?;
            Ok(std::slice::from_raw_parts(ptr.cast::<u8>(), count).to_vec())
        })();
        for value in values {
            if !value.is_null() {
                ((*ort.api).ReleaseValue)(value);
            }
        }
        if !out.is_null() {
            ((*ort.api).ReleaseValue)(out);
        }
        ((*ort.api).ReleaseMemoryInfo)(mem);
        result
    }
}
fn session() -> Result<&'static Mutex<SamSession>, String> {
    if let Some(s) = SESSION.get() {
        return Ok(s);
    }
    let p = root()?.join("migan_pipeline_v2.onnx");
    if !p.exists() || hash_file(&p)? != MODEL_SHA {
        return Err("Install the verified MI-GAN erase model first".into());
    }
    let s = Mutex::new(create_session_from_path(&p)?);
    let _ = SESSION.set(s);
    Ok(SESSION.get().unwrap())
}
fn dilate(mask: &[u8], w: u32, h: u32, r: u32) -> Vec<u8> {
    if r == 0 {
        return mask.to_vec();
    }
    let mut horizontal = vec![255; mask.len()];
    let mut out = vec![255; mask.len()];
    for y in 0..h {
        let mut zeros = (0..=r.min(w - 1))
            .filter(|&x| mask[(y * w + x) as usize] == 0)
            .count();
        for x in 0..w {
            horizontal[(y * w + x) as usize] = if zeros > 0 { 0 } else { 255 };
            if x >= r && mask[(y * w + x - r) as usize] == 0 {
                zeros -= 1;
            }
            if x + r + 1 < w && mask[(y * w + x + r + 1) as usize] == 0 {
                zeros += 1;
            }
        }
    }
    for x in 0..w {
        let mut zeros = (0..=r.min(h - 1))
            .filter(|&y| horizontal[(y * w + x) as usize] == 0)
            .count();
        for y in 0..h {
            out[(y * w + x) as usize] = if zeros > 0 { 0 } else { 255 };
            if y >= r && horizontal[((y - r) * w + x) as usize] == 0 {
                zeros -= 1;
            }
            if y + r + 1 < h && horizontal[((y + r + 1) * w + x) as usize] == 0 {
                zeros += 1;
            }
        }
    }
    out
}
pub fn generate(
    rgb: &[u8],
    mask: &[u8],
    w: u32,
    h: u32,
    cancel: &AtomicBool,
    mut on_candidate: impl FnMut(usize, Vec<u8>) -> Result<(), String>,
) -> Result<(), String> {
    let n = w as usize * h as usize;
    if n == 0
        || n > 24_000_000
        || rgb.len() != n * 3
        || mask.len() != n
        || mask.iter().all(|&m| m == 255)
        || mask.iter().any(|&m| m != 0 && m != 255)
    {
        return Err("Expected full-resolution RGB source and non-empty binary mask".into());
    }
    let mut seen = Vec::new();
    for index in 0..6 {
        if cancel.load(Ordering::Relaxed) {
            return Err("Cancelled after current inference".into());
        }
        let radius = if index == 0 {
            0
        } else {
            ((w.max(h) as f64 / 512.0) * 4.0 * index as f64)
                .round()
                .max(1.0) as u32
        };
        let mut context = dilate(mask, w, h, radius);
        let mut planar = vec![0; n * 3];
        for i in 0..n {
            for c in 0..3 {
                planar[c * n + i] = rgb[i * 3 + c];
            }
        }
        let predicted = run_u8(session()?, &mut planar, &mut context, w, h)?;
        if cancel.load(Ordering::Relaxed) {
            return Err("Cancelled after current inference".into());
        }
        let mut rgba = vec![0; n * 4];
        for i in 0..n {
            if mask[i] == 0 {
                for c in 0..3 {
                    rgba[i * 4 + c] = predicted[c * n + i];
                }
                rgba[i * 4 + 3] = 255;
            }
        }
        let hash = digest(&rgba);
        if seen.contains(&hash) {
            continue;
        }
        seen.push(hash);
        on_candidate(seen.len() - 1, rgba)?;
        if seen.len() == 3 {
            return Ok(());
        }
    }
    Err("The model produced fewer than three distinct repairs; try a different mask or discard this attempt".into())
}
static WORKING: AtomicBool = AtomicBool::new(false);
pub fn start(
    source: PathBuf,
    rgb: Vec<u8>,
    mask: Vec<u8>,
    w: u32,
    h: u32,
) -> Result<Report, String> {
    if w as u64 * h as u64 > 24_000_000 {
        return Err("Local erase currently supports sources up to 24 megapixels".into());
    }
    let source_id = hash_file(&source)?;
    let id = format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let dir = root()?.join("jobs").join(&id);
    if WORKING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Another local erase job is running; cancel it or wait".into());
    }
    if let Err(e) = fs::create_dir_all(&dir) {
        WORKING.store(false, Ordering::SeqCst);
        return Err(e.to_string());
    }
    let report = Report {
        id: id.clone(),
        phase: "working".into(),
        done: 0,
        total: 3,
        error: None,
        candidates: Vec::new(),
    };
    let cancel = Arc::new(AtomicBool::new(false));
    let discarded = Arc::new(AtomicBool::new(false));
    let mut map = match jobs().lock() {
        Ok(map) => map,
        Err(_) => {
            WORKING.store(false, Ordering::SeqCst);
            return Err("Jobs unavailable".into());
        }
    };
    // Review belongs to one modal: opening a new job expires prior terminal previews.
    let expired: Vec<_> = map
        .iter()
        .filter(|(_, j)| j.report.phase != "working")
        .map(|(key, _)| key.clone())
        .collect();
    for key in expired {
        map.remove(&key);
        let _ = fs::remove_dir_all(root()?.join("jobs").join(key));
    }
    map.insert(
        id.clone(),
        Job {
            report: report.clone(),
            cancel: cancel.clone(),
            discarded: discarded.clone(),
            source,
            source_id,
            width: w,
            height: h,
        },
    );
    drop(map);
    std::thread::spawn(move || {
        let result = generate(&rgb, &mask, w, h, &cancel, |index, rgba| {
            let changed_pixels = rgba
                .chunks_exact(4)
                .enumerate()
                .filter(|(i, p)| p[3] != 0 && p[..3] != rgb[i * 3..i * 3 + 3])
                .count();
            let image = ImageBuffer::<Rgba<u8>, _>::from_raw(w, h, rgba)
                .ok_or("Invalid candidate pixels")?;
            let path = dir.join(format!("{index}.png"));
            image.save(&path).map_err(|e| e.to_string())?;
            let candidate = Candidate {
                index,
                path: path.to_string_lossy().into_owned(),
                hash: hash_file(&path)?,
                changed_pixels,
            };
            if let Ok(mut map) = jobs().lock() {
                if let Some(job) = map.get_mut(&id) {
                    job.report.done += 1;
                    job.report.candidates.push(candidate);
                }
            }
            Ok(())
        });
        if let Ok(mut map) = jobs().lock() {
            if discarded.load(Ordering::Relaxed) {
                map.remove(&id);
                let _ = fs::remove_dir_all(&dir);
            } else if let Some(job) = map.get_mut(&id) {
                job.report.phase = if cancel.load(Ordering::Relaxed) {
                    "cancelled"
                } else if result.is_ok() {
                    "review"
                } else {
                    "failed"
                }
                .into();
                job.report.error = result.err();
            }
        }
        WORKING.store(false, Ordering::SeqCst);
    });
    Ok(report)
}
#[tauri::command]
pub fn inpaint_discard(id: String) -> Result<(), String> {
    let mut map = jobs().lock().map_err(|_| "Jobs unavailable")?;
    let job = map.get(&id).ok_or("Unknown inpainting job")?;
    job.cancel.store(true, Ordering::Relaxed);
    job.discarded.store(true, Ordering::Relaxed);
    if job.report.phase != "working" {
        map.remove(&id);
        let directory = root()?.join("jobs").join(&id);
        fs::remove_dir_all(directory).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub fn inpaint_job(id: String) -> Result<Report, String> {
    jobs()
        .lock()
        .map_err(|_| "Jobs unavailable")?
        .get(&id)
        .map(|j| j.report.clone())
        .ok_or("Unknown inpainting job".into())
}
#[tauri::command]
pub fn inpaint_cancel(id: String) -> Result<(), String> {
    let jobs = jobs().lock().map_err(|_| "Jobs unavailable")?;
    let job = jobs.get(&id).ok_or("Unknown inpainting job")?;
    job.cancel.store(true, Ordering::Relaxed);
    Ok(())
}
#[tauri::command(async)]
pub fn inpaint_accept(id: String, index: usize) -> Result<PatchRef, String> {
    let jobs = jobs().lock().map_err(|_| "Jobs unavailable")?;
    let job = jobs.get(&id).ok_or("Unknown inpainting job")?;
    if job.report.phase != "review" {
        return Err("Wait for candidate generation to finish before keeping a repair".into());
    }
    if hash_file(&job.source)? != job.source_id {
        return Err("Source photo changed during review".into());
    }
    let candidate = job
        .report
        .candidates
        .iter()
        .find(|c| c.index == index)
        .ok_or("Unknown candidate")?;
    let bytes = fs::read(&candidate.path).map_err(|e| e.to_string())?;
    if digest(&bytes) != candidate.hash {
        return Err("Candidate integrity changed".into());
    }
    let dir = assets(&job.source);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let patch = PatchRef {
        version: 1,
        asset: candidate.hash.clone(),
        source_id: job.source_id.clone(),
        width: job.width,
        height: job.height,
        enabled: true,
    };
    fs::write(dir.join(format!("{}.png", patch.asset)), bytes).map_err(|e| e.to_string())?;
    fs::write(
        dir.join(format!("{}.json", patch.asset)),
        serde_json::to_vec_pretty(&patch).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(patch)
}
#[tauri::command(async)]
pub fn inpaint_resolve(source_path: String, patch: PatchRef) -> Result<String, String> {
    if patch.version != 1 || !valid_hash(&patch.asset) || !valid_hash(&patch.source_id) {
        return Err("Unsupported or invalid accepted patch reference".into());
    }
    let source = Path::new(&source_path);
    if hash_file(source)? != patch.source_id {
        return Err("Accepted repair belongs to a different/changed source photo".into());
    }
    let path = assets(source).join(format!("{}.png", patch.asset));
    if hash_file(&path).map_err(|e| {
        format!(
            "Accepted repair asset unavailable; restore the photo\'s .chroma-assets folder: {e}"
        )
    })? != patch.asset
    {
        return Err("Accepted repair asset is missing or corrupted; restore the photo's .chroma-assets folder".into());
    }
    let dimensions = image::image_dimensions(&path).map_err(|e| e.to_string())?;
    if dimensions != (patch.width, patch.height) {
        return Err("Accepted repair dimensions do not match its recipe".into());
    }
    Ok(path.to_string_lossy().into_owned())
}

pub fn export_bundle_files(
    source: &Path,
    patches: &[PatchRef],
    destination: &Path,
) -> Result<PathBuf, String> {
    if patches.is_empty() {
        return Err("No accepted repairs to export".into());
    }
    for patch in patches {
        inpaint_resolve(source.to_string_lossy().into_owned(), patch.clone())?;
    }
    let parent = fs::canonicalize(destination).map_err(|e| e.to_string())?;
    if !parent.is_dir() {
        return Err("Choose an existing destination folder".into());
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let directory = parent.join(format!("Chromasmith-repair-{stamp}"));
    fs::create_dir(&directory).map_err(|e| e.to_string())?;
    let copied = directory.join(source.file_name().ok_or("Source photo has no filename")?);
    fs::copy(source, &copied).map_err(|e| e.to_string())?;
    let output_assets = assets(&copied);
    fs::create_dir_all(&output_assets).map_err(|e| e.to_string())?;
    // Include historical/hidden patch assets too, so virtual copies and undo refs
    // in a copied sidecar remain portable. Never traverse directories or symlinks.
    for entry in fs::read_dir(assets(source)).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name();
        let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err("Repair assets must be ordinary files".into());
        }
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
        if !valid_hash(stem) || !matches!(ext, "png" | "json") {
            return Err("Unexpected file in accepted repair asset folder".into());
        }
        fs::copy(path, output_assets.join(name)).map_err(|e| e.to_string())?;
    }
    fs::write(directory.join("session-assets.json"),serde_json::to_vec_pretty(&serde_json::json!({"format":"chromasmith-repaired-photo","version":1,"source":copied.file_name().unwrap().to_string_lossy(),"patches":patches})).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    Ok(copied)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn context_dilation_matches_square_reference_at_edges() {
        for (w, h) in [(1, 1), (3, 8), (9, 4)] {
            for radius in [0, 1, 3, 12] {
                let mut mask = vec![255; (w * h) as usize];
                for i in 0..mask.len() {
                    if i % 7 == 0 {
                        mask[i] = 0;
                    }
                }
                let actual = dilate(&mask, w, h, radius);
                for y in 0..h {
                    for x in 0..w {
                        let expected =
                            if (y.saturating_sub(radius)..=(y + radius).min(h - 1)).any(|sy| {
                                (x.saturating_sub(radius)..=(x + radius).min(w - 1))
                                    .any(|sx| mask[(sy * w + sx) as usize] == 0)
                            }) {
                                0
                            } else {
                                255
                            };
                        assert_eq!(
                            actual[(y * w + x) as usize],
                            expected,
                            "{w}x{h}, r{radius}, ({x},{y})"
                        );
                    }
                }
            }
        }
    }
    #[test]
    fn bad_mask_and_cancellation_do_not_load_runtime() {
        let cancelled = AtomicBool::new(true);
        let mut callbacks = 0;
        assert!(generate(&[0; 12], &[255; 4], 2, 2, &cancelled, |_, _| {
            callbacks += 1;
            Ok(())
        })
        .unwrap_err()
        .contains("non-empty binary mask"));
        assert!(
            generate(&[0; 12], &[0, 255, 255, 255], 2, 2, &cancelled, |_, _| {
                callbacks += 1;
                Ok(())
            })
            .unwrap_err()
            .contains("Cancelled")
        );
        assert_eq!(callbacks, 0);
    }
    #[test]
    fn accepted_assets_are_source_bound_portable_and_integrity_checked() {
        let dir = std::env::temp_dir().join(format!(
            "chromasmith-inpaint-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&dir).unwrap();
        let source = dir.join("source.png");
        ImageBuffer::<Rgba<u8>, _>::from_pixel(3, 2, Rgba([11, 22, 33, 255]))
            .save(&source)
            .unwrap();
        let patch_file = dir.join("patch.png");
        ImageBuffer::<Rgba<u8>, _>::from_pixel(3, 2, Rgba([99, 44, 22, 255]))
            .save(&patch_file)
            .unwrap();
        let patch = PatchRef {
            version: 1,
            asset: hash_file(&patch_file).unwrap(),
            source_id: hash_file(&source).unwrap(),
            width: 3,
            height: 2,
            enabled: true,
        };
        fs::create_dir_all(assets(&source)).unwrap();
        let stored = assets(&source).join(format!("{}.png", patch.asset));
        fs::copy(&patch_file, &stored).unwrap();
        fs::write(
            assets(&source).join(format!("{}.json", patch.asset)),
            serde_json::to_vec(&patch).unwrap(),
        )
        .unwrap();
        assert_eq!(
            inpaint_resolve(source.to_string_lossy().into_owned(), patch.clone()).unwrap(),
            stored.to_string_lossy()
        );
        let copied = export_bundle_files(&source, &[patch.clone()], &dir).unwrap();
        assert!(inpaint_resolve(copied.to_string_lossy().into_owned(), patch.clone()).is_ok());
        assert_eq!(hash_file(&copied).unwrap(), patch.source_id);
        fs::write(&stored, b"corrupted").unwrap();
        assert!(
            inpaint_resolve(source.to_string_lossy().into_owned(), patch.clone())
                .unwrap_err()
                .contains("corrupted")
        );
        fs::remove_file(&stored).unwrap();
        assert!(
            inpaint_resolve(source.to_string_lossy().into_owned(), patch.clone())
                .unwrap_err()
                .contains("restore")
        );
        fs::write(&source, b"changed source").unwrap();
        assert!(
            inpaint_resolve(source.to_string_lossy().into_owned(), patch)
                .unwrap_err()
                .contains("different/changed source")
        );
        // Cleanup only the exact directory created by this test.
        fs::remove_dir_all(dir).unwrap();
    }
}
