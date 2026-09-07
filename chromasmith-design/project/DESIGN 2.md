---
name: Chromasmith
description: Design tokens and components for Chromasmith, a photo library and RAW editor known for a film-emulation look.
base: Standard Apple Design System (photography-first, chrome recedes, one interactive color, edge-to-edge tiles)
---

# Chromasmith Design.md

## Colors

### Brand blues (primary/accent — the one deliberate divergence from Apple's palette)
| Token | Value | Use |
|---|---|---|
| `--blue-slate` | `#224455` | Primary — pill CTAs, active nav, links |
| `--blue-slate-focus` | `#2a5468` | Focus ring sibling |
| `--blue-slate-press` | `#1a3644` | Pressed fill |
| `--blue-mist` | `#61a0af` | Accent — links/active state on dark surfaces |
| `--blue-mist-soft` | `#e3edf0` | 12% mist wash — selected state |

### Semantic
| Token | Value | Use |
|---|---|---|
| `--red-oxide` | `#870f13` | Destructive / error |
| `--green-pine` | `#214e1d` | Success / "saved" |
| `--orange-ember` | `#ff9b42` | Warning, highlight, film-grade marker |

### Ink (text)
| Token | Value |
|---|---|
| `--ink` | `#1d1d1f` |
| `--ink-muted-80` | `#333333` |
| `--ink-muted-48` | `#7a7a7a` |
| `--ink-on-dark` | `#ffffff` |
| `--ink-on-dark-muted` | `#cccccc` |

### Surfaces
| Token | Value |
|---|---|
| `--canvas` | `#ffffff` |
| `--canvas-parchment` | `#f5f5f7` |
| `--canvas-linen` | `#f0edee` |
| `--surface-pearl` | `#fafafc` |
| `--surface-tile-1` | `#272729` |
| `--surface-tile-2` | `#2a2a2c` |
| `--surface-tile-3` | `#252527` |
| `--surface-black` | `#000000` |
| `--surface-chip-translucent` | `#d2d2d7` |

### Hairlines
| Token | Value |
|---|---|
| `--divider-soft` | `#f0f0f0` |
| `--hairline` | `#e0e0e0` |
| `--hairline-alpha` | `rgba(0,0,0,.08)` |

### Semantic aliases
`--primary`→slate, `--accent`→mist, `--text-body`/`--text-strong`→ink, `--text-muted`→ink-muted-48, `--surface-page`→canvas, `--surface-inverse`→tile-1, `--border-card`→hairline, `--state-danger/success/warning`→oxide/pine/ember.

## Typography

**Faces:** `--font-display` = SF Pro Display (headlines ≥19px) · `--font-text` = SF Pro Text (body/UI). Self-hosted, weights 300/400/600/700 roman+italic; 500 is deliberately absent from the ladder. Fallback: `system-ui, -apple-system, BlinkMacSystemFont, sans-serif`.

| Style | Size | Weight | Line-height | Tracking |
|---|---|---|---|---|
| hero | 56 | 600 | 1.07 | -0.28px |
| display-lg | 40 | 600 | 1.1 | 0 |
| display-md | 34 | 600 | 1.47 | -0.374px |
| lead | 28 | 400 | 1.14 | 0.196px |
| lead-airy | 24 | 300 | 1.5 | 0 |
| tagline | 21 | 600 | 1.19 | 0.231px |
| body-strong | 17 | 600 | 1.24 | -0.374px |
| body | 17 | 400 | 1.47 | -0.374px |
| dense-link | 17 | 400 | 2.41 | 0 |
| caption | 14 | 400 | 1.43 | -0.224px |
| caption-strong | 14 | 600 | 1.29 | -0.224px |
| button-large | 18 | 300 | 1 | 0 |
| button-utility | 14 | 400 | 1.29 | -0.224px |
| fine-print | 12 | 400 | 1 | -0.12px |
| micro-legal | 10 | 400 | 1.3 | -0.08px |
| nav-link | 12 | 400 | 1 | -0.12px |

## Foundations

- **Radius:** xs 5 · sm 8 · md 11 · lg 18 (`--radius-card`) · pill 9999 (`--radius-action`). Tiles = 0 (`--radius-tile`) — full-bleed, no rounding.
- **Spacing:** xxs 4 · xs 8 · sm 12 · md 17 · lg 24 (`--pad-card`) · xl 32 · xxl 48 · section 80 (`--pad-tile`).
- **Elevation:** one shadow in the whole system, `--shadow-product` (product/photo imagery only). Cards use a hairline ring (`--ring-hairline`), not elevation. Focus = `--focus-ring`.
- **Motion:** press = `scale(.95)`, 120ms; fades = 300ms; easing `cubic-bezier(.4,0,.6,1)`.
- **Blur:** `--blur-frosted` (saturate 180% blur 20px) with `--frosted-fill` — nav/toolbar chrome only.

## Components

| Component | Variants |
|---|---|
| **Button** | `primary` (slate pill), `secondaryPill` (ghost), `darkUtility` (compact rect), `pearlCapsule`, `storeHero` (oversized pill). `onDark`, `disabled`, `fullWidth`, `as="a"` |
| **IconButton** | icon-only action, `variant`/`size` props |
| **TextLink** | inline link, uses `--text-link` / `--text-link-on-dark` |
| **GlobalNav** | persistent 44px true-black top bar; `brand` wordmark (no logo file), `links[]`, `right` slot |
| **SubNav** | secondary nav row under GlobalNav |
| **Footer** | site footer |
| **SearchInput** | pill search field sharing the CTA capsule grammar; `onDark`, leading icon |
| **OptionChip** | selectable chip/filter |
| **ProductTile** | full-bleed marketing section; `surface` (light/parchment/linen/dark/dark2/dark3), `eyebrow`, `title`, `tagline`, `actions`, `media`, `align`, `tight` |
| **QuoteCard** | testimonial/quote surface |
| **UtilityCard** | compact info card |
| **StickyBar** | persistent bottom/top action bar |

Full source, specimens, and UI kit recreations live in the Chromasmith Design System project (`readme.md`, `tokens/`, `components/`, `ui_kits/`).
