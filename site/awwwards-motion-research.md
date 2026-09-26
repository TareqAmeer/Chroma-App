# CHR-152 motion research: photograph-led storytelling

Research date: 2026-09-26. Awwwards entries are references for visual direction; where an entry only labels an element rather than explaining its implementation, the design conclusions below are our interpretation.

## Patterns worth using

1. [LM/AL's scroll portfolio gallery](https://www.awwwards.com/inspiration/scroll-portfolio-gallery-lm-al-c-portfolio-23) and [Vincent & Dussault's scroll gallery](https://www.awwwards.com/inspiration/scroll-gallery-https-vincentetdussault-com) put photographs first. Takeaway: the image should carry the narrative, with UI treated as supporting evidence.
2. [Kirschberg's scrolling navigation/image transition](https://www.awwwards.com/inspiration/image-effect-transition-scrolling-navigation-kirschberg) and [Serhii Churilov's seamless transition](https://www.awwwards.com/inspiration/home-page-scroll-serhii-churilov) suggest spatial continuity across stops. Takeaway: move the same frame between Gallery, Studio, comparison, and Film rather than resetting the scene each chapter.
3. [Aerleum's fluid reveal](https://www.awwwards.com/inspiration/page-scroll-aerleum) and [Kaze's scroll and gallery opening elements](https://www.awwwards.com/inspiration/mobile-kaze) show that image reveals can define a chapter. Takeaway: Gallery's image opens with a mask, the interface detail slides into Studio, and Film develops from original to final.
4. [Repeat's horizontal/vertical composition changes](https://www.awwwards.com/inspiration/horizontal-and-vertical-scroll) and [Bright Biotech's scrolling story](https://www.awwwards.com/inspiration/team-interactive-scrolling-story-bright-biotech) show changing density and pacing. Takeaway: avoid repeating an equal screenshot/text grid. Use a photographic archive scene, an overlapping editor detail, a manual comparison, then a quiet final frame.
5. [Oaksun Studio's stacked cards and text reveal](https://www.awwwards.com/inspiration/silky-smooth-marquee-scroll-oaksun-studio) is a useful reminder that motion can have several roles. Takeaway: use different signatures for the frame, interface, and copy, while keeping the scroll gesture predictable.

## Implementation choices

- A shared fixed image layer follows the existing 650 ms eased section scroll. It changes position and scale with `transform` and blends two genuine image states with `opacity`.
- The before/after slider uses the original repository photo and a real Chromasmith export, not a browser colour filter. `site/render-story-photo.mjs` documents and reproduces the treatment. The source photo is a temporary sample until original reference photography is supplied.
- The image reveal and Film development use CSS only when motion is allowed. The static layout and range slider remain usable with reduced motion.
- No animation library is needed for four adjacent chapter transitions. This keeps the site self-contained and avoids extra download cost.

Technical references: [GSAP Flip](https://gsap.com/docs/v3/Plugins/Flip/) for spatial continuity, [MDN scroll-driven timelines](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations/Timelines) for future progress-linked work, [web.dev animation performance](https://web.dev/articles/animations-and-performance) for compositor-friendly properties, and [MDN reduced motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion) for accessibility.
