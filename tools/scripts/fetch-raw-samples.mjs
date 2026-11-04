#!/usr/bin/env node
// CHR-250: download the CC0 camera RAW samples listed in test/fixtures/raw-samples.json into
// test/fixtures/raw-samples/ (gitignored, never committed) and verify each one's SHA-256.
// Usage: node tools/scripts/fetch-raw-samples.mjs [--only id,id] [--force]
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(await readFile(path.join(root, 'test/fixtures/raw-samples.json'), 'utf8'));
const dir = path.join(root, 'test/fixtures/raw-samples');
const args = process.argv.slice(2);
const force = args.includes('--force');
const oi = args.indexOf('--only');
const only = oi >= 0 ? new Set(args[oi + 1].split(',')) : null;
await mkdir(dir, { recursive: true });

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
let failed = 0;
for (const s of manifest.samples) {
  if (only && !only.has(s.id)) continue;
  const dest = path.join(dir, s.file);
  try {
    if (!force) {
      const st = await stat(dest).catch(() => null);
      if (st && st.size === s.size && sha(await readFile(dest)) === s.sha256) { console.log(`ok (cached)  ${s.id}`); continue; }
    }
    // Node's fetch honours HTTPS_PROXY only with NODE_USE_ENV_PROXY=1 (Node 24+); set it if behind a proxy.
    const res = await fetch(s.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const got = sha(buf);
    if (got !== s.sha256) throw new Error(`SHA-256 mismatch: got ${got}, want ${s.sha256}`);
    if (buf.length !== s.size) throw new Error(`size mismatch: got ${buf.length}, want ${s.size}`);
    await writeFile(dest, buf);
    console.log(`ok (fetched) ${s.id}  ${(buf.length / 1e6).toFixed(1)} MB  ${s.license}`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${s.id}: ${e.message}`);
  }
}
if (failed) { console.error(`${failed} sample(s) failed`); process.exit(1); }
