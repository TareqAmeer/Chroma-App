//! Shared case-insensitive path helpers. Photo paths arrive from the filesystem, the JS layer and
//! old registry files spelled with differing case (".RW2" vs ".rw2"), which split per-path stores
//! (export history, registries) into duplicate keys. Everything that keys, dedupes or resolves a
//! photo/sidecar path goes through here.
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

/// Stable identity key for a path string: lowercase. Two spellings of one file on a
/// case-insensitive volume map to the same key.
pub fn canonical_key(path: &str) -> String {
    path.to_lowercase()
}

/// The on-disk spelling of `candidate` (same directory, name matched case-insensitively).
pub fn real_case_sibling(candidate: &Path) -> Option<PathBuf> {
    let dir = candidate.parent()?;
    let want = candidate.file_name()?.to_string_lossy().to_lowercase();
    std::fs::read_dir(dir).ok()?.flatten().find(|e| e.file_name().to_string_lossy().to_lowercase() == want).map(|e| e.path())
}

/// Real on-disk spelling of a photo path when it exists, else the input unchanged.
pub fn canonical_photo_path(path: &str) -> String {
    if !Path::new(path).exists() {
        return path.to_string();
    }
    real_case_sibling(Path::new(path)).map(|c| c.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string())
}

/// Dedupe a path list by canonical_key, keeping first occurrence and order.
pub fn dedupe_paths(list: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    list.into_iter().filter(|p| seen.insert(canonical_key(p))).collect()
}

/// One read_dir: lowercase stem -> real photo paths, best extension first (all_image_exts order).
pub fn photo_index_for_dir(dir: &Path) -> HashMap<String, Vec<PathBuf>> {
    let prio: HashMap<&str, usize> = crate::formats::all_image_exts().enumerate().map(|(i, e)| (*e, i)).collect();
    let mut tmp: HashMap<String, Vec<(usize, PathBuf)>> = HashMap::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            let Some(ext) = p.extension().and_then(|x| x.to_str()).map(|x| x.to_lowercase()) else { continue };
            let Some(&pr) = prio.get(ext.as_str()) else { continue };
            let Some(stem) = p.file_stem().and_then(|s| s.to_str()) else { continue };
            tmp.entry(stem.to_lowercase()).or_default().push((pr, p));
        }
    }
    tmp.into_iter()
        .map(|(k, mut v)| {
            v.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
            (k, v.into_iter().map(|(_, p)| p).collect())
        })
        .collect()
}

/// Existing sidecar for a photo (any case of stem/extension), else None.
pub fn find_sidecar(photo_path: &Path) -> Option<PathBuf> {
    let exact = photo_path.with_extension("xmp");
    if exact.exists() {
        return Some(exact);
    }
    let upper = photo_path.with_extension("XMP");
    if upper.exists() {
        return Some(upper);
    }
    let stem = photo_path.file_stem()?.to_string_lossy().to_lowercase();
    let dir = photo_path.parent()?;
    std::fs::read_dir(dir).ok()?.flatten().find_map(|e| {
        let p = e.path();
        let ext_ok = p.extension().and_then(|x| x.to_str()).map(|x| x.eq_ignore_ascii_case("xmp")).unwrap_or(false);
        let stem_ok = p.file_stem().map(|s| s.to_string_lossy().to_lowercase() == stem).unwrap_or(false);
        (ext_ok && stem_ok).then_some(p)
    })
}

/// Sidecar path to read: the existing one in any case, else the lowercase default.
/// Doubles as the write target so an existing ".XMP" is updated, not shadowed by a second file.
pub fn sidecar_path_for(photo_path: &Path) -> PathBuf {
    find_sidecar(photo_path).unwrap_or_else(|| photo_path.with_extension("xmp"))
}

/// Merge a keyed store so keys differing only by case collapse into one; values combine via `merge`.
/// The surviving key keeps a real spelling (the on-disk one when the file exists, else the first
/// in sorted order) so it stays usable as a path and as a case-sensitive catalog lookup.
pub fn merge_case_keys<V>(map: HashMap<String, V>, mut merge: impl FnMut(V, V) -> V) -> HashMap<String, V> {
    let mut groups: HashMap<String, Vec<(String, V)>> = HashMap::new();
    for (k, v) in map {
        groups.entry(canonical_key(&k)).or_default().push((k, v));
    }
    let mut out = HashMap::new();
    for (_, mut g) in groups {
        g.sort_by(|a, b| a.0.cmp(&b.0));
        let mut key = g[0].0.clone();
        if g.len() > 1 {
            if let Some(real) = real_case_sibling(Path::new(&key)).map(|p| p.to_string_lossy().into_owned()) {
                if g.iter().any(|(k, _)| *k == real) { key = real; }
            }
        }
        let mut it = g.into_iter().map(|(_, v)| v);
        let first = it.next().unwrap();
        out.insert(key, it.fold(first, |a, b| merge(a, b)));
    }
    out
}

/// Key in `map` equal to `path` ignoring case, if any.
pub fn find_key<'a, V>(map: &'a HashMap<String, V>, path: &str) -> Option<&'a String> {
    if let Some((k, _)) = map.get_key_value(path) { return Some(k); }
    let ck = canonical_key(path);
    map.keys().find(|k| canonical_key(k) == ck)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("canon_{name}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    #[test]
    fn key_ignores_case() { assert_eq!(canonical_key("/A/X.RW2"), canonical_key("/a/x.rw2")); }
    #[test]
    fn dedupe_keeps_first() {
        assert_eq!(dedupe_paths(vec!["/a/X.RW2".into(), "/a/x.rw2".into(), "/b".into()]), vec!["/a/X.RW2", "/b"]);
    }
    #[test]
    fn photo_index_handles_both_case_duplicates_and_priority() {
        let d = tmp("idx");
        std::fs::write(d.join("IMG.RW2"), b"").unwrap();
        std::fs::write(d.join("img.jpg"), b"").unwrap();
        std::fs::write(d.join("note.txt"), b"").unwrap();
        let idx = photo_index_for_dir(&d);
        let v = &idx["img"];
        assert_eq!(v.len(), 2);
        assert!(v[0].to_string_lossy().ends_with("IMG.RW2")); // RAW ranks first
        assert!(!idx.contains_key("note"));
    }
    #[test]
    fn finds_uppercase_and_case_differing_sidecars() {
        let d = tmp("sc");
        std::fs::write(d.join("Foo.RW2"), b"").unwrap();
        std::fs::write(d.join("foo.XMP"), b"x").unwrap();
        let p = sidecar_path_for(&d.join("Foo.RW2"));
        assert_eq!(p.file_name().unwrap().to_string_lossy().to_lowercase(), "foo.xmp");
        assert!(p.exists());
        // no sidecar -> lowercase default for writes
        assert_eq!(sidecar_path_for(&d.join("Bar.RW2")), d.join("Bar.xmp"));
    }
    #[test]
    fn merge_collapses_case_duplicate_keys() {
        let mut m: HashMap<String, Vec<u32>> = HashMap::new();
        m.insert("/a/X.RW2".into(), vec![1, 3]);
        m.insert("/a/x.rw2".into(), vec![2]);
        let out = merge_case_keys(m, |mut a, b| { a.extend(b); a.sort(); a });
        assert_eq!(out.len(), 1);
        assert_eq!(out.values().next().unwrap(), &vec![1, 2, 3]);
        assert!(find_key(&out, "/A/X.rw2").is_some());
    }
}
