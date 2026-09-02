//! Native-side diagnostics support.
//!
//! `log stream --predicate 'process == "chromasmith"'` (what diagnostics/log_capture.py
//! originally relied on for native stderr) was confirmed live to capture only os_log/NSLog
//! traffic from system frameworks (AppleJPEG, CarbonCore, ...) attributed to this process
//! — never our own `eprintln!`/`log::` text. Plain stdio writes from a GUI-launched app
//! simply don't reach unified logging here.
//!
//! The real fix is `tauri-plugin-log` (see main.rs's `.plugin(tauri_plugin_log::Builder...)`
//! and its `LogDir` target) — it writes a genuine file to disk
//! (`~/Library/Logs/com.tareq.chromasmith/chromasmith.log`) that `tail`/`cat` (or
//! diagnostics/log_capture.py) can read directly, and `attachConsole()` on the JS side
//! (chromasmith-22.html) forwards the frontend's own console.log/error into the same
//! pipeline — so log capture for BOTH sides is now "read a file", not a ring buffer this
//! module used to maintain and a Tauri command to poll it. `log()` below is a thin
//! wrapper over the `log` crate's own macros for that reason; it holds no state of its own.
//!
//! What's left here, genuinely not covered by a log line: the one process-wide panic hook
//! (there was none before this), and a shared counter for thumbnail-generation progress,
//! which previously existed as two independently-counted, unsynchronized paths (see the
//! `catalog-scan` listener comment in library-ui.js) — this gives a diagnostics poller one
//! place to read "is the indexer actually moving" without caring which path produced it.

use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;

/// Log a diagnostic line through the `log` crate, which `tauri_plugin_log`'s targets
/// (Stdout + LogDir + Webview, see main.rs) persist to a real file automatically.
/// A panic is tagged with a literal "PANIC:" prefix — it's logged at ERROR level like
/// any other error (PanicHookInfo's own Display text doesn't otherwise say "panic"),
/// and diagnostics/known_bugs.py's native-panic match depends on that exact string.
pub fn log(level: &str, msg: impl AsRef<str>) {
    let msg = msg.as_ref();
    match level {
        "panic" => log::error!("PANIC: {msg}"),
        "error" => log::error!("{msg}"),
        "warn" => log::warn!("{msg}"),
        _ => log::info!("{msg}"),
    }
}

/// Install once, at the very top of `main()` — captures panic messages that were
/// previously invisible outside a terminal (there was no `panic::set_hook` anywhere
/// in this codebase before). Preserves the default hook's own terminal output.
pub fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log("panic", info.to_string());
        default_hook(info);
    }));
}

static THUMB_GENERATED_SESSION: AtomicU64 = AtomicU64::new(0);
static THUMB_REMAINING: AtomicU64 = AtomicU64::new(u64::MAX); // MAX = "no reading yet"

/// Called from catalog_thumbnails after each batch. `generated_this_batch` accumulates
/// into a running session total; `remaining` is a point-in-time backlog reading (not
/// additive — each call replaces it with the latest known value).
pub fn record_thumb_progress(generated_this_batch: u64, remaining: u64) {
    THUMB_GENERATED_SESSION.fetch_add(generated_this_batch, Ordering::Relaxed);
    THUMB_REMAINING.store(remaining, Ordering::Relaxed);
}

#[derive(Serialize)]
pub struct DiagNativeState {
    binary_path: String,
    binary_mtime: Option<f64>,
    thumb_generated_session: u64,
    thumb_remaining: Option<u64>,
}

#[tauri::command]
pub fn diag_native_state() -> DiagNativeState {
    let exe = std::env::current_exe().ok();
    let binary_path = exe.as_ref().map(|p| p.display().to_string()).unwrap_or_default();
    let binary_mtime = exe
        .as_ref()
        .and_then(|p| std::fs::metadata(p).ok())
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64());

    let remaining = THUMB_REMAINING.load(Ordering::Relaxed);

    DiagNativeState {
        binary_path,
        binary_mtime,
        thumb_generated_session: THUMB_GENERATED_SESSION.load(Ordering::Relaxed),
        thumb_remaining: if remaining == u64::MAX { None } else { Some(remaining) },
    }
}
