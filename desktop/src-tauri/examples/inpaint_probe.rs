#[path = "../src/inpaint.rs"]
mod inpaint;
#[path = "../src/platform/mod.rs"]
mod platform;
#[path = "../src/sam.rs"]
mod sam;

#[derive(Debug, PartialEq)]
struct RgbChangeStats {
    pixels: usize,
    changed_pixels: usize,
    mean_absolute_channel_delta: f64,
    max_absolute_channel_delta: u8,
}

#[derive(Debug, PartialEq)]
struct CandidateDiagnostics {
    mask_pixels: usize,
    mask_coverage_percent: f64,
    masked_rgb_change: RgbChangeStats,
    nearby_unmasked_halo_rgb_change: RgbChangeStats,
    changed_pixels_outside_mask: usize,
}

/// Descriptive image-difference measurements for a candidate. These are diagnostics, not a
/// perceptual quality score. The nearby halo is the 8-connected, one-pixel unmasked boundary.
fn candidate_diagnostics(
    before: &[u8],
    after: &[u8],
    mask: &[u8],
    width: u32,
    height: u32,
) -> CandidateDiagnostics {
    assert_eq!(before.len() % 3, 0);
    let pixel_count = before.len() / 3;
    assert_eq!(after.len(), before.len());
    assert_eq!(mask.len(), pixel_count);
    assert_eq!(pixel_count, width as usize * height as usize);

    let mask_pixels = mask.iter().filter(|&&value| value == 0).count();
    let mut halo = vec![false; pixel_count];
    let mut changed_pixels_outside_mask = 0;
    for index in 0..pixel_count {
        let is_masked = mask[index] == 0;
        if !is_masked {
            if before[index * 3..index * 3 + 3] != after[index * 3..index * 3 + 3] {
                changed_pixels_outside_mask += 1;
            }
            continue;
        }
        let x = index % width as usize;
        let y = index / width as usize;
        for dy in -1_i32..=1 {
            for dx in -1_i32..=1 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let nx = x as i32 + dx;
                let ny = y as i32 + dy;
                if nx >= 0 && ny >= 0 && nx < width as i32 && ny < height as i32 {
                    let neighbor = ny as usize * width as usize + nx as usize;
                    if mask[neighbor] != 0 {
                        halo[neighbor] = true;
                    }
                }
            }
        }
    }

    let masked_rgb_change = rgb_change_stats(before, after, mask.iter().map(|&value| value == 0));
    let nearby_unmasked_halo_rgb_change = rgb_change_stats(before, after, halo.into_iter());
    CandidateDiagnostics {
        mask_pixels,
        mask_coverage_percent: if pixel_count == 0 {
            0.0
        } else {
            mask_pixels as f64 * 100.0 / pixel_count as f64
        },
        masked_rgb_change,
        nearby_unmasked_halo_rgb_change,
        changed_pixels_outside_mask,
    }
}

fn rgb_change_stats(
    before: &[u8],
    after: &[u8],
    selected: impl IntoIterator<Item = bool>,
) -> RgbChangeStats {
    let mut pixels = 0;
    let mut changed_pixels = 0;
    let mut total_delta = 0_u64;
    let mut max_absolute_channel_delta = 0_u8;
    for (index, selected) in selected.into_iter().enumerate() {
        if !selected {
            continue;
        }
        pixels += 1;
        let mut pixel_changed = false;
        for channel in 0..3 {
            let delta = before[index * 3 + channel].abs_diff(after[index * 3 + channel]);
            total_delta += u64::from(delta);
            max_absolute_channel_delta = max_absolute_channel_delta.max(delta);
            pixel_changed |= delta != 0;
        }
        changed_pixels += usize::from(pixel_changed);
    }
    RgbChangeStats {
        pixels,
        changed_pixels,
        mean_absolute_channel_delta: if pixels == 0 {
            0.0
        } else {
            total_delta as f64 / (pixels * 3) as f64
        },
        max_absolute_channel_delta,
    }
}

#[cfg(test)]
mod diagnostics_tests {
    use super::candidate_diagnostics;

