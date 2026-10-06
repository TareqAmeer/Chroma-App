import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('desktop native file drag plugin is registered and authorized', () => {
  const cargo = read('../desktop/src-tauri/Cargo.toml');
  const cargoLock = read('../desktop/src-tauri/Cargo.lock');
  const packageJson = JSON.parse(read('../desktop/package.json'));
  const packageLock = JSON.parse(read('../desktop/package-lock.json'));
  const main = read('../desktop/src-tauri/src/main.rs');
  const capability = JSON.parse(read('../desktop/src-tauri/capabilities/default.json'));

  assert.match(cargo, /^tauri-plugin-drag = "2\.1\.1"$/m);
  assert.match(cargoLock, /name = "tauri-plugin-drag"\nversion = "2\.1\.1"/);
  assert.equal(packageJson.dependencies['@crabnebula/tauri-plugin-drag'], '^2.1.0');
  assert.equal(packageLock.packages['node_modules/@crabnebula/tauri-plugin-drag'].version, '2.1.0');
  assert.match(main, /\.plugin\(tauri_plugin_drag::init\(\)\)/);
  assert.ok(capability.permissions.includes('drag:default'));
});
