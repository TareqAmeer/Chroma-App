// CHR-142: at greater-than-fit zoom, dragging the image must not be constrained to the
// viewport-covering range. Users need to be able to move it freely in either direction.
import { bootEditor } from './editor_state_harness.mjs';

const b = await bootEditor();
const { page, pageErrors } = b;

try {
  const result = await page.evaluate(() => {
    const zw = document.getElementById('fx-zoom-wrap');
    if (!zw || typeof _applyZoom !== 'function') throw new Error('zoom surface is unavailable');

    fxZoom = 2;
    fxPanX = 180;
    fxPanY = 140;
    _applyZoom();
    const positive = { x: fxPanX, y: fxPanY };

    fxPanX = -9999;
    fxPanY = -9999;
    _applyZoom();
    const negative = { x: fxPanX, y: fxPanY };

    fxZoom = 0.75;
    fxPanX = 0;
    fxPanY = 0;
    _applyZoom();
    const transform = zw.style.transform;
    return { positive, negative, transform };
  });

  if (result.positive.x !== 180 || result.positive.y !== 140) {
    throw new Error(`positive zoom pan was constrained: ${JSON.stringify(result.positive)}`);
  }
  if (result.negative.x !== -9999 || result.negative.y !== -9999) {
    throw new Error(`negative zoom pan was constrained: ${JSON.stringify(result.negative)}`);
  }
  if (!/scale\(0\.75\).*translate\([^0]/.test(result.transform)) {
    throw new Error(`sub-100% centering was lost: ${result.transform}`);
  }
  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join('; ')}`);
  console.log('editor:pan-check — PASS: zoomed pan is unconstrained; sub-100% centering remains.');
} finally {
  await b.close();
}
