// CHR-248 Upright Level / Vertical on synthetic images with a known answer.
import { load } from './extract.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
const ctx = load(['upLineSegments', '_upAxisDev', '_upWMedian', 'upLevelAngle', '_upH', '_upSrcLine', '_upVertResid', 'upFitVertical'], { Uint8Array, Float64Array });

// Anti-aliased dark segments (2px wide) on a mid-grey background, y-down pixel coords.
function draw(w, h, segs) {
  const g = new Float32Array(w * h).fill(0.7);
  for (const [x1, y1, x2, y2] of segs) {
    const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
    const minx = Math.max(0, Math.floor(Math.min(x1, x2) - 3)), maxx = Math.min(w - 1, Math.ceil(Math.max(x1, x2) + 3));
    const miny = Math.max(0, Math.floor(Math.min(y1, y2) - 3)), maxy = Math.min(h - 1, Math.ceil(Math.max(y1, y2) + 3));
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L2));
      const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
      const a = Math.max(0, Math.min(1, 1.5 - d));
      g[y * w + x] = Math.min(g[y * w + x], 0.7 - 0.6 * a);
    }
  }
  return g;
}
const rotSeg = (s, deg, cx, cy) => { const a = deg * Math.PI / 180, c = Math.cos(a), si = Math.sin(a);
  const r = (x, y) => [cx + (x - cx) * c - (y - cy) * si, cy + (x - cx) * si + (y - cy) * c];
  return [...r(s[0], s[1]), ...r(s[2], s[3])]; };

for (const tilt of [-6, -2.5, 3, 8]) {
  test(`Level recovers a grid rotated by ${tilt} deg`, () => {
    const w = 480, h = 320, grid = [];
    for (let x = 60; x <= 420; x += 60) grid.push([x, 40, x, 280]);
    for (let y = 60; y <= 260; y += 50) grid.push([40, y, 440, y]);
    const g = draw(w, h, grid.map(s => rotSeg(s, tilt, w / 2, h / 2)));
    const segs = ctx.upLineSegments(g, w, h);
    assert.ok(segs.length >= 6, `found ${segs.length} segments`);
    const corr = ctx.upLevelAngle(segs, w, h);
    assert.ok(corr !== null, 'Level found evidence');
    assert.ok(Math.abs(corr + tilt) <= 0.3, `Level ${corr} should undo ${tilt}`);
  });
}

test('Level declines on a featureless image', () => {
  const w = 200, h = 150, g = new Float32Array(w * h).fill(0.5);
  assert.equal(ctx.upLevelAngle(ctx.upLineSegments(g, w, h), w, h), null);
});

// Keystone: vertical lines in the CORRECTED (output) frame, mapped to the source through the
// shader's own output->source homography with a known pv, are what a tilted-up camera records.
for (const pv0 of [0.15, -0.22, 0.3]) {
  test(`Vertical makes keystoned verticals parallel (pv ${pv0})`, () => {
    const w = 360, h = 480, H = ctx._upH(pv0, 0, 0);
    const toPx = (cx, cy) => { const X = H[0] * cx + H[1] * cy + H[2], Y = H[3] * cx + H[4] * cy + H[5], W = H[6] * cx + H[7] * cy + H[8];
      return [(X / W + 0.5) * w, (0.5 - Y / W) * h]; };
    const segs0 = [];
    for (const cx of [-0.32, -0.18, 0.05, 0.2, 0.33]) segs0.push([...toPx(cx, -0.35), ...toPx(cx, 0.35)]);
    segs0.push([...toPx(-0.3, -0.1), ...toPx(0.3, -0.1)]); // one horizontal, must be ignored
    const g = draw(w, h, segs0);
    const segs = ctx.upLineSegments(g, w, h);
    const before = segs.filter(s => ctx._upAxisDev(s).axis === 'v').map(s => ctx._upAxisDev(s).dev);
    assert.ok(Math.max(...before) - Math.min(...before) > 2, 'synthetic verticals really converge');
    const f = ctx.upFitVertical(segs, w, h, 0);
    assert.ok(f, 'Vertical found lines');
    assert.ok(Math.abs(f.pv - pv0) < 0.03, `pv ${f.pv} vs ${pv0}`);
    assert.ok(Math.abs(f.rot) < 0.01, `rot ${f.rot}`);
    const Hf = ctx._upH(f.pv, 0, f.rot);
    for (const s of segs.filter(s => ctx._upAxisDev(s).axis === 'v')) {
      const r = Math.asin(Math.abs(ctx._upVertResid(ctx._upSrcLine(s, w, h), Hf, w, h))) * 180 / Math.PI;
      assert.ok(r < 0.6, `corrected vertical still ${r.toFixed(2)} deg off`);
    }
  });
}
