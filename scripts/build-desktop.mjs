#!/usr/bin/env node
// Stage the web app into desktop/dist/ for the Tauri desktop shell (macOS + Windows).
// desktop/dist/ is generated — never edit it, never point frontendDist at the repo root
// (calib/ and the Python tooling must not ship inside the app bundle).
//
// Replaces the old build-desktop.sh's rsync/python3 pipeline (docs/windows-port.md G14):
// rsync isn't installed on Windows, and the `python3` found on a stock Windows PATH is often the
// Microsoft Store's execution-alias stub rather than a real interpreter (confirmed on this repo's
// own Windows dev machine — see the G15 write-up in that doc for the same trap in a hook script).
// Node is already a hard dependency of `desktop/` (npm + @tauri-apps/cli) on both platforms, so
// this script needs nothing beyond what building the app already requires.
//
// Incremental on purpose, same as the script it replaces: an unconditional wipe + full recopy
// was costing a 39MB vendor/ walk + a 15MB HTML write on every single check, which is what made
// "just look at a Library change" expensive enough that `npm run preview`
// (test/preview_server.mjs) exists as the actual iteration loop. This script stays the source of
// truth dist/ is built from — nothing here changes what ends up on disk, only how much gets
// rewritten to get there.
import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cd = (...p) => join(repoRoot, ...p);

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// Mirrors src/ into dest/ (additions + changed files copied, files/dirs absent from src removed
// from dest) — the Node equivalent of `rsync -a --delete`. Content-hash compared, not mtime
// compared: matches the old script's `--checksum` behaviour and is immune to clock/mtime skew
// across a git clone or a different filesystem's timestamp resolution.
function mirrorDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  const srcEntries = new Map(readdirSync(src, { withFileTypes: true }).map((e) => [e.name, e]));

  // Copy/update.
  for (const [name, entry] of srcEntries) {
    const s = join(src, name);
    const d = join(dest, name);
    if (entry.isDirectory()) {
      mirrorDir(s, d);
    } else if (entry.isFile()) {
      const same = existsSync(d) && statSync(d).size === statSync(s).size && sha256(d) === sha256(s);
      if (!same) copyFileSync(s, d);
    }
  }

  // Delete anything in dest that's no longer in src.
  if (existsSync(dest)) {
    for (const entry of readdirSync(dest, { withFileTypes: true })) {
      if (!srcEntries.has(entry.name)) {
        rmSync(join(dest, entry.name), { recursive: true, force: true });
      }
    }
  }
}

function copyIfChanged(src, dest) {
  const same = existsSync(dest) && statSync(dest).size === statSync(src).size && sha256(dest) === sha256(src);
  if (!same) copyFileSync(src, dest);
}

function dirSizeBytes(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    total += entry.isDirectory() ? dirSizeBytes(p) : statSync(p).size;
  }
  return total;
}

const distDir = cd('desktop', 'dist');
mkdirSync(distDir, { recursive: true });

mirrorDir(cd('vendor'), join(distDir, 'vendor'));
copyIfChanged(cd('desktop', 'desktop-native.js'), join(distDir, 'desktop-native.js'));
copyIfChanged(cd('desktop', 'library-ui.js'), join(distDir, 'library-ui.js'));

// index.html is always regenerated from chromasmith-22.html — it's the injection step below
// that makes it correct, and that step is cheap (one read, one write of a single file), so there
// is no correctness reason to skip it even when the source hasn't changed.
//
// Inject the native-shell glue scripts right before </body>, WITHOUT touching the source
// chromasmith-22.html (it stays a platform-agnostic single file for web/iOS). Native-only
// concerns (traffic-light spacing, window drag region, menu-bar wiring, the Library folder
// browser) live entirely in these injected scripts and only run when window.__TAURI__ is
// present. library-ui.js loads after desktop-native.js (it calls loadFXImages, a global
// desktop-native.js also relies on, and reads window.chromasmithToggleLibrary's caller wiring
// from it) — order matters less than both being present, but keep it for clarity.
const html = readFileSync(cd('chromasmith-22.html'), 'utf-8');
// lastIndexOf, not the first match: a Google-Photos OAuth popup string earlier in the file
// contains a literal "</body>" substring (see chromasmith-22.html's _GP_CB handler), which a
// naive first-match replace grabbed instead of the real closing tag.
const idx = html.lastIndexOf('</body>');
if (idx === -1) {
  console.error('index.html has no </body> to inject before');
  process.exit(1);
}
const tags = '<script src="desktop-native.js"></script>\n<script src="library-ui.js"></script>\n';
writeFileSync(join(distDir, 'index.html'), html.slice(0, idx) + tags + html.slice(idx), 'utf-8');

const sizeMB = (dirSizeBytes(distDir) / (1024 * 1024)).toFixed(1);
console.log(`desktop/dist/ staged: ${sizeMB}M`);
