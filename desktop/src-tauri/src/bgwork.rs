// Shared policy for CPU-heavy BACKGROUND work (face/pet/CLIP scanning, thumbnail generation,
// RAW demosaic batches, DBSCAN clustering) — everything that competes with the interactive UI
// thread for cores. Grew out of a live incident (see catalog.rs's face_scan_fail_count comment
// and scrfd.rs's INTRA_OP_THREADS comment): a stuck face scan pegged the CPU with the app
// reading as "not responding". The fix so far had been repeatedly tightening various thread-
// count caps (main.rs's rayon cap, then scrfd.rs's ONNX intra-op cap) — a real improvement each
// time, but a game of whack-a-mole rather than a real policy, and thread-count caps alone cannot
// fully prevent a UI stall: they bound CONCURRENCY, not scheduling PRIORITY.
//
// This module ports the actual mechanisms native macOS apps use for exactly this problem
// (researched before writing any of this — see the module-level rationale in each function):
//   1. QoS (thread scheduling priority) — `mark_current_thread_background()`. This is the
//      primary fix: a low-QoS thread can still use 100% of an idle core, but the scheduler
//      preempts it in favor of ANY higher-QoS thread (the UI thread included) the instant
//      there's contention. Photos.app/Lightroom-class apps run indexing at `.utility`/
//      `.background` QoS for exactly this reason — it works even when a caller picks a bad
//      thread-count, unlike a count-only cap.
//   2. System-state throttling — `throttle_pause()`. Pause/slow background work under thermal
//      pressure or low-power mode, mirroring `ProcessInfo.thermalState`/`isLowPowerModeEnabled`
//      checks that Photos/Lightroom use to avoid indexing during a thermal event or on battery.
//   3. Adaptive backoff — `ChunkPacer`. Rather than trust a single hardcoded batch size forever,
//      measure how long each unit of work actually took and insert a proportional pause when it
//      overshoots a sane baseline. This is a practical stand-in for a literal main-thread
//      heartbeat/watchdog (which this codebase has no cheap hook for today — no periodic IPC
//      "tick" already threads a timestamp from the webview into Rust): an unexpectedly slow
//      chunk IS the symptom of system contention, whatever its root cause, so backing off in
//      response converges on the same outcome a real watchdog would produce.
//
// None of this replaces the existing thread-count caps (main.rs's rayon pool, scrfd.rs's ONNX
// intra-op cap) — QoS and count caps are complementary, and real GCD-based apps use both
// together (a low-QoS `DispatchQueue` paired with a `maxConcurrentOperationCount`).

use std::time::{Duration, Instant};

/// Mark the CALLING thread as background-priority work, macOS only (a plain no-op elsewhere,
/// including on the same code path built for other targets — there is no numbered thread-
/// priority equivalent worth reaching for on Linux/Windows here, and this app only ships for
/// macOS/iOS today per CLAUDE.md).
///
/// Uses the plain C `pthread_set_qos_class_self_np` (declared in `<pthread/qos.h>`, a stable
/// public Darwin API — NOT Objective-C, so no objc2 needed here unlike bgwork's thermal check).
/// Affects only the thread that calls it; call this as the FIRST thing inside any rayon
/// `start_handler`/`ThreadPoolBuilder` worker or any `std::thread::spawn` closure that does
/// scan/decode/inference work, never on the main/UI thread.
#[cfg(target_os = "macos")]
pub fn mark_current_thread_background() {
    #[allow(non_camel_case_types)]
    type qos_class_t = u32;
    const QOS_CLASS_UTILITY: qos_class_t = 0x11;
    extern "C" {
        fn pthread_set_qos_class_self_np(qos_class: qos_class_t, relative_priority: i32) -> i32;
    }
    // relative_priority must be <= 0 (a further de-prioritization within the class); 0 = the
    // class's own default. Ignoring the return: a failure here just leaves the thread at
    // whatever QoS it already had (inherited from its parent), which is the same as never
    // having called this at all — nothing to clean up either way.
    unsafe {
        let _ = pthread_set_qos_class_self_np(QOS_CLASS_UTILITY, 0);
    }
}

