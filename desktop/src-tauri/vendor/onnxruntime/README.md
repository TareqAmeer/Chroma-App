# Vendored ONNX Runtime dylib (x86_64-apple-darwin)

- `libonnxruntime.dylib` — Microsoft's official v1.20.0 release for macOS Intel
  (`onnxruntime-osx-x86_64-1.20.0.tgz`), MIT-licensed (see `LICENSE` in this directory).
- Source: https://github.com/microsoft/onnxruntime/releases/tag/v1.20.0

## Why this is vendored instead of using `ort`'s `download-binaries` feature

The `ort` crate's `download-binaries` feature fetches a prebuilt onnxruntime binary at build
time — but it has **no prebuilt for `x86_64-apple-darwin`** (Intel Mac), only
`aarch64-apple-darwin` (Apple Silicon), as of `ort` 2.0.0-rc.12. This project's actual dev
machine is Intel, so that feature cannot be used as-is.

Microsoft's own onnxruntime releases also dropped Intel Mac prebuilt binaries after v1.20.0 —
this is the last version with one, which is why it's pinned/vendored here rather than fetched
fresh.

## Why sam.rs doesn't use the `ort` crate's own Session API

`ort` 2.0.0-rc.12's `load-dynamic` feature has a confirmed, reproducible bug on this platform:
its internal dylib-handle cache hangs indefinitely the second time anything touches it (e.g.
`Session::builder()` called after `ort::init_from()` already loaded the library once) —
reproduced in a fully isolated test project with nothing but `ort` as a dependency, on both
the dev sandbox and this project's real Intel Mac. `sam.rs` instead calls the ONNX Runtime C
API directly via `ort-sys` (the lower-level struct/binding crate `ort` itself is built on) +
`libloading`, bypassing the buggy caching layer entirely — proven end-to-end with the real
MobileSAM encoder against a real photo before being written this way. See the top of `sam.rs`
for the full trace.
