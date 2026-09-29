---
name: Neo-Swiss Editorial Brutalism
colors:
  surface: '#f9f9f7'
  surface-dim: '#dadad8'
  surface-bright: '#f9f9f7'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f4f2'
  surface-container: '#eeeeec'
  surface-container-high: '#e8e8e6'
  surface-container-highest: '#e2e3e1'
  on-surface: '#1a1c1b'
  on-surface-variant: '#444557'
  inverse-surface: '#2f3130'
  inverse-on-surface: '#f1f1ef'
  outline: '#757589'
  outline-variant: '#c5c4db'
  surface-tint: '#303eff'
  primary: '#000dbd'
  on-primary: '#ffffff'
  primary-container: '#0015ff'
  on-primary-container: '#b7bcff'
  inverse-primary: '#bec2ff'
  secondary: '#b32100'
  on-secondary: '#ffffff'
  secondary-container: '#e02c00'
  on-secondary-container: '#fffbff'
  tertiary: '#383737'
  on-tertiary: '#ffffff'
  tertiary-container: '#4f4e4e'
  on-tertiary-container: '#c2bfbf'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e0e0ff'
  primary-fixed-dim: '#bec2ff'
  on-primary-fixed: '#00046a'
  on-primary-fixed-variant: '#0012e7'
  secondary-fixed: '#ffdad3'
  secondary-fixed-dim: '#ffb4a4'
  on-secondary-fixed: '#3e0500'
  on-secondary-fixed-variant: '#8c1800'
  tertiary-fixed: '#e5e2e1'
  tertiary-fixed-dim: '#c9c6c5'
  on-tertiary-fixed: '#1c1b1b'
  on-tertiary-fixed-variant: '#474646'
  background: '#f9f9f7'
  on-background: '#1a1c1b'
  surface-variant: '#e2e3e1'
typography:
  display-hero:
    fontFamily: Space Grotesk
    fontSize: 88px
    fontWeight: '700'
    lineHeight: 84px
    letterSpacing: -0.04em
  display-hero-mobile:
    fontFamily: Space Grotesk
    fontSize: 44px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.03em
  headline-xl:
    fontFamily: Space Grotesk
    fontSize: 48px
    fontWeight: '600'
    lineHeight: 52px
    letterSpacing: -0.03em
  headline-xl-mobile:
    fontFamily: Space Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 22px
    fontWeight: '500'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Space Grotesk
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.02em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-caps-lg:
    fontFamily: Space Grotesk
    fontSize: 13px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.12em
  label-caps-sm:
    fontFamily: Space Grotesk
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 12px
    letterSpacing: 0.16em
  code-telemetry:
    fontFamily: Space Grotesk
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.04em
spacing:
  gutter: 0px
  gutter-desktop: 1px
  margin: 1rem
  margin-desktop: 2.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 3rem
---

## Brand & Style

The design system merges high-fashion Swiss International Typographic Style with contemporary neo-brutalism for a high-performance creative photo catalog and RAW culling workspace. Designed specifically for art directors, fashion photographers, and visual archivists, the UI acts as an architectural, high-precision exhibition frame: severe, mathematically ordered, unapologetically stark, and devoid of ornamental clutter.

### Core Tenets
- **Editorial Archival Authority:** Drawing cues from contemporary art institutions (Cosmos, Bedow), pages favor expansive negative space, strict rectilinear alignments, and crisp typographic hierarchy over decorative interface wrappers.
- **Architectural Flatness:** Zero soft bevels, zero diffuse dropshadows, and zero rounded corners. Visual weight is articulated solely through hairline structural dividers, monolithic text blocks, and stark color blocking.
- **High-Chroma Accents:** Pure chromatic electricity punctuates an otherwise museum-neutral palette of bone and carbon. The palette leverages international signal red and high-voltage Klein blue to highlight selections, metadata flags, and culling states.
- **Utilitarian Elegance:** Information density is handled with Swiss discipline. Metadata, frame counts, focal lengths, and color tags sit in razor-aligned typographic columns, treating camera metrics with editorial gravitas.

## Colors

