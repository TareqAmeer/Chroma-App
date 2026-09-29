# Chromasmith Design System

Chromasmith makes a photo library and editor known for one thing: giving digital raw files a convincing film look — measured grain, stock-accurate curves, halation that only shows on a bright edge. The design language is borrowed wholesale from the **Standard Apple Design System** supplied as the starting point: photography-first, chrome that recedes, a single interactive colour, edge-to-edge tiles instead of borders. The one deliberate divergence is colour — Chromasmith's interactive blues come from its own palette, not Apple's Action Blue.

## Sources given

| Source | What it provided |
|---|---|
| `uploads/apple.design.md` | The Standard Apple Design System as a DESIGN.md file (author: Dov Azencot; format: [google-labs-code/design.md](https://github.com/google-labs-code/design.md)). Ground truth for every token, component spec, radius, spacing value, elevation rule and do/don't in this system. |
| `uploads/palette.png` | Coolors export: `000000` · `224455` · `61A0AF` · `F0EDEE` · `870F13` · `214E1D` · `FF9B42`. The two blues became primary and accent; the rest became semantics and one warm alt canvas. |

No codebase, Figma file, screenshots, logo files, fonts, photography or slide deck were supplied. Everything not derived from those two files is flagged in **Gaps & substitutions** below.

## Products represented

1. **Chromasmith for Mac** — the photo library and film-emulation editor. Library (contact sheet), Develop (canvas + emulation panel), Film Packs store. → `ui_kits/chromasmith-app/`
2. **Chromasmith.com** — the marketing site: tiled overview, Film Packs store, pricing. → `ui_kits/chromasmith-web/`

## What changed from the Apple starting point

- **Primary** is Slate Blue `#224455` (was Action Blue `#0066cc`). Focus sibling `#2a5468`, pressed fill `#1a3644`.
- **On-dark link / accent** is Mist Blue `#61a0af` (was Sky Link Blue `#2997ff`).
- **Semantics added** from the palette: Oxide `#870f13` (danger), Pine `#214e1d` (success), Ember `#ff9b42` (warning / "New" markers).
- **Linen `#f0edee`** added as a warm alternative light canvas alongside Parchment.
- Surfaces, ink, hairlines, the whole type ladder, spacing, radii and the single-shadow rule are **unchanged** from the source.
- Still true: one interactive colour, no second accent, no decorative gradients, no shadows on chrome.

---

## CONTENT FUNDAMENTALS

**Voice.** Declarative, technical, unhurried. Sentences state a fact about the product and stop. The subject is usually the product or the photograph, rarely the reader — "Chromasmith indexes the raw file, not a copy of it", not "You can index your raw files". Second person appears only in instructions and legal copy ("Trials convert unless cancelled").

**Headline grammar.** Two to five words, sentence case, ending in a full stop. Often a noun phrase, sometimes a claim with a comma pivot:
- "Film, computed."
- "Grain that behaves like grain."
- "Twenty-four stocks. Perpetual licences."
- "Two ways to buy."

Never a question. Never a colon. Never a superlative ("best", "most powerful", "revolutionary"). Numbers in headlines are spelled out ("Twenty-four stocks"); in UI and pricing they are numerals ("24 packs", "$89.00").

**Taglines.** Exactly one line, 8–16 words, adds mechanism rather than adjectives: "Sampled from real stock at three exposure levels, then re-applied per channel."

**Body copy.** One idea per paragraph, 1–3 sentences, plain vocabulary. Photographic terms are used precisely and unglossed — stock, roll, push, halation, roll-off, negative, contact sheet. The reader is assumed to be a photographer.

**UI copy.** Verb-first, no articles: "Add to library", "Save as preset", "Copy settings to 12 selected", "Export…". Trailing ellipsis when a dialog follows. Trailing "›" on in-copy links that navigate. Counts are always concrete ("640 photos · 21 rolls").

**Casing.** Sentence case everywhere — buttons, nav, headings, card titles. Uppercase is reserved for 10px section eyebrows in dense panels (letter-spaced `.08em`) and pack badges. Title Case appears only in proper nouns: product names (Chromasmith Pro, Film Packs), stock names (Portra 400, Tri-X 400).

**Punctuation.** Prices always two decimals in totals ($89.00), whole in listings ($29). Middot separators in metadata (`12 presets · Warm daylight`). En dash for ranges, em dash sparingly in prose. British-leaning spelling is acceptable and used consistently ("colour", "licence" as noun).

**Emoji: never.** Not in UI, not in marketing, not in release notes. Iconography is Lucide line glyphs only.

**Vibe.** A darkroom that respects your time. Confident, quiet, slightly nerdy about optics; never playful, never breathless, never apologetic.

---

## VISUAL FOUNDATIONS

**Colour.** One interactive colour: Slate Blue `#224455` for every link, pill CTA, focus signal and selected state on light surfaces; Mist Blue `#61a0af` takes over on near-black, where Slate disappears. There is no second brand accent — Oxide, Pine and Ember are *state* colours and never appear as decoration. Text on light surfaces is a single near-black `#1d1d1f` (never pure black); two muted steps (`#333`, `#7a7a7a`) handle secondary and disabled. Maximum two background colours in any one composition, plus the dark tile.

**Type.** SF Pro Display for headlines ≥19px, SF Pro Text for body and UI below 20px — the boundary is unbreakable. Weight ladder is **300 / 400 / 600 / 700; 500 is absent** and mid-weight readings always resolve to 600. Body is **17px, not 16px**, at 1.47 line-height with `-0.374px` tracking. Negative tracking on everything 17px and up, never at 12px or below. Footer link columns use a deliberately relaxed 2.41 leading. Weight 300 is real but rare: the 24px airy lead and the 18px store-hero button label.

**Spacing.** 8px base with sub-base typographic nudges (4, 5, 12, 17). 80px vertical padding inside a tile, 48px at small phone. Cards get 24px. Grid gutters 20–24px. Content locks at 980px for editorial text, 1440px for grids, full-bleed for tiles.

**Backgrounds.** Full-bleed flat colour tiles only — white, Parchment `#f5f5f7`, Linen `#f0edee`, or one of three near-black micro-steps (`#272729` / `#2a2a2c` / `#252527`, used so two adjacent dark tiles separate by lightness alone). **No gradients anywhere**, no textures, no repeating patterns, no hand-drawn illustration. Atmosphere comes from photography, never from CSS. Tiles stack with zero gap — the colour change *is* the section divider, so no borders and no rules between sections.

**Corner radii.** 0 for full-bleed tiles · 5px rare inline chips · 8px compact utility buttons and inner card imagery · 11px pearl capsules · 18px utility cards · pill (9999px) for every primary CTA, option chip and the search field · full circle for over-photography controls. Nothing in between; do not mix grammars.

**Cards.** White fill, 1px `#e0e0e0` hairline, 18px radius, 24px padding, **no shadow**. Selected/emphasised cards use an inset 2px Slate ring rather than elevation. Image crops inside a card are 1:1 at 8px radius.

**Shadows — exactly one.** `rgba(0,0,0,.22) 3px 5px 30px` and it is reserved for photography resting on a surface. Never on cards, buttons, text, nav or chrome. Everything else uses (a) a hairline ring `inset 0 0 0 1px rgba(0,0,0,.08)` or (b) a surface-colour change. Focus is a 2px `#2a5468` ring at 2px offset. The pearl capsule's 3px `#f0f0f0` border reads as a soft ring, not a line.

**Transparency & blur.** Only two places: the frosted sub-nav (Parchment at 80% + `saturate(180%) blur(20px)`) and the sticky bottom bar (same recipe; near-black at 72% inside the editor). Over-photography controls use `rgba(210,210,215,.64)`. Blur is functional — it means "this floats above content" — never decorative. No protection gradients: text over photography sits on a **flat** 55% near-black scrim, not a fade.

**Animation.** Restrained and short. Press is the system's signature micro-interaction: `transform: scale(0.95)` over 120ms on `cubic-bezier(.4,0,.6,1)` — every button, every chip. Fades are 300ms. Nothing bounces, nothing springs, nothing parallaxes, nothing auto-plays.

**Hover & press.** The source system deliberately does not document hover for buttons — treat hover as at most a subtle opacity lift on quiet chrome (nav links sit at 0.82 opacity and rise to 1). Links darken to the focus sibling `#2a5468` and may underline. Press = shrink, not colour change. Selected states change the **border** (1px hairline → 2px Slate/Mist) and the label weight (400 → 600); the footprint stays identical so grids never reflow.

**Layout rules.** Fixed elements: the 44px black global nav at the top, the 52px frosted sub-nav directly beneath it, and the 64px sticky bar at the bottom when a purchase or export decision is pending. Everything else scrolls. Minimum hit target 44px; nav utility links are the one intentional exception at ~32px.

**Imagery.** Warm and analogue: amber-leaning highlights, cool shadow roll-off, visible grain, no HDR crunch. Hero crops 21:9 or taller, feature crops 16:9, pack and preset art 1:1. Product renders sit on the tile colour and take the one shadow. Photography is never rounded in hero tiles; rounding appears only on inline card imagery. Editor canvases sit on true black.

---

## ICONOGRAPHY

**No icon assets were supplied** — the source is a token document with no sprite, icon font, or SVG set, and no codebase was attached.

**Substitution (please confirm):** the cards and UI kits use **[Lucide](https://lucide.dev)** line icons, loaded per-glyph from CDN as `https://unpkg.com/lucide-static@0.544.0/icons/<name>.svg`. Lucide's 1.5–2px stroke, rounded caps and 24px grid are the closest open match to SF Symbols' outline style, which is what an Apple-derived system implies. Glyphs in use: `search`, `shopping-bag`, `images`, `star`, `download`, `layout-grid`, `arrow-down-up`, `sliders-horizontal`, `crop`, `wand-sparkles`, `chevron-left`, `chevron-right`, `columns-2`, `refresh-cw`, `user-round`, `film`, `layers`, `hard-drive`, `check`.

Rules:
- Line icons only, never filled, never duotone, never multicolour. Icons inherit ink — `#1d1d1f` on light, white at 65–80% opacity on dark (achieved with `filter: brightness(0) invert(1)` on the static SVGs).
- 14–15px in nav and utility rows, 16–18px in toolbars and inside 44px circular buttons, 22px for feature-row glyphs.
- Icons never carry meaning alone in marketing copy; in app chrome an icon-only control must have an accessible label (`IconButton` requires `label`).
- **Emoji are never used.** Unicode is used typographically, not as iconography: `·` metadata separators, `›` on navigating links, `—` in prose, `…` on actions that open a dialog, `ƒ/` in exposure metadata.
- No logo file exists. Wherever a mark would go, the name **Chromasmith** is set in the display face at weight 600, tracking `-0.374px` (see `guidelines/brand-wordmark.card.html`). It has not been drawn, reconstructed or approximated.

---

## Gaps & substitutions — please confirm

1. **Fonts — resolved.** SF Pro Display and SF Pro Text are now self-hosted from `fonts/` and declared in `tokens/fonts.css` at the four ladder weights (300 / 400 / 600 / 700, roman + italic). Weight 500 is intentionally not declared. `SF-Pro-Rounded-*` and the variable `SF-Pro.ttf` / `SF-Pro-Italic.ttf` files were also uploaded but are **not** wired — the source system uses neither; say the word if Rounded should become a token.
2. **Icons.** Lucide, substituted as described above.
3. **Photography.** None supplied. Every image in the UI kits is a flat token-coloured plate with a dashed edge (`ui_kits/_shared/Placeholders.jsx`). No imagery was generated.
4. **Logo.** None supplied; the wordmark is plain type.
5. **No slide template** was provided, so no sample slides were created.
6. **Component inventory** is exactly the 24 component specs in `apple.design.md`, collapsed into 12 families by variant (see below). Nothing was invented — no Toast, Avatar, Tabs, Modal or Tooltip, because the source defines none. Error and validation states are absent for the same reason (the source lists them as a known gap).
7. **Intentional additions:** none beyond variant props. `ProductTile`'s `linen` surface and `UtilityCard`'s `badge` are the only extensions, both drawn from the supplied palette and the app's own need for a "New / Pro" marker.

---

## Index

Root files:

| Path | What |
|---|---|
| `styles.css` | The single entry point consumers link — `@import` list only |
| `tokens/colors.css` | Palette + semantic colour aliases |
| `tokens/typography.css` | Families, weight ladder, 16 type styles |
| `tokens/spacing.css` | Spacing scale, containers, fixed heights |
| `tokens/radius.css` | Radius scale and role aliases |
| `tokens/elevation.css` | The one shadow, hairline rings, blur, motion constants |
| `tokens/base.css` | Body/heading/link resets |
| `tokens/fonts.css` | Self-hosted SF Pro `@font-face` rules (300/400/600/700, roman + italic) |
| `fonts/` | Uploaded SF Pro font binaries |
| `thumbnail.html` | Homepage tile for this system |
| `SKILL.md` | Agent-Skills front matter for use in Claude Code |

**Components** (`components/<group>/`, each with `.jsx`, `.d.ts`, `.prompt.md`, plus one card per group):

- `actions/` — **Button** (primary · secondaryPill · darkUtility · pearlCapsule · storeHero), **IconButton**, **TextLink**
- `navigation/` — **GlobalNav**, **SubNav**, **Footer**
- `surfaces/` — **ProductTile** (light · parchment · linen · dark ×3), **UtilityCard**, **QuoteCard**, **StickyBar**
- `forms/` — **SearchInput**, **OptionChip**

**UI kits:**

- `ui_kits/chromasmith-app/` — Chromasmith for Mac: Library, Develop, Film Packs
- `ui_kits/chromasmith-web/` — Chromasmith.com: Overview, Film Packs, Pricing
- `ui_kits/_shared/Placeholders.jsx` — photo plates + Lucide icon helper

**Foundation cards** (`guidelines/*.card.html`, 22 cards): colours (primary, accent, semantic, light surfaces, dark surfaces, ink, hairlines), type (display, lead, body, utility, weights, tracking, families), spacing (scale, tile rhythm, radius, containers), brand (wordmark, elevation, motion, imagery).

**Starting points:** Button, GlobalNav, OptionChip, ProductTile, plus both UI kit index screens.
