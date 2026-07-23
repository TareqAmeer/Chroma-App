// Splices EXIF/GPS/XMP/IPTC metadata from the ORIGINAL Lightroom Edit-In TIFF into the
// rendered TIFF that UTIF.js produced, before "Save to Lightroom" overwrites the file.
//
// Why here and not in JS: UTIF's minimal encoder corrupts any non-ASCII tag value (see
// safeTiffMetaFrom's comment in chromasmith-22.html), and the EXIF sub-IFD (t34665) — which
// holds ExposureTime/FNumber/ISO/FocalLength/LensModel/DateTimeOriginal, i.e. everything
// Lightroom's Info panel shows — is an offset-based substructure UTIF can't relocate. The JS
// side also deliberately does NOT keep the original TIFF bytes in memory (100+ MB), but the
// original file still exists on disk at write time, so the splice happens natively in
// write_lightroom_tiff (main.rs) which reads it just before overwriting.
//
// Approach: append a re-serialized EXIF sub-IFD / GPS sub-IFD / XMP / IPTC (copied entry-by-
// entry from the source, byte-swapped to little-endian if the source was big-endian) plus a
// NEW IFD0 (= the rendered file's IFD0 entries verbatim + the four new pointer/blob tags) to
// the end of the rendered bytes, then patch the header's IFD0 offset. The rendered file's
// existing data region is untouched, so every offset its IFD0 entries carry stays valid; the
// old IFD0 table becomes ~200 dead bytes, which TIFF readers never see.
//
// Deliberately NOT copied:
//  - MakerNote (0x927C) and the Interoperability pointer (0xA005): both contain absolute file
//    offsets internal to the ORIGINAL file — relocating them blindly produces garbage.
//  - Source IFD0 tags (Orientation, ICC t34675, strip layout, …): geometry is already baked
//    into the rendered pixels, and the source ICC is ProPhoto while the render is sRGB.

const T_XMP: u16 = 700;
const T_IPTC: u16 = 33723;
const T_EXIF_IFD: u16 = 34665;
const T_GPS_IFD: u16 = 34853;
const T_MAKERNOTE: u16 = 0x927C;
const T_INTEROP: u16 = 0xA005;

fn type_size(t: u16) -> Option<usize> {
    Some(match t {
        1 | 2 | 6 | 7 => 1,       // BYTE, ASCII, SBYTE, UNDEFINED
        3 | 8 => 2,               // SHORT, SSHORT
        4 | 9 | 11 => 4,          // LONG, SLONG, FLOAT
        5 | 10 => 8,              // RATIONAL, SRATIONAL (two 4-byte halves)
        12 => 8,                  // DOUBLE (one 8-byte unit)
        _ => return None,
    })
}

// Element width for byte-swapping: rationals swap each 4-byte half, doubles swap all 8.
fn swap_unit(t: u16) -> usize {
    match t {
        3 | 8 => 2,
        4 | 9 | 11 | 5 | 10 => 4, // rationals are pairs of u32 — swap per half
        12 => 8,
        _ => 1,
    }
}

#[derive(Clone)]
struct Entry {
    tag: u16,
    typ: u16,
    count: u32,
    value: Vec<u8>, // raw value bytes, already little-endian
}

struct Reader<'a> {
    b: &'a [u8],
    le: bool,
}

impl<'a> Reader<'a> {
    fn new(b: &'a [u8]) -> Option<Self> {
        if b.len() < 8 {
            return None;
        }
        let le = match &b[0..2] {
            b"II" => true,
            b"MM" => false,
            _ => return None,
        };
        let r = Reader { b, le };
        if r.u16(2)? != 42 {
            return None;
        }
        Some(r)
    }
    fn u16(&self, off: usize) -> Option<u16> {
        let s = self.b.get(off..off + 2)?;
        Some(if self.le {
            u16::from_le_bytes([s[0], s[1]])
        } else {
            u16::from_be_bytes([s[0], s[1]])
        })
    }
    fn u32(&self, off: usize) -> Option<u32> {
        let s = self.b.get(off..off + 4)?;
        let a = [s[0], s[1], s[2], s[3]];
        Some(if self.le { u32::from_le_bytes(a) } else { u32::from_be_bytes(a) })
    }
    fn ifd0(&self) -> Option<usize> {
        Some(self.u32(4)? as usize)
    }

