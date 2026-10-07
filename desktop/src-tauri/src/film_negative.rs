//! Pure RGB math for a RawTherapee-style film-negative response curve.
//!
//! Native RAW development connects this module before the DCP/display transform. Callers must
//! supply non-negative, pre-display floating-point RGB values and calibration references in the
//! same color coordinates, transfer domain, and numeric scale. In particular, display-encoded
//! sRGB bytes are not valid inputs. The operator has no profile knowledge and cannot linearize
//! samples itself.
//!
//! RawTherapee 5.12's `rtengine/filmnegativeproc.cc` maps each reference input channel to its
//! corresponding reference output with a negative power response. Its so-called film base is
//! a sampled reference point; the algorithm does **not** subtract a per-pixel film-base offset.
//! For channel C, with positive exponent magnitude pC, the operation is
//!
//! `outC = refOutC * (inC / max(refInC, floor)) ^ -pC` for `inC > 0`
//!
//! where `pG = green_exponent`, `pR = green_exponent * red_ratio`, and
//! `pB = green_exponent * blue_ratio`. This ratio form is algebraically equivalent to
//! RawTherapee's `multiplier * pow(input, negative_exponent)` calculation, but avoids creating
//! very large intermediate multipliers. The default floor of 1.0 follows RawTherapee's
//! reference-input floor in its native signal scale; callers using another scale must choose a
//! corresponding floor. Positive pixel samples are never floored. A zero pixel sample reaches
//! the singular limit of a negative power and is clipped to `max_output`, as it would be in a
//! finite-range pipeline.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rgb {
    pub r: f64,
    pub g: f64,
    pub b: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FilmNegativeParams {
    /// Sampled calibration input RGB (“film base” reference); no offset is subtracted.
    pub reference_input: Rgb,
    /// Desired positive RGB corresponding to `reference_input`.
    pub reference_output: Rgb,
    /// Positive magnitude for the green channel's inverse-response exponent.
    pub green_exponent: f64,
    /// Red exponent relative to the green reference exponent.
    pub red_ratio: f64,
    /// Blue exponent relative to the green reference exponent.
    pub blue_ratio: f64,
    /// Lower bound used for pixel and reference inputs, expressed in their shared signal scale.
    pub input_floor: f64,
    /// Maximum representable output in the shared signal scale.
    pub max_output: f64,
}

