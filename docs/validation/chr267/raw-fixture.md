# CHR-267 native culling RAW fixture

The performance gate uses a real Nikon Z 7 capture from the [raw.pixls.us archive](https://raw.pixls.us/), sample 2789. Its repository entry reports **45.75 MP**, a CC0 public-domain dedication, and a 14-bit compressed full-size capture in its remark. The archive's generated mode label says 12-bit; the [sample's EXIF listing](https://raw.pixls.us/getfile.php/2789/exif/2-Nikon-Z7-RAW-14bit-compressed-L.NEF.exif.txt) reports Nikon NEF compression and 14 bits for the full RAW subimage. Do not use the generated mode label as the decode specification.

- [Original NEF download](https://raw.pixls.us/getfile.php/2789/nice/Nikon%20-%20Z%207%20-%2012bit%2012bit%20compressed%20%283%3A2%29.NEF)
- [CC0 licence](https://creativecommons.org/publicdomain/zero/1.0/)
- SHA-256: `e54a6c4264bf685214f538036fd9d39088e510b2bfedf288e568f0db1897880e`
- Downloaded size: **51,279,219 bytes**. The full RAW EXIF width is 8288; the Nikon Z 7 full FX image output is [8256 × 5504](https://imaging.nikon.com/imaging/lineup/mirrorless/z_7/index.html).

Keep one shared copy outside task checkouts, under the ignored `.worktrees/_shared-test-runtime/fixtures/chr267/` directory. The gate creates two hard links with distinct path/cache keys; both represent the same real capture. This validates repeated navigation of this capture at two paths, not a heterogeneous shoot or multiple camera formats. The RAW binary is not committed.

Run `node test/library_cull_perf_native.mjs` with the shared Playwright runtime and these environment variables:

- `CULL_RAW_PATH`: absolute path to the downloaded real NEF.
- `CULL_RAW_SHA256`: the checksum above.
- `CULL_RAW_SOURCE`: original download URL above.
- `CULL_RAW_LICENSE`: `CC0-1.0`.
- `CULL_NATIVE_COMMIT`: exact 40-character source commit used to build the native app.
- `CULL_EXPECTED_BUILD`: that app's BUILD stamp.
- `CULL_NATIVE_PROFILE`: `debug` or `release`; timings apply to the recorded build profile.
- `CULL_NATIVE_CATALOG_DIR` and `CULL_NATIVE_CACHE_DIR`: record the task-owned paths supplied as `CS_CATALOG_DIR` and `CS_CACHE_DIR` when launching the native app. A separate WebView profile alone does not isolate these. The gate refuses catalogs containing any photos other than its two RAW paths.
- `NATIVE_CDP`: native WebView debugging endpoint, normally `http://127.0.0.1:9223`.
- `CULL_PERF_REPORT`: optional output JSON path.

The gate refuses `libtest` and requires native IPC. It warms source-resolution cull cells, timestamps actual key/click events, and waits for two animation frames with the correct focused path, decoded source dimensions, a fitted sharp canvas or a source-resolution 1:1 ROI. It records hardware, app build, viewport, cache conditions and samples. Initial disk/OS cache is unspecified; it never clears user caches. The 100 ms and 500 ms requirements remain open until actual native results pass. Report failures and absent/undersized frames; do not accept a zoom label, an embedded preview or a synthetic DNG as evidence.