    // Reads one IFD entry's raw value bytes, normalized to little-endian.
    fn entry(&self, entry_off: usize) -> Option<Entry> {
        let tag = self.u16(entry_off)?;
        let typ = self.u16(entry_off + 2)?;
        let count = self.u32(entry_off + 4)?;
        let tsz = type_size(typ)?;
        let len = (count as usize).checked_mul(tsz)?;
        if len > 64 * 1024 * 1024 {
            return None; // sanity cap
        }
        let mut value = if len <= 4 {
            self.b.get(entry_off + 8..entry_off + 8 + len)?.to_vec()
        } else {
            let off = self.u32(entry_off + 8)? as usize;
            self.b.get(off..off.checked_add(len)?)?.to_vec()
        };
        if !self.le {
            let unit = swap_unit(typ);
            if unit > 1 {
                for chunk in value.chunks_exact_mut(unit) {
                    chunk.reverse();
                }
            }
        }
        Some(Entry { tag, typ, count, value })
    }

    // All entries of the IFD at `off` (tag → entry offset also usable for pointer lookups).
    fn ifd_entries(&self, off: usize) -> Option<Vec<Entry>> {
        let n = self.u16(off)? as usize;
        if n > 4096 {
            return None;
        }
        let mut v = Vec::with_capacity(n);
        for i in 0..n {
            // Skip (don't abort on) an individual unparsable entry — e.g. a vendor type code.
            if let Some(e) = self.entry(off + 2 + i * 12) {
                v.push(e);
            }
        }
        Some(v)
    }
}

// Endian-aware integer writers: everything appended to the rendered file must be in ITS byte
// order — UTIF.js writes BIG-endian ("MM") TIFFs, a fact discovered the hard way (the first
// version of this module assumed "II" and silently skipped the splice on every real save).
fn put16(out: &mut Vec<u8>, le: bool, v: u16) {
    out.extend_from_slice(&if le { v.to_le_bytes() } else { v.to_be_bytes() });
}
fn put32(out: &mut Vec<u8>, le: bool, v: u32) {
    out.extend_from_slice(&if le { v.to_le_bytes() } else { v.to_be_bytes() });
}

// Entry.value is normalized little-endian at parse time; re-swap per element when the target
// file is big-endian.
fn value_in_order(e: &Entry, le: bool) -> Vec<u8> {
    let mut v = e.value.clone();
    if !le {
        let unit = swap_unit(e.typ);
        if unit > 1 {
            for chunk in v.chunks_exact_mut(unit) {
                chunk.reverse();
            }
        }
    }
    v
}

// Serializes one sub-IFD (entries must be plain values, no pointers) appended to `out` in the
// given byte order, returning the IFD's absolute offset.
fn write_ifd(out: &mut Vec<u8>, le: bool, mut entries: Vec<Entry>) -> u32 {
    if out.len() % 2 == 1 {
        out.push(0);
    }
    entries.sort_by_key(|e| e.tag); // TIFF requires ascending tag order
    let ifd_off = out.len() as u32;
    let n = entries.len();
    let table_len = 2 + n * 12 + 4;
    // Value area starts right after the table.
    let mut val_off = ifd_off as usize + table_len;
    put16(out, le, n as u16);
    let mut overflow: Vec<u8> = Vec::new();
    for e in &entries {
        put16(out, le, e.tag);
        put16(out, le, e.typ);
        put32(out, le, e.count);
        let val = value_in_order(e, le);
        if val.len() <= 4 {
            let mut v = val;
            v.resize(4, 0);
            out.extend_from_slice(&v);
        } else {
            if val_off % 2 == 1 {
                overflow.push(0);
                val_off += 1;
            }
            put32(out, le, val_off as u32);
            overflow.extend_from_slice(&val);
            val_off += val.len();
        }
    }
    put32(out, le, 0); // next-IFD = none
    out.extend_from_slice(&overflow);
    ifd_off
}

// Appends a raw blob (XMP/IPTC bytes) and returns its offset.
fn write_blob(out: &mut Vec<u8>, blob: &[u8]) -> u32 {
    if out.len() % 2 == 1 {
        out.push(0);
    }
    let off = out.len() as u32;
    out.extend_from_slice(blob);
    off
}

