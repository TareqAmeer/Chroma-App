# Ident: 50 improvements over the CSS-3D cut

The old cut faked 3D with CSS `perspective` on zero-thickness divs. That is the root cause of the "cheap" look,
so the ident is now real 3D (three.js, vendored in `lib/three`, MIT). Status: **Kept** = in the render and checked on
preview contact sheets · **Tried→changed** = tested, the first value looked wrong, retuned · **Rejected** = tested and removed · **Next** = not done yet.

## Form and material
1. Real extruded slabs with thickness, not paper-thin planes. **Kept**
2. Bevelled, rounded edges that catch light along the rim. **Kept**
3. Physically based clearcoat materials instead of CSS gradient "shine". **Kept**
4. Brushed roughness maps, so highlights stretch instead of sitting as flat blobs. **Kept**
5. Separate side material, slightly darker than the face, so the edges read. **Kept**
6. The overlap diagonal comes from the SVG mark, painted onto the orange face as a texture. **Kept**
7. Orange gets a little self-emission so the brand colour doesn't go muddy in shadow. **Kept**
8. Iridescence on the orange. **Rejected** (looked like plastic toy)
9. Logo built in the same proportions as the SVG (1 unit = .05). **Kept**
10. The final logo stays the 3D objects. No hard swap to a flat SVG. **Kept**

## Light
11. Image-based environment reflections (RoomEnvironment PMREM). **Kept**
12. Warm key light from upper right. **Kept**
13. Cool blue rim light from behind, separating the slabs from the void. **Kept**
14. Low cool fill so the shadows aren't crushed. **Kept**
15. Real soft shadows: the orange slab shadows the white one. **Kept**
16. A moving softbox (RectAreaLight) sweeps a highlight across the faces at 4–5.6s. **Kept**
17. Orange "forge" point light at impact. **Rejected** (left a cheap hotspot dot on the face)
18. The forge moved to a warm pulse in the backdrop behind the mark. **Kept**
19. Removed the generic blue lens flare, crosshair streak and ghost rings. **Kept**
20. Backdrop lift: the void opens up from black over the first 1.5s. **Kept**

## Camera
21. Longer lens (28° FOV), less wide-angle distortion. **Kept**
22. Orbit from 30° to about 8°, so thickness and parallax show the whole time. **Kept**
23. Slow push-in that never fully stops, so the end card isn't dead static. **Kept**
24. Tiny decaying camera jolts on each landing. **Kept**
25. Framing: pulled back so the mark doesn't crowd the title. **Tried→changed** (first pass was too close)
26. Mark centred over the title, compensating for the orbit offset. **Kept**

## Motion
27. Bezier flight paths instead of linear lerps. **Kept**
28. Position eases out cubic; rotation eases out quintic, landing slightly after. **Kept**
29. Damped wobble after landing, so the slabs feel like they have mass. **Kept**
30. The white slab recoils when the orange slab hits it. **Kept**
31. The orange slab enters from in front of the lens, then racks into focus. **Kept**
32. Dust particles drift through the light for scale and depth. **Kept**

## Optics and post
33. Real motion blur: 10 subframes per frame, 180° shutter. **Kept**
34. Accumulation weighted correctly. **Tried→changed** (first pass applied the weight twice: everything was 1/subframes too dark)
35. Depth of field with a rack focus that follows whichever slab is moving. **Kept**
36. DOF opens to sharp once the mark lands. **Tried→changed** (first pass left the whole end card soft)
37. Bloom only on true highlights (threshold 1.0, low strength). **Tried→changed** (first pass made a halo)
38. ACES tone mapping. **Rejected** (turned the brand orange crimson and the white grey)
39. Hue-preserving shoulder tone curve instead. **Kept**
40. Subtle teal-shadow/amber-highlight split. **Kept**
41. Light chromatic fringe toward the corners. **Kept**
42. Vignette. **Kept**
43. Per-frame film grain with a proper hash. **Tried→changed** (the sin-hash grain made visible stripes)
44. Rendered natively at 1920×1080 instead of 1280×720 upscaled. **Kept**

## Type and sound
45. "CHROMASMITH" spelled as the brand. The hyphens are gone. **Kept**
46. No glow on the type, warm white matching the white slab. **Kept**
47. Letters rise through a mask one by one, with tracking easing in. **Kept**
48. A thin rule draws out from the centre, then the credit settles in. **Kept**
49. Sound hits retimed to the new landings, plus sub-bass thuds for weight. **Kept**
50. Fade to black at the end. **Kept**

## Next, not yet done
- Brighter brand orange: it still reads a shade darker than #ff3b1f on the end card.
- A faint floor reflection under the mark.
- Real HDR environment map instead of RoomEnvironment.
- A colour pass inside Chromasmith itself (dogfood the grain/halation) instead of the in-shader grade.

Render: `FFMPEG=path/to/ffmpeg node design/video/chromasmith-intro/render.mjs [--preview] [--sub=10]`.
A full render takes about 1m45s on this machine's GPU.
