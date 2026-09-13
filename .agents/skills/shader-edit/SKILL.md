---
name: shader-edit
description: Checklist to run around ANY edit touching GLSL shader source in chromasmith-22.html (the FXR class's lut/src/blur/blur_hal/comp programs) — catches the two bug classes that have each cost real debugging time and don't announce themselves. Use before AND after touching shader strings, GLSL comments near them, or adding a new shader uniform.
---

# Shader edit checklist

`chromasmith-22.html`'s GLSL lives inside JS template literals. Two failure modes here are
both silent or misleading — see AGENTS.md §3. This skill exists so neither has to be
remembered from scratch each time.

## 1. Before editing — scan for the loud bug class

**Never put a backtick `` ` `` or `${` inside a GLSL `//` comment.** The GLSL is a JS
template literal, so a stray backtick truncates the shader source mid-string and throws
`SyntaxError: missing ) after argument list`, breaking the ENTIRE page (not just the shader).
This has bitten the project twice. If you're about to write or edit a comment inside shader
source, use double-quotes for any inline code/values — never backticks.

## 2. Before editing — scan for the quiet bug class

GLSL ES reserves several words that read as completely ordinary identifiers in this codebase.
Using one as a variable/parameter/uniform name does NOT crash or white-screen the app — the
program just fails to compile/link and the whole feature it belongs to silently renders as if
switched off. This already happened with a parameter named `half`, which silently killed the
`lut` program so every mask did nothing while the app looked completely healthy.

Reserved words to avoid as identifiers: `half`, `input`, `output`, `filter`, `sample`, `cast`,
`union`, `this`, `double`. (Video work reaches for `sample`/`output` specifically — prefix
those `vidSample`/`vidOut` per AGENTS.md §12.)

## 3. After ANY shader edit — mandatory verification

```bash
node test/export_harness.mjs
```

Watch the output for `[console.error] GLSL compile error` — the harness surfaces compile/link
failures immediately. A silent no-op reads as "the page still loads, so it's fine" — it is
not. Never judge a shader change by whether the page loads; judge it by this line being
absent.

If the harness reports a **BLANK RENDER** (all-zero RGBA), re-run once before investigating —
this is a known-flaky WebGL context loss on this machine (AGENTS.md §"Two tests on this
machine are FLAKY"), not necessarily your change.

## 4. If the edit was meant to change output — confirm goldens on purpose

```bash
node test/export_harness.mjs --golden
```

only when the visual change is intentional; otherwise a golden mismatch after step 3 means
something regressed. Untouched paths must stay byte-exact — that's the point of the harness.

## 5. New uniform added?

Every new shader uniform must default to today's behaviour exactly (identity-gated), per
AGENTS.md §12's video-work rule generalized to any shader work — all `test/golden/` PNGs stay
byte-exact unless the golden regen in step 4 was deliberate.
