#!/usr/bin/env node
// Download the real-photo samples listed in test/fixtures/public-samples.json into
// test/fixtures/public-samples/ (gitignored, never committed) and verify each SHA-256.
// Usage: node tools/scripts/fetch-public-samples.mjs [--ticket CHR-262] [--force]
// Behind a proxy on Node 24+, run with NODE_USE_ENV_PROXY=1.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(await readFile(path.join(root, 'test/fixtures/public-samples.json'), 'utf8'));
const dir = path.join(root, manifest.dir);
const args = process.argv.slice(2);
const force = args.includes('--force');
const ti = args.indexOf('--ticket');
const ticket = ti >= 0 ? args[ti + 1] : null;
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
let failed = 0;
for (const s of manifest.samples) {
  if (ticket && s.ticket !== ticket) continue;
  const dest = path.join(dir, s.file);
  await mkdir(path.dirname(dest), { recursive: true });
  try {
    if (!force) {
      const st = await stat(dest).catch(() => null);
      if (st && st.size === s.size && sha(await readFile(dest)) === s.sha256) { console.log(`ok (cached)  ${s.id}`); continue; }
    }
    const res = await fetch(s.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha(buf) !== s.sha256) throw new Error(`SHA-256 mismatch: got ${sha(buf)}`);
    await writeFile(dest, buf);
    console.log(`ok (fetched) ${s.id}  ${(buf.length / 1e6).toFixed(2)} MB`);
  } catch (e) { failed++; console.error(`FAIL ${s.id}: ${e.message}`); }
}
process.exit(failed ? 1 : 0);
