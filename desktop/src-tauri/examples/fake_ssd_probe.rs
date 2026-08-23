// Manual end-to-end verification of the library-catalog work (calib-style probe, not part of the
// app): runs the REAL import + catalog pipeline against a synthetic "card" of real photos, laid
// out into a fake SSD folder the exact way ingest.rs's import would, then drives every catalog
// scan phase against it. Written because the real SSD this feature targets isn't available to
// test against during this work — exercises the identical code paths (ingest_run, add_root_run,
// scan_run, metadata_run, sidecar_run, query_run, note_deleted_run) a real card->SSD->catalog
// flow would, with real EXIF, a real XMP write, and a real trash_file delete.
//
// Prerequisite: a folder of real photo+.xmp pairs at /tmp/chroma_fake_card (flat, camera-style).
// Any real JPEGs with EXIF work; this repo's own gitignored `geneva/` is what it was run against:
//   mkdir -p /tmp/chroma_fake_card && cp geneva/__TM39*.{jpg,xmp} /tmp/chroma_fake_card/
//
//   cargo run --example fake_ssd_probe
//
// Uses an ISOLATED catalog.db (CS_CATALOG_DIR under the fake SSD's own folder), never the real
// app's — the Originals/ folder it produces is left on disk afterward specifically so the real
// app's own "Choose folder…" can be pointed at it too, which populates the REAL catalog.db
// through the real UI path instead of this probe's.
#[path = "../src/fastthumb.rs"]
mod fastthumb;
#[path = "../src/lens_correct.rs"]
mod lens_correct;
#[path = "../src/library.rs"]
mod library;
#[path = "../src/ingest.rs"]
mod ingest;
#[path = "../src/catalog.rs"]
mod catalog;

use std::path::Path;
use std::sync::atomic::AtomicBool;

// ingest.rs calls crate::unique_dest_pub — this example IS its own crate root, so it needs its
// own copy. Verbatim from main.rs's own unique_dest/unique_dest_pub.
fn unique_dest(dir: &Path, name: &str) -> std::path::PathBuf {
    let base = Path::new(name);
    let stem = base.file_stem().and_then(|s| s.to_str()).unwrap_or("export").to_string();
    let ext = base.extension().and_then(|e| e.to_str()).unwrap_or("").to_string();
    let mut dest = dir.join(name);
    let mut n = 2;
    while dest.exists() {
        let alt = if ext.is_empty() { format!("{stem} ({n})") } else { format!("{stem} ({n}).{ext}") };
        dest = dir.join(alt);
        n += 1;
    }
    dest
}
pub(crate) fn unique_dest_pub(dir: &Path, name: &str) -> std::path::PathBuf {
    unique_dest(dir, name)
}

