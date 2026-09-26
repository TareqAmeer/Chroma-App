# CHR-152 motion research: photograph-led storytelling

Research date: 2026-09-26. Awwwards entries are references for visual direction; where an entry only labels an element rather than explaining its implementation, the design conclusions below are our interpretation.

## Patterns worth using

1. [LM/AL's scroll portfolio gallery](https://www.awwwards.com/inspiration/scroll-portfolio-gallery-lm-al-c-portfolio-23) and [Vincent & Dussault's scroll gallery](https://www.awwwards.com/inspiration/scroll-gallery-https-vincentetdussault-com) put photographs first. Takeaway: the image should carry the narrative, with UI treated as supporting evidence.
2. [Kirschberg's scrolling navigation/image transition](https://www.awwwards.com/inspiration/image-effect-transition-scrolling-navigation-kirschberg) and [Serhii Churilov's seamless transition](https://www.awwwards.com/inspiration/home-page-scroll-serhii-churilov) suggest spatial continuity across stops. Takeaway: move the same frame between Gallery, Studio, comparison, and Film rather than resetting the scene each chapter.
3. [Aerleum's fluid reveal](https://www.awwwards.com/inspiration/page-scroll-aerleum) and [Kaze's scroll and gallery opening elements](https://www.awwwards.com/inspiration/mobile-kaze) show that image reveals can define a chapter. Takeaway: Gallery's image opens with a mask, the interface detail slides into Studio, and Film develops from original to final.
4. [Repeat's horizontal/vertical composition changes](https://www.awwwards.com/inspiration/horizontal-and-vertical-scroll) and [Bright Biotech's scrolling story](https://www.awwwards.com/inspiration/team-interactive-scrolling-story-bright-biotech) show changing density and pacing. Takeaway: avoid repeating an equal screenshot/text grid. Use a photographic archive scene, an overlapping editor detail, a manual comparison, then a quiet final frame.
5. [Oaksun Studio's stacked cards and text reveal](https://www.awwwards.com/inspiration/silky-smooth-marquee-scroll-oaksun-studio) is a useful reminder that motion can have several roles. Takeaway: use different signatures for the frame, interface, and copy, while keeping the scroll gesture predictable.

## Second pass: moving beyond slides

The first implementation still placed a photograph beside a headline at every stop and converted each small wheel gesture into a complete page jump. The visual references below informed a more spatial, less uniform composition. Awwwards element pages name and preview an effect but rarely disclose its mechanics, so the interpretations are design decisions rather than claims about a site's code.

1. [Michael R. Johnson's depth gallery](https://www.awwwards.com/inspiration/gallery-z-axis-depth-scroll-michael-r-johnson-portfolio): use size and perspective to establish depth, rather than fade every photo in from the same direction.
2. [Next Level Fairs' mixed-axis scroll](https://www.awwwards.com/inspiration/mixing-horizontal-and-vertical-scroll): vary the direction of movement within a vertical narrative.
3. [Kirschberg's image-effect navigation](https://www.awwwards.com/inspiration/image-effect-transition-scrolling-navigation-kirschberg): transitions can be their own visual event between destinations.
4. [OIC Design's image/text mask](https://www.awwwards.com/inspiration/text-with-image-background-scroll-effect-oic-design): make type and photography share the frame instead of occupying fixed columns.
5. [Charles Leclerc's homepage scroll](https://www.awwwards.com/inspiration/homepage-scroll-charles-leclerc): the navigation and image transition can participate in the composition.
6. [Repeat's changing scroll axes](https://www.awwwards.com/inspiration/horizontal-and-vertical-scroll): shift visual weight from side to side while the visitor keeps moving vertically.
7. [Oaksun Studio's stacked cards and text](https://www.awwwards.com/inspiration/silky-smooth-marquee-scroll-oaksun-studio): a card sequence can have depth and stagger without making every chapter a card.
8. [Codrops' sticky grid scroll](https://tympanus.net/codrops/2026/03/02/sticky-grid-scroll-building-a-scroll-driven-animated-grid/): treat scroll position as continuous time inside a scene, with arrival, expansion and settling phases.
9. [Codrops' perspective grid](https://tympanus.net/codrops/2023/08/03/on-scroll-perspective-grid-animations/): apply 3D perspective to a few photo tiles to suggest an archive with depth.
10. [Codrops' layered zoom](https://tympanus.net/codrops/2025/10/29/building-a-layered-zoom-scroll-effect-with-gsap-scrollsmoother-and-scrolltrigger/): let image, copy and interface detail move at different rates, keeping the photograph as the anchor.
11. [Codrops' SVG mask transitions](https://tympanus.net/codrops/2026/03/11/svg-mask-transitions-on-scroll-with-gsap-and-scrolltrigger/): a transition can briefly assemble a full new image before releasing it. We chose transform-driven strips to avoid a large animated mask.
12. [Codrops' 3D carousel](https://tympanus.net/codrops/2025/05/07/on-scroll-3d-carousel/): depth can be theatrical. We used rotation and perspective on the Gallery contact sheet without adding a 3D engine to the landing page.

## Implementation choices

- Desktop wheel movement stays native while the gesture is active. After 155 ms without wheel input, a critically damped spring settles on the next chapter. Another gesture interrupts it. Touch retains native section snap.
- Five full-height image strips assemble the destination photograph, hold a complete image briefly, then separate. Sections with no photograph use a dark red or black shutter.
- Photo tiles, the open Studio frame, interface detail, comparison, Film print, phone, founder graphic and beta cards respond directly to scroll progress. Reversing scroll reverses the motion. The Film original fades into a genuine Chromasmith export.
- The before/after slider remains a manual range control with keyboard support. `site/render-story-photo.mjs` reproduces the real app output from the temporary repository sample.
- The expensive visual changes primarily use `transform` and `opacity`, following [web.dev's animation performance guidance](https://web.dev/articles/animations-and-performance). Reduced-motion visitors receive the final static compositions, following [MDN's reduced-motion guidance](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion).
- We kept the implementation self-contained. [GSAP ScrollTrigger's scrub and snap model](https://gsap.com/docs/v3/Plugins/ScrollTrigger/) informed the choreography, but this page does not load GSAP.
