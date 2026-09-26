# CHR-152: 20 ways to make the site feel less like a slide deck

The current page has a fixed viewport height and a similar composition in many chapters. More
entrance animation alone will not change that rhythm. These are proposals for review, not
features silently added to the page. Ideas 2–20 can keep chapter snapping; idea 1 would change
the scrolling rule the user previously requested.

1. **Vary section length when the story needs it.** Let a photo sequence or the feature list take
   more than one viewport, with a gentle snap only at meaningful breaks. This is the largest
   change to the current interaction, so review it first.
2. **Carry one real photo through several chapters.** Move from contact sheet to editor to film
   finish using the same image so scrolling feels like following work in progress.
3. **Use a real original/export pair.** Make the comparison an actual Chromasmith result and let
   the visitor move the divider. The current dog comparison is explicitly a layout placeholder.
4. **Keep one visual element continuous across transitions.** A photo could resize from the hero
   into a gallery tile, then expand into the editor rather than vanishing at each boundary.
5. **Make the first viewport mostly photograph.** Move most copy lower in the frame and let the
   image establish mood before the product claims arrive.
6. **Break the repeated screenshot-and-headline pattern.** Alternate full-bleed photography,
   close tool details, overlapping panels, and quiet text-led moments.
7. **Show tiny real interactions in the app UI.** A five-second curve drag or mask reveal can
   explain a capability faster than another static product screenshot.
8. **Scrub a three-stage edit.** Let one image progress through original, corrected, and film
   finish as scroll position changes; keep manual controls alongside it.
9. **Use a contact sheet as navigation.** Let selected thumbnails expand into a single image or
   related feature, giving the visitor a photographer's way into the story.
10. **Let captions come from the photographs.** Show place, lens, exposure or the editor's own
    before/after note instead of repeated generic marketing labels.
11. **Make transitions spatial.** Have the next photo enter from an edge or behind the current
    one, maintaining visual continuity instead of resetting to an empty black slide.
12. **Change the pace deliberately.** Follow a dense tool scene with a quiet full-screen photo;
    give visitors a pause before the next claim.
13. **Pin only the image during a short explanation.** Let two or three captions move beside one
    photograph, then release it into the next chapter.
14. **Add a small, live film-look sampler.** A few authentic presets on one image would invite
    exploration without requiring the whole app to load.
15. **Use colour from the image.** Let a restrained sampled accent carry between chapters, so
    the palette changes for a photographic reason.
16. **Bring the maker into the process.** Replace the CHRO-MA-GUY placeholder with a portrait,
    workspace image, and a brief first-person note about a real design decision.
17. **Animate with scroll progress, not one entrance preset.** Make a crop, mask or film texture
    advance and reverse with the user's movement where browser support allows it.
18. **Give each chapter a distinct motion signature.** Gallery could gather tiles; Studio could
    reveal controls; Film could develop an image. Keep motion tied to what each tool does.
19. **Offer a sample-photo launch.** One click could open the actual editor with a supplied image
    and a starting look, turning the page from a pitch into a short trial.
20. **Measure and trim the motion.** Keep only movement that explains a change; use transform and
    opacity for smoothness, and provide a still version for reduced-motion visitors.

The product references are [VSCO's editor page](https://www.vsco.co/features/photo-editor)
and [Photomator's product page](https://www.pixelmator.com/photomator), which pair outcomes
with genuine photo or product examples. For the motion proposals, see [MDN's scroll-driven
timelines](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations/Timelines),
[GSAP ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/),
[web.dev on animation performance](https://web.dev/articles/animations-and-performance), and
[web.dev on reduced motion](https://web.dev/articles/prefers-reduced-motion).
