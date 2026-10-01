# Swiss-style motion notes (reference: YouTube d1MINa9JJDk, 0:12–0:30)

Frames: `sheet_1..3.jpg` — 36 frames, one every 0.5s, read left→right, top→bottom.

## What makes it work
1. **Text builds word by word.** Small, plain grotesk sans, one line, left- or centre-aligned. Each new word fades/slides up a few px in light grey, then settles to full white/black. No bounce.
2. **Tiny type, lots of empty space.** Captions sit at ~2% of frame height on a flat field. Scale contrast comes later from a single huge element (the big number), never mid-size text.
3. **Flat colour fields, hard cuts.** Black, warm off-white (~#E3E0DA), one red (~#D22B3A), one deep blue (~#0A0FA8). Scenes swap by hard cut or a flat panel sliding in, never a crossfade.
4. **Grids of geometric marks that morph.** A 5×5 grid of four-point stars grows from dots, then circles fill the gaps; red dots fill in one by one along a diagonal. Later an 8×8 circle grid where cells turn into half-circles/bowties in red/blue/white, like a mosaic of data.
5. **Odometer number roll.** "1999" sits on a red/off-white split panel and the digits roll vertically, with ghosted neighbouring numbers (1998, 2000) in faint tone above and below.
6. **One accent dot as punctuation.** A single red dot pops in at the end of a sentence and then travels or grows into the next scene.
7. **Dot-matrix reveal.** A field of faint dots where a lens-shaped area brightens to white, opening outward from the centre line where the text sits.
8. **Horizontal marquee band.** Large text scrolling sideways over a row of circles/half-circles in red, blue, black and white, moving continuously at a steady speed.
9. **Timing.** About 1 beat (~0.5s) per word or per grid state; every move eases out (fast start, soft stop); nothing holds longer than ~1.5s.

## Mapping to the Chromasmith promo
- Feature captions → word-by-word build (rule 1), over a flat field before each app clip.
- "113 film looks" → odometer roll of the number (rule 5).
- Grain / halation → dot-matrix field that brightens like a highlight blooming (rule 7).
- LUT library → morphing grid where each cell takes a different look's colour (rule 4).
- "Offline · nothing uploaded" → red accent dot as the full stop (rule 6).
- Outro → marquee band of feature names (rule 8).
- Palette: swap red/blue for Chromasmith tokens from `design/tokens.json`; keep black + off-white.
