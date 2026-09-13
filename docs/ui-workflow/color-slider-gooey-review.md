# Color slider gooey review

Prototype: `design/prototypes/color-slider-gooey/` — open `index.html` locally. It compares normal and proposed native-range sliders for a plain luminance control and a functional HSL-gradient control in both themes.

## Confirmed

At official `liquid-gooey` commit `422180dd7a5ac646c85deedc65500c4a74339127`, `effect="move"` separates a filtered SVG silhouette from its crisp interactive content layer. Its source contains reduced-motion handling and cleanup/idle mechanics; its README claims SVG-content filters work in Safari. That claim is source documentation, not prototype WebKit evidence.

The prototype keeps the native range as the only hit target, keyboard control, and focus owner. The decorative SVG is `aria-hidden` and has no pointer events. Its independent loop stops after settling; reduced motion removes the decorative layer. If filter support is unavailable, the normal slider remains immediately.

## Proposed settings

Trail strength `0.28`; softness `3px`; damped `180ms` settling; no bounce. Start with the effect only while dragging and settling, never at rest.

## Compatibility and concerns

No Safari claim is made for this prototype until a Playwright WebKit run succeeds. SVG-filter raster cost is limited to the thumb-sized silhouette, but remains a reason to keep the effect optional and feature-gated. Browser screenshots and equal-size pixel comparisons still need recording.

## Decisions needed

1. Keep or reject the effect.
2. Preferred trail/softness level.
3. Apply to plain sliders, functional-gradient sliders, or both.
4. Show only while dragging, or also while settling.
