# Vendored ONNX Runtime DLL (x86_64-pc-windows-msvc)

- `onnxruntime.dll` — Microsoft's official current release for Windows x64
  (`onnxruntime-win-x64-<version>.zip`), MIT-licensed (see `LICENSE`, fetched alongside it).
- Source: https://github.com/microsoft/onnxruntime/releases

## Why this is a current release, unlike the macOS side's pinned v1.20.0

`../README.md` (the macOS Intel dylib) explains why that one is pinned old: Microsoft dropped
Intel-Mac prebuilts after v1.20.0. No such constraint exists on Windows — Microsoft ships a
`win-x64` build for every release — so this vendors whatever the current release is when fetched,
rather than pinning. `sam.rs`/`rawdenoise.rs` call the ONNX Runtime C API directly at
`api-17` (`ort-sys`'s `Cargo.toml` feature); ONNX Runtime's C API is backward compatible, so a
current runtime still serves that API version via `GetApi(17)`.

## Fetching

**NOT committed to git** — 16MB DLL, no reason to carry binary history for something that's a
plain redistributable download. `.gitignore` excludes this directory's `*.dll`; re-fetch after a
fresh clone with:

```bash
cd desktop/src-tauri/vendor/onnxruntime/win-x64
curl -sL "https://github.com/microsoft/onnxruntime/releases/latest/download/onnxruntime-win-x64-<version>.zip" -o ort.zip
```

(Or resolve the latest tag first — `curl -s https://api.github.com/repos/microsoft/onnxruntime/releases/latest`
— and download that release's `onnxruntime-win-x64-<tag>.zip` asset directly, since GitHub's
`/releases/latest/download/` alias needs the exact versioned filename.) Then extract
`onnxruntime-win-x64-<version>/lib/onnxruntime.dll` (and `LICENSE`) into this directory.

`tauri.windows.conf.json`'s `bundle.resources` maps this file to `vendor/onnxruntime/onnxruntime.dll`
in the installed app, the same resource-bundling mechanism the macOS side uses for its dylib.
