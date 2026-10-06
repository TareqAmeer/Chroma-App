# First-run sample photo

The first-run editor reuses the already-bundled `vendor/splash/dog-sitting.webp`. The existing
`design/prototypes/splash-v2/index.html` credits this cover photo to Tareq Ameer. The WebP contains
image and ICC-profile chunks, but no EXIF/XMP authorship or license metadata. The onboarding card
keeps the author credit visible and opens the bundled image as a separate in-memory `File`, so
editing or exporting the sample cannot overwrite the bundled source.

The repository's `LICENSE` is for the application source and does not state a separate image
license. This note records the existing authorship attribution; it does not claim a broader
open-image license.
