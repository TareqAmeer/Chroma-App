// CHR-269: exercise the real native developed RAW face-detail command.
// Requires an already-running isolated Tauri app; this script never starts or closes the app.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

const rawPath = process.env.CULL_RAW_PATH;
const expectedSha = (process.env.CULL_RAW_SHA256 || 'e54a6c4264bf685214f538036fd9d39088e510b2bfedf288e568f0db1897880e').toLowerCase();
const expectedBuild = process.env.CULL_EXPECTED_BUILD;
const sourceCommit = process.env.CULL_NATIVE_COMMIT;
const nativeProfile = process.env.CULL_NATIVE_PROFILE;
const catalogDir = process.env.CULL_NATIVE_CATALOG_DIR;
const cacheDir = process.env.CULL_NATIVE_CACHE_DIR;
const endpoint = process.env.NATIVE_CDP || 'http://127.0.0.1:9223';
const reportPath = process.env.CULL_RAW_FACE_DETAIL_REPORT || 'docs/validation/chr269/raw-face-detail-native.json';
const outputCrop = process.env.CULL_RAW_FACE_DETAIL_CROP || 'docs/validation/chr269/raw-face-detail-crop.jpg';
const priorNativeDecodeAttempts = Number(process.env.CULL_PRIOR_NATIVE_DECODE_ATTEMPTS || 0);
assert(Number.isSafeInteger(priorNativeDecodeAttempts) && priorNativeDecodeAttempts >= 0, 'prior native decode attempt count must be a nonnegative integer');
const samePath = (a, b) => path.resolve(String(a)).toLowerCase() === path.resolve(String(b)).toLowerCase();
assert(rawPath && /\.nef$/i.test(rawPath), 'Set CULL_RAW_PATH to the canonical Nikon Z7 NEF');
assert(expectedBuild && /^[a-f0-9]{40}$/.test(sourceCommit || ''), 'Set exact CULL_EXPECTED_BUILD and CULL_NATIVE_COMMIT');
assert(['debug', 'release'].includes(nativeProfile), 'Set CULL_NATIVE_PROFILE to debug or release');
assert(catalogDir && cacheDir, 'Set task-owned CULL_NATIVE_CATALOG_DIR and CULL_NATIVE_CACHE_DIR');

const repoRoot = path.resolve(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(), '..', '..');
const expectedCatalogDir = path.join(repoRoot, '.worktrees', '_shared-test-runtime', 'native', 'chr269-20261012', 'catalog');
const expectedCacheDir = path.join(repoRoot, '.worktrees', '_shared-test-runtime', 'native', 'chr269-20261012', 'cache');
assert.equal(path.resolve(catalogDir).toLowerCase(), path.resolve(expectedCatalogDir).toLowerCase(), 'catalog must be the CHR-269 task-owned directory');
assert.equal(path.resolve(cacheDir).toLowerCase(), path.resolve(expectedCacheDir).toLowerCase(), 'cache setting must be the CHR-269 task-owned directory');
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceCommit, 'checkout must match the recorded source commit');

const fixtureDir = path.basename(path.dirname(rawPath)).toLowerCase() === 'chr268-native-compare'
  ? path.dirname(rawPath)
  : path.join(path.dirname(rawPath), 'chr268-native-compare');
const sourcePath = path.basename(path.dirname(rawPath)).toLowerCase() === 'chr268-native-compare'
  ? path.resolve(rawPath)
  : path.join(fixtureDir, 'A.NEF');
const canonicalRawPath = path.join(path.dirname(fixtureDir), 'nikon-z7-2789.NEF');
assert(samePath(rawPath, sourcePath) || samePath(rawPath, canonicalRawPath), 'CULL_RAW_PATH must be the canonical fixture or its existing A.NEF hard link');
const sourceBytes = await readFile(canonicalRawPath);
const sourceSha = createHash('sha256').update(sourceBytes).digest('hex');
assert.equal(sourceSha, expectedSha, 'canonical RAW fixture checksum mismatch');
const sourceStat = await stat(rawPath);
const aliasStat = await stat(sourcePath);
assert.equal(aliasStat.ino, sourceStat.ino, 'A.NEF must be the existing hard link to the canonical RAW fixture');
assert.equal(aliasStat.dev, sourceStat.dev, 'A.NEF hard link must reside on the same volume as the canonical RAW');
assert.equal(createHash('sha256').update(await readFile(sourcePath)).digest('hex'), expectedSha,
  'A.NEF must be the existing hard-linked copy of the canonical RAW fixture');