pub fn splice_metadata(rendered: &[u8], source: &[u8]) -> Option<Vec<u8>> {
    let src = Reader::new(source)?;
    let src_ifd0 = src.ifd_entries(src.ifd0()?)?;

    // Pull the four interesting structures out of the source's IFD0.
    let mut exif_entries: Vec<Entry> = Vec::new();
    let mut gps_entries: Vec<Entry> = Vec::new();
    let mut xmp: Option<Entry> = None;
    let mut iptc: Option<Entry> = None;
    for e in &src_ifd0 {
        match e.tag {
            T_EXIF_IFD | T_GPS_IFD => {
                if e.typ == 4 && e.count == 1 && e.value.len() == 4 {
                    let off = u32::from_le_bytes([e.value[0], e.value[1], e.value[2], e.value[3]]) as usize;
                    if let Some(subs) = src.ifd_entries(off) {
                        let dst = if e.tag == T_EXIF_IFD { &mut exif_entries } else { &mut gps_entries };
                        for s in subs {
                            // Drop offset-bearing tags — their values point into the SOURCE file.
                            if s.tag == T_MAKERNOTE || s.tag == T_INTEROP {
                                continue;
                            }
                            dst.push(s);
                        }
                    }
                }
            }
            T_XMP => xmp = Some(e.clone()),
            T_IPTC => iptc = Some(e.clone()),
            _ => {}
        }
    }
    if exif_entries.is_empty() && gps_entries.is_empty() && xmp.is_none() && iptc.is_none() {
        return None; // nothing to add
    }

    // The rendered file is UTIF output — which writes BIG-endian ("MM"). Support both orders
    // anyway: all appended structures below are serialized in the rendered file's own order.
    let ren = Reader::new(rendered)?;
    let rle = ren.le;
    let ren_ifd0_off = ren.ifd0()?;
    let ren_n = ren.u16(ren_ifd0_off)? as usize;
    // Copy the rendered IFD0's entries verbatim (raw 12-byte records — their inline values and
    // out-of-line offsets both stay valid because we never move the existing data region).
    let mut ifd0_records: Vec<[u8; 12]> = Vec::with_capacity(ren_n + 4);
    let mut existing_tags: Vec<u16> = Vec::new();
    for i in 0..ren_n {
        let off = ren_ifd0_off + 2 + i * 12;
        let rec: [u8; 12] = rendered.get(off..off + 12)?.try_into().ok()?;
        existing_tags.push(ren.u16(off)?);
        ifd0_records.push(rec);
    }

    let mut out = rendered.to_vec();

    // Pointer/blob records for the new IFD0, in the RENDERED file's byte order.
    let push_ptr = |records: &mut Vec<[u8; 12]>, tag: u16, typ: u16, count: u32, val: u32| {
        let mut rec = [0u8; 12];
        let (t, ty, c, v) = if rle {
            (tag.to_le_bytes(), typ.to_le_bytes(), count.to_le_bytes(), val.to_le_bytes())
        } else {
            (tag.to_be_bytes(), typ.to_be_bytes(), count.to_be_bytes(), val.to_be_bytes())
        };
        rec[0..2].copy_from_slice(&t);
        rec[2..4].copy_from_slice(&ty);
        rec[4..8].copy_from_slice(&c);
        rec[8..12].copy_from_slice(&v);
        records.push(rec);
    };

    if !exif_entries.is_empty() && !existing_tags.contains(&T_EXIF_IFD) {
        let off = write_ifd(&mut out, rle, exif_entries);
        push_ptr(&mut ifd0_records, T_EXIF_IFD, 4, 1, off);
    }
    if !gps_entries.is_empty() && !existing_tags.contains(&T_GPS_IFD) {
        let off = write_ifd(&mut out, rle, gps_entries);
        push_ptr(&mut ifd0_records, T_GPS_IFD, 4, 1, off);
    }
    if let Some(x) = xmp {
        if !existing_tags.contains(&T_XMP) && x.value.len() > 4 {
            let off = write_blob(&mut out, &x.value);
            push_ptr(&mut ifd0_records, T_XMP, x.typ, x.count, off);
        }
    }
    if let Some(p) = iptc {
        if !existing_tags.contains(&T_IPTC) && p.value.len() > 4 {
            let off = write_blob(&mut out, &p.value);
            push_ptr(&mut ifd0_records, T_IPTC, p.typ, p.count, off);
        }
    }
    if ifd0_records.len() == ren_n {
        return None; // nothing actually added
    }

    // New IFD0: sorted records, next-IFD = 0, header patched to point at it — all in the
    // rendered file's byte order (records are raw 12-byte copies already in that order).
    ifd0_records.sort_by_key(|r| {
        if rle { u16::from_le_bytes([r[0], r[1]]) } else { u16::from_be_bytes([r[0], r[1]]) }
    });
    if out.len() % 2 == 1 {
        out.push(0);
    }
    let new_ifd0 = out.len() as u32;
    put16(&mut out, rle, ifd0_records.len() as u16);
    for rec in &ifd0_records {
        out.extend_from_slice(rec);
    }
    put32(&mut out, rle, 0);
    let hdr = if rle { new_ifd0.to_le_bytes() } else { new_ifd0.to_be_bytes() };
    out[4..8].copy_from_slice(&hdr);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Builds a minimal TIFF: header + IFD0 (given entries) + optional EXIF sub-IFD, all LE.
    fn tiny_tiff_with_exif() -> Vec<u8> {
        let mut out = vec![b'I', b'I', 42, 0, 0, 0, 0, 0];
        // EXIF sub-IFD first (we'll point at it from IFD0).
        let exif = vec![
            Entry { tag: 33434, typ: 5, count: 1, value: {
                let mut v = 1u32.to_le_bytes().to_vec(); v.extend(250u32.to_le_bytes()); v } }, // 1/250s
            Entry { tag: 34855, typ: 3, count: 1, value: 400u16.to_le_bytes().to_vec() },       // ISO 400
            Entry { tag: 36867, typ: 2, count: 20, value: b"2026:07:20 10:11:12\0".to_vec() },  // DateTimeOriginal
            Entry { tag: 42036, typ: 2, count: 8, value: b"S 26mm \0".to_vec() },               // LensModel
            Entry { tag: T_MAKERNOTE, typ: 7, count: 4, value: vec![1, 2, 3, 4] },              // must be dropped
        ];
        let exif_off = write_ifd(&mut out, true, exif);
        let ifd0 = vec![
            Entry { tag: 256, typ: 4, count: 1, value: 1u32.to_le_bytes().to_vec() },
            Entry { tag: T_EXIF_IFD, typ: 4, count: 1, value: exif_off.to_le_bytes().to_vec() },
        ];
        let ifd0_off = write_ifd(&mut out, true, ifd0);
        out[4..8].copy_from_slice(&ifd0_off.to_le_bytes());
        out
    }

    fn tiny_rendered() -> Vec<u8> {
        // A minimal valid-enough LE TIFF with an IFD0 of plain tags (no pixel data needed for
        // the splice logic itself).
        let mut out = vec![b'I', b'I', 42, 0, 0, 0, 0, 0];
        let ifd0 = vec![
            Entry { tag: 256, typ: 4, count: 1, value: 1u32.to_le_bytes().to_vec() },
            Entry { tag: 257, typ: 4, count: 1, value: 1u32.to_le_bytes().to_vec() },
            Entry { tag: 305, typ: 2, count: 12, value: b"Chromasmith\0".to_vec() },
        ];
        let off = write_ifd(&mut out, true, ifd0);
        out[4..8].copy_from_slice(&off.to_le_bytes());
        out
    }

    #[test]
    fn splices_exif_and_drops_makernote() {
        let source = tiny_tiff_with_exif();
        let rendered = tiny_rendered();
        let spliced = splice_metadata(&rendered, &source).expect("splice");

        let r = Reader::new(&spliced).unwrap();
        let ifd0 = r.ifd_entries(r.ifd0().unwrap()).unwrap();
        let exif_ptr = ifd0.iter().find(|e| e.tag == T_EXIF_IFD).expect("exif ptr");
        let off = u32::from_le_bytes(exif_ptr.value[..4].try_into().unwrap()) as usize;
        let exif = r.ifd_entries(off).unwrap();
        assert!(exif.iter().any(|e| e.tag == 33434)); // ExposureTime
        assert!(exif.iter().any(|e| e.tag == 34855 && e.value == 400u16.to_le_bytes())); // ISO
        let dto = exif.iter().find(|e| e.tag == 36867).expect("DateTimeOriginal");
        assert_eq!(&dto.value, b"2026:07:20 10:11:12\0"); // capture date byte-identical
        assert!(exif.iter().any(|e| e.tag == 42036)); // LensModel
        assert!(!exif.iter().any(|e| e.tag == T_MAKERNOTE)); // dropped
        // Rendered IFD0 tags survive.
        assert!(ifd0.iter().any(|e| e.tag == 305));
        // kamadak-exif can parse the result and sees the capture date.
        let ex = exif::Reader::new()
            .read_raw(spliced.clone())
            .expect("kamadak parse");
        let f = ex
            .get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY)
            .expect("dto field");
        assert!(format!("{}", f.display_value()).contains("2026-07-20"));
    }

    #[test]
    fn big_endian_source_is_byteswapped() {
        // Build a BE source with just ISO in the EXIF IFD.
        let mut out = vec![b'M', b'M', 0, 42, 0, 0, 0, 0];
        // EXIF IFD @8: 1 entry (ISO SHORT 640), next=0
        out.extend_from_slice(&1u16.to_be_bytes());
        out.extend_from_slice(&34855u16.to_be_bytes());
        out.extend_from_slice(&3u16.to_be_bytes());
        out.extend_from_slice(&1u32.to_be_bytes());
        out.extend_from_slice(&640u16.to_be_bytes());
        out.extend_from_slice(&[0, 0]);
        out.extend_from_slice(&0u32.to_be_bytes());
        let ifd0_off = out.len() as u32;
        out.extend_from_slice(&1u16.to_be_bytes());
        out.extend_from_slice(&T_EXIF_IFD.to_be_bytes());
        out.extend_from_slice(&4u16.to_be_bytes());
        out.extend_from_slice(&1u32.to_be_bytes());
        out.extend_from_slice(&8u32.to_be_bytes());
        out.extend_from_slice(&0u32.to_be_bytes());
        out[4..8].copy_from_slice(&ifd0_off.to_be_bytes());

        let spliced = splice_metadata(&tiny_rendered(), &out).expect("splice");
        let r = Reader::new(&spliced).unwrap();
        let ifd0 = r.ifd_entries(r.ifd0().unwrap()).unwrap();
        let ptr = ifd0.iter().find(|e| e.tag == T_EXIF_IFD).unwrap();
        let off = u32::from_le_bytes(ptr.value[..4].try_into().unwrap()) as usize;
        let exif = r.ifd_entries(off).unwrap();
        let iso = exif.iter().find(|e| e.tag == 34855).unwrap();
        assert_eq!(iso.value, 640u16.to_le_bytes());
    }

    // The shape that actually ships: UTIF.js writes BIG-endian ("MM") TIFFs. The first version
    // of this module bailed on any non-LE rendered file — every real save skipped the splice.
    fn tiny_rendered_be() -> Vec<u8> {
        let mut out = vec![b'M', b'M', 0, 42, 0, 0, 0, 0];
        let ifd0_off = out.len() as u32;
        let entries: [(u16, u16, u32, [u8; 4]); 3] = [
            (256, 4, 1, 1u32.to_be_bytes()),
            (257, 4, 1, 1u32.to_be_bytes()),
            (296, 3, 1, {
                let mut v = [0u8; 4];
                v[..2].copy_from_slice(&2u16.to_be_bytes());
                v
            }),
        ];
        out.extend_from_slice(&(entries.len() as u16).to_be_bytes());
        for (tag, typ, count, val) in entries {
            out.extend_from_slice(&tag.to_be_bytes());
            out.extend_from_slice(&typ.to_be_bytes());
            out.extend_from_slice(&count.to_be_bytes());
            out.extend_from_slice(&val);
        }
        out.extend_from_slice(&0u32.to_be_bytes());
        out[4..8].copy_from_slice(&ifd0_off.to_be_bytes());
        out
    }

    #[test]
    fn splices_into_big_endian_rendered() {
        let source = tiny_tiff_with_exif(); // LE source with full EXIF
        let spliced = splice_metadata(&tiny_rendered_be(), &source).expect("splice into MM");
        assert_eq!(&spliced[0..2], b"MM"); // stays big-endian
        let r = Reader::new(&spliced).unwrap();
        let ifd0 = r.ifd_entries(r.ifd0().unwrap()).unwrap();
        let ptr = ifd0.iter().find(|e| e.tag == T_EXIF_IFD).expect("exif ptr");
        let off = u32::from_le_bytes(ptr.value[..4].try_into().unwrap()) as usize;
        let exif = r.ifd_entries(off).unwrap();
        assert!(exif.iter().any(|e| e.tag == 34855 && e.value == 400u16.to_le_bytes())); // ISO
        let dto = exif.iter().find(|e| e.tag == 36867).expect("DateTimeOriginal");
        assert_eq!(&dto.value, b"2026:07:20 10:11:12\0");
        assert!(ifd0.iter().any(|e| e.tag == 296)); // rendered's own tags survive
        // kamadak-exif parses the MM result and sees the capture date.
        let ex = exif::Reader::new().read_raw(spliced).expect("kamadak parse MM");
        let f = ex.get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY).expect("dto");
        assert!(format!("{}", f.display_value()).contains("2026-07-20"));
    }

    #[test]
    fn no_metadata_returns_none() {
        assert!(splice_metadata(&tiny_rendered(), &tiny_rendered()).is_none());
    }
}
