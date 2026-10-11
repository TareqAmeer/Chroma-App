#[path = "../src/inpaint.rs"]
mod inpaint;
#[path = "../src/inpaint_alpha.rs"]
mod inpaint_alpha;
#[path = "../src/platform/mod.rs"]
mod platform;
#[path = "../src/sam.rs"]
mod sam;
#[path = "../src/trash_undo.rs"]
mod trash_undo;

fn main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    if !(args.len() == 5 || args.len() == 6) {
        return Err("usage: inpaint_probe <ORT dll/dylib> <model-directory> <photo> <output-directory> [mask-image] (black=erase, white=preserve)".into());
    }
    sam::set_dylib_path(args[1].clone().into());
    inpaint::set_root(args[2].clone().into());

    let rgb = image::open(&args[3]).map_err(|e| e.to_string())?.to_rgb8();
    let (w, h) = rgb.dimensions();
    let mask = if let Some(mask_path) = args.get(5) {
        let image = image::open(mask_path)
            .map_err(|e| e.to_string())?
            .to_luma8();
        if image.dimensions() != (w, h) {
            return Err(format!(
                "mask dimensions {:?} do not match source dimensions ({w}, {h})",
                image.dimensions()
            ));
        }
        image
            .into_raw()
            .into_iter()
            .map(|value| if value < 128 { 0 } else { 255 })
            .collect()
    } else {
        let mut mask = vec![255; w as usize * h as usize];
        for y in (h * 46 / 100)..(h * 79 / 100) {
            for x in (w * 30 / 100)..(w * 33 / 100) {
                mask[(y * w + x) as usize] = 0;
            }
        }
        mask
    };
    let painted = mask.iter().filter(|&&value| value == 0).count();
    if painted == 0 {
        return Err("mask has no erase pixels (black pixels are erased)".into());
    }

    let output = std::path::Path::new(&args[4]);
    std::fs::create_dir_all(output).map_err(|e| e.to_string())?;
    rgb.save(output.join("source.png"))
        .map_err(|e| e.to_string())?;
    image::GrayImage::from_raw(w, h, mask.clone())
        .ok_or("could not construct mask image")?
        .save(output.join("mask.png"))
        .map_err(|e| e.to_string())?;

    let mut candidates: Vec<image::RgbImage> = Vec::new();
    let mut hashes = Vec::new();
    let cancel = std::sync::atomic::AtomicBool::new(false);
    let started = std::time::Instant::now();
    inpaint::generate(rgb.as_raw(), &mask, w, h, &cancel, |index, pixels| {
        if pixels.len() != mask.len() * 4 {
            return Err(format!("candidate {index} has an unexpected pixel buffer length"));
        }
        let mut composite = rgb.clone();
        let mut changed_in_mask = 0usize;
        for i in 0..mask.len() {
            let alpha = pixels[i * 4 + 3];
            if alpha > 0 {
                if mask[i] != 0 {
                    return Err(format!("candidate {index} modified a pixel outside the mask at index {i}"));
                }
                let pixel = image::Rgb([pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]]);
                let x = (i % w as usize) as u32;
                let y = (i / w as usize) as u32;
                if composite.get_pixel(x, y) != &pixel {
                    changed_in_mask += 1;
                }
                composite.put_pixel(x, y, pixel);
            }
        }
        if changed_in_mask == 0 {
            return Err(format!("candidate {index} did not change any masked pixels"));
        }
        let hash = blake3::hash(composite.as_raw()).to_string();
        if hashes.contains(&hash) {
            return Err(format!("candidate {index} duplicates an earlier composite"));
        }
        composite.save(output.join(format!("candidate-{index}.png"))).map_err(|e| e.to_string())?;
        hashes.push(hash);
        candidates.push(composite);
        println!("candidate {index}: changed {changed_in_mask}/{painted} masked pixels; outside-mask pixels identical; elapsed {:?}", started.elapsed());
        Ok(())
    }).map_err(|e| format!("native MI-GAN inference failed: {e}"))?;
    if candidates.len() != 3 {
        return Err(format!("expected 3 candidates, got {}", candidates.len()));
    }

    let mut measurements = String::from("candidate,blake3,masked_changed_pixels,masked_pixels\n");
    for (i, candidate) in candidates.iter().enumerate() {
        let changed = candidate
            .pixels()
            .zip(rgb.pixels())
            .enumerate()
            .filter(|(pixel_index, (a, b))| mask[*pixel_index] == 0 && a != b)
            .count();
        measurements.push_str(&format!("{i},{},{changed},{painted}\n", hashes[i]));
    }
    measurements.push_str("pairwise_mean_rgb_delta_on_mask,\n");
    for a in 0..candidates.len() {
        for b in (a + 1)..candidates.len() {
            let sum: u64 = candidates[a]
                .pixels()
                .zip(candidates[b].pixels())
                .enumerate()
                .filter(|(pixel_index, _)| mask[*pixel_index] == 0)
                .map(|(_, (left, right))| {
                    left.0
                        .iter()
                        .zip(right.0.iter())
                        .map(|(x, y)| x.abs_diff(*y) as u64)
                        .sum::<u64>()
                })
                .sum();
            measurements.push_str(&format!(
                "candidate-{a}-vs-{b},{:.4},,\n",
                sum as f64 / (painted * 3) as f64
            ));
        }
    }
    std::fs::write(output.join("measurements.csv"), measurements).map_err(|e| e.to_string())?;
    std::fs::write(output.join("review.md"), format!(
        "# Inpainting visual review\n\nSource: `source.png`  \nMask: `mask.png` (black pixels are erased)  \nMasked pixels: {painted}  \n\nMeasurements in `measurements.csv` verify containment, changed pixels, hashes, and pairwise differences. They do not establish visual quality.\n\n| Candidate | Review at 100% | Repeating pattern? | Colour shift? | Smearing/semantic damage? | Reviewer notes |\n|---|---|---|---|---|---|\n| 0 | Pending | Pending | Pending | Pending | |\n| 1 | Pending | Pending | Pending | Pending | |\n| 2 | Pending | Pending | Pending | Pending | |\n\nDo not mark quality acceptance until each candidate is reviewed against the source at 100%.\n"
    )).map_err(|e| e.to_string())?;
    println!("PASS native MI-GAN: three distinct candidates; {painted} erased pixels; source, mask, measurements and pending review receipt saved to {} ({:?})", output.display(), started.elapsed());
    Ok(())
}