const box = { x0: 0.4, y0: 0.16, x1: 0.52, y1: 0.55 };
const report = {
  issue: 'CHR-269', capturedAt: new Date().toISOString(), sourceCommit, expectedBuild, nativeProfile,
  fixture: { canonicalPath: canonicalRawPath, commandSourcePath: sourcePath, sha256: sourceSha, bytes: sourceStat.size,
    sourceIsExistingFixtureHardlink: true, syntheticFaceBox: box,
    portraitDetectionOrIdentityValidated: false },
  settings: { mode: 'srgb', lutKey: '', rawNr: 'off', autoLens: false, demosaicAlgo: 'ahd',
    lensOverride: '', lensOverrideFocal: 0, recipeKey: null,
    dcpProfileApplied: false, dcpNote: 'Baseline sRGB request; no DCP LUT was supplied or claimed.' },
  validationScope: { actualTauriCommand: true, libraryUIInvoked: false, realFaceDetectorInvoked: false,
    syntheticBoxOnly: true, portraitOrEyeRecognitionClaimed: false },
  isolation: { catalogDir, configuredCacheDir: cacheDir,
    decodeCacheNote: 'Native RAW decode cache uses the platform LocalAppData root; CS_CACHE_DIR does not redirect it. The unique recipe is checked for full/display/editor cache misses before and after this command.' },
  runtime: null, databaseSeed: null, editorState: null, beforeCache: null, response: null,
  nativeDecodeAttemptsIncludingPrior: priorNativeDecodeAttempts,
  stages: [], result: 'RUNNING', hardware: { platform: os.platform(), release: os.release(), arch: os.arch(),
    cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem() },
};
const stage = name => report.stages.push({ name, at: new Date().toISOString() });
const save = async () => { await mkdir(path.dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2)); };

// SQLite is modified only inside the CHR-269 disposable catalog. Python's standard-library
// sqlite3 avoids adding a Node dependency. Existing unrelated face rows are preserved.
const seedSqlite = String.raw`
import json, os, sqlite3, sys
db_path, expected_dir, source_path = sys.argv[1:4]
box = tuple(float(v) for v in sys.argv[4:8])
db_real, source_real = os.path.realpath(db_path), os.path.realpath(source_path)
expected = os.path.normcase(os.path.abspath(os.path.join(expected_dir, 'catalog.db')))
if os.path.normcase(db_real) != expected:
    raise SystemExit('catalog database path is outside the exact CHR-269 task directory')
c = sqlite3.connect(db_real, timeout=30)
c.execute('PRAGMA busy_timeout=30000')
try:
    cols = {r[1] for r in c.execute('PRAGMA table_info(photos)')}
    required = {'id','mtime','faces_scanned_at','rel_path','volume_id'}
    if not required.issubset(cols): raise RuntimeError('photos schema missing required face-scan identity columns')
    rows = []
    for r in c.execute('SELECT p.id,p.mtime,p.rel_path,v.last_path,v.is_local FROM photos p JOIN volumes v ON v.id=p.volume_id'):
        base = r[3]
        resolved = os.path.realpath(r[2] if os.path.isabs(r[2]) else os.path.join(base, r[2]))
        if os.path.normcase(resolved) == os.path.normcase(source_real): rows.append(r)
    if len(rows) != 1: raise RuntimeError('expected exactly one catalog photo row for the fixture A.NEF source')
    photo_id, mtime = rows[0][0], rows[0][1]
    face_cols = {r[1] for r in c.execute('PRAGMA table_info(photo_faces)')}
    required_face = {'id','photo_id','x0','y0','x1','y1','score','kps','confirmed'}
    if not required_face.issubset(face_cols): raise RuntimeError('photo_faces schema missing required fields')
    existing = c.execute('SELECT id FROM photo_faces WHERE photo_id=? AND x0=? AND y0=? AND x1=? AND y1=?', (photo_id,*box)).fetchone()
    if existing: face_id = existing[0]
    else:
        cur = c.execute('INSERT INTO photo_faces(photo_id,x0,y0,x1,y1,score,kps,confirmed) VALUES(?,?,?,?,?,?,?,1)', (photo_id,*box,0.99,'[]'))
        face_id = cur.lastrowid
    if 'face_scan_fail_count' in cols:
        c.execute('UPDATE photos SET faces_scanned_at=mtime, face_scan_fail_count=0 WHERE id=?', (photo_id,))
    else:
        c.execute('UPDATE photos SET faces_scanned_at=mtime WHERE id=?', (photo_id,))
    c.commit()
    print(json.dumps({'photoId':photo_id,'faceId':face_id,'mtime':mtime,'sourcePath':source_real,'bbox':box,'seeded':not bool(existing)}))
finally:
    c.close()
`;