    #[test]
    fn reports_masked_changes_halo_and_outside_changes_separately() {
        let before = vec![0_u8; 5 * 5 * 3];
        let mut after = before.clone();
        after[12 * 3..12 * 3 + 3].copy_from_slice(&[10, 10, 10]); // masked center
        after[7 * 3..7 * 3 + 3].copy_from_slice(&[3, 0, 0]); // unmasked halo
        after[0..3].copy_from_slice(&[0, 0, 1]); // outside the halo
        let mut mask = vec![255_u8; 25];
        mask[12] = 0;

        let result = candidate_diagnostics(&before, &after, &mask, 5, 5);
        assert_eq!(result.mask_pixels, 1);
        assert!((result.mask_coverage_percent - 4.0).abs() < 1e-10);
        assert_eq!(result.masked_rgb_change.pixels, 1);
        assert_eq!(result.masked_rgb_change.changed_pixels, 1);
        assert_eq!(result.masked_rgb_change.mean_absolute_channel_delta, 10.0);
        assert_eq!(result.masked_rgb_change.max_absolute_channel_delta, 10);
        assert_eq!(result.nearby_unmasked_halo_rgb_change.pixels, 8);
        assert_eq!(result.nearby_unmasked_halo_rgb_change.changed_pixels, 1);
        assert_eq!(
            result
                .nearby_unmasked_halo_rgb_change
                .mean_absolute_channel_delta,
            0.125
        );
        assert_eq!(
            result
                .nearby_unmasked_halo_rgb_change
                .max_absolute_channel_delta,
            3
        );
        assert_eq!(result.changed_pixels_outside_mask, 2);
    }

