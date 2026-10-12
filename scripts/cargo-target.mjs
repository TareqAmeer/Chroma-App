// Single source of truth for where `npm run build` / `tauri build` put the Rust build output.
// scripts/tauri-shared-cache.mjs sets CARGO_TARGET_DIR to this; install-app.sh, the test probes and
// tools/diagnostics (find_process.py mirrors this logic) resolve the app bundle from it so none of
// them can launch a stale repo-local copy. CLI: `node scripts/cargo-target.mjs [dir|bundle|exe]`.
import { homedir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legacy = path.join(repoRoot, 'desktop', 'src-tauri', 'target');

export function cargoTargetDir() {
  if (process.env.CARGO_TARGET_DIR) return process.env.CARGO_TARGET_DIR;
  return process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Chroma-App', 'cargo-target')
    : path.join(process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache'), 'chroma-app', 'cargo-target');
}

export function appBundlePath() {
  const rel = ['release', 'bundle', 'macos', 'Chromasmith.app'];
  const real = path.join(cargoTargetDir(), ...rel);
  // Pre-shared-cache builds lived in the repo; only fall back when the real output doesn't exist yet.
  return existsSync(real) || !existsSync(path.join(legacy, ...rel)) ? real : path.join(legacy, ...rel);
}

export function appExePath() {
  return path.join(appBundlePath(), 'Contents', 'MacOS', 'chromasmith');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const what = process.argv[2] || 'bundle';
  console.log(what === 'dir' ? cargoTargetDir() : what === 'exe' ? appExePath() : appBundlePath());
}
