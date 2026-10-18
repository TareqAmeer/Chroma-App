//! Strip-parallel lossless frame container for the persistent full-resolution decode cache.
//!
//! The single-stream QOI the cache used before encodes and decodes on ONE core (1.5s+ for a 24MP
//! frame on the Intel dev Mac under load) and barely compresses developed photo noise (~0.9x).
//! This container cuts the frame into horizontal bands of whole rows. Each band is stored either
//! as its own QOI stream or, when QOI cannot get it under ~85%, as raw RGBA8 — so the common
//! noisy-photo case is a plain file write on the way out and parallel `pread`s straight into the
//! destination buffer on the way back in (no intermediate copy of the frame, no codec at all).
//! Pixels are bit-identical to the single-stream QOI of the same frame (both are lossless).
//!
//! Layout (little-endian):
//!   "CSQ1" | w u32 | h u32 | rows_per_band u32 | band_count u32
//!   band_count x ( kind u8 [0 = QOI stream, 1 = raw RGBA8] | len u32 )
//!   band payloads, back to back, in order
//!
//! Anything that does not parse (wrong magic, truncated, sizes that do not add up, a band that
//! fails to decode) is an Err; callers treat that as "no usable cache" and decode the RAW again.
use rayon::prelude::*;
use std::io::Write;

pub const MAGIC: &[u8; 4] = b"CSQ1";
const HEAD: usize = 20;
const ROWS_PER_BAND: usize = 128;
/// A QOI band must come in under this percentage of its raw size to be worth the decode cost.
const RAW_FALLBACK_PCT: usize = 85;
/// Rows QOI-encoded from the middle of the frame to decide whether QOI is worth trying at all.
const PROBE_ROWS: usize = 16;

fn bad<T>(m: &str) -> Result<T, String> {
    Err(format!("strip cache: {m}"))
}

fn band_rows(h: usize) -> usize {
    ROWS_PER_BAND.min(h.max(1))
}

fn qoi_encode(chunk: &[u8], w: u32) -> Result<Vec<u8>, String> {
    use image::ImageEncoder;
    let bh = (chunk.len() / (w as usize * 4)) as u32;
    let mut q = Vec::with_capacity(chunk.len() / 2);
    image::codecs::qoi::QoiEncoder::new(&mut q)
        .write_image(chunk, w, bh, image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("encode band: {e}"))?;
    Ok(q)
}

enum Band<'a> {
    Qoi(Vec<u8>),
    Raw(&'a [u8]),
}

impl Band<'_> {
    fn parts(&self) -> (u8, &[u8]) {
        match self {
            Band::Qoi(v) => (0, v),
            Band::Raw(s) => (1, s),
        }
    }
}

/// Streams the container for `rgba` (w*h*4 bytes) into `sink`. Bands are QOI-encoded in parallel on
/// the current rayon pool when a probe says the frame compresses; otherwise they are written as-is
/// straight from `rgba` with no extra copy of the frame.
pub fn write_to<W: Write>(sink: &mut W, rgba: &[u8], w: u32, h: u32) -> Result<(), String> {
    let (head, bands) = plan(rgba, w, h)?;
    let io = |e: std::io::Error| format!("strip cache: write: {e}");
    sink.write_all(&head).map_err(io)?;
    for b in &bands {
        sink.write_all(b.parts().1).map_err(io)?;
    }
    Ok(())
}

/// Writes the container to `file` with every band `pwrite`n from its own rayon task, so the copy
/// into the page cache (~170ms single-threaded for a 24MP raw frame) spreads over all cores.
pub fn write_file(file: &std::fs::File, rgba: &[u8], w: u32, h: u32) -> Result<(), String> {
    let (head, bands) = plan(rgba, w, h)?;
    let mut offsets = Vec::with_capacity(bands.len());
    let mut pos = head.len() as u64;
    for b in &bands {
        offsets.push(pos);
        pos += b.parts().1.len() as u64;
    }
    file.set_len(pos).map_err(|e| format!("strip cache: size: {e}"))?;
    write_all_at(file, &head, 0)?;
    bands.par_iter().zip(offsets.par_iter()).try_for_each(|(b, off)| write_all_at(file, b.parts().1, *off))
}

