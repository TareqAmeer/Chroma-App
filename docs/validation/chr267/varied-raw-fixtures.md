# Varied RAW validation fixtures — 12 October 2026

The canonical files live once in `.worktrees/_shared-test-runtime/fixtures/chr267/`.
The native gate uses hard links in `chr267-cull-performance-varied/`; RAW binaries are not tracked.

| Capture | Canonical file | Bytes | SHA-256 | Expected developed size |
| --- | --- | ---: | --- | --- |
| Nikon Z 7, sample 2789 | `nikon-z7-2789.NEF` | 51,279,219 | `e54a6c4264bf685214f538036fd9d39088e510b2bfedf288e568f0db1897880e` | 8256 × 5504 |
| Canon EOS R5, sample 4694, RAW without Dual Pixel | `canon-r5-4694.CR3` | 40,632,406 | `21430c36387efe65bd09ac0fcd724bfd959d93dd391ec811a1b741c8663becb5` | 8192 × 5464, verified native decode |

The [primary repository](https://raw.pixls.us/) and its
[metadata endpoint](https://raw.pixls.us/json/getrepository.php) list both samples under
[CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/). The Canon row lists 44.76 MP,
RAW without Dual Pixel, and the checksum above. The downloaded original matches that checksum.
[Canon original](https://raw.pixls.us/getfile.php/4694/nice/Canon%20-%20EOS%20R5%20-%203%3A2.CR3).

This supplies two different captures and camera formats, not a representative camera/scene
quality set. Preparation is outside the warm presentation interval; OS/disk cache state must
remain explicit. Native dimensions and results belong in the execution report, not this manifest.
The prior same-capture report remains valid for its narrower dataset.