The system is calibrated around a luminous bone-white canvas (`#f6f6f4`), dense carbon black ink (`#0a0a0a`), and saturated primary pigments. The default canvas operates in high-key light mode, matching print proofing standards and art book layouts, with a mirrored carbon dark mode available for low-light digital darkroom workflows.

### Palette Architecture
- **Primary (`#0015ff` - Chroma Klein Blue):** Used for focal selection indicators, active workspace mode toggles, and hero typographic moments.
- **Secondary (`#ff3300` - Signal Orange/Red):** Reserved for rejection states, destructive flags, highlight alerts, and critical telemetry warnings.
- **Tertiary (`#0a0a0a` - Carbon):** The master structural color used for 1px boundary rules, primary glyphs, monolithic titles, and solid inverted component backgrounds.
- **Neutral (`#f6f6f4` - Bone White):** The master surface background, providing a paper-like, tactile substrate that avoids the harsh clinical glare of pure `#ffffff`.

### Supporting Shades & Usage
- **Hairline Border (`#0a0a0a` at 15% opacity or solid `#e2e2de`):** Used for subtle interior photo grid dividers. Structural pane divisions always use pure `#0a0a0a` at 100% hairline thickness.
- **Muted Metadata (`#70706c`):** Applied to technical camera exposure readouts, labels, and timestamps to maintain clear typographic separation from primary content.
- **Canvas Contrast Rule:** Never apply gradients or multi-stop blends to surfaces. Color fills must be flat, unmodulated blocks of solid pigment.

## Typography

The typographic hierarchy juxtaposes the geometric character of Space Grotesk with the neutral legibility of Inter. Headline and label structures are derived from Swiss exhibition posters: tightly tracked large-scale display headers set against wide-tracked, uppercase micro-labels.

### Typographic Guidelines
- **Case Conventions:** Category tabs, metadata keys (e.g., `ISO`, `SHUTTER`, `APERTURE`), status flags, and table column titles are strictly styled in all-caps (`text-transform: uppercase`) using `label-caps-lg` or `label-caps-sm` with generous tracking (`0.12em` to `0.16em`).
- **Body & Paragraphs:** Body text remains in sentence case using Inter to guarantee reading comfort across asset descriptions, curation notes, and editorial statements.
- **Numeral Treatment:** Camera telemetry, shot counts, and file sizes are displayed in tabular Space Grotesk figures (`font-variant-numeric: tabular-nums`) to maintain strict vertical alignment in data-heavy lists and toolbars.

## Layout & Spacing

The workspace runs on a modular Swiss grid system inspired by Josef Müller-Brockmann. Layout boundaries are framed directly by 1px solid hairline borders, allowing content modules to nest edge-to-edge without decorative padding buffers.

### Grid & Density Structure
- **Asymmetrical Workbench Layout:** The primary desktop workspace utilizes an asymmetric tripartite split: a narrow fixed catalog/filter index on the left (240px to 280px), an expansive multi-column RAW contact sheet in the center (fluid grid), and a collapsible 320px contextual inspector/histogram pane on the right.
- **Contact Sheet Matrix:** The asset gallery uses a zero-gutter or hairline 1px gutter grid. Image assets touch bordering rules directly, mimicking contact sheets and physical photographic plates.
- **Outer Shell Margins:** The global window uses a consistent outer border frame (`margin-desktop: 2.5rem`) creating an exhibition passe-partout around the working interface.
- **Responsive Adaptations:**
  - **Mobile (<768px):** Collapses into a single structural column. Sidebar indexing shifts to an off-canvas, full-bleed carbon drawer. Gutter rules drop to 0px with images stacked in 1 or 2 high-density columns.
  - **Tablet (768px–1024px):** Two-column split (navigation docked to bottom bar, primary workspace and inspector sharing the canvas).
  - **Desktop (>1024px):** Full tripartite workspace active with hairline borders persisting throughout.

## Elevation & Depth

Visual depth is achieved strictly through planar contrast, border articulation, and hard layering. Drop shadows, directional lights, and soft blurs are prohibited.