    #[test]
    fn empty_mask_has_zero_coverage_and_no_halo() {
        let result = candidate_diagnostics(&[0; 12], &[0; 12], &[255; 4], 2, 2);
        assert_eq!(result.mask_pixels, 0);
        assert_eq!(result.mask_coverage_percent, 0.0);
        assert_eq!(result.nearby_unmasked_halo_rgb_change.pixels, 0);
        assert_eq!(result.changed_pixels_outside_mask, 0);
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    assert_eq!(
        args.len() == 5 || args.len() == 6 || args.len() == 9,
        "inpaint_probe <ORT dll/dylib> <model-directory> <photo> <output-directory> [mask-polygon.json | mask-x0 mask-y0 mask-x1 mask-y1 (0..1000)]"
    );
    sam::set_dylib_path(args[1].clone().into());
    inpaint::set_root(args[2].clone().into());
    let rgb = image::open(&args[3]).unwrap().to_rgb8();
    let (w, h) = rgb.dimensions();
    let mut mask = vec![255; w as usize * h as usize];
    if args.len() == 6 {
        let polygon: Vec<[u32; 2]> =
            serde_json::from_slice(&std::fs::read(&args[5]).expect("read normalized mask polygon"))
                .expect("mask polygon must be a JSON array of [x,y] points");
        assert!(
            polygon.len() >= 3,
            "mask polygon needs at least three points"
        );
        assert!(
            polygon.iter().all(|p| p[0] <= 1000 && p[1] <= 1000),
            "mask coordinates must be 0..1000"
        );
        let scale = |point: u32, dimension: u32| ((point as u64 * dimension as u64) / 1000) as u32;
        let x0 = scale(polygon.iter().map(|p| p[0]).min().unwrap(), w);
        let x1 = scale(polygon.iter().map(|p| p[0]).max().unwrap(), w).min(w - 1);
        let y0 = scale(polygon.iter().map(|p| p[1]).min().unwrap(), h);
        let y1 = scale(polygon.iter().map(|p| p[1]).max().unwrap(), h).min(h - 1);
        for y in y0..=y1 {
            for x in x0..=x1 {
                let (px, py) = (
                    (x as f64 + 0.5) * 1000.0 / w as f64,
                    (y as f64 + 0.5) * 1000.0 / h as f64,
                );
                let mut inside = false;
                let mut j = polygon.len() - 1;
                for i in 0..polygon.len() {
                    let (xi, yi) = (polygon[i][0] as f64, polygon[i][1] as f64);
                    let (xj, yj) = (polygon[j][0] as f64, polygon[j][1] as f64);
                    if (yi > py) != (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi {
                        inside = !inside;
                    }
                    j = i;
                }
                if inside {
                    mask[(y * w + x) as usize] = 0;
                }
            }
        }
    } else {
        let rect = if args.len() == 9 {
            let values: Vec<u32> = args[5..9]
                .iter()
                .map(|value| value.parse().expect("mask coordinates must be integers"))
                .collect();
            (values[0], values[1], values[2], values[3])
        } else {
            (300, 460, 330, 790)
        };
        assert!(rect.0 < rect.2 && rect.1 < rect.3 && rect.2 <= 1000 && rect.3 <= 1000);
        let scale = |point: u32, dimension: u32| ((point as u64 * dimension as u64) / 1000) as u32;
        for y in scale(rect.1, h)..scale(rect.3, h) {
            for x in scale(rect.0, w)..scale(rect.2, w) {
                mask[(y * w + x) as usize] = 0;
            }
        }
    }
    let source_before = rgb.clone();
    let mask_pixels = mask.iter().filter(|&&value| value == 0).count();
    println!(
        "DIAGNOSTIC ONLY (not a quality score): mask covers {mask_pixels} of {} pixels ({:.4}%)",
        mask.len(),
        if mask.is_empty() {
            0.0
        } else {
            mask_pixels as f64 * 100.0 / mask.len() as f64
        }
    );
    let mut seen = Vec::new();
    let cancel = std::sync::atomic::AtomicBool::new(false);
    std::fs::create_dir_all(&args[4]).unwrap();
    let started = std::time::Instant::now();
    inpaint::generate(rgb.as_raw(),&mask,w,h,&cancel,|index,pixels|{
        let mut composite=source_before.clone();let mut changed=0;for i in 0..mask.len(){if pixels[i*4+3]>0{assert_eq!(mask[i],0);let x=(i%w as usize)as u32;let y=(i/w as usize)as u32;let p=image::Rgb([pixels[i*4],pixels[i*4+1],pixels[i*4+2]]);if composite.get_pixel(x,y)!=&p{changed+=1;}composite.put_pixel(x,y,p);}}
        let diagnostics = candidate_diagnostics(source_before.as_raw(), composite.as_raw(), &mask, w, h);
        assert_eq!(diagnostics.changed_pixels_outside_mask, 0, "source pixels outside mask must remain untouched");
        let hash=blake3::hash(composite.as_raw()).to_string();assert!(!seen.contains(&hash));seen.push(hash.clone());assert!(changed>0);
        composite.save(std::path::Path::new(&args[4]).join(format!("candidate-{index}.png"))).map_err(|e|e.to_string())?;
        println!("DIAGNOSTIC ONLY (not a quality score): candidate {index}: mask={} ({:.4}%), masked RGB changed={}/{}, mean abs channel delta={:.3}, max channel delta={}, nearby unmasked halo changed={}/{}, mean abs channel delta={:.3}, max channel delta={}, changed outside mask={}, hash {hash}, elapsed {:?}", diagnostics.mask_pixels, diagnostics.mask_coverage_percent, diagnostics.masked_rgb_change.changed_pixels, diagnostics.masked_rgb_change.pixels, diagnostics.masked_rgb_change.mean_absolute_channel_delta, diagnostics.masked_rgb_change.max_absolute_channel_delta, diagnostics.nearby_unmasked_halo_rgb_change.changed_pixels, diagnostics.nearby_unmasked_halo_rgb_change.pixels, diagnostics.nearby_unmasked_halo_rgb_change.mean_absolute_channel_delta, diagnostics.nearby_unmasked_halo_rgb_change.max_absolute_channel_delta, diagnostics.changed_pixels_outside_mask, started.elapsed());Ok(())
    }).expect("real native MI-GAN inference");
    assert_eq!(seen.len(), 3);
    println!(
        "PASS native MI-GAN CPU: three distinct mask-context candidates, source untouched, {:?}",
        started.elapsed()
    );
}