fn write_all_at(file: &std::fs::File, buf: &[u8], offset: u64) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileExt;
        file.write_all_at(buf, offset).map_err(|e| format!("strip cache: write: {e}"))
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileExt;
        let mut done = 0usize;
        while done < buf.len() {
            let n = file.seek_write(&buf[done..], offset + done as u64).map_err(|e| format!("strip cache: write: {e}"))?;
            if n == 0 {
                return bad("short write");
            }
            done += n;
        }
        Ok(())
    }
}

fn plan(rgba: &[u8], w: u32, h: u32) -> Result<(Vec<u8>, Vec<Band<'_>>), String> {
    let (wu, hu) = (w as usize, h as usize);
    if wu == 0 || hu == 0 || rgba.len() != wu * hu * 4 {
        return bad("frame size does not match its pixels");
    }
    let rows = band_rows(hu);
    let band_bytes = rows * wu * 4;
    // Probe: does QOI help on this frame at all? One short slice from the middle decides.
    let probe_rows = PROBE_ROWS.min(hu);
    let probe_start = (hu / 2).saturating_sub(probe_rows / 2).min(hu - probe_rows);
    let probe = &rgba[probe_start * wu * 4..(probe_start + probe_rows) * wu * 4];
    let try_qoi = qoi_encode(probe, w)?.len() * 100 < probe.len() * RAW_FALLBACK_PCT;
    let bands: Vec<Band> = rgba
        .par_chunks(band_bytes)
        .map(|chunk| -> Result<Band, String> {
            if try_qoi {
                let q = qoi_encode(chunk, w)?;
                if q.len() * 100 < chunk.len() * RAW_FALLBACK_PCT {
                    return Ok(Band::Qoi(q));
                }
            }
            Ok(Band::Raw(chunk))
        })
        .collect::<Result<_, _>>()?;
    let mut head = Vec::with_capacity(HEAD + bands.len() * 5);
    head.extend_from_slice(MAGIC);
    head.extend_from_slice(&w.to_le_bytes());
    head.extend_from_slice(&h.to_le_bytes());
    head.extend_from_slice(&(rows as u32).to_le_bytes());
    head.extend_from_slice(&(bands.len() as u32).to_le_bytes());
    for b in &bands {
        let (kind, data) = b.parts();
        head.push(kind);
        head.extend_from_slice(&(data.len() as u32).to_le_bytes());
    }
    Ok((head, bands))
}

/// Convenience: the whole container in memory (tests, benches).
pub fn encode(rgba: &[u8], w: u32, h: u32) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    write_to(&mut out, rgba, w, h)?;
    Ok(out)
}

/// Frame size from the first 12 bytes of a container.
pub fn dims(head: &[u8]) -> Option<(u32, u32)> {
    if head.len() < 12 || &head[0..4] != MAGIC {
        return None;
    }
    let rd = |o: usize| u32::from_le_bytes(head[o..o + 4].try_into().unwrap());
    Some((rd(4), rd(8)))
}

/// Random-access source of the container bytes (a file via `pread`, or a slice).
pub trait ReadAt: Sync {
    fn len(&self) -> u64;
    fn read_exact_at(&self, buf: &mut [u8], offset: u64) -> Result<(), String>;
}

impl ReadAt for &[u8] {
    fn len(&self) -> u64 {
        (**self).len() as u64
    }
    fn read_exact_at(&self, buf: &mut [u8], offset: u64) -> Result<(), String> {
        let o = offset as usize;
        match o.checked_add(buf.len()).and_then(|e| self.get(o..e)) {
            Some(s) => {
                buf.copy_from_slice(s);
                Ok(())
            }
            None => bad("truncated"),
        }
    }
}

pub struct FileSource {
    file: std::fs::File,
    len: u64,
}

