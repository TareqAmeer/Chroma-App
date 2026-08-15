# Film frame plates

Overlay plates for the **Film frame** border style. Each is an RGBA PNG whose CENTRE is
transparent and whose edge carries the frame; the app scales one to the output size and
composites it over the photo (`filmFrameCompose` in `chromasmith-22.html`).

## What is bundled, and why only this

| file | source | licence |
|---|---|---|
| `carrier-ragged.png` | [romnn/film-borders](https://github.com/romnn/film-borders) `borders/border.png` | **MIT** |

MIT permits redistribution inside a distributed application, which is the bar an asset has to
clear to live in this folder. It is the classic filed-out negative-carrier edge — the irregular
black border a darkroom print gets when the carrier is filed wider than the frame.

⚠️ **Most film-border packs on the web do NOT clear that bar**, including ones advertised as
"free". FilterGrade's sample rebates (Kodak Gold, Portra) are free to *use in media projects*,
which is not the same permission as shipping them inside software — so they are deliberately not
here. The same goes for Freepik/Magnific "free for commercial use" assets, whose terms forbid
redistribution as part of a product.

That restriction is why the feature does not depend on bundled plates at all:

- The **procedural** styles (`sprocket35`, `sprocket35-wide`, `rollfilm`) need no asset. Their
  geometry is ISO 1007 / SMPTE nominal — 35mm film width, 24x36mm frame, KS-1870 perforations at
  a 0.187in (4.7498mm) pitch, 8 per frame. Those are published measurements, i.e. facts, and
  carry no copyright.
- **Load frame…** takes any PNG the user has a licence to. Anyone who buys or downloads a rebate
  pack — FilterGrade's included — points the app at it and gets exactly that look, with no
  redistribution by us.

## Adding a plate

Drop an RGBA PNG here, add it to `FILM_FRAMES` in `chromasmith-22.html`, and record its source
and licence in the table above. A plate with no clear redistribution licence does not go in.