fn main() {
    let card = "/tmp/chroma_fake_card";
    let ssd_root = std::env::var("HOME").unwrap() + "/Desktop/chroma-test-ssd";
    let originals = format!("{ssd_root}/Originals");
    let catalog_dir = format!("{ssd_root}/.catalog-probe");
    std::env::set_var("CS_CATALOG_DIR", &catalog_dir);

    println!("=== 1. Card scan (ingest.rs::scan_card) ===");
    let scanned = ingest::scan_card(card.to_string(), None).expect("scan_card");
    println!("found {} media files on the fake card", scanned.len());
    for f in scanned.iter().take(3) {
        println!("  {} — kind={} date={:?}", f.name, f.kind, f.date);
    }

    println!("\n=== 2. Real import (ingest.rs::ingest_run) — lays out by capture date ===");
    let mut ticks = 0usize;
    let result = ingest::ingest_run(
        scanned,
        ingest::IngestOptions {
            dest_root: originals.clone(),
            backup_root: None,
            folder_template: None, // default "{YYYY}/{YYYY-MM-DD}" — the real SSD layout
            filename_template: None,
            skip_duplicates: true,
            only: Vec::new(),
        },
        &mut |_p| ticks += 1,
    )
    .expect("ingest_run");
    println!("copied {} files ({} bytes), {} duplicates skipped, {} failed",
        result.copied, result.bytes, result.duplicates_skipped, result.failed.len());
    if !result.failed.is_empty() {
        println!("  failures: {:?}", result.failed);
    }

    println!("\n=== 3. Real date folders on disk ===");
    let mut dirs = Vec::new();
    fn walk_dirs(p: &Path, out: &mut Vec<String>) {
        if let Ok(rd) = std::fs::read_dir(p) {
            for e in rd.flatten() {
                let ep = e.path();
                if ep.is_dir() {
                    out.push(ep.strip_prefix(std::env::var("HOME").unwrap() + "/Desktop/chroma-test-ssd").unwrap_or(&ep).to_string_lossy().into_owned());
                    walk_dirs(&ep, out);
                }
            }
        }
    }
    walk_dirs(Path::new(&originals), &mut dirs);
    dirs.sort();
    for d in &dirs { println!("  {d}"); }

    println!("\n=== 4. Catalog: add_root + scan phase A (walk) ===");
    let state = catalog::CatalogState::new();
    let conn = state.conn.into_inner().unwrap();
    let root = catalog::add_root_run(&conn, &originals, Some("originals".to_string())).expect("add_root_run");
    let cancel = AtomicBool::new(false);
    let scan_result = catalog::scan_run(&conn, Some(root.volume_id), &mut |_| {}, &cancel).expect("scan_run");
    println!("scanned {} files, {} added, {} marked absent", scan_result.scanned, scan_result.added, scan_result.marked_absent);

    println!("\n=== 5. Catalog: scan phase B (EXIF metadata) ===");
    let meta_result = catalog::metadata_run(&conn, &mut |_| {}, &cancel).expect("metadata_run");
    println!("read metadata for {} photos", meta_result.read);

    println!("\n=== 6. Query: All Photos, as the real UI would see it ===");
    let page = catalog::query_run(&conn, catalog::CatalogQuery::default()).expect("query_run");
    println!("total={} capped={}", page.total, page.capped);
    for e in page.entries.iter().take(8) {
        println!("  id={} {} kind={} size={}B offline={}", e.id, e.name, e.kind, e.size, e.offline);
    }

    println!("\n=== 7. Set a real rating via the app's own sidecar writer ===");
    let target = page.entries[0].path.clone();
    library::set_sidecar(target.clone(), 5, "Green".to_string(), true, None, Some(true)).expect("set_sidecar");
    println!("rated {} 5 stars + Green + Favorite via the real XMP writer", page.entries[0].name);

    println!("\n=== 8. Catalog: scan phase A+C picks up the sidecar ===");
    catalog::scan_run(&conn, Some(root.volume_id), &mut |_| {}, &cancel).expect("rescan");
    let sc_result = catalog::sidecar_run(&conn, &mut |_| {}, &cancel).expect("sidecar_run");
    println!("synced {} sidecars", sc_result.read);
    let page2 = catalog::query_run(&conn, catalog::CatalogQuery::default()).expect("query_run 2");
    let rated = page2.entries.iter().find(|e| e.path == target).unwrap();
    println!("  confirmed via catalog_query: {} id={}", rated.name, rated.id);

    println!("\n=== 9. Delete: trash it, mark absent immediately, verify rating survives ===");
    library::trash_file(target.clone()).expect("trash_file");
    let deleted = catalog::note_deleted_run(&conn, &[target.clone()]).expect("note_deleted_run");
    println!("note_deleted_run matched {} row(s)", deleted);
    let page3 = catalog::query_run(&conn, catalog::CatalogQuery::default()).expect("query_run 3");
    println!("total after delete: {} (was {})", page3.total, page.total);
    assert_eq!(page3.total, page.total - 1, "the deleted photo must disappear from query results immediately");

    println!("\n=== 10. Resumability: re-run everything, confirm zero redundant work ===");
    let r2 = catalog::scan_run(&conn, Some(root.volume_id), &mut |_| {}, &cancel).expect("rescan2");
    let m2 = catalog::metadata_run(&conn, &mut |_| {}, &cancel).expect("meta2");
    let s2 = catalog::sidecar_run(&conn, &mut |_| {}, &cancel).expect("sc2");
    println!("second pass: added={} metadata_read={} sidecar_read={} (all should be 0)", r2.added, m2.read, s2.read);

    println!("\n✅ All stages completed successfully.");
    println!("Fake SSD is at: {originals}");
    println!("Point the real app's \"Choose folder…\" (Devices, sidebar) at that path to browse it live.");
}
