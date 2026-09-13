# Color slider gooey review

Prototype: `design/prototypes/color-slider-gooey/` — open `index.html` locally. It compares normal and proposed native-range sliders for a plain luminance control and a functional HSL-gradient control in both themes.

Second prototype: `design/prototypes/color-slider-gooey-css-filter/` — a user-supplied CSS/SVG-filter variation. It filters only decorative blob elements and lets an endpoint blob merge with the thumb; text and native range controls remain outside the filter. Chromium review passed; it is explicitly not Safari/WebKit evidence.

## Confirmed

At official `liquid-gooey` commit `422180dd7a5ac646c85deedc65500c4a74339127`, `effect="move"` separates a filtered SVG silhouette from its crisp interactive content layer. Its source contains reduced-motion handling and cleanup/idle mechanics; its README claims SVG-content filters work in Safari. That claim is source documentation, not prototype WebKit evidence.

The prototype keeps the native range as the only hit target, keyboard control, and focus owner. The decorative SVG is `aria-hidden` and has no pointer events. Its independent loop stops after settling; reduced motion removes the decorative layer. If filter support is unavailable, the normal slider remains immediately.

## Revised proposed settings

No trailing or settling movement. The SVG mirrors the thumb directly, with a `1.5px` soft edge and `0.18` horizontal compression only at either endpoint. It has no animation loop and no bounce.

## Compatibility and concerns

No Safari claim is made for either prototype until a Playwright WebKit run succeeds. The CSS `filter:url()` variation is particularly unsuitable as a compatibility claim because the official library avoids CSS filters on HTML specifically for WebKit. SVG-filter raster cost is limited to thumb-sized decoration, but remains a reason to keep any effect optional and feature-gated. Browser screenshots and equal-size pixel comparisons still need recording.

## Decisions needed

1. Keep or reject the effect.
2. Preferred trail/softness level.
3. Apply to plain sliders, functional-gradient sliders, or both.
4. Show only while dragging, or also while settling.