impl FileSource {
    pub fn open(path: &std::path::Path) -> Result<Self, String> {
        let file = std::fs::File::open(path).map_err(|e| format!("strip cache: open: {e}"))?;
        let len = file.metadata().map_err(|e| format!("strip cache: stat: {e}"))?.len();
        Ok(Self { file, len })
    }
}

impl ReadAt for FileSource {
    fn len(&self) -> u64 {
        self.len
    }
    fn read_exact_at(&self, buf: &mut [u8], offset: u64) -> Result<(), String> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::FileExt;
            self.file.read_exact_at(buf, offset).map_err(|e| format!("strip cache: read: {e}"))
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::FileExt;
            let mut done = 0usize;
            while done < buf.len() {
                let n = self.file.seek_read(&mut buf[done..], offset + done as u64).map_err(|e| format!("strip cache: read: {e}"))?;
                if n == 0 {
                    return bad("truncated");
                }
                done += n;
            }
            Ok(())
        }
    }
}

struct Layout {
    w: u32,
    h: u32,
    rows: usize,
    /// (kind, absolute offset, len) per band.
    bands: Vec<(u8, u64, usize)>,
}

fn read_layout(src: &dyn ReadAt) -> Result<Layout, String> {
    let mut head = [0u8; HEAD];
    if src.len() < HEAD as u64 {
        return bad("truncated header");
    }
    src.read_exact_at(&mut head, 0)?;
    let Some((w, h)) = dims(&head) else { return bad("not a strip container") };
    let rd = |o: usize| u32::from_le_bytes(head[o..o + 4].try_into().unwrap()) as usize;
    let (wu, hu, rows, n) = (w as usize, h as usize, rd(12), rd(16));
    if wu == 0 || hu == 0 || rows == 0 || n == 0 || n != hu.div_ceil(rows) {
        return bad("inconsistent header");
    }
    let table_end = HEAD as u64 + n as u64 * 5;
    if src.len() < table_end {
        return bad("truncated table");
    }
    let mut table = vec![0u8; n * 5];
    src.read_exact_at(&mut table, HEAD as u64)?;
    let mut bands = Vec::with_capacity(n);
    let mut pos = table_end;
    for e in table.chunks_exact(5) {
        let len = u32::from_le_bytes(e[1..5].try_into().unwrap()) as usize;
        if pos + len as u64 > src.len() {
            return bad("truncated band");
        }
        bands.push((e[0], pos, len));
        pos += len as u64;
    }
    Ok(Layout { w, h, rows, bands })
}

/// Frame size from a source without decoding.
pub fn source_dims(src: &dyn ReadAt) -> Result<(u32, u32), String> {
    read_layout(src).map(|l| (l.w, l.h))
}