### Spatial Techniques
- **Zero Diffusion:** All visual elements inhabit a singular flat plane. No `box-shadow` tokens exist in the design system.
- **Hard Layer Inversion:** Modals, overlays, contextual right-click menus, and active tooltips achieve spatial dominance by sharply inverting their surfaces (e.g., `#0a0a0a` background with `#f6f6f4` typography) encased in a stark 1px solid border.
- **Z-Index Architectural Hard Framing:** Overlays sit on top of the gallery sheet with a crisp, 1px perimeter outline. When a preview lightbox triggers, the background does not blur; instead, it is occluded by a solid `#0a0a0a` or bone `#f6f6f4` flood layer at 95% opacity.
- **Active Structural Selection:** Selected photographic assets do not float or lift via shadow. Instead, they gain a high-voltage 2px inner or outer stroke in Chroma Klein Blue (`#0015ff`), accompanied by a solid Klein blue corner index tag.

## Shapes

Every component, container, button, tag, and modal possesses an uncompromised corner radius of 0px. 

### Geometric Rules
- **Absolute Sharpness:** Border-radius is strictly `0px` across all controls, buttons, thumbnails, dialogs, and popovers.
- **Structural Lines:** 1px hairline rules act as both structural boundaries and visual dividers. Corners join at precise right angles without chamfering or rounding.
- **Aspect Ratio Locking:** Photo assets preserve their native sensor ratios (3:2, 4:3, 1:1, 16:9, or 65:24 panoramic) within sharp bounding boxes, framed with hairline rules.

## Components

### Buttons & Interactive Triggers
- **Primary Button:** Solid Carbon (`#0a0a0a`) background, bone-white (`#f6f6f4`) text, 0px radius, 1px solid `#0a0a0a` border. Padding: `0.75rem 1.5rem`. Typography: `label-caps-lg`. On hover, background shifts instantly to Chroma Klein Blue (`#0015ff`) with no ease-in transition.
- **Secondary Button:** Bone-white (`#f6f6f4`) background, carbon (`#0a0a0a`) text, 1px solid `#0a0a0a` border. On hover, inverts to carbon background with bone text.
- **Danger/Reject Action:** Bone background with Signal Orange (`#ff3300`) text and border. On hover, floods with solid `#ff3300` and white text.

### Chips & Filter Tags
- **Base State:** Transparent background, 1px solid `#0a0a0a` at 20% opacity, all-caps `label-caps-sm`, padding `0.25rem 0.5rem`.
- **Selected State:** Solid `#0015ff` fill with pure white typography, 1px solid `#0015ff` border.
- **Status Badges (P1, Rejected, Starred):** Micro geometric indicators (e.g., `★ 5`, `REJ`, `RAW`) pinned to the top-left corner of thumbnails inside a solid carbon or signal orange 0px badge.

### Lists & Navigation Trees
- **Tree Rows:** Zero vertical margin; items sit flush stacked within 1px horizontal bottom borders.
- **Metrics Display:** Category labels left-aligned in `label-caps-lg`, asset counts right-aligned in muted tabular `code-telemetry` (`#70706c`).
- **Row Hover:** Entire list item fills with bone-shade hover tint or inverts to solid Klein Blue with white text on active selection.

### Inputs & Search
- **Search Fields:** Underlined or framed in 1px solid `#0a0a0a`. Background is pure `#f6f6f4`. 
- **Focus State:** Active input gains a bold 2px bottom border in `#0015ff` with zero focus rings or soft glows. Typographic placeholder uses uppercase tracking with 50% opacity.

### Checkboxes & Radios
- **Selection Square:** 14px by 14px sharp 0px square, 1px solid `#0a0a0a`.
- **Checked State:** Square is completely filled with solid Carbon (`#0a0a0a`) or Chroma Blue (`#0015ff`) with a centered micro bone-white square insert (not a curved tick mark).

### Photo Cards & Culling Frames
- **Card Anatomy:** Strict 1px solid `#0a0a0a` border encasing the image. Below the preview, an integrated 24px metadata bar displays file name, shutter speed, ISO, and aperture in `code-telemetry`.
- **Culling Flag Indicator:** Fast key-driven cull flags paint a 3px solid border around the frame: Klein Blue for "Select", Signal Orange for "Reject", and neutral hairline for "Unrated".