#[cfg(not(target_os = "macos"))]
pub fn mark_current_thread_background() {}

/// How long to pause before the NEXT unit of background work, given current system pressure.
/// `None` means proceed immediately (the common case). Checked via `NSProcessInfo` (objc2 —
/// already a dependency, used the same way gainmap.rs already talks to Core Image).
///
/// Two independent signals, matching what Photos.app/Lightroom throttle on:
///   - `thermalState`: `.serious`/`.critical` means the OS itself is already trying to shed
///     load — continuing to burn cores on a background scan risks a fan-spin/thermal-throttle
///     spiral that also slows the UI indirectly (CPU frequency scaling under thermal pressure
///     hits every thread, not just this process's background ones).
///   - `isLowPowerModeEnabled`: the user has explicitly asked for reduced background activity to
///     save battery — running a full-speed AI scan is directly against that stated preference,
///     independent of whether the machine happens to be thermally comfortable right now.
#[cfg(target_os = "macos")]
pub fn throttle_pause() -> Option<Duration> {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    unsafe {
        let info: *mut AnyObject = msg_send![class!(NSProcessInfo), processInfo];
        if info.is_null() {
            return None;
        }
        // NSProcessInfoThermalState: 0=nominal, 1=fair, 2=serious, 3=critical.
        let thermal: isize = msg_send![info, thermalState];
        let low_power: bool = msg_send![info, isLowPowerModeEnabled];
        if thermal >= 3 {
            Some(Duration::from_secs(5)) // critical — pause hard, re-check next chunk
        } else if thermal >= 2 {
            Some(Duration::from_millis(1500)) // serious — slow down significantly
        } else if low_power {
            Some(Duration::from_millis(400)) // user asked for reduced background activity
        } else {
            None
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn throttle_pause() -> Option<Duration> {
    None
}

/// Adaptive pacing between chunks of background work: measures each chunk's wall time and
/// inserts a proportional pause once it overshoots a baseline "this should be fast" budget,
/// instead of hammering the next chunk immediately regardless of how contended the system
/// already looked. Deliberately simple (no PID controller, no history window) — the goal is to
/// convert "things got slow" into "back off a bit", not to hit a precise CPU target.
pub struct ChunkPacer {
    baseline: Duration,
    last_start: Option<Instant>
}

impl ChunkPacer {
    /// `baseline` is the expected wall time for one chunk under NORMAL (uncontended)
    /// conditions — e.g. for faces_run's CHUNK=4 at ~150-250ms/photo of actual SCRFD inference
    /// (serialized behind its single session Mutex — see scrfd.rs), a sane baseline is ~1s.
    /// Pass the real measured figure for the caller's own unit of work, not a guess.
    pub fn new(baseline: Duration) -> Self {
        Self { baseline, last_start: None }
    }

    /// Call once immediately before starting a chunk of work.
    pub fn start_chunk(&mut self) {
        self.last_start = Some(Instant::now());
    }

    /// Call once immediately after a chunk finishes. Returns how long the CALLER should sleep
    /// before starting the next chunk (zero when the chunk finished within budget — the common
    /// case, so this never slows down a healthy scan). Backs off proportionally to the overshoot
    /// rather than a fixed penalty, capped so a single pathological chunk can't stall the whole
    /// scan for an unreasonable amount of real time (also bounded independently by faces_run's
    /// own per-photo timeout).
    pub fn end_chunk(&mut self) -> Duration {
        let Some(start) = self.last_start.take() else { return Duration::ZERO };
        let elapsed = start.elapsed();
        if elapsed <= self.baseline {
            return Duration::ZERO;
        }
        let overshoot = elapsed - self.baseline;
        // Sleep a fraction of the overshoot, not the whole thing — this yields real time back
        // to the rest of the system proportional to how contended things look, without making
        // an already-slow scan glacial. Capped at 3s so pacing itself can't become the new
        // "stuck" complaint.
        (overshoot / 4).min(Duration::from_secs(3))
    }
}
