# Chromasmith intro: research applied in v3

The v2 review showed that visual intent must be checked in the camera image, not
in world coordinates alone. These practices were new to this intro workflow.

1. **Freeze a beat specification before editing.** OpenAI's Codex workflow recommends a durable spec, milestones, and a definition of done; the 31-item v3 critique supplies the target instead of relying on memory. [OpenAI](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex)
2. **Validate one milestone before the next.** The same workflow describes a plan/edit/test/observe/repair loop. Here, geometry audits preceded render work. [OpenAI](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex)
3. **Record decisions and failed tests.** Keeping a short audit log prevents another attempt at the same ineffective light setup. [OpenAI](https://developers.openai.com/blog/automating-repetitive-work-at-openai-with-codex)
4. **Bake motion paths through the active camera.** Blender can calculate camera-space motion paths, which exposes detours hidden in a 3D viewport. [Blender](https://docs.blender.org/manual/en/latest/animation/motion_paths.html)
5. **Measure projected coordinates.** `world_to_camera_view` returns normalized camera coordinates; the v3 audit checks that both main square centers move without screen-x reversals. [Blender API](https://docs.blender.org/api/5.2/bpy_extras.object_utils.html)
6. **Ray-test source occlusion.** Evaluated mesh `ray_cast` checks whether either solid plate blocks the camera ray to the active rear source; the v3 audit found zero misses. [Blender API](https://docs.blender.org/api/current/bpy.types.Object.html)
7. **Aim focus with an object.** A camera Focus Object follows the intended plane as it moves; v3 keys an Empty from the near square to the completed mark. [Blender](https://docs.blender.org/manual/nl/4.5/render/cameras.html)
8. **Inspect rotation axes, not just angle values.** The old square's Y-axis rotation was in its own plane, so a numerical 360-degree turn made no face flip. V3 rotates around X and checks edge-on frames and facing-sign changes with the evaluated transform.
9. **Use curve controls that cannot overshoot blindly.** Blender's auto-clamped Bézier handles and Graph Editor explain why guide-point interpolation needs inspection; v3 samples a continuous path and audits the projection. [Blender](https://docs.blender.org/manual/en/4.5/animation/keyframes/introduction.html)
10. **Test motion blur at the intended frame rate.** Cycles' shutter spans portions of a frame, and Blender notes moving lights are not included in motion blur; v3 holds the rear source fixed during fast travel and renders the review cut at 24 fps. [Blender](https://docs.blender.org/UATEST/manual/en/4.5/render/cycles/render_settings/motion_blur.html)
11. **Use adaptive sampling for dark frames with bright accents.** Cycles can stop sampling clean pixels early; v3 uses it for diagnostic and preview renders. [Blender](https://docs.blender.org/manual/sl/4.5/render/cycles/render_settings/sampling.html)
12. **Provide denoising passes for low-sample checks.** Blender recommends at least albedo to preserve detail; the v3 preview uses Cycles denoising while the final render can raise samples. [Blender](https://docs.blender.org/manual/sl/4.5/render/cycles/render_settings/sampling.html)
13. **Link lights to intended receivers.** V3 excludes the fog volume from front fill lights, leaving the rear spot to produce the visible, geometry-shadowed beams. [Blender light linking](https://docs.blender.org/manual/en/4.1/render/cycles/object_settings/light_linking.html)
14. **Render a fixed diagnostic beat set before a full cut.** Opening, both edge views, arrival, reflection, wordmark flight, shared byline fade, and final black are rendered separately so specific failures can be repaired quickly.

## V3 checks

- White center screen-x: 0.503 to 0.476; no direction reversal. Edge-on frames 78–94; facing changes at frame 87.
- Orange center screen-x: 1.822 to 0.536; no direction reversal. Edge-on frames 74–84 and 167–175; facing changes at frames 79 and 171.
- Camera ray to active rear source: zero unobstructed frames from 106 to 325.
- Five evaluated bevelled plates: zero intersections at integer and half frames, 1–360.
- Line and subtitle use the same fade interval, frames 294–310.
- Rear beams are cast by a Cycles spot through a volume. All front fill lights exclude the volume, and the plate shadows shape the beams.

The v3 visual cut remains for review before a high-resolution render and audio edit.
