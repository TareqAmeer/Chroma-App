import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargoTargetDir } from './cargo-target.mjs';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'desktop');
const tauriCli = path.join(desktopDir, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const command = process.argv[2];

if (!command) {
  console.error('Usage: node scripts/tauri-shared-cache.mjs <tauri-command> [arguments...]');
  process.exit(2);
}

const cacheRoot = cargoTargetDir();

const child = spawn(process.execPath, [tauriCli, ...process.argv.slice(2)], {
  cwd: desktopDir,
  env: { ...process.env, CARGO_TARGET_DIR: cacheRoot },
  stdio: 'inherit',
  windowsHide: true,
});

child.on('error', (error) => {
  console.error(`Unable to start the Tauri CLI at ${tauriCli}: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
