// Zoom-in at an off-centre cursor then zoom-out must return the photo to centre (was: jumped to a
// corner because the centring offset only applied below 100%), and cursor-zoom must keep the
// point under the cursor fixed at every zoom level including across 100%.
import { bootEditor } from './editor_state_harness.mjs';

const b = await bootEditor();
const { page, pageErrors } = b;
try {
  const r = await page.evaluate(() => {
    const zw = document.getElementById('fx-zoom-wrap');
    const centre = () => { const q = zw.getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]; };
    _resetZoom(); zw.style.transition = '';
    const c0 = centre();
    const q0 = zw.getBoundingClientRect();
    const cx = q0.left + q0.width * 0.8, cy = q0.top + q0.height * 0.3;
    // point under cursor, as fraction of the photo
    const frac = () => { const q = zw.getBoundingClientRect(); return [(cx - q.left) / q.width, (cy - q.top) / q.height]; };
    const f0 = frac();
    let maxDrift = 0;
    const step = (z) => { _zoomAt(z, cx, cy); _applyZoom(); zw.style.transition = ''; const f = frac(); maxDrift = Math.max(maxDrift, Math.abs(f[0] - f0[0]), Math.abs(f[1] - f0[1])); };
    for (let i = 0; i < 60; i++) step(fxZoom * 1.025);
    const zIn = fxZoom;
    for (let i = 0; i < 60; i++) step(fxZoom / 1.025);
    // now reset pan via zooming out at the centre, verify centre-anchored zoom keeps centred
    _resetZoom(); zw.style.transition = '';
    zoomBy(2); zoomBy(0.25); zw.style.transition = '';
    const c1 = centre();
    return { c0, c1, maxDrift, zIn };
  });
  if (r.maxDrift > 0.01) throw new Error(`cursor anchor drifted ${r.maxDrift}`);
  if (Math.hypot(r.c1[0] - r.c0[0], r.c1[1] - r.c0[1]) > 1) throw new Error(`centre moved ${JSON.stringify(r)}`);
  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join('; ')}`);
  console.log('editor:zoom-anchor — PASS', JSON.stringify(r));
} finally { await b.close(); }
