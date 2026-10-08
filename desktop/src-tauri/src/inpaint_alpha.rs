/// Convert the dilated inpaint context into a smooth composite alpha. The
/// prediction is visible only in this bounded context halo, never farther out.
pub(crate) fn candidate_alpha(
    mask: &[u8],
    mut context: Vec<u8>,
    w: u32,
    h: u32,
    feather: u32,
) -> Vec<u8> {
    let n = context.len();
    let mut distance = vec![u8::MAX; n];
    for (i, &value) in mask.iter().enumerate() {
        if value == 0 {
            distance[i] = 0;
        }
    }
    // Two-pass 8-connected chamfer distance, saturated so work is bounded.
    for y in 0..h as usize {
        for x in 0..w as usize {
            let i = y * w as usize + x;
            if x > 0 {
                distance[i] = distance[i].min(distance[i - 1].saturating_add(1));
            }
            if y > 0 {
                distance[i] = distance[i].min(distance[i - w as usize].saturating_add(1));
                if x > 0 {
                    distance[i] = distance[i].min(distance[i - w as usize - 1].saturating_add(1));
                }
                if x + 1 < w as usize {
                    distance[i] = distance[i].min(distance[i - w as usize + 1].saturating_add(1));
                }
            }
        }
    }
    for y in (0..h as usize).rev() {
        for x in (0..w as usize).rev() {
            let i = y * w as usize + x;
            if x + 1 < w as usize {
                distance[i] = distance[i].min(distance[i + 1].saturating_add(1));
            }
            if y + 1 < h as usize {
                distance[i] = distance[i].min(distance[i + w as usize].saturating_add(1));
                if x > 0 {
                    distance[i] = distance[i].min(distance[i + w as usize - 1].saturating_add(1));
                }
                if x + 1 < w as usize {
                    distance[i] = distance[i].min(distance[i + w as usize + 1].saturating_add(1));
                }
            }
        }
    }
    let feather = feather.clamp(1, 254) as f32;
    for i in 0..n {
        context[i] = if context[i] != 0 {
            0
        } else if mask[i] == 0 {
            255
        } else {
            let t = ((feather - distance[i] as f32) / feather).clamp(0.0, 1.0);
            (255.0 * t * t * (3.0 - 2.0 * t)).round() as u8
        };
    }
    context
}

#[cfg(test)]
mod tests {
    use super::candidate_alpha;

    fn dilate(mask: &[u8], w: u32, h: u32, radius: u32) -> Vec<u8> {
        (0..h)
            .flat_map(|y| {
                (0..w).map(move |x| {
                    let has_mask = (y.saturating_sub(radius)..=(y + radius).min(h - 1)).any(|sy| {
                        (x.saturating_sub(radius)..=(x + radius).min(w - 1))
                            .any(|sx| mask[(sy * w + sx) as usize] == 0)
                    });
                    if has_mask {
                        0
                    } else {
                        255
                    }
                })
            })
            .collect()
    }

    #[test]
    fn alpha_is_smooth_and_confined_to_context() {
        let (w, h) = (9, 9);
        let mut mask = vec![255; (w * h) as usize];
        for y in 3..6 {
            for x in 3..6 {
                mask[(y * w + x) as usize] = 0;
            }
        }
        let alpha = candidate_alpha(&mask, dilate(&mask, w, h, 2), w, h, 2);
        assert_eq!(alpha[(4 * w + 4) as usize], 255);
        assert_eq!(alpha[(3 * w + 3) as usize], 255);
        assert!(alpha[(2 * w + 4) as usize] > 0 && alpha[(2 * w + 4) as usize] < 255);
        assert_eq!(alpha[(1 * w + 4) as usize], 0);
        assert_eq!(alpha[(0 * w + 0) as usize], 0);
    }
}
