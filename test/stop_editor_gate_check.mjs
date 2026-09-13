import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const hook = await readFile(path.join(ROOT, '.claude/hooks/stop-editor-gate-check.sh'), 'utf8');

async function fixture(panel = 'masks') {
  const dir = await mkdtemp(path.join(tmpdir(), 'chroma-stop-hook-'));
  await mkdir(path.join(dir, '.claude/hooks'), { recursive: true });
  await mkdir(path.join(dir, '.claude/state'), { recursive: true });
  await mkdir(path.join(dir, 'test'), { recursive: true });
  await mkdir(path.join(dir, 'bin'), { recursive: true });
  await writeFile(path.join(dir, '.claude/hooks/stop-editor-gate-check.sh'), hook, { mode: 0o755 });
  await writeFile(path.join(dir, '.claude/state/active-panel'), panel + '\n');
  await writeFile(path.join(dir, 'chromasmith-22.html'), 'source-a\n');
  await writeFile(path.join(dir, 'build-desktop.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await writeFile(path.join(dir, 'bin/node'), '#!/bin/sh\ncat "$CLAUDE_PROJECT_DIR/diff-result.json"\nexit "$(cat "$CLAUDE_PROJECT_DIR/diff-code")"\n', { mode: 0o755 });
  await writeFile(path.join(dir, 'bin/git'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return dir;
}

async function result(dir, code, body = [{ selector: '#x', property: 'padding', actualValue: '4px' }]) {
  await writeFile(path.join(dir, 'diff-code'), String(code));
  await writeFile(path.join(dir, 'diff-result.json'), JSON.stringify(body));
}

function run(dir) {
  return spawnSync('sh', ['.claude/hooks/stop-editor-gate-check.sh'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}` },
  });
}

test('unchanged source never hides an unresolved failure and three failures stay failures', async () => {
  const dir = await fixture();
  await result(dir, 1);
  for (let round = 1; round <= 4; round++) {
    const r = run(dir);
    assert.equal(r.status, 2, `round ${round}: ${r.stderr}`);
  }
  assert.match(run(dir).stderr, /human attention is required/);
  assert.equal((await readFile(path.join(dir, '.claude/state/panel-blocks-masks'), 'utf8')).trim(), '5');
  assert.match(await readFile(path.join(dir, '.claude/state/panel-last-failure-masks.json'), 'utf8'), /#x/);
  await assert.rejects(readFile(path.join(dir, '.claude/state/panel-hash-masks')));
});

test('a clean run clears stale failure state and only then caches the panel hash', async () => {
  const dir = await fixture();
  await result(dir, 1);
  assert.equal(run(dir).status, 2);
  await result(dir, 0, []);
  assert.equal(run(dir).status, 0);
  await assert.rejects(readFile(path.join(dir, '.claude/state/panel-blocks-masks')));
  await assert.rejects(readFile(path.join(dir, '.claude/state/panel-last-failure-masks.json')));
  assert.ok((await readFile(path.join(dir, '.claude/state/panel-hash-masks'), 'utf8')).trim());
  await result(dir, 1);
  assert.equal(run(dir).status, 0, 'same panel+hash passed, so expensive check may be skipped');
});

test('panel counters, reports, and passed hashes are isolated', async () => {
  const dir = await fixture('masks');
  await result(dir, 1);
  assert.equal(run(dir).status, 2);
  await writeFile(path.join(dir, '.claude/state/active-panel'), 'retouch\n');
  await result(dir, 0, []);
  assert.equal(run(dir).status, 0);
  assert.equal((await readFile(path.join(dir, '.claude/state/panel-blocks-masks'), 'utf8')).trim(), '1');
  await assert.rejects(readFile(path.join(dir, '.claude/state/panel-blocks-retouch')));
  assert.ok((await readFile(path.join(dir, '.claude/state/panel-hash-retouch'), 'utf8')).trim());
});
