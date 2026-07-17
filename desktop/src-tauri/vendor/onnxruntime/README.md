# Vendored ONNX Runtime dylib (x86_64-apple-darwin)

- `libonnxruntime.dylib` — Microsoft's official v1.20.0 release for macOS Intel
  (`onnxruntime-osx-x86_64-1.20.0.tgz`), MIT-licensed (see `LICENSE` in this directory).
- Source: https://github.com/microsoft/onnxruntime/releases/tag/v1.20.0

## Why this is vendored instead of using `ort`'s `download-binaries` feature

`ort` (the Rust crate `desktop/src-tauri/src/sam.rs` uses) has a `download-binaries` feature that
fetches a prebuilt onnxruntime binary at build time — but it has **no prebuilt for
`x86_64-apple-darwin`** (Intel Mac), only `aarch64-apple-darwin` (Apple Silicon), as of `ort`
2.0.0-rc.12. This project's actual dev machine is Intel, so that feature cannot be used as-is.

Microsoft's own onnxruntime releases also dropped Intel Mac prebuilt binaries after v1.20.0 —
this is the last version with one, which is why it's pinned/vendored here rather than fetched
fresh.

`Cargo.toml` uses `ort`'s `load-dynamic` feature instead, which dlopen()s this dylib by path at
runtime rather than linking it at build time. `main.rs`'s `.setup()` resolves the path (bundled
resource in a real `.app`, source-tree fallback for `cargo tauri dev`) and calls
`sam::set_dylib_path()` before any AI-select command can run.

⚠️ See the top of `sam.rs`'s `ensure_ort_init()` for an unresolved hang encountered in this
project's dev sandbox when actually calling `Session::builder()` — unconfirmed whether it
reproduces on a real Intel Mac outside that sandbox.