function parseJpegSize(buffer) {
  assert(buffer[0] === 0xff && buffer[1] === 0xd8, 'face detail body is not JPEG');
  let i = 2;
  while (i + 4 <= buffer.length) {
    if (buffer[i++] !== 0xff) continue;
    while (buffer[i] === 0xff) i++;
    const marker = buffer[i++];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = buffer.readUInt16BE(i);
    if (length < 2 || i + length > buffer.length) break;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      return { width: buffer.readUInt16BE(i + 5), height: buffer.readUInt16BE(i + 3) };
    }
    i += length;
  }
  throw new Error('JPEG dimensions not found');
}
function rgbaCropGeometry(width, height, b) {
  const bw = Math.max(b.x1 - b.x0, 0.01), bh = Math.max(b.y1 - b.y0, 0.01);
  const x0 = Math.min(width - 1, Math.floor(Math.max(0, b.x0 - bw * 0.35) * width));
  const y0 = Math.min(height - 1, Math.floor(Math.max(0, b.y0 - bh * 0.35) * height));
  const x1 = Math.floor(Math.min(1, b.x1 + bw * 0.35) * width);
  const y1 = Math.floor(Math.min(1, b.y1 + bh * 0.35) * height);
  const cropWidth = Math.max(1, Math.min(x1 - x0, width - x0));
  const cropHeight = Math.max(1, Math.min(y1 - y0, height - y0));
  const scale = Math.min(2048 / Math.max(cropWidth, cropHeight), 1);
  return { x0, y0, cropWidth, cropHeight,
    outputWidth: Math.max(1, Math.round(cropWidth * scale)), outputHeight: Math.max(1, Math.round(cropHeight * scale)) };
}
function toBuffer(value) {
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
  if (Array.isArray(value)) return Buffer.from(value);
  if (value?.data instanceof Uint8Array) return Buffer.from(value.data);
  throw new Error(`native binary response has unsupported JS shape: ${Object.prototype.toString.call(value)}`);
}

