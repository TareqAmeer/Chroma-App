import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {repositoryRootFromTestUrl} from './lib/repo-paths.mjs';

const originalCwd=process.cwd();
const root=await mkdtemp(path.join(os.tmpdir(),'chromasmith-root-'));
try {
  await mkdir(path.join(root,'test'),{recursive:true});
  process.chdir(os.tmpdir());
  const moduleUrl=pathToFileURL(path.join(root,'test','mobile_ux.mjs'));
  const resolved=repositoryRootFromTestUrl(moduleUrl);
  assert.equal(resolved,root,'test root must come from its file URL, independent of process.cwd()');
  assert.ok(path.isAbsolute(resolved));
  if(process.platform==='win32') assert.doesNotMatch(resolved,/^\/[A-Za-z]:\//,'root must not retain URL pathname /C:/ prefix');
  console.log(`PASS repository root from file URL: ${resolved}`);
} finally {
  process.chdir(originalCwd);
  await rm(root,{recursive:true,force:true});
}
