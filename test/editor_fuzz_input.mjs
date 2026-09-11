// T38 (editor_ux_spec.json, 2026-09-11): nothing feeds a corrupt .cube, a truncated/malformed
// image, or a zero-byte file through the real load paths and asserts a bounded, clean failure
// instead of a silent hang — exactly the failure shape T28's editor_hang_diagnose.mjs exists to
// diagnose AFTER the fact (the mskRebuild()/fxEnsureDepthMap() infinite loop). This is the
// before-ship half: throw adversarial input at the real hf()/loadFXImages() entry points and
// assert each one settles within a bounded time, with no uncaught error and no hang.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const d = await readFile(path.join(ROOT, u.slice(1)));
    const ext = path.extname(u);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm' };
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const port = server.address().port;
const URL = `http://127.0.0.1:${port}/desktop/dist/index.html?libtest=1&deskx=1`;

// Each case: a file (name + text/base64 content) and which real entry point consumes it.
const CASES = [
  { label: 'garbage .cube (not even LUT-shaped text)', file: 'garbage.cube', text: 'this is not a LUT file at all\njust some random prose\n1 2 3 4 5 6 7 8 9', kind: 'lut' },
  { label: '.cube with LUT_3D_SIZE but truncated data', file: 'truncated.cube', text: 'LUT_3D_SIZE 33\n0.0 0.0 0.0\n0.1 0.1 0.1\n', kind: 'lut' },
  { label: '.cube with a huge claimed size (resource-exhaustion shape)', file: 'huge.cube', text: 'LUT_3D_SIZE 999999999\n0 0 0\n', kind: 'lut' },
  { label: 'zero-byte .cube', file: 'empty.cube', text: '', kind: 'lut' },
  { label: 'truncated PNG (valid header, no real image data)', file: 'truncated.png', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]), kind: 'image' },
  { label: 'zero-byte image file', file: 'empty.png', bytes: Buffer.alloc(0), kind: 'image' },
  { label: 'renamed non-image as .png (text content, .png extension)', file: 'fake.png', text: 'not actually a png', kind: 'image' },
];

const browser = await chromium.launch();
const findings = [];

for (const c of CASES) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { if (typeof fxSection === 'function') fxSection('looks', true); });

  const payload = c.bytes ? Buffer.from(c.bytes).toString('base64') : Buffer.from(c.text, 'utf8').toString('base64');
  const TIMEOUT_MS = 8000; // generous — a real parse/decode should settle in well under a second

  const outcome = await Promise.race([
    page.evaluate(async ({ name, b64, kind }) => {
      try {
        const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
        const file = new File([bytes], name, { type: kind === 'image' ? 'image/png' : 'text/plain' });
        if (kind === 'lut') {
          if (typeof hf === 'function') await hf(file, 'fx-lut');
        } else if (typeof loadFXImages === 'function') {
          await loadFXImages([file]);
        }
        return { settled: true };
      } catch (e) {
        return { settled: true, threw: e.message }; // a caught, reported error is a PASS — the failure mode this guards against is a HANG, not an error
      }
    }, { name: c.file, b64: payload, kind: c.kind }),
    new Promise((resolve) => setTimeout(() => resolve({ settled: false }), TIMEOUT_MS)),
  ]);

  if (!outcome.settled) {
    findings.push(`${c.label}: did not settle within ${TIMEOUT_MS}ms — possible hang on adversarial input`);
  }
  if (pageErrors.length) {
    findings.push(`${c.label}: uncaught page error(s): ${pageErrors.join('; ')}`);
  }
  await page.close();
}

await browser.close();
server.close();

console.log('EDITOR FUZZ/MALFORMED-INPUT CHECK (T38)');
console.log('='.repeat(78));
console.log(`  ${CASES.length} adversarial fixture(s) run through the real hf()/loadFXImages() entry points`);
if (findings.length) {
  findings.forEach((f) => console.log('  ' + f));
  console.log(`\n${findings.length} finding(s).`);
  console.log('RESULT: FAIL');
  process.exit(1);
} else {
  console.log('Every malformed fixture settled within the timeout with no uncaught error.');
  console.log('RESULT: PASS');
}
