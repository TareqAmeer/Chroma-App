#!/usr/bin/env node
// Emit a sha256sum-compatible checksum beside a release artifact without buffering it in memory.
import { createReadStream, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';

const artifactArg = process.argv[2];
if (!artifactArg || process.argv.length !== 3) {
  console.error('Usage: node tools/scripts/write-sha256.mjs <release-artifact>');
  process.exit(2);
}

const artifact = resolve(artifactArg);
const hash = createHash('sha256');
for await (const chunk of createReadStream(artifact)) hash.update(chunk);

const checksumPath = artifact + '.sha256';
writeFileSync(checksumPath, hash.digest('hex') + '  ' + basename(artifact) + '\n', { flag: 'w' });
console.log('Wrote ' + checksumPath);