impl Default for FilmNegativeParams {
    fn default() -> Self {
        Self {
            reference_input: Rgb {
                r: 1.0,
                g: 1.0,
                b: 1.0,
            },
            reference_output: Rgb {
                r: 1.0,
                g: 1.0,
                b: 1.0,
            },
            green_exponent: 1.5,
            red_ratio: 2.04 / 1.5,
            blue_ratio: 1.29 / 1.5,
            input_floor: 1.0,
            max_output: 65_535.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FilmNegativeError {
    NonFiniteValue,
    NegativePixel,
    NegativeReference,
    InvalidExponent,
    InvalidInputFloor,
    InvalidOutputRange,
}

fn finite_rgb(rgb: Rgb) -> bool {
    rgb.r.is_finite() && rgb.g.is_finite() && rgb.b.is_finite()
}

fn channel(
    input: f64,
    reference_input: f64,
    reference_output: f64,
    exponent: f64,
    params: FilmNegativeParams,
) -> f64 {
    if reference_output == 0.0 {
        return 0.0;
    }
    if input == 0.0 {
        return params.max_output;
    }
    let reference = reference_input.max(params.input_floor);
    let ratio = input / reference;
    let value = reference_output * (-exponent * ratio.ln()).exp();
    if !value.is_finite() || value >= params.max_output {
        params.max_output
    } else {
        value.max(0.0)
    }
}

/// Apply the negative-response conversion to one RGB sample.
///
/// Disabled processing is an exact identity and intentionally bypasses parameter validation.
pub fn apply_pixel(
    pixel: Rgb,
    params: FilmNegativeParams,
    enabled: bool,
) -> Result<Rgb, FilmNegativeError> {
    if !enabled {
        return Ok(pixel);
    }

    if !finite_rgb(pixel)
        || !finite_rgb(params.reference_input)
        || !finite_rgb(params.reference_output)
        || !params.green_exponent.is_finite()
        || !params.red_ratio.is_finite()
        || !params.blue_ratio.is_finite()
        || !params.input_floor.is_finite()
        || !params.max_output.is_finite()
    {
        return Err(FilmNegativeError::NonFiniteValue);
    }
    if pixel.r < 0.0 || pixel.g < 0.0 || pixel.b < 0.0 {
        return Err(FilmNegativeError::NegativePixel);
    }
    if params.reference_input.r < 0.0
        || params.reference_input.g < 0.0
        || params.reference_input.b < 0.0
        || params.reference_output.r < 0.0
        || params.reference_output.g < 0.0
        || params.reference_output.b < 0.0
    {
        return Err(FilmNegativeError::NegativeReference);
    }
    if params.green_exponent <= 0.0 || params.red_ratio <= 0.0 || params.blue_ratio <= 0.0 {
        return Err(FilmNegativeError::InvalidExponent);
    }
    if params.input_floor <= 0.0 {
        return Err(FilmNegativeError::InvalidInputFloor);
    }
    if params.max_output <= 0.0
        || params.reference_output.r > params.max_output
        || params.reference_output.g > params.max_output
        || params.reference_output.b > params.max_output
    {
        return Err(FilmNegativeError::InvalidOutputRange);
    }

    Ok(Rgb {
        r: channel(
            pixel.r,
            params.reference_input.r,
            params.reference_output.r,
            params.green_exponent * params.red_ratio,
            params,
        ),
        g: channel(
            pixel.g,
            params.reference_input.g,
            params.reference_output.g,
            params.green_exponent,
            params,
        ),
        b: channel(
            pixel.b,
            params.reference_input.b,
            params.reference_output.b,
            params.green_exponent * params.blue_ratio,
            params,
        ),
    })
}

/// Convert native camera-linear u16 RGB without altering the cached negative source.
/// Parameters use normalized 0..1 camera values, sampled before the same display transform.
pub fn convert_rgb16(source: &[u16], reference: [f64; 3], exponents: [f64; 3], out: f64, bw: bool) -> Result<Vec<u16>, String> {
    if source.len() % 3 != 0 { return Err("film negative: incomplete RGB pixel".into()); }
    let params = FilmNegativeParams {
        reference_input: Rgb { r: reference[0], g: reference[1], b: reference[2] },
        reference_output: Rgb { r: out, g: out, b: out },
        green_exponent: exponents[1], red_ratio: exponents[0] / exponents[1], blue_ratio: exponents[2] / exponents[1],
        input_floor: 1.0 / 65535.0, max_output: 1.0,
    };
    // Validate before allocating output, including the empty-frame case.
    apply_pixel(Rgb { r: 1.0, g: 1.0, b: 1.0 }, params, true).map_err(|e| format!("film negative: {e:?}"))?;
    // Bounded per-channel tables replace tens of millions of powers at 24 MP.
    let tables: Vec<Vec<u16>> = (0..3).map(|c| (0..=65535).map(|v| {
        (channel(v as f64 / 65535.0, reference[c], out, exponents[c], params) * 65535.0).round() as u16
    }).collect()).collect();
    let converted = source.iter().enumerate().map(|(i,v)| tables[i % 3][*v as usize]).collect();
    // B&W collapses after the camera transform in main.rs, not in camera primaries.
    let _ = bw;
    Ok(converted)
}

/// Uniform rebate sampler, in oriented native image coordinates, before any display transform.
pub fn sample_rgb16(source: &[u16], w: usize, h: usize, nx: f64, ny: f64) -> Result<([f64; 3], usize), String> {
    if w == 0 || h == 0 || w.checked_mul(h).and_then(|n| n.checked_mul(3)) != Some(source.len()) {
        return Err("film base: invalid native dimensions".into());
    }
    if !nx.is_finite() || !ny.is_finite() || !(0.0..1.0).contains(&nx) || !(0.0..1.0).contains(&ny) {
        return Err("film base: point outside source".into());
    }
    let cx = (nx * w as f64) as usize; let cy = (ny * h as f64) as usize;
    let radius = ((w.min(h) as f64 * 0.01).round() as usize).clamp(4, 24);
    let mut sum = [0.0; 3]; let mut squares = [0.0; 3]; let mut n = 0;
    for y in cy.saturating_sub(radius)..(cy + radius + 1).min(h) {
        for x in cx.saturating_sub(radius)..(cx + radius + 1).min(w) {
            for c in 0..3 { let v = source[(y * w + x) * 3 + c] as f64 / 65535.0; sum[c] += v; squares[c] += v * v; }
            n += 1;
        }
    }
    let mean = sum.map(|v| v / n as f64);
    if mean.iter().any(|v| *v > 0.985 || *v < 0.02) { return Err("film base: clipped or nearly black native rebate; rescan or pick a clean patch".into()); }
    if (0..3).any(|c| ((squares[c] / n as f64 - mean[c] * mean[c]).max(0.0)).sqrt() / mean[c] > 0.12) {
        return Err("film base: non-uniform native rebate".into());
    }
    Ok((mean, n))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_table_matches_scalar_at_dark_and_bright_samples() {
        let reference = [0.8, 0.5, 0.3]; let exponents = [2.04, 1.5, 1.29];
        let source = vec![0, 1, 65535, 12000, 18000, 24000, 52000, 33000, 20000];
        let result = convert_rgb16(&source, reference, exponents, 0.02, false).unwrap();
        for (i, value) in source.iter().enumerate() {
            let expected = if *value == 0 { 65535 } else { (0.02 * (*value as f64 / 65535.0 / reference[i % 3]).powf(-exponents[i % 3]) * 65535.0).clamp(0.0, 65535.0).round() as u16 };
            assert_eq!(result[i], expected);
        }
        assert_eq!(source[3], 12000, "cached negative must stay untouched");
    }

    #[test]
    fn native_sampler_uses_original_coordinates_and_rejects_clip() {
        let mut source = vec![30000; 30 * 20 * 3];
        for y in 0..20 { for x in 15..30 { for c in 0..3 { source[(y * 30 + x) * 3 + c] = 65535; } } }
        let (rgb, count) = sample_rgb16(&source, 30, 20, 0.1, 0.5).unwrap();
        assert!(rgb.iter().all(|v| (*v - 30000.0 / 65535.0).abs() < 1e-12)); assert_eq!(count, 72);
        assert!(sample_rgb16(&source, 30, 20, 0.8, 0.5).is_err());
        assert!(sample_rgb16(&source, 30, 20, 1.0, 0.5).is_err());
    }

    fn params() -> FilmNegativeParams {
        FilmNegativeParams {
            reference_input: Rgb {
                r: 100.0,
                g: 100.0,
                b: 100.0,
            },
            reference_output: Rgb {
                r: 10.0,
                g: 10.0,
                b: 10.0,
            },
            green_exponent: 2.0,
            red_ratio: 1.0,
            blue_ratio: 1.0,
            input_floor: 1.0,
            max_output: 65_535.0,
        }
    }

    #[test]
    fn disabled_is_exact_identity_even_with_invalid_params() {
        let pixel = Rgb {
            r: 0.0,
            g: 12.5,
            b: 65_535.0,
        };
        let mut invalid = params();
        invalid.green_exponent = f64::NAN;
        assert_eq!(apply_pixel(pixel, invalid, false), Ok(pixel));
    }

    #[test]
    fn reference_maps_to_reference_output_and_neutral_stays_neutral() {
        let p = params();
        assert_eq!(
            apply_pixel(p.reference_input, p, true),
            Ok(p.reference_output)
        );
        let output = apply_pixel(
            Rgb {
                r: 50.0,
                g: 50.0,
                b: 50.0,
            },
            p,
            true,
        )
        .unwrap();
        assert!((output.r - output.g).abs() < 1e-12);
        assert!((output.g - output.b).abs() < 1e-12);
    }

    #[test]
    fn channel_ratios_change_only_their_channel_response() {
        let mut p = params();
        p.red_ratio = 2.0;
        p.blue_ratio = 0.5;
        let output = apply_pixel(
            Rgb {
                r: 50.0,
                g: 50.0,
                b: 50.0,
            },
            p,
            true,
        )
        .unwrap();
        assert!(output.r > output.g);
        assert!(output.b < output.g);
    }

    #[test]
    fn zero_is_finite_and_clamps_to_output_maximum() {
        let p = params();
        let output = apply_pixel(
            Rgb {
                r: 0.0,
                g: 0.0,
                b: 0.0,
            },
            p,
            true,
        )
        .unwrap();
        assert_eq!(
            output,
            Rgb {
                r: p.max_output,
                g: p.max_output,
                b: p.max_output
            }
        );
        assert!(finite_rgb(output));
    }

    #[test]
    fn input_floor_applies_only_to_the_reference_sample() {
        let mut p = params();
        p.max_output = 1_000_000.0;
        p.reference_input = Rgb {
            r: 1.0,
            g: 1.0,
            b: 1.0,
        };
        p.reference_output = Rgb {
            r: 10.0,
            g: 10.0,
            b: 10.0,
        };
        let output = apply_pixel(
            Rgb {
                r: 0.5,
                g: 0.5,
                b: 0.5,
            },
            p,
            true,
        )
        .unwrap();
        assert_eq!(
            output,
            Rgb {
                r: 40.0,
                g: 40.0,
                b: 40.0
            }
        );
    }

    #[test]
    fn rejects_negative_and_non_finite_inputs() {
        let p = params();
        assert_eq!(
            apply_pixel(
                Rgb {
                    r: -1.0,
                    g: 1.0,
                    b: 1.0
                },
                p,
                true
            ),
            Err(FilmNegativeError::NegativePixel)
        );
        assert_eq!(
            apply_pixel(
                Rgb {
                    r: f64::NAN,
                    g: 1.0,
                    b: 1.0
                },
                p,
                true
            ),
            Err(FilmNegativeError::NonFiniteValue)
        );
        let mut invalid = p;
        invalid.blue_ratio = f64::INFINITY;
        assert_eq!(
            apply_pixel(
                Rgb {
                    r: 1.0,
                    g: 1.0,
                    b: 1.0
                },
                invalid,
                true
            ),
            Err(FilmNegativeError::NonFiniteValue)
        );
    }

    #[test]
    fn rejects_invalid_exponents_and_ranges() {
        let pixel = Rgb {
            r: 1.0,
            g: 1.0,
            b: 1.0,
        };
        let mut p = params();
        p.green_exponent = 0.0;
        assert_eq!(
            apply_pixel(pixel, p, true),
            Err(FilmNegativeError::InvalidExponent)
        );
        p = params();
        p.input_floor = 0.0;
        assert_eq!(
            apply_pixel(pixel, p, true),
            Err(FilmNegativeError::InvalidInputFloor)
        );
        p = params();
        p.max_output = 9.0;
        assert_eq!(
            apply_pixel(pixel, p, true),
            Err(FilmNegativeError::InvalidOutputRange)
        );
    }
}
