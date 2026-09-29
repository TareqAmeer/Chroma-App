#!/usr/bin/env node
// Fetch the desktop shell's gitignored binary vendor assets: the SAM2 encoder/decoder, the
// RawNIND raw-denoise weights, and (Windows only) the ONNX Runtime win-x64 DLL. See
// docs/windows-port.md ground rule 4 ("Cross-platform scripts in Node") — CI and local dev both
// call this instead of each having their own curl/python steps.
//
// Idempotent: skips anything already present on disk (same behavior as desktop-dmg.yml's old
// inline `actions/cache` + curl steps). Re-run after `rm`ing a file to force a re-fetch.
//
// Sources + why each isn't committed to git: the README.md next to each destination directory
// (vendor/sam2/README.md, vendor/rawdenoise/README.md, vendor/onnxruntime/win-x64/README.md).
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = join(repoRoot, 'desktop', 'src-tauri', 'vendor');
const forceWinOrt = process.argv.includes('--windows-ort');

// fs.renameSync fails with EXDEV when src and dest are on different volumes — which they are on
// GitHub's windows-latest runner (the OS temp dir extraction happens into is on C:, the checkout
// is on D:). Confirmed live: the first CI run of this script failed exactly this way. Fall back to
// copy+delete, same as `mv` across filesystems.
function moveFile(src, dest) {
  try {
    renameSync(src, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    copyFileSync(src, dest);
    rmSync(src, { force: true });
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function fetchToFile(url, dest) {
  console.log(`  GET ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error(`${url} -> empty response body`);
  writeFileSync(dest, buf);
  console.log(`  wrote ${dest} (${(buf.length / (1024 * 1024)).toFixed(1)}M, sha256 ${sha256(dest)})`);
}

// bsdtar (libarchive) understands .zip natively and ships as the system `tar` on both macOS
// (/usr/bin/tar) and Windows 10/11 (%SystemRoot%\System32\tar.exe) — no extra dependency needed.
// Explicit System32 path on win32 sidesteps a Git-Bash GNU `tar` earlier on PATH, which cannot
// read zip archives at all (see docs/windows-port.md G14 for the same class of PATH trap).
function extractZip(zipPath, destDir) {
  const tarBin = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  mkdirSync(destDir, { recursive: true });
  execFileSync(tarBin, ['-xf', zipPath, '-C', destDir], { stdio: 'inherit' });
}

async function fetchSam2() {
  const dir = join(vendor, 'sam2');
  const encoder = join(dir, 'encoder.onnx');
  const decoder = join(dir, 'decoder.onnx');
  if (existsSync(encoder) && existsSync(decoder)) {
    console.log('sam2: already present, skipping');
    return;
  }
  console.log('sam2: fetching (SharpAI/sam2-hiera-tiny-onnx, Apache 2.0)');
  if (!existsSync(encoder)) await fetchToFile('https://huggingface.co/SharpAI/sam2-hiera-tiny-onnx/resolve/main/encoder.onnx', encoder);
  if (!existsSync(decoder)) await fetchToFile('https://huggingface.co/SharpAI/sam2-hiera-tiny-onnx/resolve/main/decoder.onnx', decoder);
}

async function fetchRawdenoise() {
  const dir = join(vendor, 'rawdenoise');
  const linear = join(dir, 'model_linear.onnx');
  const bayer = join(dir, 'model_bayer.onnx');
  if (existsSync(linear) && existsSync(bayer)) {
    console.log('rawdenoise: already present, skipping');
    return;
  }
  console.log('rawdenoise: fetching (darktable-ai release-5.6.0, GPL-3.0)');
  const tmpZip = join(os.tmpdir(), `rawdenoise-nind-${Date.now()}.dtmodel`);
  await fetchToFile(
    'https://github.com/darktable-org/darktable-ai/releases/download/release-5.6.0/rawdenoise-nind.dtmodel',
    tmpZip
  );
  const extractDir = join(os.tmpdir(), `rawdenoise-nind-${Date.now()}-extracted`);
  extractZip(tmpZip, extractDir);
  const extractedSub = join(extractDir, 'rawdenoise-nind');
  moveFile(join(extractedSub, 'model_linear.onnx'), linear);
  moveFile(join(extractedSub, 'model_bayer.onnx'), bayer);
  rmSync(tmpZip, { force: true });
  rmSync(extractDir, { recursive: true, force: true });
  console.log(`  -> ${linear}, ${bayer}`);
}

async function fetchWindowsOrt() {
  const dir = join(vendor, 'onnxruntime', 'win-x64');
  const dll = join(dir, 'onnxruntime.dll');
  if (existsSync(dll)) {
    console.log('onnxruntime win-x64: already present, skipping');
    return;
  }
  console.log('onnxruntime win-x64: resolving latest release (current, unpinned — see vendor/onnxruntime/win-x64/README.md)');
  const res = await fetch('https://api.github.com/repos/microsoft/onnxruntime/releases/latest', {
    headers: { 'User-Agent': 'chromasmith-fetch-models' },
  });
  if (!res.ok) throw new Error(`GitHub releases API -> HTTP ${res.status}`);
  const release = await res.json();
  const tag = release.tag_name; // e.g. "v1.20.1"
  const version = tag.replace(/^v/, '');
  const assetName = `onnxruntime-win-x64-${version}.zip`;
  const asset = (release.assets ?? []).find((a) => a.name === assetName);
  if (!asset) throw new Error(`release ${tag} has no asset named ${assetName}`);

  const tmpZip = join(os.tmpdir(), `${assetName}-${Date.now()}`);
  await fetchToFile(asset.browser_download_url, tmpZip);
  const extractDir = join(os.tmpdir(), `ort-win-x64-${Date.now()}-extracted`);
  extractZip(tmpZip, extractDir);
  const pkgDir = join(extractDir, `onnxruntime-win-x64-${version}`);
  mkdirSync(dir, { recursive: true });
  moveFile(join(pkgDir, 'lib', 'onnxruntime.dll'), dll);
  const licenseSrc = join(pkgDir, 'LICENSE');
  if (existsSync(licenseSrc)) moveFile(licenseSrc, join(dir, 'LICENSE'));
  rmSync(tmpZip, { force: true });
  rmSync(extractDir, { recursive: true, force: true });
  console.log(`  -> ${dll} (release ${tag})`);
}

await fetchSam2();
await fetchRawdenoise();
if (forceWinOrt || process.platform === 'win32') {
  await fetchWindowsOrt();
} else {
  console.log('onnxruntime win-x64: skipped (not on Windows; pass --windows-ort to force)');
}
console.log('fetch-models: done');
