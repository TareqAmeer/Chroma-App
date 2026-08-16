// HDR from RAW (ROADMAP 13/14's replacement — see gainmap.rs's "HDR from RAW" section and
// applyDcpLUT's hrOut comment). CIRAWFilter was measured directly against a real RW2 and does
// nothing for this camera's files, so headroom comes from OUR OWN DCP-LUT trilinear sampling,
// which the LookTable already carries in extended range ("TABLE-INDEX clamps only, values
// extended-range" — CLAUDE.md §7) before the final +0.5 clamp throws it away.
//
// This probe covers the two things a Rust-only test can't: that applyDcpLUT's SDR output is
// byte-identical whether or not hrOut is supplied (no regression to every existing RAW photo),
// and that the headroom map survives geometry (crop/rotate/flip/straighten) pixel-aligned with
// the photo, via the SAME applyGeomTo the photo itself uses. The Core Image compositing math
// (gamma pre-encode, CIColorMatrix, the multiply) is verified separately and more directly in
// desktop/src-tauri/examples/gainmap_from_map_probe.rs, against real Core Image calls a browser
// harness cannot reach.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const ROOT = process.cwd();
const server = createServer(async (req, res) => {
  try {
    const u = req.url.split('?')[0];
    const d = await readFile(path.join(ROOT, decodeURIComponent(u).slice(1)));
    res.writeHead(200, { 'Content-Type': u.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
let pageError = null;
p.on('pageerror', (e) => { pageError = e.message; console.log('[pageerror]', e.message); });
await p.goto(`http://127.0.0.1:${server.address().port}/chromasmith-22.html`, { waitUntil: 'load' });
await p.waitForFunction(() => typeof applyDcpLUT === 'function' && typeof _hdrHeadroomPngFor === 'function');

const dcp = await p.evaluate(() => {
  // Synthetic LUT with entries that deliberately EXCEED 1.0 — real DCP LookTables carry
  // extended-range values, and a LUT capped at 1.0 would never exercise the clamp-vs-track path.
  const N = 5, data = new Float32Array(N * N * N * 3);
  for (let bb = 0; bb < N; bb++) for (let gg = 0; gg < N; gg++) for (let rr = 0; rr < N; rr++) {
    const idx = 3 * ((bb * N + gg) * N + rr);
    data[idx] = (rr / (N - 1)) * 1.4; data[idx + 1] = (gg / (N - 1)) * 1.4; data[idx + 2] = (bb / (N - 1)) * 1.4;
  }
  const lut = { n: N, data };
  const w = 37, h = 23, u16 = new Uint16Array(w * h * 3);
  for (let i = 0; i < u16.length; i++) u16[i] = Math.floor(Math.random() * 65536);
  const withoutHr = applyDcpLUT(u16, w, h, lut);
  const hrOut = new Uint8ClampedArray(w * h);
  const withHr = applyDcpLUT(u16, w, h, lut, hrOut);
  let diff = 0; for (let i = 0; i < withoutHr.length; i++) if (withoutHr[i] !== withHr[i]) diff++;
  let anyHeadroom = 0; for (let i = 0; i < hrOut.length; i++) if (hrOut[i] > 0) anyHeadroom++;
  return { rgbaBytesDiffering: diff, totalBytes: withoutHr.length, pixelsWithHeadroom: anyHeadroom, totalPixels: w * h };
});

const geom = await p.evaluate(() => {
  const hw = 40, hh = 30, data = new Uint8ClampedArray(hw * hh);
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) data[y * hw + x] = (x < hw / 2 && y < hh / 2) ? 255 : 0;
  const img = document.createElement('canvas'); img.width = hw; img.height = hh;
  img.getContext('2d').fillStyle = '#888'; img.getContext('2d').fillRect(0, 0, hw, hh);
  img._hdrHeadroom = { data, w: hw, h: hh }; img._hdrHeadroomPresent = true;
  const it = { img, geom: defGeom(), _exportW: 80, _exportH: 60 };
  const c1 = _hdrHeadroomPngFor(it, 80, 60);
  const noRot = { topLeft: c1.getContext('2d').getImageData(5, 5, 1, 1).data[0], bottomRight: c1.getContext('2d').getImageData(75, 55, 1, 1).data[0] };
  it.geom = { ...defGeom(), rot: 180 };
  const c2 = _hdrHeadroomPngFor(it, 80, 60);
  const rot180 = { topLeft: c2.getContext('2d').getImageData(5, 5, 1, 1).data[0], bottomRight: c2.getContext('2d').getImageData(75, 55, 1, 1).data[0] };
  return { noRot, rot180 };
});

console.log('applyDcpLUT SDR output, with vs without hrOut:', JSON.stringify(dcp));
console.log('headroom map geometry alignment:', JSON.stringify(geom));
await b.close(); server.close();

const dcpOk = dcp.rgbaBytesDiffering === 0 && dcp.pixelsWithHeadroom > 0;
const geomOk = geom.noRot.topLeft > 200 && geom.noRot.bottomRight < 20 && geom.rot180.topLeft < 20 && geom.rot180.bottomRight > 200;
console.log(dcpOk && geomOk && !pageError ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(dcpOk && geomOk && !pageError ? 0 : 1);
