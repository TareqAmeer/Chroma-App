# The product page

`index.html` at the repository root is the GitHub Pages landing page. It is hand-written and
self-contained (one file, inline CSS/JS, no framework, no build step — the same rule the app
itself follows). The page is a ten-chapter scrolling story with a fixed brand rail and
section index. It uses the bundled Gramatika family throughout. The index shows only the
current chapter and its neighbors, plus a return-to-top arrow.

On wheel input, one gesture eases to the next chapter and stops. Touch devices use native
mandatory section snapping. Each chapter is sized to one viewport; very short browser windows
use natural scrolling so content remains reachable. Reduced-motion visitors get a still,
ordinary-scroll version. The opening photo, product frames, panels and chapter titles have
short, separate arrival animations. A shared image layer carries one frame between Gallery,
Studio, Click and Film; those chapters also have distinct reveal, interface and photo-development
motion. See `awwwards-motion-research.md` for visual references and implementation choices.

The Coming Soon chapter labels video editing, astro stacking and the current two-photo
panorama as beta. The Features chapter holds 100 short, expandable descriptions in an
independently scrolling directory. The wheel handler lets that directory scroll before
advancing to another chapter. See `less-powerpoint-ideas.md` for the next design review.

The hero uses `site/assets/hero-placeholder.webp`, made from the repository's approved splash
photo. Gallery through Film use the same temporary repository canal photo. Its Studio and Film
versions were rendered through Chromasmith, and the original/export comparison is genuine.
Run `node site/render-story-photo.mjs` to reproduce them. The CHRO-MA-GUY portrait and copy are
explicitly temporary. Replace the sample photo and founder material when originals arrive.

Three scripts feed it. All of them are optional: the page renders without any of them.

```bash
node site/shoot-screenshots.mjs   # re-capture the UI screenshots from the REAL app
node site/build-assets.mjs        # optimise your photos from site/photos-src/
node site/build-page.mjs          # inject hero and real comparison into index.html
node site/render-story-photo.mjs  # reproduce the temporary sample's app exports
```

## Adding before/after photos

Drop full-size files into `site/photos-src/` (gitignored — the originals are yours and large):

```
01-before.jpg   01-after.jpg   01.txt      <- 01.txt is a one-line caption
02-before.jpg   02-after.jpg   02.txt
hero.jpg                                   <- the opening full-screen photo
```

Then run `build-assets.mjs` (downsizes and re-encodes into `site/assets/`) followed by
`build-page.mjs` (rewrites the regions between the `<!-- GALLERY:START -->` and
`<!-- HERO-IMG:START -->` markers). Everything outside those markers is hand-edited and is never
touched by a script. `GALLERY` is the one-click comparison in section 04; `HERO-IMG` is
the opening photograph in section 01.

The Gallery, Studio and Film sample imagery in `index.html` is currently hand-wired to
`site/assets/story/`. When original reference photos arrive, replace those sources along with
the comparison manifest so the narrative continues to follow one photograph.

## Notes worth knowing before editing

- **Output is WebP, and that is not just a size decision.** The repo's `.gitignore` excludes
  `*.jpg`/`*.jpeg`/`*.JPG` globally, so a JPEG dropped into `site/assets/` would be silently
  untracked and the live page would 404 on it.
- **The encoder is Chromium, not a native tool.** `cwebp` is not installed on this machine and
  macOS `sips` refuses `-s format webp` (exit 13), so `img-encode.mjs` encodes through the
  Playwright browser the test harnesses already depend on. No new dependency.
- **Screenshots are generated, never hand-taken.** The previous set lived in an untracked folder
  and was lost. `shoot-screenshots.mjs` drives the real app, suppresses the first-run tour, and
  writes 1600px WebP.
- **The Library screenshot needs the desktop build staged.** The Library lives in
  `desktop/library-ui.js`, which `build-desktop.sh` injects at build time — the plain single file
  never loads it. Run `bash build-desktop.sh` first, or that shot is an empty editor.
- **Keep the assets small.** The whole of `site/assets/` should stay comfortably under ~3 MB.
