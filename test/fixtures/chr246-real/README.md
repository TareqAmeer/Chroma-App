# CHR-246 natural-image inpainting fixture

`power-lines.jpg` is *Power lines in the trees - panoramio.jpg* by Nicholas Frisardi,
downloaded from Wikimedia Commons. The photograph is licensed under Creative Commons
Attribution-ShareAlike 3.0 Unported (CC BY-SA 3.0).

- Source page: https://commons.wikimedia.org/wiki/File:Power_lines_in_the_trees_-_panoramio.jpg
- Original file: https://upload.wikimedia.org/wikipedia/commons/0/01/Power_lines_in_the_trees_-_panoramio.jpg
- Dimensions: 4000 × 3000
- SHA-256: `da0e90b0ff663dd8ab543414a44e6c4e068fd005b4e87e96c2d6204286449510`

Please preserve this attribution and license if the fixture is redistributed.

`woman-crossing.jpg` is *Woman walking across street.jpg* by Keith Vaughton, downloaded
from Wikimedia Commons. It is licensed under Creative Commons Attribution 2.0 Generic
(CC BY 2.0).

- Source page: https://commons.wikimedia.org/wiki/File:Woman_walking_across_street.jpg
- Original file: https://upload.wikimedia.org/wikipedia/commons/a/a2/Woman_walking_across_street.jpg
- Dimensions: 4896 × 3264
- SHA-256: `d42caac192b7106e57348af6fa3fd0169ac7790407fa8d2b766e955b047f22a1`
- `woman-crossing-mask.json` is an approximate normalized polygon around the central person
  and their cast shadow. It is an evaluation mask, not a segmentation ground truth.
- Run the real native candidates from the repository root with the pinned model/runtime:
  `cargo run --locked --manifest-path desktop/src-tauri/Cargo.toml --example inpaint_probe -- <onnxruntime.dll> <model-directory> test/fixtures/chr246-real/woman-crossing.jpg test/output/chr246-person test/fixtures/chr246-real/woman-crossing-mask.json`

Please preserve this attribution and indicate any changes if the image is redistributed.
