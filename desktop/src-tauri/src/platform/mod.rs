//! OS-service surface: every place the desktop shell touches something that isn't pure Rust.
//!
//! Each fn here is a single flat call — no `cfg` at the call site. `macos.rs` holds the bodies
//! that shipped before this module existed (moved, not rewritten, so `cargo test` proves
//! nothing regressed); `windows.rs` holds the Windows port. See CLAUDE.md's Windows-port plan
//! for the reasoning behind each choice (COM apartment threading for trash, MAX_PATH handling,
//! why HEIC decode fails cleanly instead of vendoring a decoder, etc.).

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::*;

#[cfg(not(any(target_os = "macos", windows)))]
compile_error!("desktop shell only supports macOS and Windows");