/// Decodes the container into a fresh buffer laid out as `prefix` zero bytes followed by w*h*4
/// RGBA8 (callers frame it for IPC), bands in parallel on the current rayon pool, reading raw
/// bands straight into place.
pub fn decode_with_prefix(src: &dyn ReadAt, prefix: usize) -> Result<(Vec<u8>, u32, u32), String> {
    use image::ImageDecoder;
    let l = read_layout(src)?;
    let (wu, hu) = (l.w as usize, l.h as usize);
    let mut out = vec![0u8; prefix + wu * hu * 4];
    out[prefix..]
        .par_chunks_mut(l.rows * wu * 4)
        .zip(l.bands.par_iter())
        .try_for_each(|(dst, &(kind, off, len))| -> Result<(), String> {
            match kind {
                1 => {
                    if len != dst.len() {
                        return bad("raw band size");
                    }
                    src.read_exact_at(dst, off)
                }
                0 => {
                    let mut comp = vec![0u8; len];
                    src.read_exact_at(&mut comp, off)?;
                    let dec = image::codecs::qoi::QoiDecoder::new(std::io::Cursor::new(&comp)).map_err(|e| format!("decode band: {e}"))?;
                    let (bw, bh) = dec.dimensions();
                    if bw != l.w || bh as usize * wu * 4 != dst.len() || dec.color_type() != image::ColorType::Rgba8 {
                        return bad("band shape");
                    }
                    dec.read_image(dst).map_err(|e| format!("decode band: {e}"))
                }
                _ => bad("unknown band kind"),
            }
        })?;
    Ok((out, l.w, l.h))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(w: usize, h: usize, seed: u32, noisy: bool) -> Vec<u8> {
        let mut s = seed.wrapping_mul(2654435761).max(1);
        (0..w * h * 4)
            .map(|i| {
                s ^= s << 13;
                s ^= s >> 17;
                s ^= s << 5;
                if noisy { (s >> 8) as u8 } else if i % 4 == 3 { 255 } else { ((i / 4) % w / 8) as u8 }
            })
            .collect()
    }

    fn decode(enc: &[u8]) -> Result<(Vec<u8>, u32, u32), String> {
        decode_with_prefix(&enc, 0)
    }

    #[test]
    fn round_trips_noisy_and_flat_frames_including_a_short_last_band() {
        for (w, h, noisy) in [(37usize, 300usize, true), (64, 128, false), (50, 129, false), (3, 1, true), (200, 515, true), (40, 7, false)] {
            let src = frame(w, h, (w * 31 + h) as u32, noisy);
            let enc = encode(&src, w as u32, h as u32).unwrap();
            assert_eq!(dims(&enc), Some((w as u32, h as u32)));
            let (out, dw, dh) = decode(&enc).unwrap();
            assert_eq!((dw, dh), (w as u32, h as u32));
            assert_eq!(out, src, "{w}x{h} noisy={noisy}");
        }
    }

    #[test]
    fn flat_frames_use_qoi_and_noisy_frames_are_stored_raw() {
        let flat = encode(&frame(64, 400, 1, false), 64, 400).unwrap();
        assert!(flat.len() < 64 * 400 * 4 / 2, "flat frame should compress");
        let noisy = encode(&frame(64, 400, 1, true), 64, 400).unwrap();
        assert!(noisy.len() > 64 * 400 * 4, "noisy frame is stored raw plus a small header");
    }

    #[test]
    fn prefix_is_left_zeroed_and_pixels_follow() {
        let src = frame(30, 200, 5, true);
        let (out, _, _) = decode_with_prefix(&encode(&src, 30, 200).unwrap().as_slice(), 8).unwrap();
        assert!(out[..8].iter().all(|b| *b == 0));
        assert_eq!(&out[8..], &src[..]);
    }

    #[test]
    fn matches_the_single_stream_qoi_pixels() {
        use image::{ImageDecoder, ImageEncoder};
        let (w, h) = (120usize, 333usize);
        let src = frame(w, h, 7, false);
        let mut single = Vec::new();
        image::codecs::qoi::QoiEncoder::new(&mut single).write_image(&src, w as u32, h as u32, image::ExtendedColorType::Rgba8).unwrap();
        let dec = image::codecs::qoi::QoiDecoder::new(std::io::Cursor::new(&single)).unwrap();
        let mut legacy = vec![0u8; dec.total_bytes() as usize];
        dec.read_image(&mut legacy).unwrap();
        assert_eq!(decode(&encode(&src, w as u32, h as u32).unwrap()).unwrap().0, legacy);
    }

    #[test]
    fn corrupt_or_truncated_containers_are_errors_not_panics() {
        for noisy in [true, false] {
            let (w, h) = (40usize, 260usize);
            let enc = encode(&frame(w, h, 3, noisy), w as u32, h as u32).unwrap();
            for cut in [0, 3, 19, 20, 30, enc.len() / 2, enc.len() - 1] {
                assert!(decode(&enc[..cut]).is_err(), "cut {cut} noisy={noisy}");
            }
            let mut bad_magic = enc.clone();
            bad_magic[0] = b'X';
            assert!(decode(&bad_magic).is_err());
            let mut lie = enc.clone();
            lie[HEAD + 1..HEAD + 5].copy_from_slice(&u32::MAX.to_le_bytes());
            assert!(decode(&lie).is_err());
            let mut zero_rows = enc.clone();
            zero_rows[12..16].copy_from_slice(&0u32.to_le_bytes());
            assert!(decode(&zero_rows).is_err());
        }
    }
}
