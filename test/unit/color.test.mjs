// Fast unit tests (no browser) for the pure colour maths. Run: node --test test/unit/
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './extract.mjs';

const ok = load(['s2l', 'l2s', '_okCbrt', 'rgb2oklab', 'rgb2oklch', 'oklch2rgb']);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b}`);

test('oklab: white is L=1 with no chroma, black is L=0', () => {
  const [L, a, b] = ok.rgb2oklab(1, 1, 1);
  near(L, 1, 1e-3); near(a, 0, 1e-3); near(b, 0, 1e-3);
  near(ok.rgb2oklab(0, 0, 0)[0], 0, 1e-9);
});

test('oklab: rgb -> oklch -> rgb round-trips across the gamut grid', () => {
  for (let r = 0; r <= 1; r += 0.25) for (let g = 0; g <= 1; g += 0.25) for (let b = 0; b <= 1; b += 0.25) {
    const [h, C, L] = ok.rgb2oklch(r, g, b);
    const back = ok.oklch2rgb(h, C, L);
    near(back[0], r, 2e-3, `r@${r},${g},${b}`); near(back[1], g, 2e-3, 'g'); near(back[2], b, 2e-3, 'b');
  }
});

test('oklab: known reference value for pure red (Ottosson)', () => {
  const [L, a, b] = ok.rgb2oklab(1, 0, 0);
  near(L, 0.6280, 2e-3); near(a, 0.2249, 2e-3); near(b, 0.1258, 2e-3);
});

test('oklch hue is a turn in [0,1)', () => {
  for (const c of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1], [1, 0, 1]]) {
    const h = ok.rgb2oklch(...c)[0]; assert.ok(h >= 0 && h < 1, 'hue ' + h);
  }
});

const pp = load(['_mat3Mul', 'PROPHOTO_TO_XYZ_D50', 'XYZ_D50_TO_D65_BRADFORD', 'XYZ_D65_TO_SRGB_LINEAR',
  'PROPHOTO_LINEAR_TO_SRGB_LINEAR', 'proPhotoDecodeTRC', 'srgbEncodeTRC', 'PROPHOTO_DECODE_LUT', 'convertProPhotoRGBAtoSRGB']);
pp.window._proPhotoMatrixOk = true;

test('prophoto: matrix maps white to white', () => {
  const m = pp.PROPHOTO_LINEAR_TO_SRGB_LINEAR;
  for (let r = 0; r < 3; r++) near(m[r * 3] + m[r * 3 + 1] + m[r * 3 + 2], 1, 1e-3);
});

test('prophoto: TRC is continuous at the toe and hits 0/1', () => {
  near(pp.proPhotoDecodeTRC(0.03125 - 1e-9), pp.proPhotoDecodeTRC(0.03125 + 1e-9), 1e-3);
  near(pp.proPhotoDecodeTRC(0), 0, 0); near(pp.proPhotoDecodeTRC(1), 1, 1e-9);
});

test('srgb encode: clamps, known mid value, linear toe', () => {
  near(pp.srgbEncodeTRC(-1), 0, 1e-12); near(pp.srgbEncodeTRC(2), 1, 1e-12);
  near(pp.srgbEncodeTRC(0.2140), 0.5, 1e-3); near(pp.srgbEncodeTRC(0.001), 0.01292, 1e-6);
});

test('prophoto -> sRGB 8-bit: white/black fixed, alpha untouched, grey ramp monotonic', () => {
  const px = new Uint8ClampedArray([255, 255, 255, 7, 0, 0, 0, 9]);
  pp.convertProPhotoRGBAtoSRGB(px);
  assert.deepEqual([...px], [255, 255, 255, 7, 0, 0, 0, 9]);
  const ramp = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) ramp.set([i, i, i, 255], i * 4);
  pp.convertProPhotoRGBAtoSRGB(ramp);
  for (let i = 1; i < 256; i++) assert.ok(ramp[i * 4] >= ramp[(i - 1) * 4], 'monotonic at ' + i);
  assert.equal(ramp[255 * 4], 255);
});
