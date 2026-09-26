# CHR-152: photography site and motion research

These are design inferences from the linked sites and technical guidance, recorded so the home
page can keep evolving when the original photographs arrive.

## Important takeaways

### Photography portfolio presentation

1. Open with one image that establishes mood before showing the interface.
2. Keep navigation sparse and visually quieter than the photograph.
3. A dark neutral canvas gives colour photographs room to carry the page.
4. Change image scale between chapters: full-bleed image, framed interface, and close detail.
5. Give each visual a short, specific caption only when it adds context.
6. Use a sequence of images to tell a story instead of repeating identical cards.
7. Keep an About section distinct from the work; it adds a human connection to the tool.

These patterns appear in [Max Montgomery's portfolio case study](https://www.wix.com/explore/websites/site/max-montgomery)
and [Format's photography layouts](https://www.format.com/online-portfolio-website/photography/templates).

### How photo products explain themselves

8. Start each chapter with an outcome the visitor wants, followed by the capability that enables it.
9. Keep one primary claim per section so the visitor can scan the story.
10. Pair a claim with the actual app interface or a real edited image in the same view.
11. Show the easy first action before exposing the deeper controls.
12. A manual original/export comparison communicates the result faster than a technical list.
13. Distinguish the library, editor, film effects, and mobile experience visually.
14. Keep the main action available throughout the page and repeat it at the end.
15. Explain privacy concretely: where photos are processed and where they stay.
16. Put installation details behind an optional disclosure after the product story.

Product-page references: [Lightroom mobile](https://www.adobe.com/products/photoshop-lightroom/mobile.html),
[VSCO photo editor](https://www.vsco.co/features/photo-editor),
[Photomator](https://www.pixelmator.com/photomator), and
[Apple Photos](https://www.apple.com/uk/ios/photos/).

### Motion and interaction

17. Let visitor input set the pace; use directional chapter movement to clarify each transition.
18. Use a short slide and fade to introduce text and imagery, then let them rest.
19. Give the large photograph and framed screenshots slightly different motion for visual rhythm.
20. Keep the brand word and numbered index in sync with the chapter at the viewport centre.
21. Use one-viewport chapters with mandatory snap when they fit, and natural scrolling on short viewports or expanded details.
22. Keep the comparison visitor-controlled rather than automatically moving its divider.
23. Prefer transform and opacity for motion; avoid repeatedly animating layout dimensions.
24. Use an IntersectionObserver for entry and active-section changes instead of heavy scroll work.
25. Treat scroll-linked CSS as progressive enhancement because support is still limited.
26. Provide a still experience for reduced-motion visitors.
27. Any long-running automatic movement would need a pause control, so avoid it here.
28. Prioritize the opening image and lazy-load images farther down the story.

Technical references: [CSS scroll snap](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll_snap/Basic_concepts),
[animation performance](https://web.dev/articles/animations-and-performance),
[Intersection Observer](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API),
[CSS animation timelines](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/animation-timeline),
[reduced motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion),
[W3C animation controls](https://www.w3.org/WAI/tutorials/carousels/animations/), and
[image performance](https://web.dev/learn/performance/image-performance).

## Motion choices for this iteration

The page uses short title, image, panel, phone and portrait arrivals; a changing rail word;
an active numbered index; and a visitor-controlled comparison. One wheel gesture eases to the
next chapter and stops. Touch input uses native mandatory section snapping, with natural
scrolling on short viewports and for reduced-motion visitors. Subtle image drift runs only where
scroll-linked CSS is supported. These effects fit the self-contained page without an animation
library. [GSAP ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/) remains an option
if later revisions need longer pinned narratives or tightly choreographed timelines.

Once the original photos arrive, consider a masked original-to-export reveal, a small sequence
showing one image through Gallery → Studio → Click → Film, and a photographic closing frame.
Keep the final comparison truthful: the two images should be the real original and Chromasmith
export at matching dimensions.
