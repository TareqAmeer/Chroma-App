import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const helper = join(repo, 'tools/scripts/write-sha256.mjs');
const temp = mkdtempSync(join(tmpdir(), 'chromasmith-checksum-'));

try {
  const filename = 'release build with spaces.dmg';
  const artifact = join(temp, filename);
  const bytes = Buffer.from(Array.from({ length: 512 * 1024 }, (_, i) => i % 251));
  writeFileSync(artifact, bytes);

  const result = spawnSync(process.execPath, [helper, artifact], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Wrote .*\.sha256/);

  const expected = createHash('sha256').update(bytes).digest('hex');
  assert.equal(readFileSync(artifact + '.sha256', 'utf8'), `${expected}  ${filename}\n`);

  const missingArg = spawnSync(process.execPath, [helper], { encoding: 'utf8' });
  assert.equal(missingArg.status, 2);
  assert.match(missingArg.stderr, /Usage: node .*write-sha256\.mjs/);
  console.log('SHA-256 release sidecar matches Node crypto for a binary artifact with spaces');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
