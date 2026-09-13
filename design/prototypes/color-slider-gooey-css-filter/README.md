# CSS-filter variation

This disposable native HTML/CSS/JS prototype applies the user-supplied SVG blur/contrast technique to a decorative CSS-blob layer only. It does not use React, `liquid-gooey`, or a production dependency.

The real `<input type="range">` remains the focusable, keyboard-operable control. Its visual thumb is hidden only while the decorative layer is available. At either endpoint, a stationary decorative blob merges with the moving blob; there is no trailing behavior.

The CSS `filter:url()` approach has been visually reviewed in Chromium only. It is deliberately not a Safari/WebKit compatibility claim.