const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = browser.contexts()[0].pages().find(p => !p.url().includes('devtools'));
  assert(page, 'Native WebView page missing');
  const runtime = await page.evaluate(async () => {
    if (new URL(location.href).searchParams.has('libtest') || !window.__TAURI__?.core?.invoke) throw Error('Real Tauri IPC is required');
    const catalog = await window.__TAURI__.core.invoke('catalog_query', { q: { offset: 0, limit: 8 } });
    return { build: typeof BUILD === 'undefined' ? null : BUILD, url: location.href, catalog };
  });
  report.runtime = { build: runtime.build, url: runtime.url, catalogTotal: runtime.catalog.total,
    catalogPaths: (runtime.catalog.entries || []).map(entry => entry.path) };
  assert.equal(runtime.build, expectedBuild, 'native app BUILD does not match expected build');
  const expectedPaths = ['A.NEF', 'B.NEF', 'C.NEF'].map(name => path.join(fixtureDir, name));
  assert(runtime.catalog.total === 3 && runtime.catalog.entries?.length === 3 &&
    expectedPaths.every(expected => runtime.catalog.entries.some(entry => samePath(entry.path, expected))),
  'Refuse to seed or call native code unless catalog is exactly the three disposable compare fixtures');
  assert(runtime.catalog.entries.some(entry => samePath(entry.path, sourcePath)), 'fixture source path not present in task catalog');

  const dbPath = path.join(catalogDir, 'catalog.db');
  stage('seed-synthetic-face-in-task-catalog');
  const python = process.env.PYTHON || 'python';
  const seed = JSON.parse(execFileSync(python, ['-c', seedSqlite, dbPath, catalogDir, sourcePath,
    String(box.x0), String(box.y0), String(box.x1), String(box.y1)], { encoding: 'utf8', timeout: 40000 }).trim());
  report.databaseSeed = { ...seed, catalogPath: dbPath,
    sourceIdentity: 'canonical path joined from the isolated photo row volume + rel_path' };

  const invoke = (command, args = {}) => page.evaluate(([cmd, value]) => window.__TAURI__.core.invoke(cmd, value), [command, args]);
  // Chromium's CDP value serializer does not reliably preserve Tauri's raw IPC
  // Uint8Array/ArrayBuffer return value. Convert only this bounded response to a plain
  // number array inside the WebView, before it crosses the CDP boundary.
  const invokeBinary = (command, args = {}) => page.evaluate(async ([cmd, value]) => {
    const response = await window.__TAURI__.core.invoke(cmd, value);
    if (response instanceof ArrayBuffer) return Array.from(new Uint8Array(response));
    if (ArrayBuffer.isView(response)) {
      return Array.from(new Uint8Array(response.buffer, response.byteOffset, response.byteLength));
    }
    if (Array.isArray(response)) return response;
    return { unsupportedBinaryShape: Object.prototype.toString.call(response), keys: Object.keys(response || {}).slice(0, 8) };
  }, [command, args]);
  const faces = await invoke('catalog_faces_for_path', { path: sourcePath, stack: false });
  assert(faces.some(face => face.face_id === seed.faceId), 'native read connection did not observe the synthetic persisted face row');
  assert.equal(await invoke('catalog_face_scan_status', { path: sourcePath }), true, 'face scan status must be complete to avoid model reprocessing');
  const selectedFaces = [{ faceId: seed.faceId, x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 }];
  const recipeKey = `chr269-face-detail:${sourceSha.slice(0,16)}:${Date.now()}-${process.pid}`;
  report.settings.recipeKey = recipeKey;
  const request = { path: sourcePath, recipeKey, mode: 'srgb', lutKey: '', rawNr: 'off', autoLens: false,
    demosaicAlgo: 'ahd', lensOverride: '', lensOverrideFocal: 0, faceIds: [seed.faceId] };
  const cacheMisses = async () => {
    const checks = {};
    for (const [name, command, args] of [
      ['fullDecodePath','get_decode_cache_path',{path:sourcePath,recipeKey}],
      ['displayProxyPath','get_display_decode_cache_path',{path:sourcePath,recipeKey,longEdge:2560}],
      ['editorFrame','get_cached_raw_decode',{path:sourcePath,recipeKey}],
    ]) {
      try { await invoke(command,args); checks[name] = { miss: false, error: null }; }
      catch (error) {
        const message = String(error);
        const expected = name === 'displayProxyPath' ? /no cached display proxy/i : /no cached decode/i;
        assert.match(message, expected, `${name} failed for an unexpected reason`);
        checks[name] = { miss: true, error: message.slice(0, 180) };
      }
    }
    assert(Object.values(checks).every(check => check.miss), 'unique RAW recipe unexpectedly has a full/display/editor cache hit');
    return checks;
  };
  report.beforeCache = await cacheMisses();
  const beforeEditor = await page.evaluate(() => {
    window.__chr269EditorBaseline = {
      frameArray: typeof fxImages === 'undefined' ? null : fxImages,
      frames: typeof fxImages === 'undefined' || !Array.isArray(fxImages) ? null : [...fxImages],
      selectedPath: document.getElementById('sel-input')?.value || null,
      lensApplied: window.chromasmithLensApplied ?? null,
      persistTarget: window.__chromasmithPersistTarget ?? null,
    };
    return { frameCount: window.__chr269EditorBaseline.frames?.length ?? null,
      hasFrameArray: !!window.__chr269EditorBaseline.frameArray,
      selectedPath: window.__chr269EditorBaseline.selectedPath,
      lensApplied: window.__chr269EditorBaseline.lensApplied,
      hasPersistenceTarget: !!window.__chr269EditorBaseline.persistTarget };
  });
  report.editorState = { before: beforeEditor };
  stage('native-developed-detail-decode-start');
  report.nativeDecodeAttemptsIncludingPrior += 1;
  const startedAt = Date.now();
  const detailPromise = invokeBinary('catalog_raw_face_detail', request);
  let rawResponse, timeoutId;
  try {
    rawResponse = await Promise.race([detailPromise, new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('RAW face-detail command exceeded 120-second safety timeout')), 120000);
    })]);
  } catch (error) {
    report.decode = { elapsedMs: Date.now() - startedAt, outcome: 'failed-or-timeout', timingIsPerformanceClaim: false };
    throw error;
  } finally { clearTimeout(timeoutId); }
  const elapsedMs = Date.now() - startedAt;
  stage('native-developed-detail-decode-complete');
  const bytes = toBuffer(rawResponse);
  assert(bytes.length >= 4, 'native face-detail response is shorter than its header prefix');
  const headerLength = bytes.readUInt32LE(0);
  assert(headerLength > 0 && 4 + headerLength <= bytes.length, 'invalid native face-detail JSON header length');
  const header = JSON.parse(bytes.subarray(4, 4 + headerLength).toString('utf8'));
  const bodyOffset = 4 + headerLength;
  assert.equal(header.sourceWidth, 8256, 'real Nikon fixture developed width mismatch');
  assert.equal(header.sourceHeight, 5504, 'real Nikon fixture developed height mismatch');
  assert.equal(header.crops?.length, 1, 'native response must include exactly the requested face');
  const descriptor = header.crops[0];
  assert.equal(descriptor.faceId, seed.faceId);
  assert(descriptor.offset >= 0 && descriptor.length > 0 && bodyOffset + descriptor.offset + descriptor.length <= bytes.length,
    'native crop byte range escapes response payload');
  const jpeg = bytes.subarray(bodyOffset + descriptor.offset, bodyOffset + descriptor.offset + descriptor.length);
  assert(descriptor.length < 1024 * 1024, 'single bounded face JPEG unexpectedly exceeds 1 MiB');
  const jpegSize = parseJpegSize(jpeg);
  const expectedGeometry = rgbaCropGeometry(header.sourceWidth, header.sourceHeight, box);
  assert(jpegSize.width <= 2048 && jpegSize.height <= 2048, 'face detail crop exceeds 2048px');
  assert.equal(jpegSize.width, descriptor.width);
  assert.equal(jpegSize.height, descriptor.height);
  assert(Math.abs(jpegSize.width / jpegSize.height - expectedGeometry.cropWidth / expectedGeometry.cropHeight) < 0.002,
    'encoded face crop did not preserve its padded source aspect ratio');
  assert(Math.max(jpegSize.width, jpegSize.height) === 2048, 'synthetic crop should downscale to the 2048px bound');
  await mkdir(path.dirname(outputCrop), { recursive: true });
  await writeFile(outputCrop, jpeg);
  report.decode = { elapsedMs, outcome: 'completed', timingIsPerformanceClaim: false,
    note: 'Observed one real native RAW detail decode; elapsed time is diagnostic only, not a latency target.' };
  report.response = { bytes: bytes.length, headerBytes: headerLength, sourceWidth: header.sourceWidth, sourceHeight: header.sourceHeight,
    cropCount: header.crops.length, crop: { faceId: descriptor.faceId, width: jpegSize.width, height: jpegSize.height,
      bytes: descriptor.length, sha256: createHash('sha256').update(jpeg).digest('hex'), savedPath: outputCrop },
    expectedGeometry, syntheticFaceRow: true, portraitOrEyeValidation: false };
  report.afterCache = await cacheMisses();
  const afterEditor = await page.evaluate(() => {
    const baseline = window.__chr269EditorBaseline;
    const current = typeof fxImages === 'undefined' ? null : fxImages;
    const frames = Array.isArray(current) ? current : null;
    const result = {
      frameArraySame: current === baseline.frameArray,
      frameObjectsSame: baseline.frames === null ? frames === null : !!frames && frames.length === baseline.frames.length && frames.every((frame, i) => frame === baseline.frames[i]),
      selectedPathSame: (document.getElementById('sel-input')?.value || null) === baseline.selectedPath,
      lensAppliedSame: (window.chromasmithLensApplied ?? null) === baseline.lensApplied,
      persistenceTargetSame: (window.__chromasmithPersistTarget ?? null) === baseline.persistTarget,
    };
    delete window.__chr269EditorBaseline;
    return result;
  });
  report.editorState.after = afterEditor;
  assert(Object.values(afterEditor).every(Boolean), 'direct native detail command changed Editor frames or globals');
  report.result = 'PASS';
  stage('complete');
  await save();
  console.log(JSON.stringify({ result: report.result, source: sourcePath, response: report.response, report: reportPath }));
} catch (error) {
  report.result = 'FAIL'; report.error = String(error.stack || error);
  await save(); throw error;
} finally {
  // Disconnect this helper only; the root-owned Tauri app stays running.
  await browser.close();
}
