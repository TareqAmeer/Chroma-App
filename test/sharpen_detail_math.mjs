// CHR-249: Lightroom-style sharpening Detail balance between edges and fine texture.
import assert from 'node:assert/strict';

function sharpenSignal(edge, texture, detail) {
  const t = Math.max(0, Math.min(1, (detail - 0.5) * 2));
  return edge * (1 - t) + texture * t;
}

assert.equal(sharpenSignal(0.4, 0.2, 0.5), 0.4, 'default preserves the existing radius-1 edge signal');
assert.equal(sharpenSignal(0.4, 0.2, 0), 0.4, 'low detail emphasizes edges');
assert.equal(sharpenSignal(0.4, 0.2, 1), 0.2, 'high detail emphasizes finer texture');
assert.equal(sharpenSignal(0.4, 0.2, -1), 0.4, 'values clamp at the edge-only endpoint');
assert.equal(sharpenSignal(0.4, 0.2, 2), 0.2, 'values clamp at the texture endpoint');
console.log('SHARPEN DETAIL MATH: PASS');
