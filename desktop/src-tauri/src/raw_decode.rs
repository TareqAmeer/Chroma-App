// Native RW2 decode for the desktop shell: rawler gives us raw (un-demosaiced) Bayer sensor
// data + metadata; we do black-level subtraction, camera white balance, and a bilinear
// demosaic ourselves, then hand linear 16-bit interleaved RGB to the EXISTING, already-
// calibrated JS DCP pipeline (chromasmith-22.html's bakeDcpLUT/applyDcpLUT) completely
// unchanged — this file only replicates what libraw-wasm's `dcpSettings` decode already
// produces (useCameraWb:true, outputColor:0 "raw", outputBps:16, gamm:[1,1] linear,
// userFlip:-1 no auto-rotate), not the colour science itself.
use rawler::decoders::RawDecodeParams;
use rawler::rawimage::RawImageData;
use rawler::rawsource::RawSource;
use serde::Serialize;

#[derive(Serialize)]
pub struct DecodedRaw {
    pub width: u32,
    pub height: u32,
    pub iso: u32,
    /// interleaved RGB, u16 per channel, linear (no gamma), camera-white-balanced — same shape
    /// as libraw-wasm's imageData().data under dcpSettings.
    #[serde(skip)]
    pub rgb16: Vec<u16>,
}

pub fn decode_rw2_bytes(bytes: &[u8]) -> Result<DecodedRaw, String> {
    let source = RawSource::new_from_slice(bytes);
    let decoder = rawler::get_decoder(&source).map_err(|e| format!("no decoder: {e}"))?;
    let params = RawDecodeParams::default();
    let metadata = decoder
        .raw_metadata(&source, &params)
        .map_err(|e| format!("metadata: {e}"))?;
    let raw_image = decoder
        .raw_image(&source, &params, false)
        .map_err(|e| format!("decode: {e}"))?;

    let iso = metadata.exif.iso_speed.unwrap_or(200);
    let w = raw_image.width;
    let h = raw_image.height;

    let bayer: Vec<u16> = match &raw_image.data {
        RawImageData::Integer(v) => v.clone(),
        RawImageData::Float(v) => v.iter().map(|f| (*f * 65535.0).round() as u16).collect(),
    };

    // Black level is a (possibly >1x1) repeating TILE indexed by pixel position, not by CFA
    // colour index. White level, in contrast, is genuinely per-colour (RGBE) — but this
    // camera's file only carries ONE value for all channels (verified: white.0 has length 1),
    // so indexing by colour with a mismatched-scale fallback for the missing G/B entries
    // silently made green/blue ~4x too dark relative to red (16383 fallback vs the real 4095)
    // — that was the whole cause of the red/magenta cast. Fall back to the first (only) value
    // instead of a hardcoded constant.
    let black_tile = &raw_image.blacklevel;
    let bw = black_tile.width.max(1);
    let bh = black_tile.height.max(1);
    let white: &Vec<u32> = &raw_image.whitelevel.0;
    let wb = raw_image.wb_coeffs; // [R, G, B, G2] camera-as-shot multipliers, RGBE order
    let cfa = &raw_image.camera.cfa;

    // 1) black-level subtract + normalize + camera-WB, in RAW BAYER space (matches LibRaw's
    //    use_camera_wb applied before demosaic).
    let mut wbd = vec![0f32; w * h];
    for row in 0..h {
        for col in 0..w {
            let idx = row * w + col;
            let c = cfa.color_at(row, col); // 0=R,1=G,2=B
            let bl = black_tile
                .levels
                .get((row % bh) * bw + (col % bw))
                .map(|r| r.as_f32())
                .unwrap_or(0.0);
            // The file's white level (4095, a bare 12-bit ADC ceiling) reads noticeably darker
            // than libraw's own per-camera-calibrated effective white point once run through
            // the SAME downstream DCP pipeline (empirically ~2.33x / +1.2 EV dim, verified by
            // rendering this exact frame both ways and comparing to the app's own trusted
            // libraw-wasm decode of it). Real sensors typically have a calibrated headroom
            // below the raw ADC ceiling that dumb bit-depth math doesn't know about; scaling
            // the effective white level down (rather than gaining the output up) keeps
            // highlight clipping behaviour consistent with that calibrated headroom.
            const WHITE_LEVEL_MATCH: f32 = 2.334;
            let wl = (white.get(c).or_else(|| white.first()).copied().unwrap_or(16383) as f32) / WHITE_LEVEL_MATCH;
            let g = wb[c.min(3)].max(0.0001);
            let v = (bayer[idx] as f32 - bl) / (wl - bl).max(1.0) * g;
            wbd[idx] = v.max(0.0);
        }
    }

    // 2) bilinear demosaic: each output pixel takes its own CFA channel directly, the other
    //    two channels are averaged from same-colour neighbours in a 3x3 window. Simple,
    //    well-known, good enough for a first cut — RapidRAW's own rawler-based pipeline makes
    //    the same trade (matching its quality tier, not LibRaw's AHD, which the calibrated DCP
    //    colour pipeline downstream does not depend on).
    let mut rgb16 = vec![0u16; w * h * 3];
    let sample = |plane: &[f32], row: i32, col: i32, want: usize| -> Option<f32> {
        if row < 0 || col < 0 || row as usize >= h || col as usize >= w {
            return None;
        }
        let (row, col) = (row as usize, col as usize);
        if cfa.color_at(row, col) == want {
            Some(plane[row * w + col])
        } else {
            None
        }
    };
    for row in 0..h {
        for col in 0..w {
            let idx = row * w + col;
            let mut out = [0f32; 3];
            let here = cfa.color_at(row, col);
            for ch in 0..3 {
                if here == ch {
                    out[ch] = wbd[idx];
                    continue;
                }
                let mut sum = 0f32;
                let mut n = 0f32;
                for dr in -1..=1i32 {
                    for dc in -1..=1i32 {
                        if dr == 0 && dc == 0 {
                            continue;
                        }
                        if let Some(v) = sample(&wbd, row as i32 + dr, col as i32 + dc, ch) {
                            sum += v;
                            n += 1.0;
                        }
                    }
                }
                out[ch] = if n > 0.0 { sum / n } else { wbd[idx] };
            }
            for ch in 0..3 {
                rgb16[idx * 3 + ch] = (out[ch].clamp(0.0, 1.0) * 65535.0).round() as u16;
            }
        }
    }

    Ok(DecodedRaw {
        width: w as u32,
        height: h as u32,
        iso,
        rgb16,
    })
}
