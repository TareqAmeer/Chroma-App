//! Native-side diagnostics bridge.
//!
//! `log stream --predicate 'process == "chromasmith"'` (what diagnostics/log_capture.py
//! used to rely on for native stderr) was confirmed live to capture only os_log/NSLog
//! traffic from system frameworks (AppleJPEG, CarbonCore, ...) attributed to this
//! process — never our own `eprintln!`/`println!` text. Plain stdio writes from a
//! GUI-launched app simply don't reach unified logging here. This module is the
//! fallback: a small in-memory ring buffer that IS reachable from JS via a Tauri
//! command, so the diagnostics tool can poll it instead.
//!
//! Also home to the one process-wide panic hook (there was none before this) and a
//! shared counter for thumbnail-generation progress, which previously existed as two
//! independently-counted, unsynchronized paths (see the `catalog-scan` listener
//! comment in library-ui.js) — this gives a diagnostics poller one place to read
//! "is the indexer actually moving" without caring which path produced the number.

use serde::Serialize;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const RING_CAPACITY: usize = 200;

#[derive(Serialize, Clone)]
struct LogEntry {
    ts: f64,
    level: String,
    msg: String,
}

fn ring() -> &'static Mutex<VecDeque<LogEntry>> {
    static RING: OnceLock<Mutex<VecDeque<LogEntry>>> = OnceLock::new();
    RING.get_or_init(|| Mutex::new(VecDeque::with_capacity(RING_CAPACITY)))
}

fn now_secs_f64() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

/// Log a diagnostic line. Still `eprintln!`s it (terminal visibility is unchanged
/// for anyone running from a shell) AND pushes it into the ring buffer a Tauri
/// command can hand to JS, which is the part that was missing before.
pub fn log(level: &str, msg: impl Into<String>) {
    let msg = msg.into();
    eprintln!("[{level}] {msg}");
    if let Ok(mut buf) = ring().lock() {
        if buf.len() >= RING_CAPACITY {
            buf.pop_front();
        }
        buf.push_back(LogEntry { ts: now_secs_f64(), level: level.to_string(), msg });
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
    recent_logs: Vec<serde_json::Value>,
    binary_path: String,
    binary_mtime: Option<f64>,
    thumb_generated_session: u64,
    thumb_remaining: Option<u64>,
}

#[tauri::command]
pub fn diag_native_state() -> DiagNativeState {
    let logs: Vec<serde_json::Value> = ring()
        .lock()
        .map(|buf| {
            buf.iter()
                .map(|e| serde_json::json!({"ts": e.ts, "level": e.level, "msg": e.msg}))
                .collect()
        })
        .unwrap_or_default();

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
        recent_logs: logs,
        binary_path,
        binary_mtime,
        thumb_generated_session: THUMB_GENERATED_SESSION.load(Ordering::Relaxed),
        thumb_remaining: if remaining == u64::MAX { None } else { Some(remaining) },
    }
}
