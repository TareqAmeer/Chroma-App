# The product page

`index.html` at the repository root is the GitHub Pages landing page. It is hand-written and
self-contained (one file, inline CSS/JS, no framework, no build step — the same rule the app
itself follows), and it borrows its colour and type tokens verbatim from `chromasmith-22.html`
so the site and the product look like the same object.

Three scripts feed it. All of them are optional: the page renders without any of them.

```bash
node site/shoot-screenshots.mjs   # re-capture the UI screenshots from the REAL app
node site/build-assets.mjs        # optimise your photos from site/photos-src/
node site/build-page.mjs          # inject those photos into index.html
```

## Adding before/after photos

Drop full-size files into `site/photos-src/` (gitignored — the originals are yours and large):

```
01-before.jpg   01-after.jpg   01.txt      <- 01.txt is a one-line caption
02-before.jpg   02-after.jpg   02.txt
hero.jpg                                   <- the photo behind the headline
```

Then run `build-assets.mjs` (downsizes and re-encodes into `site/assets/`) followed by
`build-page.mjs` (rewrites the regions between the `<!-- GALLERY:START -->` and
`<!-- HERO-IMG:START -->` markers). Everything outside those markers is hand-edited and is never
touched by a script.

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
